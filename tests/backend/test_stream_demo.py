import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from backend.app import stream_demo as stream
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.model_lineage import conversion_label, training_label
from backend.app.repositories import Repository
from backend.app.stream_routes import create_stream_router


@pytest.fixture
def setup(tmp_path):
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db, AppPaths(tmp_path))
    project = repo.create_project("Stream tests")
    app = FastAPI()
    app.include_router(create_stream_router(lambda: repo, lambda: False, []))
    return repo, project, TestClient(app)


def test_camera_capabilities_keep_format_resolution_and_fps_together():
    modes = stream.parse_camera_modes("""
    [0]: 'MJPG' (Motion-JPEG)
        Size: Discrete 1280x720
            Interval: Discrete 0.033s (30.000 fps)
            Interval: Discrete 0.067s (15.000 fps)
    [1]: 'YUYV' (YUYV 4:2:2)
        Size: Discrete 640x480
            Interval: Discrete 0.033s (30.000 fps)
    [2]: 'BAD1' (Unsupported)
        Size: Discrete 320x240
            Interval: Discrete 0.100s (10.000 fps)
    """)
    assert [(m["format"], m["width"], m["height"], m["fps"]) for m in modes] == [
        ("MJPG", 1280, 720, 30), ("MJPG", 1280, 720, 15), ("YUYV", 640, 480, 30)]


@pytest.mark.parametrize("patch", [{"fps": 0}, {"fps": 61}, {"bitrate": 0}, {"conf": float("nan")}, {"iou": 1.1}, {"width": 999}, {"pipeline": "filesrc ! fakesink"}])
def test_stream_rejects_invalid_controls_and_arbitrary_pipeline(patch):
    with pytest.raises(ValidationError):
        stream.StreamConfig.model_validate({"model_id": "model", "source": "upload", "source_id": "video", **patch})


@pytest.mark.parametrize('value', [-1, float('nan'), float('inf')])
def test_stream_rejects_invalid_seek(value):
    with pytest.raises(ValidationError):
        stream.StreamConfig(model_id='m', source='upload', source_id='v', start_seconds=value)


def test_uploaded_video_seek_is_an_argument_not_shell_code():
    config = stream.StreamConfig(model_id='m', source='upload', source_id='v', start_seconds=12.5)
    command = stream.decode_command(config, Path('/tmp/video with spaces.mp4'), None)
    assert command[:6] == ['ffmpeg', '-nostdin', '-v', 'error', '-ss', '12.5']
    assert command[command.index('-i') + 1] == '/tmp/video with spaces.mp4'
    assert 'pad=640:360' in command[command.index('-vf') + 1]


def test_close_drains_a_decoder_with_full_stdout():
    import asyncio
    import sys
    async def check():
        config = stream.StreamConfig(model_id='m', source='upload', source_id='v')
        session = stream.StreamSession(config, '/model.pt', Path('/video.mp4'))
        child = await session.spawn([sys.executable, '-c', 'import os; os.write(1, b"x" * 4000000)'])
        await asyncio.sleep(.1)
        await asyncio.wait_for(session.close(), 5)
        assert child.returncode is not None
    asyncio.run(check())


def test_websocket_seek_checks_duration_and_starts_fresh_session(setup, monkeypatch):
    repo, project, client = setup
    monkeypatch.setattr(stream, 'list_models', lambda *_: [{'id': 'm', 'path': '/model.pt', 'format': 'pt'}])
    monkeypatch.setattr(stream, 'capabilities', lambda: {'available': True, 'cuda': False, 'engines': {'pt': {'available': True}}})
    monkeypatch.setattr(stream, 'resolve_upload', lambda *_: Path('/video.mp4'))
    monkeypatch.setattr(stream, 'probe_video', lambda *_: {'duration': 20})
    starts = []
    class Session:
        def __init__(self, config, *args):
            starts.append(config.start_seconds)
        async def run(self, ws):
            await ws.send_json({'type': 'ended'})
        async def close(self):
            pass
    monkeypatch.setattr(stream, 'StreamSession', Session)
    for seconds in [20, 5, 0]:
        with client.websocket_connect(f'/api/projects/{project["id"]}/stream-demo/live', headers={'origin': 'http://testserver'}) as socket:
            socket.send_json({'model_id': 'm', 'source': 'upload', 'source_id': 'v', 'device': 'cpu', 'start_seconds': seconds})
            assert socket.receive_json()['type'] == ('error' if seconds == 20 else 'ended')
    assert starts == [5, 0]


