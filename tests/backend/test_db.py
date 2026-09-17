from pathlib import Path
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

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


def _create_pre_feature_removal_schema(db: sqlite3.Connection) -> None:
    """Create the small legacy schema that predates removal/staleness metadata."""
    db.executescript(
        """
        create table projects (
            id text primary key,
            slug text not null unique,
            name text not null,
            description text not null default '',
            root_path text not null,
            created_at text not null,
            updated_at text not null
        );

        -- The legacy image and run tables referenced these parent IDs.
        create table source_assets (id text primary key);
        create table pseudo_label_runs (id text primary key);

        create table images (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            source_asset_id text references source_assets(id) on delete set null,
            pseudo_label_run_id text references pseudo_label_runs(id) on delete set null,
            augmentation_run_id text,
            path text not null,
            width integer,
            height integer,
            review_status text not null default 'unreviewed',
            created_at text not null
        );

        create table augmentation_runs (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            pseudo_label_run_id text references pseudo_label_runs(id) on delete set null,
            name text not null,
            output_dir text not null,
            settings_json text not null,
            source_image_count integer not null default 0,
            created_image_count integer not null default 0,
            job_id text,
            created_at text not null
        );

        create table dataset_splits (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            name text not null,
            train_ratio real not null,
            val_ratio real not null,
            test_ratio real not null,
            output_dir text not null,
            dataset_yaml_path text not null,
            image_ids_json text not null,
            pseudo_label_run_id text references pseudo_label_runs(id) on delete set null,
            augmentation_run_id text,
            job_id text,
            created_at text not null
        );
        """
    )


