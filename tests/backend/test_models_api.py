from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def test_model_endpoints_return_lists(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir()
    paths.input_model_dir.mkdir()
    paths.output_model_dir.mkdir()
    (paths.world_model_dir / "yolov8s-world.pt").write_text("", encoding="utf-8")
    (paths.input_model_dir / "yolov8n.pt").write_text("", encoding="utf-8")
    (paths.output_model_dir / "best.pt").write_text("", encoding="utf-8")
    with connect(tmp_path / "test.db") as db:
        initialize_schema(db)
        models = Repository(db=db, paths=paths).list_models()

    assert models["world_models"] == ["yolov8s-world.pt"]
    assert models["input_models"] == ["yolov8n.pt"]
    assert models["output_models"] == ["best.pt"]
