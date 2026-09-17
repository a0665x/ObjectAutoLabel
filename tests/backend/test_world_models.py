from pathlib import Path
from datetime import datetime
import sys
import types

import numpy as np
import pytest

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app.world_models import _schema_prompts, resolve_world_model, run_yolo_world_pseudo_label


def test_schema_prompts_keep_descriptor_to_target_class_mapping() -> None:
    prompts, mappings = _schema_prompts(
        {
            "classes": [
                {"class_id": 4, "class_name": "screw", "descriptors": ["tiny screw", "black screw"]},
                {"class_id": 7, "class_name": "washer", "descriptors": []},
            ]
        }
    )

    assert prompts == ["tiny screw", "black screw", "washer"]
    assert mappings == [
        {"class_id": 4, "class_name": "screw", "source_descriptor": "tiny screw"},
        {"class_id": 4, "class_name": "screw", "source_descriptor": "black screw"},
        {"class_id": 7, "class_name": "washer", "source_descriptor": "washer"},
    ]


def test_resolve_world_model_uses_world_model_folder(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    with connect(tmp_path / "db.sqlite") as db:
        initialize_schema(db)
        repo = Repository(db=db, paths=paths)

        assert resolve_world_model(repo, "yolov8s-world.pt") == tmp_path / "world_model" / "yolov8s-world.pt"


def _pseudo_repo(tmp_path: Path) -> tuple[Repository, dict, dict, dict]:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir(parents=True, exist_ok=True)
    db = connect(tmp_path / "db.sqlite")
    initialize_schema(db)
    repo = Repository(db=db, paths=paths)
    project = repo.create_project("YOLOE")
    schema = repo.create_class_schema(
        project["id"],
        "hardware",
        [{"class_id": 7, "class_name": "washer", "descriptors": ["flat washer"]}],
    )
    image = repo.create_image(project["id"], str(tmp_path / "sample.jpg"), width=64, height=64)
    job = repo.create_job("pseudo_label", project_id=project["id"])
    return repo, project, schema, image | {"job_id": job["id"]}


def test_yoloe_pseudo_labels_persist_bbox_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo, project, schema, image = _pseudo_repo(tmp_path)
    (repo.paths.world_model_dir / "yoloe-26n-seg.pt").write_bytes(b"weights")

    class FakePromptedWorldModel:
        def __init__(self, checkpoint: Path, prompts: list[str]) -> None:
            assert checkpoint.name == "yoloe-26n-seg.pt"
            assert prompts == ["flat washer"]

        def predict(self, frame: np.ndarray, confidence: float, iou: float) -> list[dict]:
            return [{"xyxy": [10.0, 20.0, 30.0, 40.0], "prompt_class_id": 0, "confidence": 0.9}]

    monkeypatch.setattr("backend.app.world_models.PromptedWorldModel", FakePromptedWorldModel)
    monkeypatch.setattr("backend.app.world_models._draw_preview", lambda *args: None)
    monkeypatch.setitem(sys.modules, "cv2", types.SimpleNamespace(imread=lambda path: np.zeros((64, 64, 3))))

    run = run_yolo_world_pseudo_label(
        repo,
        project["id"],
        schema["id"],
        None,
        "yoloe-26n-seg.pt",
        0.25,
        0.7,
        job_id=image["job_id"],
    )

    assert run["run_name"] == f"Pseudo_{datetime.now().strftime('%m%d')}_v001"

    annotation = repo.list_annotations(image["id"])[0]
    assert {key: annotation[key] for key in (
        "class_id", "class_name", "x_center", "y_center", "width", "height",
        "confidence", "source_descriptor", "source_type", "edited",
    )} == {
        "class_id": 7,
        "class_name": "washer",
        "x_center": 0.3125,
        "y_center": 0.46875,
        "width": 0.3125,
        "height": 0.3125,
        "confidence": 0.9,
        "source_descriptor": "flat washer",
        "source_type": "pseudo",
        "edited": False,
    }
    assert "mask" not in annotation
    assert "segments" not in annotation


def test_unsupported_checkpoint_fails_with_filename(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo, project, schema, image = _pseudo_repo(tmp_path)
    (repo.paths.world_model_dir / "mystery.pt").write_bytes(b"weights")
    monkeypatch.setitem(sys.modules, "cv2", types.SimpleNamespace(imread=lambda path: pytest.fail("no image iteration")))

    with pytest.raises(RuntimeError, match=r"mystery\.pt \(unknown\) failed"):
        run_yolo_world_pseudo_label(
            repo,
            project["id"],
            schema["id"],
            None,
            "mystery.pt",
            0.25,
            0.7,
            job_id=image["job_id"],
        )
