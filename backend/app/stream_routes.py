from __future__ import annotations

import asyncio
import json
from pathlib import Path
import subprocess
import shlex
from typing import Callable
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from . import stream_demo as stream
from .repositories import Repository


def create_stream_router(get_repo: Callable[[], Repository], auth_enabled: Callable[[], bool], allowed_origins: list[str]) -> APIRouter:
    router = APIRouter(prefix="/api")
    active: dict[str, stream.StreamConfig] = {}

    @router.get("/stream-demo/capabilities")
    def capabilities():
        return stream.capabilities()

    @router.get("/projects/{project_id}/stream-demo/models")
    def models(project_id: str):
        if not get_repo().get_project(project_id):
            raise HTTPException(404, "Project not found")
        return [{key: value for key, value in item.items() if key != "path"} for item in stream.list_models(get_repo(), project_id)]

    @router.get("/projects/{project_id}/stream-demo/uploads")
    def uploads(project_id: str):
        try:
            return stream.list_uploads(get_repo(), project_id)
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc

    @router.post("/projects/{project_id}/stream-demo/verify-command")
    def verify_command(project_id: str, config: stream.StreamConfig):
        repo = get_repo()
        if not repo.get_project(project_id):
            raise HTTPException(404, "Project not found")
        selected = next((model for model in stream.list_models(repo, project_id) if model["id"] == config.model_id), None)
        if not selected:
            raise HTTPException(404, "Conversion model not found")
        if not selected.get("available", True):
            raise HTTPException(422, selected.get("reason") or "The selected model failed runtime contract validation")
        if config.source == "upload":
            try:
                source = str(stream.resolve_upload(repo, project_id, config.source_id))
            except (ValueError, FileNotFoundError) as exc:
                raise HTTPException(404, "Uploaded video not found") from exc
        else:
            import re
            if not re.fullmatch(r"video\d+", config.source_id):
                raise HTTPException(422, "Select a host camera")
            source = str(Path("/dev") / config.source_id)
        device = config.device if selected["format"] == "pt" else "cpu"
        code = (f"from utils import run_video; run_video({json.dumps(selected['path'])}, source={json.dumps(source)}, "
                f"conf={config.conf!r}, iou={config.iou!r}, imgsz={config.imgsz}, fps={config.fps}, device={json.dumps(device)})")
        return {"command": shlex.join(["python", "-c", code])}

    @router.post("/projects/{project_id}/stream-demo/uploads", status_code=201)
    async def upload(project_id: str, request: Request, filename: str):
        suffix = Path(filename).suffix.lower()
        if suffix not in stream.VIDEO_SUFFIXES:
            raise HTTPException(422, "Supported video files: MP4, MOV, MKV, WebM, AVI, M4V")
        try:
            root = stream.upload_dir(get_repo(), project_id)
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        root.mkdir(parents=True, exist_ok=True)
        destination = root / f"{uuid4().hex}{suffix}"
        partial = destination.with_suffix(suffix + ".part")
        size = 0
        try:
            async def receive_upload():
                nonlocal size
                with partial.open("xb") as output:
                    async for chunk in request.stream():
                        size += len(chunk)
                        if size > stream.MAX_UPLOAD_BYTES:
                            raise HTTPException(413, "Video exceeds the 1 GiB upload limit")
                        output.write(chunk)
            await asyncio.wait_for(receive_upload(), 300)
            info = await asyncio.to_thread(stream.probe_video, partial)
            partial.rename(destination)
            item = {"id": destination.name, "name": Path(filename).name[:200], "bytes": size, **info}
            destination.with_suffix(".json").write_text(json.dumps(item), encoding="utf-8")
            return item
        except (ValueError, subprocess.SubprocessError) as exc:
            raise HTTPException(422, "Cannot decode uploaded video") from exc
        except asyncio.TimeoutError as exc:
            raise HTTPException(408, "Video upload timed out") from exc
        finally:
            partial.unlink(missing_ok=True)
            if not destination.with_suffix(".json").exists():
                destination.unlink(missing_ok=True)

    @router.delete("/projects/{project_id}/stream-demo/uploads/{source_id}")
    def delete_upload(project_id: str, source_id: str):
        if project_id in active and active[project_id].source_id == source_id:
            raise HTTPException(409, "Stop the stream before deleting this video")
        try:
            path = stream.resolve_upload(get_repo(), project_id, source_id)
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(404, "Uploaded video not found") from exc
        path.unlink()
        path.with_suffix(".json").unlink(missing_ok=True)
        return {"ok": True}

    @router.websocket("/projects/{project_id}/stream-demo/live")
    async def live(websocket: WebSocket, project_id: str):
        origin = websocket.headers.get("origin", "").rstrip("/")
        same_origin = {f"http://{websocket.headers.get('host')}", f"https://{websocket.headers.get('host')}"}
        if origin not in same_origin | set(allowed_origins) or (auth_enabled() and not websocket.session.get("user")):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        session = None
        owns_slot = False
        try:
            config = stream.StreamConfig.model_validate(await asyncio.wait_for(websocket.receive_json(), 15))
            if active:
                raise ValueError("Another Stream Demo session is active. Stop it before starting a new session.")
            if not get_repo().get_project(project_id):
                raise ValueError("Project not found")
            active[project_id] = config
            owns_slot = True
            selected = next((m for m in stream.list_models(get_repo(), project_id) if m["id"] == config.model_id), None)
            if not selected:
                raise ValueError("The selected conversion model is unavailable")
            if not selected.get("available", True):
                raise ValueError(selected.get("reason") or "The selected model failed runtime contract validation")
            caps = await asyncio.to_thread(stream.capabilities)
            if not caps["available"]:
                raise ValueError("GStreamer plugins unavailable: " + ", ".join(caps["missing_plugins"]))
            engine = caps["engines"][selected["format"]]
            if not engine["available"]:
                raise ValueError(engine["reason"])
            if config.device == "0" and (selected["format"] != "pt" or not caps["cuda"]):
                raise ValueError("CUDA is only available for native PT models on this runtime")
            mode = None
            if config.source == "upload":
                source = stream.resolve_upload(get_repo(), project_id, config.source_id)
            else:
                camera = next((c for c in caps["cameras"] if c["id"] == config.source_id), None)
                mode = next((m for m in camera["modes"] if m["id"] == config.camera_mode), None) if camera else None
                if not mode:
                    raise ValueError("Select a capture mode reported by the camera")
                if config.fps > mode["fps"]:
                    raise ValueError("Output FPS exceeds the camera capture mode")
                source = Path("/dev") / camera["id"]
            session = stream.StreamSession(config, selected["path"], source, mode)
            await session.run(websocket)
        except WebSocketDisconnect:
            pass
        except (ValueError, ValidationError, RuntimeError, OSError, asyncio.TimeoutError) as exc:
            try:
                message = "Stream timed out while waiting for video or client data" if isinstance(exc, asyncio.TimeoutError) else str(exc)
                await websocket.send_json({"type": "error", "message": message[:1500]})
            except (RuntimeError, WebSocketDisconnect):
                pass
        finally:
            if session:
                await session.close()
            if owns_slot:
                active.pop(project_id, None)
            try:
                await websocket.close()
            except (RuntimeError, WebSocketDisconnect):
                pass

    return router
