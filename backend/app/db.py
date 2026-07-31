from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any


def connect(database_path: Path | str) -> sqlite3.Connection:
    db = sqlite3.connect(str(database_path), check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("pragma foreign_keys = on")
    return db


@contextmanager
def transaction(db: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def initialize_schema(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        create table if not exists projects (
            id text primary key,
            slug text not null unique,
            name text not null,
            description text not null default '',
            root_path text not null,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists source_assets (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            kind text not null check (kind in ('video', 'image_folder')),
            path text not null,
            status text not null default 'ready',
            created_at text not null
        );

        create table if not exists frame_extraction_runs (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            source_asset_id text not null references source_assets(id) on delete cascade,
            output_dir text not null,
            frames_per_second real not null,
            resize_enabled integer not null default 0,
            resize_width integer,
            resize_height integer,
            frame_count integer not null default 0,
            job_id text,
            created_at text not null
        );

        create table if not exists class_schemas (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            name text not null,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists class_descriptors (
            id text primary key,
            schema_id text not null references class_schemas(id) on delete cascade,
            class_id integer not null,
            class_name text not null,
            descriptor text not null,
            sort_order integer not null default 0
        );

        create table if not exists pseudo_label_runs (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            run_name text,
            schema_id text not null references class_schemas(id),
            source_asset_id text references source_assets(id),
            world_model text not null,
            output_dir text not null,
            confidence real not null,
            iou real not null,
            image_count integer not null default 0,
            labeled_count integer not null default 0,
            raw_detection_count integer not null default 0,
            merged_detection_count integer not null default 0,
            merge_rate real not null default 0,
            last_image_path text,
            job_id text,
            created_at text not null
        );

        create table if not exists images (
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

        create table if not exists annotations (
            id text primary key,
            image_id text not null references images(id) on delete cascade,
            class_id integer not null,
            class_name text not null,
            x_center real not null,
            y_center real not null,
            width real not null,
            height real not null,
            confidence real,
            source_descriptor text,
            source_type text not null default 'pseudo',
            edited integer not null default 0,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists review_sessions (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            pseudo_label_run_id text references pseudo_label_runs(id) on delete set null,
            reviewed_count integer not null default 0,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists dataset_splits (
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

        create table if not exists augmentation_runs (
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

        create table if not exists training_runs (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            dataset_split_id text not null references dataset_splits(id),
            input_model text not null,
            output_dir text not null,
            run_name text,
            save_dir text,
            best_model_path text,
            last_model_path text,
            metrics_json text not null default '[]',
            status text not null default 'queued',
            job_id text,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists model_exports (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            training_run_id text not null references training_runs(id) on delete cascade,
            source_model_path text not null,
            export_format text not null,
            output_path text,
            status text not null default 'queued',
            job_id text,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists model_conversion_runs (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            training_run_id text references training_runs(id) on delete set null,
            source_model_path text not null,
            package_name text not null,
            output_dir text not null,
            schema_id text references class_schemas(id) on delete set null,
            schema_name text not null,
            schema_snapshot_json text not null,
            manifest_path text,
            status text not null default 'queued',
            job_id text,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists model_conversion_artifacts (
            id text primary key,
            conversion_run_id text not null references model_conversion_runs(id) on delete cascade,
            project_id text not null references projects(id) on delete cascade,
            format text not null,
            precision text not null,
            output_path text,
            status text not null default 'queued',
            created_at text not null,
            updated_at text not null
        );

        create table if not exists model_export_bundles (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            conversion_run_id text not null references model_conversion_runs(id) on delete cascade,
            bundle_name text not null,
            output_dir text not null,
            included_artifacts_json text not null,
            status text not null default 'queued',
            job_id text,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists jobs (
            id text primary key,
            project_id text references projects(id) on delete set null,
            related_type text,
            related_id text,
            name text not null,
            status text not null,
            progress integer not null default 0,
            message text not null default '',
            result_json text,
            error text,
            created_at text not null,
            updated_at text not null
        );

        create index if not exists idx_images_project_path on images(project_id, path);
        create index if not exists idx_annotations_image_id on annotations(image_id);
        create index if not exists idx_jobs_project_updated on jobs(project_id, updated_at);
        """
    )
    for statement in (
        "alter table pseudo_label_runs add column raw_detection_count integer not null default 0",
        "alter table pseudo_label_runs add column merged_detection_count integer not null default 0",
        "alter table pseudo_label_runs add column merge_rate real not null default 0",
        "alter table pseudo_label_runs add column last_image_path text",
        "alter table pseudo_label_runs add column run_name text",
        "alter table images add column augmentation_run_id text",
        "alter table dataset_splits add column pseudo_label_run_id text references pseudo_label_runs(id) on delete set null",
        "alter table dataset_splits add column augmentation_run_id text",
        "alter table training_runs add column run_name text",
        "alter table training_runs add column save_dir text",
        "alter table training_runs add column metrics_json text not null default '[]'",
    ):
        try:
            db.execute(statement)
        except sqlite3.OperationalError as exc:
            if "duplicate column name" not in str(exc):
                raise
    conversion_run_columns = db.execute("pragma table_info(model_conversion_runs)").fetchall()
    training_run_column = next((column for column in conversion_run_columns if column["name"] == "training_run_id"), None)
    if training_run_column is not None and int(training_run_column["notnull"]) == 1:
        db.executescript(
            """
            alter table model_conversion_runs rename to model_conversion_runs_old;
            create table model_conversion_runs (
                id text primary key,
                project_id text not null references projects(id) on delete cascade,
                training_run_id text references training_runs(id) on delete set null,
                source_model_path text not null,
                package_name text not null,
                output_dir text not null,
                schema_id text references class_schemas(id) on delete set null,
                schema_name text not null,
                schema_snapshot_json text not null,
                manifest_path text,
                status text not null default 'queued',
                job_id text,
                created_at text not null,
                updated_at text not null
            );
            insert into model_conversion_runs
            (id, project_id, training_run_id, source_model_path, package_name, output_dir,
             schema_id, schema_name, schema_snapshot_json, manifest_path, status, job_id,
             created_at, updated_at)
            select id, project_id, training_run_id, source_model_path, package_name, output_dir,
                   schema_id, schema_name, schema_snapshot_json, manifest_path, status, job_id,
                   created_at, updated_at
            from model_conversion_runs_old;
            drop table model_conversion_runs_old;
            """
        )
    artifact_foreign_keys = db.execute("pragma foreign_key_list(model_conversion_artifacts)").fetchall()
    if any(row["table"] == "model_conversion_runs_old" for row in artifact_foreign_keys):
        db.executescript(
            """
            alter table model_conversion_artifacts rename to model_conversion_artifacts_old;
            create table model_conversion_artifacts (
                id text primary key,
                conversion_run_id text not null references model_conversion_runs(id) on delete cascade,
                project_id text not null references projects(id) on delete cascade,
                format text not null,
                precision text not null,
                output_path text,
                status text not null default 'queued',
                created_at text not null,
                updated_at text not null
            );
            insert into model_conversion_artifacts
            (id, conversion_run_id, project_id, format, precision, output_path, status, created_at, updated_at)
            select id, conversion_run_id, project_id, format, precision, output_path, status, created_at, updated_at
            from model_conversion_artifacts_old;
            drop table model_conversion_artifacts_old;
            """
        )
    bundle_foreign_keys = db.execute("pragma foreign_key_list(model_export_bundles)").fetchall()
    if any(row["table"] == "model_conversion_runs_old" for row in bundle_foreign_keys):
        db.executescript(
            """
            alter table model_export_bundles rename to model_export_bundles_old;
            create table model_export_bundles (
                id text primary key,
                project_id text not null references projects(id) on delete cascade,
                conversion_run_id text not null references model_conversion_runs(id) on delete cascade,
                bundle_name text not null,
                output_dir text not null,
                included_artifacts_json text not null,
                status text not null default 'queued',
                job_id text,
                created_at text not null,
                updated_at text not null
            );
            insert into model_export_bundles
            (id, project_id, conversion_run_id, bundle_name, output_dir, included_artifacts_json,
             status, job_id, created_at, updated_at)
            select id, project_id, conversion_run_id, bundle_name, output_dir, included_artifacts_json,
                   status, job_id, created_at, updated_at
            from model_export_bundles_old;
            drop table model_export_bundles_old;
            """
        )
    db.commit()
