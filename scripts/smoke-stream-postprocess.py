"""Offline real YOLOv8/YOLO26 postprocessing acceptance across all demo engines."""
import json
import atexit
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.conversion_runtime import export_fp32_artifact
from backend.app.runtime_safety import disable_ultralytics_autoinstall
from backend.app.stream_verify import predict_frame
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cli_workspace"))
from utils import load_detector

if "--gui" in sys.argv and not os.environ.get("DISPLAY"):
    display = subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1280x1024x24", "-nolisten", "tcp", "-ac"])
    def close_display():
        display.terminate()
        try:
            display.wait(timeout=3)
        except subprocess.TimeoutExpired:
            display.kill()
            display.wait()
    atexit.register(close_display)
    for _ in range(50):
        if Path("/tmp/.X11-unix/X99").exists():
            break
        if display.poll() is not None:
            raise RuntimeError("Xvfb exited before opening the display")
        time.sleep(.1)
    else:
        raise RuntimeError("Xvfb did not open the display within 5 seconds")
    os.environ["DISPLAY"] = ":99"

disable_ultralytics_autoinstall()
from ultralytics import YOLO
from ultralytics.utils.nms import non_max_suppression

# Identical same-class boxes must collapse in raw YOLOv8 output, but remain
# untouched in an end-to-end output: confidence filtering is not another NMS.
raw = torch.tensor([[[10., 10.], [10., 10.], [4., 4.], [4., 4.], [.9, .8]]])
assert len(non_max_suppression(raw, .25, .5)[0]) == 1
decoded = torch.tensor([[[8., 8., 12., 12., .9, 0.], [8., 8., 12., 12., .8, 0.]]])
assert len(non_max_suppression(decoded, .25, .5, end2end=True)[0]) == 2

with tempfile.TemporaryDirectory(prefix="stream-postprocess-") as directory:
    root = Path(directory)
    for architecture, expected in (("yolov8n", "NMS"), ("yolo26n", "NMS-free")):
        folder = root / architecture
        folder.mkdir()
        checkpoint = folder / "renamed-checkpoint.pt"
        YOLO(architecture + ".yaml").save(checkpoint)
        paths = [checkpoint] + [export_fp32_artifact(checkpoint, folder, fmt, imgsz=64) for fmt in ("onnx", "tflite")]
        for path in paths:
            model = YOLO(str(path), task="detect")
            for _ in range(2):
                result, mode = predict_frame(model, np.full((96, 128, 3), 100, np.uint8), conf=.001,
                                             iou=.5, imgsz=64 if path.suffix == ".pt" else 320, device="cpu")
                assert mode == expected, (architecture, path, mode)
                assert result.orig_shape == (96, 128)
            print(f"PASS {architecture} {path.suffix}: {mode}", flush=True)
            plugin = load_detector(str(path), conf=.001, iou=.5, imgsz=64 if path.suffix == ".pt" else 320)
            prepared = plugin.preprocess(np.full((96, 128, 3), 100, np.uint8))
            prediction = plugin.predict(prepared)
            staged = plugin.postprocess(prediction)
            assert plugin.mode == expected
            assert staged.orig_shape == (96, 128)
            np.testing.assert_allclose(staged.boxes.data.cpu().numpy(), result.boxes.data.cpu().numpy(), atol=1e-4)
            print(f"PASS staged CLI plugin: {architecture} {path.suffix}", flush=True)
            if "--gui" in sys.argv:
                video = folder / "source.mp4"
                writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), 5, (128, 96))
                assert writer.isOpened()
                writer.write(np.full((96, 128, 3), 100, np.uint8))
                writer.release()
                config = {"model": str(path), "source": str(video), "camera": False, "fps": 5,
                          "conf": .001, "iou": .5, "imgsz": 64 if path.suffix == ".pt" else 320, "device": "cpu"}
                script = Path(__file__).resolve().parents[1] / "backend/app/stream_verify.py"
                result = subprocess.run([sys.executable, "-c", f"exec({script.read_text()!r})", json.dumps(config)],
                                        capture_output=True, text=True, timeout=60, env=os.environ.copy())
                assert result.returncode == 0, result.stdout + result.stderr
                assert f"Postprocess: {expected}" in result.stdout, result.stdout
                print(f"PASS cv2.imshow one-line command: {architecture} {path.suffix}", flush=True)
