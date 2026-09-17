import os
import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi import WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app.cli_workspace import access_token, create_cli_router


@pytest.fixture
def cli(tmp_path, monkeypatch):
    monkeypatch.setenv("OBJECT_AUTOLABEL_CLI_ENABLED", "true")
    root = tmp_path / "cli_workspace"
    app = FastAPI()
    app.include_router(create_cli_router(root, lambda: False, []))
    with TestClient(app) as client:
        yield client, root, {"X-CLI-Token": access_token(root)}


def test_disabled_and_token_gate(cli, monkeypatch):
    client, root, headers = cli
    assert client.get("/api/cli/files").status_code == 200
    assert client.get("/api/cli/files", headers={"X-CLI-Token": "bad"}).status_code == 200
    assert client.get("/api/cli/capabilities").json()["enabled"]
    assert root.joinpath(".cli-token").stat().st_mode & 0o777 == 0o600
    monkeypatch.setenv("OBJECT_AUTOLABEL_CLI_ENABLED", "false")
    assert client.get("/api/cli/files", headers=headers).status_code == 403


def test_file_crud_conflicts_and_hidden_token(cli):
    client, root, headers = cli
    def put(**body):
        return client.put("/api/cli/file", headers=headers, json=body)
    created = put(path="utils/check.py", content="print('first')")
    assert created.status_code == 200
    original = created.json()
    assert put(path=original["path"], content="overwrite").status_code == 409
    updated = put(**{**original, "content": "print('second')"}).json()
    assert updated["etag"] != original["etag"]
    assert put(**original).status_code == 409
    renamed = client.post("/api/cli/rename", headers=headers, json={"path": updated["path"], "destination": "examples/renamed.py", "etag": updated["etag"]}).json()
    assert client.get("/api/cli/files", headers=headers).json() == ["examples/renamed.py"]
    assert client.get("/api/cli/file", headers=headers, params={"path": renamed["path"]}).json() == renamed
    assert client.delete("/api/cli/file", headers=headers, params={"path": renamed["path"], "etag": "stale"}).status_code == 409
    assert client.delete("/api/cli/file", headers=headers, params={"path": renamed["path"], "etag": renamed["etag"]}).status_code == 200
    assert client.get("/api/cli/files", headers=headers).json() == []


@pytest.mark.parametrize("name", ["../escape.py", "/tmp/escape.py", ".cli-token", "utils/.secret", "utils/../../escape"])
def test_editor_rejects_unsafe_paths(cli, name):
    client, _, headers = cli
    assert client.put("/api/cli/file", headers=headers, json={"path": name, "content": "bad"}).status_code == 422


def test_editor_rejects_symlinks_and_oversize_before_writing(cli, tmp_path):
    client, root, headers = cli
    (root / "link").symlink_to(tmp_path, target_is_directory=True)
    assert client.put("/api/cli/file", headers=headers, json={"path": "link/escape", "content": "bad"}).status_code == 422
    assert client.put("/api/cli/file", headers=headers, json={"path": "big.py", "content": "\u4e2d" * 100000}).status_code == 413
    assert not (root / "big.py").exists()


def test_terminal_rejects_origin_and_does_not_require_token(cli):
    client, _, _ = cli
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/cli/terminal", headers={"origin": "https://evil.example"}):
            pass
    with client.websocket_connect("/api/cli/terminal", headers={"origin": "http://testserver"}) as socket:
        socket.send_json({})
        assert socket.receive_json()["type"] == "started"


def test_terminal_runs_in_workspace_and_cleans_up(cli):
    client, root, headers = cli
    with client.websocket_connect("/api/cli/terminal", headers={"origin": "http://testserver"}) as socket:
        socket.send_json({"token": headers["X-CLI-Token"]})
        started = socket.receive_json()
        assert started["type"] == "started" and started["cwd"] == str(root)
        assert len(started["session"]) == 32
        socket.send_json({"type": "resize", "rows": 30, "cols": 90})
        socket.send_json({"type": "input", "data": "printf '%s' $$ > shell.pid; touch terminal-ran; pwd; sleep 60\r"})
        output = ""
        for _ in range(40):
            data = socket.receive_json()
            output += data.get("data", "")
            if str(root) + "\r\n" in output:
                break
        socket.send_json({"type": "input", "data": "\u0003"})
        prompt = ""
        while "cli_workspace $ " not in prompt:
            prompt += socket.receive_json().get("data", "")
        socket.send_json({"type": "input", "data": "printf '\\nCLI_DONE\\n'\r"})
        output = ""
        for _ in range(40):
            output += socket.receive_json().get("data", "")
            if "\r\nCLI_DONE\r\n" in output:
                break
        assert "\r\nCLI_DONE\r\n" in output
        assert (root / "terminal-ran").exists()
        pid = int((root / "shell.pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_display_handshake_is_session_scoped_and_interrupt_preserves_shell(cli):
    client, root, headers = cli
    assert client.post("/api/cli/unlock", headers=headers).status_code == 200
    assert client.post("/api/cli/unlock").status_code == 200
    with client.websocket_connect("/api/cli/terminal", headers={"origin": "http://testserver"}) as socket:
        socket.send_json({"token": headers["X-CLI-Token"]})
        session = socket.receive_json()["session"]
        folder = root / ".preview" / session
        socket.send_json({"type": "input", "data": "printf ticket > \"$OBJECT_AUTOLABEL_CLI_DISPLAY/request\"; sleep 60\r"})
        while True:
            message = socket.receive_json()
            if message["type"] == "display_request":
                assert message["ticket"] == "ticket"
                break
        assert not (folder / "grant").exists()
        socket.send_json({"type": "display_grant", "ticket": "ticket"})
        socket.send_json({"type": "interrupt"})
        while socket.receive_json()["type"] != "interrupted":
            pass
        assert (folder / "grant").read_text() == "ticket"
        (folder / "frame.jpg").write_bytes(b"jpeg")
        assert client.get("/api/cli/preview", headers=headers, params={"session": session}).content == b"jpeg"
        assert client.get("/api/cli/preview", headers=headers, params={"session": "../"}).status_code == 404
        socket.send_json({"type": "input", "data": "printf '\\nSHELL_ALIVE\\n'\r"})
        output = ""
        while "\r\nSHELL_ALIVE\r\n" not in output:
            output += socket.receive_json().get("data", "")
    assert not folder.exists()


def test_disconnect_does_not_reenter_read_after_send_finishes_during_cancel(cli, monkeypatch):
    client, root, headers = cli
    original = WebSocket.send_json
    async def racing_send(socket, data, *args, **kwargs):
        await original(socket, data, *args, **kwargs)
        if data.get("type") == "output" and "SEND_RACE_READY" in data.get("data", ""):
            try:
                await asyncio.sleep(20)
            except asyncio.CancelledError:
                return
    monkeypatch.setattr(WebSocket, "send_json", racing_send)
    with client.websocket_connect("/api/cli/terminal", headers={"origin": "http://testserver"}) as socket:
        socket.send_json({"token": headers["X-CLI-Token"]})
        session = socket.receive_json()["session"]
        socket.send_json({"type": "input", "data": "echo SEND_RACE_READY\r"})
        while "SEND_RACE_READY" not in socket.receive_json().get("data", ""):
            pass
    assert not (root / ".preview" / session).exists()
