"""Workspace file editing and a real PTY in the existing runtime container.

The PTY is deliberately not a sandbox: it has the service user's filesystem/GPU
access. The editor's path guards limit file operations, not shell execution.
"""
from __future__ import annotations

import asyncio
import codecs
import hashlib
import os
from pathlib import Path
import secrets
import signal
import shutil
import tempfile

from anyio import CancelScope
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


class WriteFile(BaseModel):
    path: str
    content: str = Field(max_length=262144)
    etag: str | None = None


class RenameFile(BaseModel):
    path: str
    destination: str
    etag: str


def workspace_path(root: Path, name: str) -> Path:
    relative = Path(name)
    if not name or "\x00" in name or relative.is_absolute() or any(part.startswith(".") for part in relative.parts):
        raise HTTPException(422, "Use a relative, non-hidden workspace file path")
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()) or any(p.is_symlink() for p in [path, *path.parents] if p != root.parent):
        raise HTTPException(422, "Symlink paths are not editable")
    return path


def file_info(path: Path, root: Path) -> dict:
    if not path.is_file():
        raise HTTPException(404, "File not found")
    if path.stat().st_size > 262144:
        raise HTTPException(413, "Editor limit is 256 KiB")
    data = path.read_bytes()
    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(422, "Only UTF-8 text files are editable") from exc
    return {"path": str(path.relative_to(root)), "content": content, "etag": hashlib.sha256(data).hexdigest()}


def create_parent(path: Path, root: Path):
    missing = []
    parent = path.parent
    while parent != root and not parent.exists():
        missing.append(parent)
        parent = parent.parent
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.geteuid() == 0:
        owner = root.stat()
        for directory in missing:
            os.chown(directory, owner.st_uid, owner.st_gid)


def access_token(root: Path) -> str:
    path = root / ".cli-token"
    if not path.exists():
        root.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "w") as file:
                file.write(secrets.token_urlsafe(32))
            if os.geteuid() == 0:
                stat = root.stat()
                os.chown(path, stat.st_uid, stat.st_gid)
    return path.read_text().strip()


async def read_pty(fd: int) -> bytes:
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    def ready():
        if future.done():
            return
        try:
            future.set_result(os.read(fd, 8192))
        except BlockingIOError:
            return
        except OSError:
            future.set_result(b"")
    loop.add_reader(fd, ready)
    try:
        return await future
    finally:
        loop.remove_reader(fd)


def stop_pty(process):
    # Include foreground/background process groups in this terminal session.
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            try:
                pid = int(entry.name)
                if os.getsid(pid) == process.pid:
                    os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
    process.close(force=True)