def test_upload_validation_and_cleanup(setup, monkeypatch):
    repo, project, client = setup
    url = f"/api/projects/{project['id']}/stream-demo/uploads"
    assert client.post(url + "?filename=a.exe", content=b"bad").status_code == 422
    monkeypatch.setattr(stream, "probe_video", lambda _: {"width": 640, "height": 360, "fps": 15, "duration": 1})
    response = client.post(url + "?filename=clip.mp4", content=b"video")
    assert response.status_code == 201
    item = response.json()
    assert item["name"] == "clip.mp4" and item["bytes"] == 5
    assert client.get(url).json() == [item]
    assert stream.resolve_upload(repo, project["id"], item["id"]).read_bytes() == b"video"
    assert client.delete(url + "/" + item["id"]).status_code == 200
    assert client.get(url).json() == []
    monkeypatch.setattr(stream, "MAX_UPLOAD_BYTES", 2)
    assert client.post(url + "?filename=large.mp4", content=b"big").status_code == 413
    assert list(stream.upload_dir(repo, project["id"]).iterdir()) == []


def test_websocket_resolves_only_current_project_schema(setup,monkeypatch):
    repo,project,client=setup
    labels=[{'class_id':0,'class_name':'Pedestrian','descriptors':['person']}]
    schema=repo.create_class_schema(project['id'],'Labels',labels)
    other=repo.create_project('other')
    foreign=repo.create_class_schema(other['id'],'Foreign',labels)
    monkeypatch.setattr(stream,'list_models',lambda *_:[{'id':'m','path':'/model.pt','format':'pt'}])
    monkeypatch.setattr(stream,'capabilities',lambda:{'available':True,'cuda':False,'engines':{'pt':{'available':True}}})
    monkeypatch.setattr(stream,'resolve_upload',lambda *_:Path('/video.mp4'))
    monkeypatch.setattr(stream,'probe_video',lambda *_:{'duration':10})
    class Session:
        def __init__(self,*args): pass
        async def run(self,ws): await ws.send_json({'type':'labels','names':self.label_names})
        async def close(self): pass
    monkeypatch.setattr(stream,'StreamSession',Session)
    for schema_id,expected in [('auto',{'0':'Pedestrian'}),(schema['id'],{'0':'Pedestrian'}),('model',None),(foreign['id'],'error')]:
        with client.websocket_connect(f'/api/projects/{project["id"]}/stream-demo/live',headers={'origin':'http://testserver'}) as ws:
            ws.send_json({'model_id':'m','source':'upload','source_id':'v','device':'cpu','schema_id':schema_id})
            message=ws.receive_json()
            if expected=='error': assert message['type']=='error'
            else: assert message['names']==expected


def test_external_model_is_project_scoped_and_rejects_changed_files(setup, monkeypatch, tmp_path):
    from backend.app import stream_models
    repo, project, client = setup
    path = tmp_path / 'old.onnx'
    path.write_bytes(b'model')
    monkeypatch.setattr(stream_models, 'inspect_external_model', lambda *_: {'format':'onnx','layout':'NCHW','available':True})
    url = f"/api/projects/{project['id']}/stream-demo"
    response = client.post(url+'/inspect-model',json={'path':str(path)})
    assert response.status_code == 200
    model_id = response.json()['id']
    config = {'model_id':model_id,'source':'camera','source_id':'video0','device':'cpu'}
    second = repo.create_project('another project')
    assert client.post(f"/api/projects/{second['id']}/stream-demo/verify-command",json=config).status_code == 404
    path.write_bytes(b'replaced model')
    changed = client.post(url+'/verify-command',json=config)
    assert changed.status_code == 422
    assert 'changed' in changed.json()['detail']