def test_initialize_schema_adds_recoverable_image_removal_and_staleness(tmp_path: Path) -> None:
    db_path = tmp_path / "object_autolabel.db"
    with connect(db_path) as db:
        _create_pre_feature_removal_schema(db)
        assert {
            "removed_at",
            "removal_operation_id",
        }.isdisjoint({row["name"] for row in db.execute("pragma table_info(images)")})
        assert {
            "source_image_ids_json",
            "outdated",
            "outdated_reason",
        }.isdisjoint({row["name"] for row in db.execute("pragma table_info(augmentation_runs)")})
        assert {"outdated", "outdated_reason"}.isdisjoint(
            {row["name"] for row in db.execute("pragma table_info(dataset_splits)")}
        )
        assert db.execute(
            "select name from sqlite_master "
            "where type = 'table' and name = 'image_removal_operations'"
        ).fetchone() is None

        db.execute(
            "insert into projects (id, slug, name, description, root_path, created_at, updated_at) "
            "values (?, ?, ?, ?, ?, ?, ?)",
            ("project-1", "project-1", "Project", "", "/tmp/project", "now", "now"),
        )
        db.execute(
            "insert into images (id, project_id, path, created_at) values (?, ?, ?, ?)",
            ("image-1", "project-1", "/tmp/project/image.jpg", "now"),
        )
        db.execute(
            "insert into augmentation_runs "
            "(id, project_id, name, output_dir, settings_json, created_at) "
            "values (?, ?, ?, ?, ?, ?)",
            ("augmentation-1", "project-1", "Augmentation", "/tmp/aug", "{}", "now"),
        )
        db.execute(
            "insert into dataset_splits "
            "(id, project_id, name, train_ratio, val_ratio, test_ratio, output_dir, "
            "dataset_yaml_path, image_ids_json, created_at) "
            "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "split-1",
                "project-1",
                "Split",
                0.8,
                0.1,
                0.1,
                "/tmp/split",
                "/tmp/split/data.yaml",
                "[\"image-1\"]",
                "now",
            ),
        )

        initialize_schema(db)

        image_columns = {row["name"] for row in db.execute("pragma table_info(images)")}
        augmentation_columns = {
            row["name"] for row in db.execute("pragma table_info(augmentation_runs)")
        }
        split_columns = {row["name"] for row in db.execute("pragma table_info(dataset_splits)")}
        assert {"removed_at", "removal_operation_id"} <= image_columns
        assert {"source_image_ids_json", "outdated", "outdated_reason"} <= augmentation_columns
        assert {"outdated", "outdated_reason"} <= split_columns
        operation_columns = [
            row["name"] for row in db.execute("pragma table_info(image_removal_operations)")
        ]
        assert operation_columns == [
            "id",
            "project_id",
            "image_id",
            "original_image_path",
            "trash_image_path",
            "original_label_path",
            "trash_label_path",
            "removed_at",
            "restored_at",
        ]
        assert db.execute(
            "select name from sqlite_master "
            "where type = 'table' and name = 'image_removal_operations'"
        ).fetchone()

        removal_foreign_keys = db.execute(
            "pragma foreign_key_list(image_removal_operations)"
        ).fetchall()
        assert {
            (row["table"], row["on_delete"])
            for row in removal_foreign_keys
        } == {("projects", "CASCADE"), ("images", "CASCADE")}

        image = db.execute(
            "select id, project_id, path, review_status, removed_at, removal_operation_id "
            "from images where id = ?",
            ("image-1",),
        ).fetchone()
        augmentation = db.execute(
            "select project_id, name, settings_json, source_image_ids_json, outdated, outdated_reason "
            "from augmentation_runs where id = ?",
            ("augmentation-1",),
        ).fetchone()
        split = db.execute(
            "select project_id, name, image_ids_json, outdated, outdated_reason "
            "from dataset_splits where id = ?",
            ("split-1",),
        ).fetchone()

        db.execute(
            "insert into image_removal_operations "
            "(id, project_id, image_id, original_image_path, trash_image_path, "
            "original_label_path, trash_label_path, removed_at, restored_at) "
            "values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "removal-1",
                "project-1",
                "image-1",
                "/tmp/project/image.jpg",
                "/tmp/project/.trash/image.jpg",
                "/tmp/project/image.txt",
                "/tmp/project/.trash/image.txt",
                "later",
                None,
            ),
        )
        assert db.execute(
            "select id from image_removal_operations where id = ?", ("removal-1",)
        ).fetchone()["id"] == "removal-1"
        db.execute("delete from images where id = ?", ("image-1",))
        assert db.execute(
            "select id from image_removal_operations where id = ?", ("removal-1",)
        ).fetchone() is None

        initialize_schema(db)
        assert db.execute("pragma foreign_key_check").fetchall() == []

    assert dict(image) == {
        "id": "image-1",
        "project_id": "project-1",
        "path": "/tmp/project/image.jpg",
        "review_status": "unreviewed",
        "removed_at": None,
        "removal_operation_id": None,
    }
    assert dict(augmentation) == {
        "project_id": "project-1",
        "name": "Augmentation",
        "settings_json": "{}",
        "source_image_ids_json": None,
        "outdated": 0,
        "outdated_reason": None,
    }
    assert dict(split) == {
        "project_id": "project-1",
        "name": "Split",
        "image_ids_json": '["image-1"]',
        "outdated": 0,
        "outdated_reason": None,
    }


def test_connection_rejects_raw_cursor_factories(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")

    with pytest.raises(ValueError, match="SerializedCursor"):
        db.cursor(factory=sqlite3.Cursor)


def test_connection_context_manager_holds_lock_until_exit(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    writer_entered = Event()
    reader_attempted = Event()
    reader_finished = Event()
    release_writer = Event()

    def hold_connection_context() -> None:
        with db:
            db.execute("insert into projects (id, slug, name, description, root_path, created_at, updated_at) values ('id', 'slug', 'name', '', '', 'now', 'now')")
            writer_entered.set()
            assert reader_attempted.wait(timeout=3)
            assert not reader_finished.wait(timeout=0.1)
            assert release_writer.wait(timeout=3)

    def read_while_context_is_open() -> int:
        assert writer_entered.wait(timeout=3)
        reader_attempted.set()
        value = db.execute("select count(*) from projects").fetchone()[0]
        reader_finished.set()
        return value

    with ThreadPoolExecutor(max_workers=2) as executor:
        writer = executor.submit(hold_connection_context)
        reader = executor.submit(read_while_context_is_open)
        assert reader_attempted.wait(timeout=3)
        assert not reader_finished.wait(timeout=0.1)
        release_writer.set()
        writer.result(timeout=10)
        assert reader.result(timeout=10) == 1


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
