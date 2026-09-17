from __future__ import annotations

import json
import os
from pathlib import Path
import platform
import shutil
import types
import zipfile
from typing import Literal

from pydantic import BaseModel, ConfigDict

from .runtime_safety import disable_ultralytics_autoinstall


X86_ARCHITECTURES = {"x86_64", "amd64"}
CONVERSION_HANDOFF_REASON = (
    "Copy the .pt checkpoint to an x86_64 host and convert it there."
)


class ConversionCapability(BaseModel):
    model_config = ConfigDict(frozen=True)

    format: Literal["onnx", "tflite"]
    precision: Literal["fp32"] = "fp32"
    architecture: str
    exporter: Literal["ultralytics"] = "ultralytics"
    available: bool
    reason: str | None = None


ConversionLayout = Literal["NCHW", "NHWC"]


def detect_conversion_capabilities(
    architecture: str | None = None,
) -> list[ConversionCapability]:
    normalized_architecture = (architecture or platform.machine()).lower()
    available = normalized_architecture in X86_ARCHITECTURES
    reason = None if available else CONVERSION_HANDOFF_REASON
    return [
        ConversionCapability(
            format=export_format,
            architecture=normalized_architecture,
            available=available,
            reason=reason,
        )
        for export_format in ("onnx", "tflite")
    ]


def export_fp32_artifact(
    source_model: Path,
    output_dir: Path,
    format: Literal["onnx", "tflite"],
    imgsz: int,
    opset: int = 11,
    layout: ConversionLayout = "NCHW",
) -> Path:
    if format == "onnx" and layout != "NCHW":
        raise ValueError("ONNX conversion uses NCHW layout")
    if format == "tflite" and layout not in {"NCHW", "NHWC"}:
        raise ValueError(f"Unsupported LiteRT input layout: {layout}")
    capabilities = detect_conversion_capabilities()
    if not all(capability.available for capability in capabilities):
        raise RuntimeError(capabilities[0].reason or CONVERSION_HANDOFF_REASON)

    disable_ultralytics_autoinstall()
    if format == "tflite" and layout == "NHWC":
        exported = _export_nhwc_litert_artifact(source_model, output_dir, imgsz)
        validate_tflite_export(exported, layout, imgsz)
        return exported

    from ultralytics import YOLO

    disable_ultralytics_autoinstall()
    export_kwargs: dict[str, object] = {"format": "litert" if format == "tflite" else format, "imgsz": imgsz}
    if format == "onnx":
        if not 11 <= opset <= 20:
            raise ValueError(f"ONNX opset {opset} is unsupported; select a version from 11 to 20")
        export_kwargs.update({"half": False, "simplify": False, "opset": opset})
    else:
        export_kwargs.update({"quantize": None})
    model = YOLO(str(source_model))
    kind = "end-to-end/NMS-free" if getattr(getattr(model, "model", None), "end2end", False) else "raw/NMS"
    try:
        exported = Path(model.export(**export_kwargs))
        if format == "onnx":
            validate_onnx_export(exported, opset)
    except Exception as exc:
        detail = f"ONNX opset {opset}" if format == "onnx" else "LiteRT"
        raise RuntimeError(f"{detail} conversion failed ({kind}, {source_model.name}): {exc}. No fallback opset was used.") from exc
    if not exported.is_file():
        raise RuntimeError(f"Ultralytics did not produce a conversion artifact: {exported}")
    if format == "tflite":
        validate_tflite_export(exported, layout, imgsz)

    suffix = ".onnx" if format == "onnx" else ".tflite"
    target_path = output_dir / f"model-{format}-fp32{suffix}"
    if exported.resolve() != target_path.resolve():
        shutil.copy2(exported, target_path)
    return target_path