def test_tracking_yaml_import_preserves_names_validates_values_and_ignores_unrelated_env(setup):
    _,_,client=setup
    schema=client.get('/api/stream-demo/tracking-settings').json()
    assert schema['defaults']['TRACKING_ID_STABILIZER_MATCH_THRESHOLD']==.65
    url='/api/stream-demo/tracking-settings/import'
    response=client.post(url,content='env:\n  TRACKING_ID_STABILIZER_CONFIRM_FRAMES: 7\n  AI_MODEL_PATH: ignored.tflite\n')
    assert response.status_code==200
    assert response.json()['settings']['TRACKING_ID_STABILIZER_CONFIRM_FRAMES']==7
    for yaml in ['env:\n  TRACKING_BRIDGE_TTL_MS: -1','env:\n  TRACKING_BRIDGE_CONF_DECAY: .nan','env:\n  TRACKING_BRIDGE_TYPO: 1','env: []']:
        assert client.post(url,content=yaml).status_code==422
    assert client.post(url,content='x'*65537).status_code==413


def test_corrupt_upload_is_not_published(setup, monkeypatch):
    repo, project, client = setup
    def fail(_):
        raise ValueError("No video")
    monkeypatch.setattr(stream, "probe_video", fail)
    url = f"/api/projects/{project['id']}/stream-demo/uploads?filename=bad.mp4"
    assert client.post(url, content=b"garbage").status_code == 422
    assert list(stream.upload_dir(repo, project["id"]).iterdir()) == []


def test_upload_ids_cannot_escape_project(setup, tmp_path):
    repo, project, _ = setup
    with pytest.raises(ValueError):
        stream.resolve_upload(repo, project["id"], "../../other.mp4")
    root = stream.upload_dir(repo, project["id"])
    root.mkdir(parents=True)
    external = tmp_path / "external.mp4"
    external.write_bytes(b"other project")
    source_id = "a" * 32 + ".mp4"
    (root / source_id).symlink_to(external)
    with pytest.raises(FileNotFoundError):
        stream.resolve_upload(repo, project["id"], source_id)


def test_websocket_requires_same_origin_and_known_model(setup):
    _, project, client = setup
    url = f"/api/projects/{project['id']}/stream-demo/live"
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(url, headers={"origin": "https://untrusted.example"}):
            pass
    with client.websocket_connect(url, headers={"origin": "http://testserver"}) as socket:
        socket.send_json({"model_id": "/etc/passwd", "source": "upload", "source_id": "bad"})
        assert socket.receive_json()["type"] == "error"


