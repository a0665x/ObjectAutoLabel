from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_create_project_creates_project_folders(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)

    project = repo.create_project(name="Drone Cars", description="aerial labels")

    assert project["slug"] == "drone-cars"
    assert Path(project["root_path"]).exists()
    assert (Path(project["root_path"]) / "sources").exists()
    assert (Path(project["root_path"]) / "reviewed_labels").exists()


def test_create_class_schema_preserves_class_id_order(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Demo", description="")

    schema = repo.create_class_schema(
        project_id=project["id"],
        name="Default",
        classes=[
            {"class_id": 0, "class_name": "person", "descriptors": ["standing person", "walking person"]},
            {"class_id": 1, "class_name": "car", "descriptors": ["sedan car", "aerial vehicle"]},
        ],
    )
    loaded = repo.get_class_schema(schema["id"])

    assert loaded is not None
    assert loaded["classes"][0]["class_id"] == 0
    assert loaded["classes"][0]["descriptors"] == ["standing person", "walking person"]
    assert loaded["classes"][1]["class_name"] == "car"


def test_list_models_uses_world_and_input_dirs(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    (tmp_path / "world_model").mkdir()
    (tmp_path / "input_model").mkdir()
    (tmp_path / "world_model" / "yolov8s-world.pt").write_text("x", encoding="utf-8")
    (tmp_path / "world_model" / "custom-world.pth").write_text("x", encoding="utf-8")
    (tmp_path / "input_model" / "yolov8n.pt").write_text("x", encoding="utf-8")
    (tmp_path / "input_model" / "custom-input.pth").write_text("x", encoding="utf-8")

    models = repo.list_models()

    assert models == {
        "world_models": ["custom-world.pth", "yolov8s-world.pt"],
        "input_models": ["custom-input.pth", "yolov8n.pt"],
        "output_models": [],
    }
