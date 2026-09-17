from pathlib import Path
import sys
import types

import pytest

from backend.app import conversion_runtime


HANDOFF_REASON = "Copy the .pt checkpoint to an x86_64 host and convert it there."


def test_x86_conversion_capabilities_are_exactly_fp32_onnx_and_tflite() -> None:
    capabilities = conversion_runtime.detect_conversion_capabilities("x86_64")

    assert [(item.format, item.precision, item.available) for item in capabilities] == [
        ("onnx", "fp32", True),
        ("tflite", "fp32", True),
    ]
    assert all(item.exporter == "ultralytics" for item in capabilities)


@pytest.mark.parametrize("architecture", ["aarch64", "arm64", "riscv64"])
def test_non_x86_conversion_capabilities_fail_closed(architecture: str) -> None:
    capabilities = conversion_runtime.detect_conversion_capabilities(architecture)

    assert all(not item.available for item in capabilities)
    assert all(item.reason == HANDOFF_REASON for item in capabilities)


@pytest.mark.parametrize(
    ("export_format", "expected_kwargs", "expected_name"),
    [
        (
            "onnx",
            {"format": "onnx", "imgsz": 320, "half": False, "simplify": False, "opset": 11},
            "model-onnx-fp32.onnx",
        ),
        (
            "tflite",
            {"format": "litert", "imgsz": 320, "quantize": None},
            "model-tflite-fp32.tflite",
        ),
    ],
)
def test_export_fp32_artifact_uses_official_ultralytics_arguments(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    export_format: str,
    expected_kwargs: dict[str, object],
    expected_name: str,
) -> None:
    source_model = tmp_path / "best.pt"
    source_model.write_text("checkpoint", encoding="utf-8")
    output_dir = tmp_path / "conversion"
    output_dir.mkdir()
    calls: list[dict[str, object]] = []

    class FakeYOLO:
        def __init__(self, source: str) -> None:
            assert source == str(source_model)

        def export(self, **kwargs: object) -> str:
            calls.append(kwargs)
            exported = tmp_path / f"ultralytics-export.{export_format}"
            exported.write_text("artifact", encoding="utf-8")
            return str(exported)

    fake_checks = types.ModuleType("ultralytics.utils.checks")
    fake_checks.AUTOINSTALL = True  # type: ignore[attr-defined]
    fake_utils = types.ModuleType("ultralytics.utils")
    fake_utils.AUTOINSTALL = True  # type: ignore[attr-defined]
    fake_utils.checks = fake_checks  # type: ignore[attr-defined]
    fake_ultralytics = types.ModuleType("ultralytics")
    fake_ultralytics.YOLO = FakeYOLO  # type: ignore[attr-defined]
    fake_ultralytics.utils = fake_utils  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "ultralytics", fake_ultralytics)
    monkeypatch.setitem(sys.modules, "ultralytics.utils", fake_utils)
    monkeypatch.setitem(sys.modules, "ultralytics.utils.checks", fake_checks)
    monkeypatch.setattr(conversion_runtime.platform, "machine", lambda: "x86_64")
    monkeypatch.delenv("YOLO_AUTOINSTALL", raising=False)
    monkeypatch.setattr(conversion_runtime, "validate_onnx_export", lambda path, opset: None)
    monkeypatch.setattr(conversion_runtime, "validate_tflite_export", lambda path, layout, imgsz: None)

    artifact = conversion_runtime.export_fp32_artifact(
        source_model,
        output_dir,
        export_format,  # type: ignore[arg-type]
        imgsz=320,
    )

    assert calls == [expected_kwargs]
    assert artifact == output_dir / expected_name
    assert artifact.read_text(encoding="utf-8") == "artifact"
    assert conversion_runtime.os.environ["YOLO_AUTOINSTALL"] == "False"
    assert fake_utils.AUTOINSTALL is False  # type: ignore[attr-defined]
    assert fake_checks.AUTOINSTALL is False  # type: ignore[attr-defined]


