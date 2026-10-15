"""Bounded GStreamer capture -> YOLO -> H.264 sessions, owned by a WebSocket."""
from __future__ import annotations

import asyncio
from fractions import Fraction
import json
import importlib
from functools import lru_cache
import math
from pathlib import Path
import re
import shutil
import subprocess
import time
from typing import Any, Literal

import cv2
import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from .model_lineage import conversion_label
from .repositories import Repository
from .runtime_safety import disable_ultralytics_autoinstall
from .stream_verify import predict_frame
from .tracking_settings import TrackingSettings

VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
MAX_UPLOAD_BYTES = None  # No application-level size cap; uploads stream to disk.
MIME = 'video/mp4; codecs="avc1.42c028"'
PLUGINS = ("filesrc", "decodebin", "videoconvert", "videoscale", "videorate", "rawvideoparse", "x264enc", "h264parse", "mp4mux", "fdsink", "fdsrc", "v4l2src", "jpegdec")


class StreamConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str
    source: Literal["upload", "camera"]
    source_id: str
    camera_mode: str = ""
    width: Literal[640, 960, 1280] = 640
    fps: int = Field(default=15, ge=1, le=60)
    bitrate: int = Field(default=2000, ge=100, le=20000)
    conf: float = Field(default=0.25, ge=0, le=1)
    iou: float = Field(default=0.7, ge=0, le=1)
    imgsz: Literal[320, 640, 960] = 640
    device: Literal["cpu", "0"] = "0"
    start_seconds: float = Field(default=0, ge=0, allow_inf_nan=False)
    tracking: bool = True
    tracking_settings: TrackingSettings = Field(default_factory=TrackingSettings)
    schema_id: str = Field(default='auto', max_length=100)

    @property
    def height(self) -> int:
        return self.width * 9 // 16


class Thresholds(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conf: float = Field(ge=0, le=1)
    iou: float = Field(ge=0, le=1)


def probe_video(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return dict(_probe_video_cached(str(path.resolve()), stat.st_size, stat.st_mtime_ns))


@lru_cache(maxsize=256)
def _probe_video_cached(filename: str, size: int, modified: int) -> dict[str, Any]:
    path = Path(filename)
    result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                             "stream=width,height,avg_frame_rate,duration:stream_tags=DURATION:format=duration", "-of", "json", str(path)],
                            capture_output=True, text=True, timeout=15, check=True)
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    if not streams or not streams[0].get("width") or not streams[0].get("height"):
        raise ValueError("The uploaded file has no decodable video stream")
    stream = streams[0]
    try:
        fps = float(Fraction(stream.get("avg_frame_rate", "0/1")))
    except (ValueError, ZeroDivisionError):
        fps = 0
    duration = 0.
    duration_source = 'metadata'
    for candidate in [stream.get('duration'), stream.get('tags', {}).get('DURATION'), data.get('format', {}).get('duration')]:
        try:
            value = 0.
            for part in str(candidate).split(':'):
                value = value * 60 + float(part)
            if math.isfinite(value) and value > 0:
                duration = value
                break
        except (TypeError, ValueError):
            pass
    if not duration:
        # Interrupted Matroska recordings often lack header duration. Scan packet
        # timestamps without decoding 4K frames or modifying the original file.
        try:
            packets = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', str(path)],
                capture_output=True, text=True, timeout=120, check=False)
            packet_rows = packets.stdout.splitlines()
        except subprocess.TimeoutExpired:
            # A partial scan cannot establish full duration; retain start-at-zero.
            packet_rows = []
        first, end = math.inf, 0.
        for row in packet_rows:
            fields = row.split(',')
            try:
                pts = float(fields[0])
                length = float(fields[1]) if len(fields) > 1 and fields[1] != 'N/A' else (1 / fps if fps > 0 else 0)
                if math.isfinite(pts) and math.isfinite(length):
                    first, end = min(first, pts), max(end, pts + max(0, length))
            except ValueError:
                continue
        duration = max(0., end - first) if math.isfinite(first) else 0.
        duration_source = 'packets' if duration else 'unknown'
    return {"width": stream["width"], "height": stream["height"], "fps": round(fps, 3),
            "duration": duration, 'duration_source': duration_source}


