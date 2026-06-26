from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app.world_models import _schema_prompts, resolve_world_model


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