def test_model_selector_groups_native_and_artifacts_with_saved_lineage(setup, tmp_path):
    repo, project, _ = setup
    split_yaml = tmp_path / "dataset.yaml"
    split_yaml.write_text("names: [person, car]\n")
    split = repo.create_dataset_split_record(project["id"], "Split A", .8, .1, .1, str(tmp_path), str(split_yaml), "[]")
    root = repo.project_output_model_dir(project)
    native = root / "best.pt"
    native.write_bytes(b"weights")
    run = repo.create_training_run_record(project["id"], split["id"], "yolov8n.pt", str(root), run_name="Run A",
                                          settings={"optimizer": "MuSGD", "epochs": 100, "imgsz": 640})
    repo.update_training_run(run["id"], status="completed", metrics_json=json.dumps([{"epoch": 86}]))
    run = repo.get_training_run(run["id"])
    label = training_label(repo, run)
    assert all(value in label for value in ("person, car", "Split A", "80/10/10", "Run A", "MuSGD", "86/100 epochs", "img 640"))
    conversion = repo.create_model_conversion_run(project_id=project["id"], training_run_id=run["id"], source_model_path=str(native),
        package_name="conversion-001", output_dir=str(root), schema_id=None, schema_name="Vehicles", schema_snapshot=[{"id": 0, "name": "person"}])
    for fmt in ("onnx", "tflite"):
        artifact = root / f"model.{fmt}"
        artifact.write_bytes(b"model")
        repo.add_model_conversion_artifact(conversion["id"], project["id"], fmt, "fp32", str(artifact), "completed")
    repo.update_model_conversion_run(conversion["id"], status="completed")
    models = stream.list_models(repo, project["id"])
    assert {model["format"] for model in models} == {"pt", "onnx", "tflite"}
    assert {model["conversion_id"] for model in models} == {conversion["id"]}
    assert "MuSGD" in conversion_label(repo, repo.get_model_conversion_run(conversion["id"]))
    repo.update_model_conversion_run(conversion["id"], status="failed")
    assert stream.list_models(repo, project["id"]) == []


@pytest.mark.parametrize("end2end,metadata,expected", [
    (False, {}, "NMS"), (True, {}, "NMS-free"),
    (True, {"args": {"nms": True}}, "Embedded NMS"),
])
def test_postprocess_uses_loaded_model_contract_not_name(end2end, metadata, expected):
    from types import SimpleNamespace
    from backend.app.stream_verify import postprocess_mode
    assert postprocess_mode(SimpleNamespace(end2end=end2end, metadata=metadata)) == expected


def test_predict_keeps_export_dimensions_and_does_not_force_end2end():
    from types import SimpleNamespace
    from backend.app.stream_verify import predict_frame
    calls = []
    def predict(frame, **kwargs):
        calls.append(kwargs)
        return ["result"]
    model = SimpleNamespace(predict=predict, predictor=SimpleNamespace(model=SimpleNamespace(
        format="onnx", dynamic=False, imgsz=[320, 320], end2end=True, metadata={})))
    assert predict_frame(model, "frame", conf=.3, iou=.6, imgsz=640, device="cpu") == ("result", "NMS-free")
    assert calls[0]["imgsz"] == [320, 320]
    assert calls[0]["max_det"] == 300
    assert "end2end" not in calls[0] and "nms" not in calls[0]


def test_verification_command_uses_workspace_utils_and_shell_quoted_container_paths(setup, monkeypatch):
    import ast
    import shlex
    repo, project, client = setup
    native = repo.project_output_model_dir(project) / "a ' $(bad).onnx"
    native.write_bytes(b"model")
    monkeypatch.setattr(stream, "list_models", lambda *_: [{"id": "a", "path": str(native), "format": "onnx"}])
    root = stream.upload_dir(repo, project["id"])
    root.mkdir(parents=True)
    video = root / ("a" * 32 + ".mp4")
    video.write_bytes(b"video")
    url = f"/api/projects/{project['id']}/stream-demo/verify-command"
    response = client.post(url, json={"model_id": "a", "source": "upload", "source_id": video.name, "conf": .4, "device": "0"})
    assert response.status_code == 200
    command = response.json()["command"]
    assert "\n" not in command
    args = shlex.split(command)
    assert args[:2] == ["python", "-c"]
    compile(args[2], "<verification>", "exec")
    assert len(args) == 3
    tree = ast.parse(args[2])
    assert tree.body[0].module == "utils"
    call = tree.body[1].value
    assert call.func.id == "run_video"
    assert ast.literal_eval(call.args[0]) == str(native)
    settings = {arg.arg: ast.literal_eval(arg.value) for arg in call.keywords}
    assert settings["source"] == str(video)
    assert settings["device"] == "cpu" and settings["conf"] == .4
    assert client.post(url, json={"model_id": "bad", "source": "upload", "source_id": video.name}).status_code == 404