def upload_dir(repo: Repository, project_id: str) -> Path:
    project = repo.get_project(project_id)
    if not project or not Path(project["root_path"]).is_dir():
        raise FileNotFoundError("Project workspace not found")
    return Path(project["root_path"]) / "stream_demo" / "uploads"


def resolve_upload(repo: Repository, project_id: str, source_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}\.(mp4|mov|mkv|webm|avi|m4v)", source_id):
        raise ValueError("Invalid uploaded video id")
    root = upload_dir(repo, project_id).resolve()
    path = root / source_id
    if not path.is_file() or path.resolve().parent != root:
        raise FileNotFoundError("Uploaded video not found")
    return path


def list_uploads(repo: Repository, project_id: str) -> list[dict[str, Any]]:
    root = upload_dir(repo, project_id)
    items = []
    for meta in sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            item = json.loads(meta.read_text())
            resolve_upload(repo, project_id, item["id"])
            if not item.get('duration'):
                item.update(probe_video(resolve_upload(repo, project_id, item['id'])))
            items.append(item)
        except (ValueError, KeyError, OSError, subprocess.SubprocessError):
            continue
    return items


def inspect_tflite_input(path: Path, *, imgsz: int = 640, layout: str = "NCHW") -> dict[str, Any]:
    """Read the LiteRT input contract before exposing an artifact to inference."""
    expected_layout = layout.upper()
    try:
        if path.stat().st_size < 1024:
            raise ValueError("artifact is too small to be a valid LiteRT flatbuffer")
        from ai_edge_litert.interpreter import Interpreter

        interpreter = Interpreter(model_path=str(path))
        details = interpreter.get_input_details()
        from .litert_contract import input_contract
        actual_layout, _ = input_contract(details)
        shape = tuple(int(value) for value in details[0]["shape"])
        return {"input_shape": list(shape), "layout": actual_layout, "available": True, "reason": None}
    except Exception as exc:  # noqa: BLE001 - surface the artifact-specific reason in the selector
        return {"input_shape": None, "layout": expected_layout, "available": False,
                "reason": f"LiteRT input inspection failed: {exc}"}


def list_models(repo: Repository, project_id: str) -> list[dict[str, Any]]:
    models = []
    for conversion in repo.list_model_conversion_runs(project_id):
        if conversion["status"] != "completed":
            continue
        group = {"conversion_id": conversion["id"], "conversion_label": conversion_label(repo, conversion), 'schema_id': conversion.get('schema_id')}
        native = Path(conversion["source_model_path"])
        if native.is_file():
            models.append({**group, "id": f"native::{conversion['id']}", "path": str(native), "format": "pt", "label": "PT · PyTorch"})
        for artifact in conversion["artifacts"]:
            if artifact["status"] == "completed" and artifact["format"] in {"onnx", "tflite"} and Path(artifact.get("output_path") or "").is_file():
                engine = "ONNX Runtime" if artifact["format"] == "onnx" else "LiteRT"
                contract = {"available": True, "input_shape": None, "layout": artifact.get("layout", "NCHW"), "reason": None}
                if artifact["format"] == "tflite":
                    contract = inspect_tflite_input(Path(artifact["output_path"]), layout=contract["layout"])
                shape = ""
                if contract["input_shape"]:
                    shape = " · " + "x".join(str(value) for value in contract["input_shape"])
                models.append({**group, "id": f"artifact::{artifact['id']}", "path": artifact["output_path"],
                               "format": artifact["format"], "layout": contract["layout"], "input_shape": contract["input_shape"],
                               "available": contract["available"], "reason": contract["reason"],
                               "label": f"{artifact['format'].upper()} {artifact['precision'].upper()} · {engine} · {contract['layout']}{shape}"})
    roots = [repo.paths.output_model_dir.resolve()]
    roots.extend(repo.project_output_model_dir(project).resolve() for project in repo.list_projects())
    return [item for item in models if any(Path(item["path"]).resolve().is_relative_to(root) for root in roots)]


