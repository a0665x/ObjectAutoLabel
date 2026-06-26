from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi import HTTPException
from backend.app import main
from pydantic import ValidationError

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.project_services import save_image_annotations
from backend.app.repositories import Repository
from backend.app.schemas import AnnotationSaveRequest


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_save_annotations_writes_yolo_label_file(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Annot API")
    image_path = Path(project["root_path"]) / "sources" / "image.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(image_path), width=30, height=20)

    result = save_image_annotations(
        repo,
        image_id=image["id"],
        review_status="reviewed",
        annotations=[
            {
                "class_id": 1,
                "class_name": "car",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.3,
                "source_type": "manual",
                "edited": True,
            }
        ],
    )

    label_path = Path(result["label_path"])
    assert label_path.read_text(encoding="utf-8") == "1 0.500000 0.500000 0.200000 0.300000"


def test_annotation_save_rejects_invalid_bbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Annot API Bounds")
    image_path = Path(project["root_path"]) / "sources" / "image.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(image_path), width=30, height=20)

    payload = {
        "review_status": "reviewed",
        "annotations": [
            {
                "class_id": 0,
                "class_name": "object",
                "x_center": 0.95,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.2,
                "source_type": "manual",
                "edited": True,
            }
        ],
    }
    AnnotationSaveRequest.model_validate(payload)

    monkeypatch.setattr(main, "repo", repo)
    with pytest.raises(HTTPException, match="Annotation bbox must stay within normalized image bounds") as exc_info:
        main.save_annotations(image["id"], AnnotationSaveRequest.model_validate(payload))

    assert exc_info.value.status_code == 422


def test_annotation_save_rejects_invalid_review_status() -> None:
    with pytest.raises(ValidationError):
        AnnotationSaveRequest.model_validate(
            {
                "review_status": "done",
                "annotations": [],
            }
        )


def test_save_annotations_rejects_bbox_outside_image_bounds(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Annot Bounds")
    image_path = Path(project["root_path"]) / "sources" / "image.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(image_path), width=30, height=20)

    with pytest.raises(ValueError, match="Annotation bbox must stay within normalized image bounds"):
        save_image_annotations(
            repo,
            image_id=image["id"],
            review_status="reviewed",
            annotations=[
                {
                    "class_id": 1,
                    "class_name": "car",
                    "x_center": 0.95,
                    "y_center": 0.5,
                    "width": 0.2,
                    "height": 0.3,
                    "source_type": "manual",
                    "edited": True,
                }
            ],
        )
