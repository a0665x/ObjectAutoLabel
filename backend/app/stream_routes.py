from __future__ import annotations

import asyncio
import json
from pathlib import Path
import subprocess
import shlex
from typing import Callable
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError
from typing import Literal

from . import stream_demo as stream
from .repositories import Repository

class InspectModelRequest(BaseModel):
    path: str
    coordinates: Literal['auto', 'pixels', 'normalized'] = 'auto'


def create_stream_router(get_repo: Callable[[], Repository], auth_enabled: Callable[[], bool], allowed_origins: list[str]) -> APIRouter:
    router = APIRouter(prefix="/api")
    active: dict[str, stream.StreamConfig] = {}
    external_models = {}

    @router.get('/stream-demo/tracking-settings')
    def tracking_settings():
        from .tracking_settings import TrackingSettings
        return {'defaults': TrackingSettings().model_dump(), 'properties': TrackingSettings.model_json_schema()['properties']}

    @router.post('/stream-demo/tracking-settings/import')
    async def import_tracking_settings(request: Request):
        import yaml
        from .tracking_settings import TrackingSettings
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body)>65536:
                raise HTTPException(413,'Tracking YAML must be at most 64 KiB')
        try:
            data=yaml.safe_load(bytes(body))
            if not isinstance(data,dict): raise ValueError('Expected a YAML mapping or env: mapping')
            data=data.get('env',data)
            if not isinstance(data,dict): raise ValueError('Expected env: mapping')
            fields=TrackingSettings.model_fields
            values={k:v for k,v in data.items() if k in fields}
            unknown=[k for k in data if isinstance(k,str) and k.startswith(('TRACKING_','TRACK_MOTION_','AI_TRACK_')) and k not in fields]
            if unknown: raise ValueError('Unknown tracking settings: '+', '.join(unknown))
            if not values: raise ValueError('No supported tracking settings found')
            return {'settings':TrackingSettings.model_validate(values).model_dump(), 'imported':len(values)}
        except (ValueError,yaml.YAMLError) as exc:
            raise HTTPException(422,str(exc)) from exc

    def selected_model(project_id, model_id):
        if model_id.startswith('external::'):
            entry = external_models.get((project_id, model_id))
            if entry:
                stat = Path(entry['path']).stat()
                if (stat.st_size, stat.st_mtime_ns) != entry['fingerprint']:
                    raise ValueError('Model file changed; inspect the path again')
            return entry
        return next((m for m in stream.list_models(get_repo(), project_id) if m['id'] == model_id), None)

    @router.post('/projects/{project_id}/stream-demo/inspect-model')
    def inspect_model(project_id: str, request: InspectModelRequest):
        if not get_repo().get_project(project_id):
            raise HTTPException(404, 'Project not found')
        from .stream_models import local_model_path, inspect_external_model
        try:
            path = local_model_path(request.path)
            stat = path.stat()
            info = inspect_external_model(path, request.coordinates)
            item = dict(info, id=f'external::{uuid4().hex}', conversion_id='external',
                        conversion_label=str(path), label=f"{path.name} · {info['layout']}")
            if len(external_models) >= 128:
                external_models.pop(next(iter(external_models)))
            external_models[(project_id, item['id'])] = dict(item, path=str(path),
                fingerprint=(stat.st_size, stat.st_mtime_ns), external_coordinates=request.coordinates)
            return item
        except Exception as exc:
            raise HTTPException(422, f'Model inspection failed: {str(exc)[:1000]}') from exc

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
        try:
            selected = selected_model(project_id, config.model_id)
        except (ValueError, OSError) as exc:
            raise HTTPException(422, str(exc)) from exc
        if not selected:
            raise HTTPException(404, "Conversion model not found")
        if config.model_id.startswith('external::'):
            raise HTTPException(422, 'Path models use the inspected Stream Demo runtime; CLI conversion verification is unavailable')
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
                chunks = request.stream().__aiter__()
                with partial.open("xb") as output:
                    while True:
                        try:
                            chunk = await asyncio.wait_for(anext(chunks), 300)
                        except StopAsyncIteration:
                            break
                        size += len(chunk)
                        if stream.MAX_UPLOAD_BYTES is not None and size > stream.MAX_UPLOAD_BYTES:
                            raise HTTPException(413, "Video exceeds the configured upload limit")
                        output.write(chunk)
            await receive_upload()
            info = await asyncio.to_thread(stream.probe_video, partial)
            partial.rename(destination)
            item = {"id": destination.name, "name": Path(filename).name[:200], "bytes": size, **info}
            destination.with_suffix(".json").write_text(json.dumps(item), encoding="utf-8")
            return item
        except (ValueError, subprocess.SubprocessError) as exc:
            raise HTTPException(422, "Cannot decode uploaded video") from exc
        except asyncio.TimeoutError as exc:
            raise HTTPException(408, "Video upload stalled for 5 minutes; check the connection and retry") from exc
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
            selected = selected_model(project_id, config.model_id)
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
                info = await asyncio.to_thread(stream.probe_video, source)
                if info['duration'] > 0 and config.start_seconds >= info['duration']:
                    raise ValueError("Playback time must be within the uploaded video duration")
                if info['duration'] <= 0 and config.start_seconds > 0:
                    raise ValueError("Video duration is unknown; start from the beginning")
            else:
                if config.start_seconds:
                    raise ValueError("Camera streams cannot seek")
                camera = next((c for c in caps["cameras"] if c["id"] == config.source_id), None)
                mode = next((m for m in camera["modes"] if m["id"] == config.camera_mode), None) if camera else None
                if not mode:
                    raise ValueError("Select a capture mode reported by the camera")
                if config.fps > mode["fps"]:
                    raise ValueError("Output FPS exceeds the camera capture mode")
                source = Path("/dev") / camera["id"]
            session = stream.StreamSession(config, selected["path"], source, mode)
            session.external_coordinates = selected.get('external_coordinates')
            from .stream_labels import resolve_stream_labels
            session.label_names = resolve_stream_labels(get_repo(), project_id, selected, config.schema_id)
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