def parse_camera_modes(output: str) -> list[dict[str, Any]]:
    modes: list[dict[str, Any]] = []
    pixel_format = ""
    size: tuple[int, int] | None = None
    supported = {"MJPG", "YUYV", "UYVY", "NV12", "RGB3", "BGR3"}
    for line in output.splitlines():
        fmt = re.search(r"\[\d+\]: '([A-Z0-9]+)'", line)
        dimensions = re.search(r"Size: Discrete (\d+)x(\d+)", line)
        rate = re.search(r"Interval: Discrete .*\(([0-9.]+) fps\)", line)
        if fmt:
            pixel_format, size = fmt[1], None
        elif dimensions:
            size = (int(dimensions[1]), int(dimensions[2]))
        elif rate and size and pixel_format in supported:
            fps = float(rate[1])
            if fps <= 0:
                continue
            mode_id = f"{pixel_format}:{size[0]}:{size[1]}:{rate[1]}"
            modes.append({"id": mode_id, "format": pixel_format, "width": size[0], "height": size[1], "fps": fps,
                          "label": f"{pixel_format} · {size[0]}x{size[1]} · {fps:g} FPS"})
    return modes


def capabilities() -> dict[str, Any]:
    missing = []
    if not shutil.which('ffmpeg'):
        missing.append('ffmpeg')
    for plugin in PLUGINS:
        if not shutil.which("gst-inspect-1.0"):
            missing.append(plugin)
            continue
        result = subprocess.run(["gst-inspect-1.0", plugin], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        if result.returncode:
            missing.append(plugin)
    cameras = []
    if shutil.which("v4l2-ctl"):
        for device in sorted(Path("/dev").glob("video[0-9]*")):
            if not re.fullmatch(r"video\d+", device.name):
                continue
            try:
                result = subprocess.run(["v4l2-ctl", "--device", str(device), "--list-formats-ext"], capture_output=True, text=True, timeout=5)
                modes = parse_camera_modes(result.stdout)
                cameras.append({"id": device.name, "label": str(device), "modes": modes,
                                "error": None if modes else "No supported discrete capture modes or device access denied"})
            except subprocess.TimeoutExpired:
                cameras.append({"id": device.name, "label": str(device), "modes": [], "error": "Camera probe timed out"})
    import torch
    engines = {}
    for format_name, module_name in (("pt", "torch"), ("onnx", "onnxruntime"), ("tflite", "ai_edge_litert.interpreter")):
        try:
            importlib.import_module(module_name)
            engines[format_name] = {"available": True, "device": "CUDA / CPU" if format_name == "pt" and torch.cuda.is_available() else "CPU", "reason": None}
        except (ImportError, OSError) as exc:
            engines[format_name] = {"available": False, "device": "Unavailable", "reason": str(exc)}
    return {"available": not missing, "missing_plugins": missing, "cameras": cameras,
            "cuda": torch.cuda.is_available(), "engines": engines, "mime": MIME, "max_upload_bytes": MAX_UPLOAD_BYTES}


def decode_command(config: StreamConfig, source: Path, mode: dict[str, Any] | None) -> list[str]:
    if config.source == "upload":
        # Accurate input seeking decodes/discards from the preceding keyframe.
        # Keep aspect ratio and pad exactly as the camera/GStreamer path does.
        return ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(config.start_seconds),
                "-i", str(source), "-an", "-sn", "-vf",
                f"fps={config.fps},scale={config.width}:{config.height}:force_original_aspect_ratio=decrease,"
                f"pad={config.width}:{config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1",
                "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"]
    command = ["gst-launch-1.0", "-q"]
    if mode:
        rate = Fraction(mode["fps"]).limit_denominator(1001)
        caps = f"width={mode['width']},height={mode['height']},framerate={rate.numerator}/{rate.denominator}"
        command += ["v4l2src", f"device={source}", "!", "image/jpeg," + caps, "!", "jpegdec"] if mode["format"] == "MJPG" else [
            "v4l2src", f"device={source}", "!", "video/x-raw,format=" + {"YUYV": "YUY2", "UYVY": "UYVY", "NV12": "NV12", "RGB3": "RGB", "BGR3": "BGR"}[mode["format"]] + "," + caps]
    else:
        command += ["filesrc", f"location={source}", "!", "decodebin"]
    return command + ["!", "videoconvert", "!", "videoscale", "add-borders=true", "!", "videorate", "!",
                      f"video/x-raw,format=BGR,width={config.width},height={config.height},framerate={config.fps}/1,pixel-aspect-ratio=1/1",
                      "!", "fdsink", "fd=1", "sync=true"]


