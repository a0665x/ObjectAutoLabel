"""Offline desktop CUDA, API, and FP32 conversion acceptance in a disposable container."""

import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import torch
import torchvision
from torchvision.ops import nms
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.conversion_runtime import export_fp32_artifact
from backend.app.main import app
from backend.app.runtime_safety import disable_ultralytics_autoinstall

assert os.environ["YOLO_AUTOINSTALL"] == "False"
disable_ultralytics_autoinstall()
assert torch.__version__.split("+")[0] == "2.11.0"
assert torchvision.__version__.split("+")[0] == "0.26.0"
assert torch.version.cuda == "12.8"
assert torch.cuda.is_available()
print("CUDA:", torch.__version__, torch.cuda.get_device_name(0), flush=True)
layer = torch.nn.Conv2d(3, 8, 3).cuda()
layer(torch.ones(1, 3, 16, 16, device="cuda")).square().mean().backward()
assert torch.isfinite(layer.weight.grad).all()
boxes = torch.tensor([[0, 0, 2, 2], [0, 0, 2, 2]], dtype=torch.float32, device="cuda")
assert nms(boxes, torch.tensor([0.9, 0.8], device="cuda"), 0.5).tolist() == [0]
torch.cuda.synchronize()
print("CUDA forward/backward and torchvision NMS: OK", flush=True)
with TestClient(app) as client:
    response = client.get("/api/health")
    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True
print("API health: OK", flush=True)

from ultralytics import YOLO
import onnx
from ai_edge_litert.interpreter import Interpreter

with TemporaryDirectory(prefix="desktop-export-smoke-") as tmp:
    root = Path(tmp)
    source = root / "smoke.pt"
    YOLO("yolov8n.yaml").save(source)
    for export_format in ("onnx", "tflite"):
        target = export_fp32_artifact(source, root, export_format, imgsz=64)
        assert target.stat().st_size > 0
        if export_format == "onnx":
            onnx.checker.check_model(str(target))
        else:
            Interpreter(model_path=str(target)).allocate_tensors()
        print(f"{export_format} artifact: OK ({target.stat().st_size} bytes)", flush=True)
