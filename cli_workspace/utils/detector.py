from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
import os
from pathlib import Path
import time

_display_pid = None


def claim_display():
    """Wait for the WebUI to release its single monitor before opening a source."""
    global _display_pid
    directory = os.environ.get("OBJECT_AUTOLABEL_CLI_DISPLAY")
    if not directory or _display_pid == os.getpid():
        return
    import secrets
    root = Path(directory)
    ticket = secrets.token_hex(16)
    temporary = root / "request.tmp"
    temporary.write_text(ticket)
    temporary.replace(root / "request")
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        grant = root / "grant"
        if grant.exists() and grant.read_text() == ticket:
            _display_pid = os.getpid()
            return
        time.sleep(.05)
    raise RuntimeError("WebUI did not release the shared display; keep Stream Demo open")

import cv2
import numpy as np


@dataclass
class PreparedFrame:
    tensor: object
    original: np.ndarray


@dataclass
class Prediction:
    raw: object
    frame: PreparedFrame


class DetectionPlugin(ABC):
    """One loaded engine; separate preprocessing, inference, and postprocessing."""
    def __init__(self, predictor):
        self.predictor = predictor

    def preprocess(self, frame: np.ndarray) -> PreparedFrame:
        if frame is None or frame.ndim != 3 or frame.shape[2] != 3:
            raise ValueError("Expected a nonempty BGR image (H, W, 3)")
        return PreparedFrame(self.predictor.preprocess([frame]), frame)

    def predict(self, frame: PreparedFrame) -> Prediction:
        import torch
        with torch.inference_mode():
            return Prediction(self.predictor.inference(frame.tensor), frame)

    def postprocess(self, prediction: Prediction):
        import torch
        with torch.inference_mode():
            return self._postprocess_(prediction)

    @abstractmethod
    def _postprocess_(self, prediction: Prediction):
        raise NotImplementedError

    def _results(self, prediction):
        self.predictor.batch = (["frame"], [prediction.frame.original], [""])
        return self.predictor.postprocess(prediction.raw, prediction.frame.tensor, [prediction.frame.original])[0]


class RawYOLOPlugin(DetectionPlugin):
    mode = "NMS"

    def _postprocess_(self, prediction):
        # DetectionPredictor performs xywh decoding, class-aware NMS, and maps
        # letterboxed coordinates back to the original image exactly once.
        if self.predictor.model.end2end:
            raise RuntimeError("Raw YOLO plugin received an end-to-end model")
        return self._results(prediction)


class EndToEndYOLOPlugin(DetectionPlugin):
    mode = "NMS-free"

    def _postprocess_(self, prediction):
        # YOLO26 end-to-end output is xyxy/conf/class. The official predictor
        # filters confidence without applying another NMS to decoded boxes.
        if not self.predictor.model.end2end:
            raise RuntimeError("End-to-end plugin received a raw-output model")
        return self._results(prediction)


class EmbeddedNMSPlugin(EndToEndYOLOPlugin):
    mode = "Embedded NMS"


def load_detector(path: str, *, conf=.25, iou=.7, imgsz=640, device="cpu") -> DetectionPlugin:
    claim_display()
    os.environ["YOLO_AUTOINSTALL"] = "False"
    from ultralytics.models.yolo.detect.predict import DetectionPredictor
    from ultralytics.data.loaders import SourceTypes
    from ultralytics.utils.checks import check_imgsz
    import ultralytics.utils
    import ultralytics.utils.checks
    ultralytics.utils.AUTOINSTALL = False
    ultralytics.utils.checks.AUTOINSTALL = False
    model = Path(path).expanduser().resolve()
    if not model.is_file() or model.suffix not in {".pt", ".pth", ".onnx", ".tflite"}:
        raise ValueError(f"Expected an existing PT, ONNX, or TFLite model: {model}")
    if not 0 <= conf <= 1 or not 0 <= iou <= 1:
        raise ValueError("conf and iou must be between 0 and 1")
    if model.suffix == ".tflite":
        from ai_edge_litert.interpreter import Interpreter
        interpreter = Interpreter(model_path=str(model))
        details = interpreter.get_input_details()
        shape = tuple(int(value) for value in details[0]["shape"]) if details else ()
        expected = {(1, imgsz, imgsz, 3), (1, 3, imgsz, imgsz)}
        if shape not in expected:
            expected_text = " or ".join(str(item) for item in sorted(expected))
            raise ValueError(f"LiteRT input shape mismatch: expected batch-1 NHWC/NCHW {expected_text}, got {shape}; re-export the artifact with batch=1")
    predictor = DetectionPredictor(overrides={"model": str(model), "task": "detect", "device": device,
                                              "conf": conf, "iou": iou, "imgsz": imgsz, "max_det": 100, "verbose": False})
    predictor.setup_model(model=str(model), verbose=False)
    predictor.source_type = SourceTypes(from_img=True)
    backend = predictor.model
    size = getattr(backend, "imgsz", imgsz) if model.suffix not in {".pt", ".pth"} else imgsz
    predictor.imgsz = check_imgsz(size, stride=backend.stride, min_dim=2)
    metadata = getattr(backend, "metadata", {}) or {}
    if metadata.get("args", {}).get("nms"):
        plugin = EmbeddedNMSPlugin(predictor)
    elif backend.end2end:
        plugin = EndToEndYOLOPlugin(predictor)
    else:
        plugin = RawYOLOPlugin(predictor)
    print(f"{type(plugin).__name__}: {plugin.mode} | {model.name}", flush=True)
    return plugin


def show(result):
    """Publish the latest annotated image in the web CLI preview, without X11."""
    claim_display()
    root = Path(os.environ["OBJECT_AUTOLABEL_CLI_DISPLAY"]) if os.environ.get("OBJECT_AUTOLABEL_CLI_DISPLAY") else Path(__file__).resolve().parents[1] / ".preview"
    root.mkdir(exist_ok=True)
    ok, image = cv2.imencode(".jpg", result.plot())
    if not ok:
        raise RuntimeError("Cannot encode preview")
    import tempfile
    with tempfile.NamedTemporaryFile(dir=root, suffix=".jpg", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(image.tobytes())
    temporary.replace(root / "frame.jpg")
    return result


def run_video(model: str, source=0, *, conf=.25, iou=.7, imgsz=640, device="cpu", fps=15, max_frames=0):
    if not 1 <= fps <= 60 or max_frames < 0:
        raise ValueError("fps must be 1..60 and max_frames must be nonnegative")
    detector = load_detector(model, conf=conf, iou=iou, imgsz=imgsz, device=device)
    cap = cv2.VideoCapture(source)
    count = 0
    stop_file = Path(os.environ["OBJECT_AUTOLABEL_CLI_DISPLAY"]) / "stop" if os.environ.get("OBJECT_AUTOLABEL_CLI_DISPLAY") else None
    def stopping():
        return stop_file is not None and stop_file.exists()
    try:
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open source: {source}")
        while not max_frames or count < max_frames:
            if stopping():
                break
            started = time.monotonic()
            ok, frame = cap.read()
            if not ok:
                break
            prepared = detector.preprocess(frame)
            prediction = detector.predict(prepared)
            result = detector.postprocess(prediction)
            show(result)
            count += 1
            if count == 1 or count % 30 == 0:
                print(f"frame={count} detections={len(result.boxes)} mode={detector.mode}", flush=True)
            time.sleep(max(0, 1 / fps - (time.monotonic() - started)))
        if not count and not stopping():
            raise RuntimeError("Source produced no decoded frames")
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        print(f"Stopped after {count} frames", flush=True)