def encode_command(config: StreamConfig) -> list[str]:
    return ["gst-launch-1.0", "-q", "fdsrc", "fd=0", "!", "rawvideoparse", "format=bgr",
            f"width={config.width}", f"height={config.height}", f"framerate={config.fps}/1", "!", "videoconvert", "!",
            "video/x-raw,format=I420", "!", "x264enc", "tune=zerolatency", "speed-preset=ultrafast",
            f"bitrate={config.bitrate}", f"key-int-max={config.fps}", "!", "video/x-h264,profile=constrained-baseline,level=(string)4",
            "!", "h264parse", "!", "mp4mux", "fragment-duration=200", "streamable=true", "!", "fdsink", "fd=1", "sync=false"]


class StreamSession:
    def __init__(self, config: StreamConfig, model_path: str, source: Path, camera_mode: dict[str, Any] | None = None):
        self.config = config
        self.model_path = model_path
        self.model_identity = {"model_id": config.model_id, "path": str(model_path), "format": Path(model_path).suffix.lstrip('.')}
        self.external_coordinates = None
        self.label_names = None
        self.source = source
        self.camera_mode = camera_mode
        self.processes: list[asyncio.subprocess.Process] = []
        self.tasks: list[asyncio.Task] = []
        self.errors: list[str] = []
        self.stats: dict[str, Any] = {"frames": 0, "detections": 0, "inference_ms": 0, "fps": 0}
        self.tracker = None
        self.identity = None
        self.selection_requests = []
        self.objects: list[dict[str, Any]] = []
        self.playing = asyncio.Event()
        self.playing.set()

    async def spawn(self, command: list[str]) -> asyncio.subprocess.Process:
        process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE,
                                                       stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        self.processes.append(process)
        async def drain_errors():
            while data := await process.stderr.read(4096):
                self.errors.append(data.decode(errors="replace")[-2048:])
                self.errors[:] = self.errors[-4:]
        self.tasks.append(asyncio.create_task(drain_errors()))
        return process

    def predict(self, model: Any, frame: np.ndarray) -> np.ndarray:
        result, mode = predict_frame(model, frame, conf=min(.1, self.config.conf) if self.config.tracking else self.config.conf, iou=self.config.iou,
                                     imgsz=self.config.imgsz, device=self.config.device)
        self.stats["postprocess"] = mode
        from .stream_labels import apply_stream_labels
        apply_stream_labels(result, self.label_names)
        if self.config.tracking:
            if self.tracker is None:
                from .stream_tracking import StreamTracker
                self.tracker = StreamTracker(self.config.fps, self.config.tracking_settings)
                from .stream_identity import IdentityTracker
                self.identity = IdentityTracker(self.config.tracking_settings, self.config.width, self.config.height)
            while self.selection_requests:
                identity, media_time = self.selection_requests.pop(0)
                self.identity.select(identity, media_time)
            tracks = self.tracker.update(result, self.config.conf)
            self.stats["detections"] = len(self.tracker.detections)
            self.stats["tracks"] = len(tracks)
            observed = self.identity.update(tracks, self.stats['frames'] / self.config.fps)
            matched = {item['detection_index'] for item in observed if not item.get('predicted')}
            untracked = [item for item in self.tracker.detections if item['detection_index'] not in matched]
            self.stats["untracked"] = len(untracked)
            self.objects = [*observed, *untracked]
            # Interactive boxes are drawn at the matching playback timestamp in
            # the browser, so a paused or delayed frame cannot select a future ID.
            return frame
        from .stream_tracking import display_detections
        self.objects = display_detections(result, self.config.conf)
        self.stats.update(detections=len(self.objects), tracks=0, untracked=len(self.objects))
        return frame

    async def run(self, websocket: Any) -> None:
        disable_ultralytics_autoinstall()
        from ultralytics import YOLO
        if self.external_coordinates is not None:
            from .stream_models import load_external_model
            model = await asyncio.to_thread(load_external_model, Path(self.model_path), self.external_coordinates)
        else:
            model = await asyncio.to_thread(YOLO, self.model_path, task="detect")
        decoder = await self.spawn(decode_command(self.config, self.source, self.camera_mode))
        encoder = await self.spawn(encode_command(self.config))
        await websocket.send_json({"type": "started", "mime": MIME, "start_seconds": self.config.start_seconds,
                                   "model": self.model_identity})

        async def infer():
            began = time.monotonic()
            while True:
                await self.playing.wait()
                try:
                    raw = await asyncio.wait_for(decoder.stdout.readexactly(self.config.width * self.config.height * 3), 20)
                except asyncio.IncompleteReadError as exc:
                    if exc.partial:
                        raise RuntimeError("Incomplete decoded frame") from exc
                    code = await decoder.wait()
                    if code or not self.stats["frames"]:
                        raise RuntimeError("GStreamer capture failed: " + " ".join(self.errors))
                    encoder.stdin.close()
                    return
                frame = np.frombuffer(raw, np.uint8).reshape(self.config.height, self.config.width, 3).copy()
                start = time.monotonic()
                frame = await asyncio.to_thread(self.predict, model, frame)
                await websocket.send_json({"type": "tracks", "time": self.stats["frames"] / self.config.fps,
                                           "objects": self.objects, "width": self.config.width, "height": self.config.height,
                                           "identity": self.identity.debug if self.identity else {},
                                           "dt_ms": 1000 / self.config.fps})
                self.stats.update(frames=self.stats["frames"] + 1, inference_ms=round((time.monotonic() - start) * 1000, 1))
                self.stats["fps"] = round(self.stats["frames"] / max(0.001, time.monotonic() - began), 1)
                encoder.stdin.write(frame.tobytes())
                await asyncio.wait_for(encoder.stdin.drain(), 15)
                await asyncio.sleep(max(0, 1 / self.config.fps - (time.monotonic() - start)))

        async def send():
            while data := await encoder.stdout.read(65536):
                await asyncio.wait_for(websocket.send_bytes(data), 15)
                await websocket.send_json({"type": "stats", **self.stats})
            if await encoder.wait():
                raise RuntimeError("GStreamer encoder failed: " + " ".join(self.errors))
            await websocket.send_json({"type": "ended", **self.stats})

        async def controls():
            while True:
                message = await websocket.receive_json()
                if message.get("type") == "stop":
                    return
                if message.get("type") == "playback":
                    if type(message.get("paused")) is not bool:
                        raise ValueError("Playback paused must be a boolean")
                    if self.config.source != "upload":
                        raise ValueError("Pause is only available for uploaded video")
                    self.playing.clear() if message["paused"] else self.playing.set()
                    continue
                if message.get('type') == 'select_track':
                    identity, media_time = message.get('id'), message.get('time')
                    if identity is not None and (not isinstance(identity, str) or len(identity)>80):
                        raise ValueError('Invalid selected track ID')
                    if not isinstance(media_time, (int,float)) or not math.isfinite(media_time) or media_time<0:
                        raise ValueError('Invalid selected frame timestamp')
                    self.selection_requests[:] = [(identity,float(media_time))]
                    continue
                values = Thresholds.model_validate(message.get("thresholds", {}))
                self.config.conf, self.config.iou = values.conf, values.iou

        infer_task, send_task, control_task = (asyncio.create_task(fn()) for fn in (infer, send, controls))
        self.tasks.extend([infer_task, send_task, control_task])
        done, _ = await asyncio.wait([infer_task, send_task, control_task], return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
        if infer_task in done and control_task not in done:
            await asyncio.wait_for(send_task, 45)

    async def close(self) -> None:
        for task in self.tasks:
            task.cancel()
        for process in self.processes:
            if process.returncode is None:
                process.terminate()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        for process in self.processes:
            try:
                # A seekable file decoder can fill stdout ahead of inference.
                # Drain pipes after cancellation; wait() alone can deadlock on
                # a full asyncio pipe even after the child has been terminated.
                await asyncio.wait_for(process.communicate(), 3)
            except asyncio.TimeoutError:
                process.kill()
                await asyncio.wait_for(process.communicate(), 3)