def test_export_fp32_artifact_rejects_non_x86_before_output_side_effects(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_model = tmp_path / "best.pt"
    source_model.write_text("checkpoint", encoding="utf-8")
    output_dir = tmp_path / "conversion"
    monkeypatch.setattr(conversion_runtime.platform, "machine", lambda: "aarch64")

    with pytest.raises(RuntimeError, match="Copy the .pt checkpoint to an x86_64 host"):
        conversion_runtime.export_fp32_artifact(source_model, output_dir, "onnx", imgsz=640)

    assert not output_dir.exists()


def test_nhwc_exporter_receives_loaded_model_object_not_source_path(tmp_path: Path, monkeypatch) -> None:
    source_model = tmp_path / "best.pt"
    source_model.write_text("checkpoint", encoding="utf-8")
    output_dir = tmp_path / "conversion"
    output_dir.mkdir()
    model_object = object()
    seen: list[object] = []
    exporter_options: list[dict] = []

    class FakeYOLO:
        def __init__(self, source: str) -> None:
            assert source == str(source_model)
            self.model = model_object

    class FakeExporter:
        def __init__(self, **_kwargs) -> None:
            exporter_options.append(_kwargs)

        def __call__(self, model=None) -> str:
            seen.append(model)
            exported = tmp_path / "ultralytics-nhwc.tflite"
            exported.write_text("artifact", encoding="utf-8")
            return str(exported)

    fake_ultralytics = types.ModuleType("ultralytics")
    fake_ultralytics.YOLO = FakeYOLO  # type: ignore[attr-defined]
    fake_engine = types.ModuleType("ultralytics.engine")
    fake_exporter = types.ModuleType("ultralytics.engine.exporter")
    fake_exporter.Exporter = FakeExporter  # type: ignore[attr-defined]
    fake_engine.exporter = fake_exporter  # type: ignore[attr-defined]
    fake_ultralytics.engine = fake_engine  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "ultralytics", fake_ultralytics)
    monkeypatch.setitem(sys.modules, "ultralytics.engine", fake_engine)
    monkeypatch.setitem(sys.modules, "ultralytics.engine.exporter", fake_exporter)

    artifact = conversion_runtime._export_nhwc_litert_artifact(source_model, output_dir, imgsz=320)

    assert seen == [model_object]
    assert exporter_options == [{"overrides": {"format": "litert", "imgsz": 320, "batch": 1, "quantize": None, "device": "cpu"}}]
    assert artifact == output_dir / "model-tflite-fp32-nhwc.tflite"


@pytest.mark.parametrize("actual,checker_error,runtime_error", [([12], None, None), ([11], "invalid graph", None), ([11], None, "unsupported operator")])
def test_onnx_validation_fails_closed(monkeypatch, actual, checker_error, runtime_error):
    def check(model):
        if checker_error:
            raise RuntimeError(checker_error)
    def session(*args, **kwargs):
        if runtime_error:
            raise RuntimeError(runtime_error)
    model = types.SimpleNamespace(opset_import=[types.SimpleNamespace(domain="", version=value) for value in actual])
    monkeypatch.setitem(sys.modules, "onnx", types.SimpleNamespace(load=lambda _: model, checker=types.SimpleNamespace(check_model=check)))
    monkeypatch.setitem(sys.modules, "onnxruntime", types.SimpleNamespace(InferenceSession=session))
    with pytest.raises(RuntimeError, match=checker_error or runtime_error or "Requested opset 11"):
        conversion_runtime.validate_onnx_export(Path("test.onnx"), 11)


def test_export_rejection_keeps_requested_opset_and_model_mode(monkeypatch, tmp_path):
    calls = []
    class FakeYOLO:
        model = types.SimpleNamespace(end2end=True)
        def __init__(self, _):
            pass
        def export(self, **kwargs):
            calls.append(kwargs)
            raise ValueError("operator unsupported at this opset")
    monkeypatch.setattr(conversion_runtime, "disable_ultralytics_autoinstall", lambda: None)
    monkeypatch.setattr(conversion_runtime.platform, "machine", lambda: "x86_64")
    monkeypatch.setitem(sys.modules, "ultralytics", types.SimpleNamespace(YOLO=FakeYOLO))
    with pytest.raises(RuntimeError, match=r"ONNX opset 11 conversion failed \(end-to-end/NMS-free.*No fallback opset"):
        conversion_runtime.export_fp32_artifact(tmp_path / "renamed.pt", tmp_path, "onnx", 64)
    assert len(calls) == 1 and calls[0]["opset"] == 11
    assert not (tmp_path / "model-onnx-fp32.onnx").exists()
