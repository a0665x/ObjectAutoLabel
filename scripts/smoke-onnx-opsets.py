"""Probe the pinned exporter's actual ONNX opsets using offline temporary models."""
import json
import os
from pathlib import Path
import tempfile

os.environ["YOLO_AUTOINSTALL"] = "False"
import numpy as np
import onnx
import onnxruntime as ort
from ultralytics import YOLO

with tempfile.TemporaryDirectory(prefix="opset-smoke-") as directory:
    for architecture in ("yolov8n", "yolo26n"):
        source = Path(directory) / f"{architecture}.pt"
        YOLO(architecture + ".yaml").save(source)
        for requested in (11, 12, 13, 14, 17):
            try:
                path = YOLO(str(source)).export(format="onnx", imgsz=64, opset=requested, simplify=False)
                graph = onnx.load(path)
                actual = [item.version for item in graph.opset_import if item.domain in ("", "ai.onnx")]
                assert actual == [requested], (requested, actual)
                onnx.checker.check_model(graph)
                session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
                result = session.run(None, {session.get_inputs()[0].name: np.zeros((1, 3, 64, 64), np.float32)})
                print("OPSET_RESULT", json.dumps({"model": architecture, "requested": requested, "actual": actual, "shape": result[0].shape}), flush=True)
            except Exception as exc:
                print("OPSET_RESULT", json.dumps({"model": architecture, "requested": requested, "error": str(exc)}), flush=True)
                raise
