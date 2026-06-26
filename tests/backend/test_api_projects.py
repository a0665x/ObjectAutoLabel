from pathlib import Path

from backend.app import main
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app.schemas import ClassDescriptorItem, ClassSchemaCreate, ProjectCreate


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_create_and_list_project(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    payload = ProjectCreate(name="API Demo", description="demo")
    project = repo.create_project(payload.name, payload.description)

    assert project["name"] == "API Demo"
    assert project["slug"].startswith("api-demo")
    assert any(item["id"] == project["id"] for item in repo.list_projects())


def test_create_class_schema_via_api(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(ProjectCreate(name="Schema API").name)
    payload = ClassSchemaCreate(
        name="Default",
        classes=[
            ClassDescriptorItem(class_id=0, class_name="person", descriptors=["person"]),
            ClassDescriptorItem(class_id=1, class_name="car", descriptors=["car", "van"]),
        ],
    )

    schema = repo.create_class_schema(
        project_id=project["id"],
        name=payload.name,
        classes=[item.model_dump() for item in payload.classes],
    )

    assert schema["classes"][1]["descriptors"] == ["car", "van"]


def test_images_can_be_filtered_by_review_status(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(ProjectCreate(name="Filter API").name)
    reviewed = repo.create_image(project["id"], str(tmp_path / "reviewed.jpg"))
    repo.create_image(project["id"], str(tmp_path / "pending.jpg"))
    repo.replace_image_annotations(reviewed["id"], [], review_status="reviewed")

    original_repo = main.repo
    main.repo = repo
    try:
        response = main.list_project_images(project["id"], review_status="reviewed")
    finally:
        main.repo = original_repo

    assert all(item["review_status"] == "reviewed" for item in response)
    assert [item["id"] for item in response] == [reviewed["id"]]


def test_review_stats_counts_statuses_and_low_confidence(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(ProjectCreate(name="Stats API").name)
    pending = repo.create_image(project["id"], str(tmp_path / "pending.jpg"))
    reviewed = repo.create_image(project["id"], str(tmp_path / "reviewed.jpg"))
    repo.replace_image_annotations(
        pending["id"],
        [
            {
                "class_id": 0,
                "class_name": "object",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.3,
                "height": 0.3,
                "confidence": 0.4,
                "source_type": "pseudo",
                "edited": False,
            }
        ],
        review_status="pending_review",
    )
    repo.replace_image_annotations(
        reviewed["id"],
        [
            {
                "class_id": 1,
                "class_name": "object",
                "x_center": 0.4,
                "y_center": 0.4,
                "width": 0.2,
                "height": 0.2,
                "confidence": 0.95,
                "source_type": "manual",
                "edited": True,
            }
        ],
        review_status="reviewed",
    )

    original_repo = main.repo
    main.repo = repo
    try:
        response = main.get_review_stats(project["id"])
    finally:
        main.repo = original_repo

    assert response["pending_review"] == 1
    assert response["reviewed"] == 1
    assert response["low_confidence"] == 1
