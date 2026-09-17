from pathlib import Path

import numpy as np
import pytest

from backend.app.world_model_adapter import PromptedWorldModel


class FakeResult:
    boxes = type(
        "Boxes",
        (),
        {
            "xyxy": np.array([[10.0, 20.0, 30.0, 40.0]]),
            "cls": np.array([1.0]),
            "conf": np.array([0.9]),
        },
    )()


class FakeModel:
    instances: list["FakeModel"] = []

    def __init__(self, path: str):
        self.path = path
        self.prompts: list[str] = []
        self.predict_kwargs: dict[str, object] = {}
        self.__class__.instances.append(self)

    def set_classes(self, prompts: list[str]) -> None:
        self.prompts = prompts

    def predict(self, frame: np.ndarray, **kwargs: object) -> list[FakeResult]:
        self.predict_kwargs = kwargs
        return [FakeResult()]


class FakeLegacyModel(FakeModel):
    instances: list[FakeModel] = []


class FakeYoloeModel(FakeModel):
    instances: list[FakeModel] = []


class CurrentDirectoryModel(FakeModel):
    def set_classes(self, prompts: list[str]) -> None:
        self.current_directory = Path.cwd()
        super().set_classes(prompts)


def _checkpoint(tmp_path: Path, name: str) -> Path:
    checkpoint = tmp_path / name
    checkpoint.write_bytes(b"weights")
    encoder = "mobileclip2_b.ts" if name.startswith("yoloe-26") else "ViT-B-32.pt"
    (tmp_path / encoder).write_bytes(b"encoder")
    return checkpoint


def test_yoloe_adapter_sets_prompts_and_returns_boxes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.world_model_adapter._load_ultralytics_classes",
        lambda: (FakeLegacyModel, FakeYoloeModel),
    )
    model = PromptedWorldModel(_checkpoint(tmp_path, "yoloe-26n-seg.pt"), ["bolt", "washer"])

    assert model.family == "yoloe-26"
    assert FakeYoloeModel.instances[-1].prompts == ["bolt", "washer"]
    assert model.predict(np.zeros((64, 64, 3)), 0.25, 0.7) == [
        {"xyxy": [10.0, 20.0, 30.0, 40.0], "prompt_class_id": 1, "confidence": 0.9}
    ]
    assert FakeYoloeModel.instances[-1].predict_kwargs == {
        "conf": 0.25,
        "iou": 0.7,
        "device": 0,
        "verbose": False,
    }


def test_legacy_checkpoint_uses_yolo_world(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.world_model_adapter._load_ultralytics_classes",
        lambda: (FakeLegacyModel, FakeYoloeModel),
    )
    checkpoint = _checkpoint(tmp_path, "yolov8s-world.pt")
    model = PromptedWorldModel(checkpoint, ["bolt"])
    assert model.family == "yolo-world"
    assert FakeLegacyModel.instances[-1].path == str(checkpoint)


def test_world_v2_checkpoint_uses_yolo_world_and_clip_encoder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.world_model_adapter._load_ultralytics_classes",
        lambda: (FakeLegacyModel, FakeYoloeModel),
    )
    checkpoint = _checkpoint(tmp_path, "yolov8s-worldv2.pt")
    model = PromptedWorldModel(checkpoint, ["bolt"])

    assert model.family == "yolo-world-v2"
    assert FakeLegacyModel.instances[-1].path == str(checkpoint)


def test_adapter_does_not_change_process_working_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.world_model_adapter._load_ultralytics_classes",
        lambda: (CurrentDirectoryModel, CurrentDirectoryModel),
    )
    original_cwd = Path.cwd()

    model = PromptedWorldModel(_checkpoint(tmp_path, "yoloe-26n-seg.pt"), ["bolt"])

    assert Path.cwd() == original_cwd
    assert model.model.current_directory == original_cwd


def test_rejects_unsupported_checkpoint_before_import(monkeypatch: pytest.MonkeyPatch) -> None:
    load = lambda: pytest.fail("Ultralytics should not load")
    monkeypatch.setattr("backend.app.world_model_adapter._load_ultralytics_classes", load)
    with pytest.raises(ValueError, match="Unsupported world model mystery.pt"):
        PromptedWorldModel(Path("mystery.pt"), ["bolt"])


def test_empty_boxes_returns_no_predictions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class EmptyModel(FakeModel):
        def predict(self, frame: np.ndarray, **kwargs: object) -> list[object]:
            return [type("Result", (), {"boxes": None})()]

    monkeypatch.setattr(
        "backend.app.world_model_adapter._load_ultralytics_classes",
        lambda: (FakeLegacyModel, EmptyModel),
    )
    model = PromptedWorldModel(_checkpoint(tmp_path, "yoloe-26n-seg.pt"), ["bolt"])
    assert model.predict(np.zeros((64, 64, 3)), 0.25, 0.7) == []


def test_missing_prompt_encoder_fails_before_ultralytics_load(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    checkpoint = tmp_path / "yoloe-26n-seg.pt"
    checkpoint.write_bytes(b"weights")
    load = lambda: pytest.fail("Ultralytics should not load")
    monkeypatch.setattr("backend.app.world_model_adapter._load_ultralytics_classes", load)

    with pytest.raises(FileNotFoundError, match="mobileclip2_b.ts.*install-world-model.sh"):
        PromptedWorldModel(checkpoint, ["bolt"])