def create_cli_router(root: Path, auth_enabled, allowed_origins: list[str]) -> APIRouter:
    router = APIRouter(prefix="/api/cli")
    active = set()
    sessions = set()

    def enabled():
        return os.environ.get("OBJECT_AUTOLABEL_CLI_ENABLED", "true").lower() in {"1", "true"}

    def check_token():
        if not enabled():
            raise HTTPException(403, "CLI workspace is disabled")

    def check(request: Request):
        check_token()

    @router.get("/capabilities")
    def capabilities():
        return {"enabled": enabled(), "root": str(root), "token_file": None, "max_terminals": 6}

    @router.post("/unlock")
    def unlock(request: Request):
        check(request)
        return {"ok": True}

    @router.get("/files")
    def files(request: Request):
        check(request)
        items = []
        for path in root.rglob("*"):
            relative = path.relative_to(root)
            if path.is_file() and not path.is_symlink() and not any(p.startswith(".") or p == "__pycache__" for p in relative.parts):
                items.append(str(relative))
                if len(items) > 1000:
                    raise HTTPException(413, "Workspace file count exceeds 1000")
        return sorted(items)

    @router.get("/file")
    def read_file(request: Request, path: str):
        check(request)
        return file_info(workspace_path(root, path), root)

    @router.put("/file")
    def write_file(request: Request, body: WriteFile):
        check(request)
        path = workspace_path(root, body.path)
        data = body.content.encode("utf-8")
        if len(data) > 262144:
            raise HTTPException(413, "Editor limit is 256 KiB")
        if path.exists() and file_info(path, root)["etag"] != body.etag:
            raise HTTPException(409, "File changed; reload before saving")
        if not path.exists() and body.etag is not None:
            raise HTTPException(409, "File was removed; reload before saving")
        owner = path.stat() if path.exists() else root.stat()
        mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
        create_parent(path, root)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(data)
        temporary.chmod(mode)
        if os.geteuid() == 0:
            os.chown(temporary, owner.st_uid, owner.st_gid)
        temporary.replace(path)
        return file_info(path, root)

    @router.post("/rename")
    def rename_file(request: Request, body: RenameFile):
        check(request)
        path = workspace_path(root, body.path)
        target = workspace_path(root, body.destination)
        if file_info(path, root)["etag"] != body.etag:
            raise HTTPException(409, "File changed; reload before renaming")
        if target.exists():
            raise HTTPException(409, "Destination already exists")
        create_parent(target, root)
        path.rename(target)
        return file_info(target, root)

    @router.delete("/file")
    def delete_file(request: Request, path: str, etag: str):
        check(request)
        selected = workspace_path(root, path)
        if file_info(selected, root)["etag"] != etag:
            raise HTTPException(409, "File changed; reload before deleting")
        selected.unlink()
        return {"ok": True}

    @router.get("/preview")
    def preview(request: Request, session: str = ""):
        check(request)
        if session not in sessions:
            raise HTTPException(404, "Terminal session not found")
        path = root / ".preview" / session / "frame.jpg"
        if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
            raise HTTPException(404, "No preview yet")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @router.websocket("/terminal")
    async def terminal(socket: WebSocket):
        origin = socket.headers.get("origin", "").rstrip("/")
        host = socket.headers.get("host")
        if origin not in {f"http://{host}", f"https://{host}", *allowed_origins} or (auth_enabled() and not socket.session.get("user")):
            await socket.close(code=1008)
            return
        await socket.accept()
        process = None
        tasks = []
        closing = False
        session = secrets.token_hex(16)
        display_dir = root / ".preview" / session
        try:
            hello = await asyncio.wait_for(socket.receive_json(), 10)
            check_token()
            if len(active) >= 6:
                raise ValueError("At most six CLI terminals may be open")
            from ptyprocess import PtyProcess
            display_dir.mkdir(parents=True)
            environment = {**os.environ, "TERM": "xterm-256color", "PYTHONUNBUFFERED": "1", "YOLO_AUTOINSTALL": "False",
                           "PYTHONPATH": str(root), "PS1": "cli_workspace $ ", "HISTFILE": "/dev/null",
                           "OBJECT_AUTOLABEL_CLI_DISPLAY": str(display_dir)}
            process = PtyProcess.spawn(["/bin/bash", "--noprofile", "--norc", "-i"], cwd=str(root), env=environment)
            active.add(process.pid)
            sessions.add(session)
            os.set_blocking(process.fd, False)
            await socket.send_json({"type": "started", "cwd": str(root), "session": session})
            async def display_requests():
                previous = ""
                while not closing:
                    request_path = display_dir / "request"
                    ticket = request_path.read_text() if request_path.exists() else ""
                    if ticket and ticket != previous:
                        previous = ticket
                        (display_dir / "frame.jpg").unlink(missing_ok=True)
                        (display_dir / "stop").unlink(missing_ok=True)
                        await socket.send_json({"type": "display_request", "ticket": ticket})
                    await asyncio.sleep(.05)
            async def output():
                decoder = codecs.getincrementaldecoder("utf-8")("replace")
                while not closing:
                    data = await read_pty(process.fd)
                    if not data:
                        return
                    await asyncio.wait_for(socket.send_json({"type": "output", "data": decoder.decode(data)}), 15)
            async def input_data():
                while not closing:
                    message = await socket.receive_json()
                    if message.get("type") == "display_grant":
                        ticket = str(message.get("ticket", ""))
                        request_path = display_dir / "request"
                        if request_path.exists() and request_path.read_text() == ticket:
                            (display_dir / "grant").write_text(ticket)
                    elif message.get("type") == "interrupt":
                        foreground = os.tcgetpgrp(process.fd)
                        if foreground != process.pid:
                            try:
                                # The video utility can release V4L2 between reads;
                                # other shell programs still receive normal SIGINT.
                                (display_dir / "stop").touch()
                                for _ in range(30):
                                    if os.tcgetpgrp(process.fd) == process.pid:
                                        break
                                    await asyncio.sleep(.05)
                                if os.tcgetpgrp(process.fd) != process.pid:
                                    os.killpg(foreground, signal.SIGINT)
                                for _ in range(100):
                                    if os.tcgetpgrp(process.fd) == process.pid:
                                        break
                                    await asyncio.sleep(.05)
                                else:
                                    os.killpg(foreground, signal.SIGKILL)
                                    for _ in range(40):
                                        if os.tcgetpgrp(process.fd) == process.pid:
                                            break
                                        await asyncio.sleep(.05)
                                    else:
                                        raise RuntimeError("Terminal command did not release the display")
                            except ProcessLookupError:
                                pass
                        await socket.send_json({"type": "interrupted"})
                    elif message.get("type") == "resize":
                        process.setwinsize(max(2, min(100, int(message["rows"]))), max(20, min(300, int(message["cols"]))))
                    elif message.get("type") == "input":
                        data = str(message.get("data", "")).encode()
                        if len(data) > 65536:
                            raise ValueError("Terminal input exceeds 64 KiB")
                        while data:
                            try:
                                data = data[os.write(process.fd, data):]
                            except BlockingIOError:
                                await asyncio.sleep(.01)
            tasks = [asyncio.create_task(output()), asyncio.create_task(input_data()), asyncio.create_task(display_requests())]
            done, _ = await asyncio.wait(tasks, timeout=3600, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            try:
                await socket.send_json({"type": "error", "message": str(getattr(exc, "detail", exc))})
            except (WebSocketDisconnect, RuntimeError):
                pass
        finally:
            # ASGI cancellation must not interrupt process reaping on disconnect.
            with CancelScope(shield=True):
                # A transport send can complete concurrently with cancellation.
                # Do not re-enter an idle PTY read after that send completes.
                closing = True
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                if process:
                    await asyncio.to_thread(stop_pty, process)
                    active.discard(process.pid)
                sessions.discard(session)
                shutil.rmtree(display_dir, ignore_errors=True)
                try:
                    await socket.close()
                except RuntimeError:
                    pass
    return router
