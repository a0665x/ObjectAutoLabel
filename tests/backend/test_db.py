from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema


def test_app_paths_use_new_model_folder_names(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)

    assert paths.world_model_dir == tmp_path / "world_model"
    assert paths.input_model_dir == tmp_path / "input_model"
    assert paths.output_model_dir == tmp_path / "output_model"
    assert paths.database_path == tmp_path / "data" / "object_autolabel.db"


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


def test_initialize_schema_repairs_conversion_artifact_foreign_key_after_table_migration(tmp_path: Path) -> None:
    db_path = tmp_path / "object_autolabel.db"
    with connect(db_path) as db:
        db.executescript(
            """
            create table projects (id text primary key);
            create table model_conversion_runs (
                id text primary key,
                project_id text not null references projects(id) on delete cascade,
                training_run_id text references training_runs(id) on delete set null,
                source_model_path text not null,
                package_name text not null,
                output_dir text not null,
                schema_id text,
                schema_name text not null,
                schema_snapshot_json text not null,
                manifest_path text,
                status text not null default 'queued',
                job_id text,
                created_at text not null,
                updated_at text not null
            );
            alter table model_conversion_runs rename to model_conversion_runs_old;
            create table model_conversion_runs (
                id text primary key,
                project_id text not null references projects(id) on delete cascade,
                training_run_id text references training_runs(id) on delete set null,
                source_model_path text not null,
                package_name text not null,
                output_dir text not null,
                schema_id text,
                schema_name text not null,
                schema_snapshot_json text not null,
                manifest_path text,
                status text not null default 'queued',
                job_id text,
                created_at text not null,
                updated_at text not null
            );
            create table model_conversion_artifacts (
                id text primary key,
                conversion_run_id text not null references model_conversion_runs_old(id) on delete cascade,
                project_id text not null references projects(id) on delete cascade,
                format text not null,
                precision text not null,
                output_path text,
                status text not null default 'queued',
                created_at text not null,
                updated_at text not null
            );
            drop table model_conversion_runs_old;
            """
        )

        initialize_schema(db)
        foreign_keys = db.execute("pragma foreign_key_list(model_conversion_artifacts)").fetchall()

    assert {row["table"] for row in foreign_keys} == {"model_conversion_runs", "projects"}


def test_initialize_schema_repairs_export_bundle_foreign_key_after_table_migration(tmp_path: Path) -> None:
    db_path = tmp_path / "object_autolabel.db"
    with connect(db_path) as db:
        db.executescript(
            """
            create table projects (id text primary key);
            create table model_conversion_runs (
                id text primary key,
                project_id text not null references projects(id) on delete cascade,
                training_run_id text references training_runs(id) on delete set null,
                source_model_path text not null,
                package_name text not null,
                output_dir text not null,
                schema_id text,
                schema_name text not null,
                schema_snapshot_json text not null,
                manifest_path text,
                status text not null default 'queued',
                job_id text,
                created_at text not null,
                updated_at text not null
            );
            alter table model_conversion_runs rename to model_conversion_runs_old;
            create table model_conversion_runs (
                id text primary key,
                project_id text not null references projects(id) on delete cascade,
                training_run_id text references training_runs(id) on delete set null,
                source_model_path text not null,
                package_name text not null,
                output_dir text not null,
                schema_id text,
                schema_name text not null,
                schema_snapshot_json text not null,
                manifest_path text,
                status text not null default 'queued',
                job_id text,
                created_at text not null,
                updated_at text not null
            );
            create table model_export_bundles (
                id text primary key,
                project_id text not null references projects(id) on delete cascade,
                conversion_run_id text not null references model_conversion_runs_old(id) on delete cascade,
                bundle_name text not null,
                output_dir text not null,
                included_artifacts_json text not null,
                status text not null default 'queued',
                job_id text,
                created_at text not null,
                updated_at text not null
            );
            drop table model_conversion_runs_old;
            """
        )

        initialize_schema(db)
        foreign_keys = db.execute("pragma foreign_key_list(model_export_bundles)").fetchall()

    assert {row["table"] for row in foreign_keys} == {"model_conversion_runs", "projects"}