def validate_tflite_export(path: Path, layout: ConversionLayout, imgsz: int) -> None:
    """Reject LiteRT artifacts whose fixed input shape disagrees with the package contract."""
    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_path=str(path))
    details = interpreter.get_input_details()
    if len(details) != 1:
        raise RuntimeError(f"LiteRT export must have exactly one input tensor, got {len(details)}")
    actual = tuple(int(value) for value in details[0]["shape"])
    expected = (1, 3, imgsz, imgsz) if layout == "NCHW" else (1, imgsz, imgsz, 3)
    if actual != expected:
        raise RuntimeError(f"LiteRT {layout} input shape mismatch: expected {expected}, got {actual}")


def _export_nhwc_litert_artifact(source_model: Path, output_dir: Path, imgsz: int) -> Path:
    """Trace the official LiteRT exporter with an explicit NHWC input wrapper.

    Ultralytics' native ``format=litert`` path traces NCHW.  The wrapper keeps
    the model itself unchanged while making the exported graph accept NHWC.
    """
    from ultralytics import YOLO
    from ultralytics.engine.exporter import Exporter

    class NHWCExporter(Exporter):
        def export_litert(self, prefix: str = "LiteRT:") -> Path:  # type: ignore[override]
            return _torch2litert_with_layout(self.model, self.im, self.file, self.metadata, prefix, "NHWC")

    exporter = NHWCExporter(
        overrides={"format": "litert", "imgsz": imgsz, "batch": 1, "quantize": None, "device": "cpu"}
    )
    loaded = YOLO(str(source_model))
    exported = Path(exporter(model=loaded.model))
    target_path = output_dir / "model-tflite-fp32-nhwc.tflite"
    if exported.resolve() != target_path.resolve():
        shutil.copy2(exported, target_path)
    return target_path


def _torch2litert_with_layout(model, im, file: Path, metadata: dict, prefix: str, layout: ConversionLayout) -> Path:
    """Local layout-aware counterpart of Ultralytics' torch2litert helper."""
    import torch
    from ultralytics.nn.modules import Detect
    from ultralytics.utils.export.litert import _litert_gather, _litert_grouped_topk, _NormalizeCoords
    from ultralytics.utils.checks import check_requirements

    check_requirements(("litert-torch>=0.9.0", "ai-edge-litert>=2.1.4"))
    import litert_torch

    nchw_im = im
    if layout == "NHWC":
        im = im.permute(0, 2, 3, 1).contiguous()

    task = metadata.get("task") if metadata else None
    export_model = model
    if task in {"detect", "segment", "pose", "obb"} and not (metadata or {}).get("end2end", False):
        export_model = _NormalizeCoords(
            export_model,
            int(nchw_im.shape[2]),
            int(nchw_im.shape[3]),
            task,
            len((metadata or {}).get("names", {})),
            (metadata or {}).get("kpt_shape"),
        )

    for module in export_model.modules():
        if isinstance(module, Detect):
            module._grouped_topk = _litert_grouped_topk
            module._gather = types.MethodType(_litert_gather, module)

    if layout == "NHWC":
        class NHWCInput(torch.nn.Module):
            def __init__(self, wrapped):
                super().__init__()
                self.wrapped = wrapped

            def forward(self, value):
                return self.wrapped(value.permute(0, 3, 1, 2).contiguous())

        export_model = NHWCInput(export_model)

    litert_torch.fx_infra.decomp.add_pre_lower_decomp(
        torch.ops.aten.index_select.default,
        lambda value, dim, index: torch.ops.tfl.gather(value, index.int(), dim),
    )
    edge_model = litert_torch.convert(export_model, (im,))
    tflite_file = Path(file).with_name(f"{Path(file).stem}_nhwc.tflite")
    edge_model.export(tflite_file)
    with zipfile.ZipFile(tflite_file, "a", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("metadata.json", json.dumps(metadata or {}))
    return tflite_file


def validate_onnx_export(path: Path, requested_opset: int) -> None:
    import onnx
    import onnxruntime as ort
    model = onnx.load(str(path))
    actual = [item.version for item in model.opset_import if item.domain in ("", "ai.onnx")]
    if actual != [requested_opset]:
        raise RuntimeError(f"Requested opset {requested_opset}, but exporter produced {actual}")
    onnx.checker.check_model(model)
    ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
