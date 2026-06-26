from pathlib import Path

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
