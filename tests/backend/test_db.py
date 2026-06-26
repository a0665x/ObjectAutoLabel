from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema


def test_app_paths_use_new_model_folder_names(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)

    assert paths.world_model_dir == tmp_path / "world_model"
    assert paths.input_model_dir == tmp_path / "input_model"
    assert paths.output_model_dir == tmp_path / "output_model"
    assert paths.database_path == tmp_path / "object_autolabel.db"


def test_initialize_schema_creates_core_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "object_autolabel.db"
    with connect(db_path) as db:
        initialize_schema(db)
        rows = db.execute(
            "select name from sqlite_master where type = 'table' order by name"
        ).fetchall()

    table_names = {row["name"] for row in rows}
    assert {
        "annotations",
        "class_descriptors",
        "class_schemas",
        "dataset_splits",
        "frame_extraction_runs",
        "images",
        "jobs",
        "model_exports",
        "projects",
        "pseudo_label_runs",
        "review_sessions",
        "source_assets",
        "training_runs",
    }.issubset(table_names)


def test_initialize_schema_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "object_autolabel.db"
    with connect(db_path) as db:
        initialize_schema(db)
        initialize_schema(db)
        count = db.execute("select count(*) as count from projects").fetchone()["count"]

    assert count == 0
