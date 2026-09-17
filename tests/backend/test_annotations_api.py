from pathlib import Path
from threading import Event, Thread

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


def test_image_position_rejects_an_image_outside_the_project(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Position API")
    other_project = repo.create_project("Other Position API")
    other_image = repo.create_image(other_project["id"], str(tmp_path / "other.jpg"))
    monkeypatch.setattr(main, "repo", repo)

    with pytest.raises(HTTPException) as exc_info:
        main.get_image_position(project["id"], other_image["id"])

    assert exc_info.value.status_code == 404


def test_remove_and_restore_project_image_returns_middle_queue_successor_and_annotations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Removal API")
    project_root = Path(project["root_path"])
    images = []
    for name in ("a.jpg", "b.jpg", "c.jpg"):
        image_path = project_root / "sources" / name
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(name.encode("utf-8"))
        images.append(repo.create_image(project["id"], str(image_path), width=30, height=20))
    repo.replace_image_annotations(
        images[1]["id"],
        [
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
        review_status="reviewed",
    )
    monkeypatch.setattr(main, "repo", repo)

    removal = main.remove_project_image(project["id"], images[1]["id"])

    assert removal["operation_id"]
    assert removal["image_id"] == images[1]["id"]
    assert removal["next_image_id"] == images[2]["id"]
    assert [image["id"] for image in repo.list_images(project["id"])] == [images[0]["id"], images[2]["id"]]

    restored = main.restore_project_image(project["id"], removal["operation_id"])

    assert restored["image"]["id"] == images[1]["id"]
    assert restored["annotations"][0]["class_name"] == "car"
    assert main.restore_project_image(project["id"], removal["operation_id"]) == restored


def test_remove_project_image_uses_previous_active_image_when_deleting_the_last_item(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Removal last-item API")
    project_root = Path(project["root_path"])
    images = []
    for name in ("a.jpg", "b.jpg", "c.jpg"):
        image_path = project_root / "sources" / name
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(name.encode("utf-8"))
        images.append(repo.create_image(project["id"], str(image_path)))
    monkeypatch.setattr(main, "repo", repo)

    removal = main.remove_project_image(project["id"], images[2]["id"])

    assert removal["next_image_id"] == images[1]["id"]


def test_remove_project_image_returns_no_successor_when_the_queue_becomes_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Removal single-item API")
    image_path = Path(project["root_path"]) / "sources" / "only.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"only")
    image = repo.create_image(project["id"], str(image_path))
    monkeypatch.setattr(main, "repo", repo)

    removal = main.remove_project_image(project["id"], image["id"])

    assert removal["next_image_id"] is None


def test_remove_project_image_keeps_queue_selection_atomic_against_an_earlier_removal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Removal atomic queue API")
    project_root = Path(project["root_path"])
    images = []
    for name in ("a.jpg", "b.jpg", "c.jpg", "d.jpg"):
        image_path = project_root / "sources" / name
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(name.encode("utf-8"))
        images.append(repo.create_image(project["id"], str(image_path)))
    monkeypatch.setattr(main, "repo", repo)

    safe_remove = main.project_services.remove_project_image
    remove_earlier = Event()
    earlier_finished = Event()

    def remove_earlier_image() -> None:
        remove_earlier.wait()
        safe_remove(repo, project["id"], images[0]["id"])
        earlier_finished.set()

    earlier_thread = Thread(target=remove_earlier_image)
    earlier_thread.start()

    def remove_target_after_interleaving(*args: object) -> dict[str, object]:
        remove_earlier.set()
        earlier_finished.wait(timeout=0.5)
        return safe_remove(*args)  # type: ignore[arg-type]

    monkeypatch.setattr(main.project_services, "remove_project_image", remove_target_after_interleaving)
    try:
        removal = main.remove_project_image(project["id"], images[1]["id"])
    finally:
        earlier_thread.join(timeout=2)

    assert not earlier_thread.is_alive()
    assert removal["next_image_id"] == images[2]["id"]


def test_concurrent_repeat_remove_returns_404_instead_of_an_internal_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Removal repeat API")
    image_path = Path(project["root_path"]) / "sources" / "record.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"record")
    image = repo.create_image(project["id"], str(image_path))
    monkeypatch.setattr(main, "repo", repo)

    start = Event()
    outcomes: list[dict[str, object] | HTTPException] = []

    def remove_in_parallel() -> None:
        start.wait()
        try:
            outcomes.append(main.remove_project_image(project["id"], image["id"]))
        except HTTPException as error:
            outcomes.append(error)

    threads = [Thread(target=remove_in_parallel) for _ in range(2)]
    for thread in threads:
        thread.start()
    start.set()
    for thread in threads:
        thread.join(timeout=2)

    assert all(not thread.is_alive() for thread in threads)
    assert sum(isinstance(outcome, dict) for outcome in outcomes) == 1
    errors = [outcome for outcome in outcomes if isinstance(outcome, HTTPException)]
    assert len(errors) == 1
    assert errors[0].status_code == 404


def test_image_removal_routes_hide_cross_project_resources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Removal API owner")
    other_project = repo.create_project("Removal API other")
    image_path = Path(other_project["root_path"]) / "sources" / "other.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"other")
    other_image = repo.create_image(other_project["id"], str(image_path))
    operation = main.project_services.remove_project_image(repo, other_project["id"], other_image["id"])
    monkeypatch.setattr(main, "repo", repo)

    with pytest.raises(HTTPException) as remove_error:
        main.remove_project_image(project["id"], other_image["id"])
    with pytest.raises(HTTPException) as restore_error:
        main.restore_project_image(project["id"], operation["id"])

    assert remove_error.value.status_code == 404
    assert restore_error.value.status_code == 404


def test_restore_route_maps_destination_collisions_and_unsafe_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Removal collision API")
    image_path = Path(project["root_path"]) / "sources" / "record.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"record")
    image = repo.create_image(project["id"], str(image_path))
    operation = main.project_services.remove_project_image(repo, project["id"], image["id"])
    monkeypatch.setattr(main, "repo", repo)

    image_path.write_bytes(b"collision")
    with pytest.raises(HTTPException) as collision_error:
        main.restore_project_image(project["id"], operation["id"])

    assert collision_error.value.status_code == 409
    assert "record.jpg" not in collision_error.value.detail

    image_path.unlink()
    repo.db.execute(
        "update image_removal_operations set original_image_path = ? where id = ?",
        (str(tmp_path / "outside.jpg"), operation["id"]),
    )
    with pytest.raises(HTTPException) as unsafe_error:
        main.restore_project_image(project["id"], operation["id"])

    assert unsafe_error.value.status_code == 422
    assert str(tmp_path) not in unsafe_error.value.detail
