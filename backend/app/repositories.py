from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .config import AppPaths
from .db import row_to_dict, rows_to_dicts, transaction


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid4().hex


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "project"


class Repository:
    def __init__(self, db: Any, paths: AppPaths) -> None:
        self.db = db
        self.paths = paths

    def create_project(self, name: str, description: str = "") -> dict[str, Any]:
        now = utc_now()
        base_slug = slugify(name)
        slug = base_slug
        suffix = 2
        while self.db.execute("select 1 from projects where slug = ?", (slug,)).fetchone():
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        project_id = new_id()
        root_path = self.paths.projects_dir / slug
        for child in ("sources", "frames", "pseudo_labels", "reviewed_labels", "splits", "metadata"):
            (root_path / child).mkdir(parents=True, exist_ok=True)
        with transaction(self.db):
            self.db.execute(
                """
                insert into projects (id, slug, name, description, root_path, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (project_id, slug, name, description, str(root_path), now, now),
            )
        project = self.get_project(project_id)
        assert project is not None
        return project

    def list_projects(self) -> list[dict[str, Any]]:
        rows = self.db.execute("select * from projects order by created_at desc").fetchall()
        return rows_to_dicts(rows)

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from projects where id = ?", (project_id,)).fetchone())

    def create_class_schema(
        self,
        project_id: str,
        name: str,
        classes: list[dict[str, Any]],
    ) -> dict[str, Any]:
        schema_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into class_schemas (id, project_id, name, created_at, updated_at)
                values (?, ?, ?, ?, ?)
                """,
                (schema_id, project_id, name, now, now),
            )
            for item in classes:
                class_id = int(item["class_id"])
                class_name = str(item["class_name"])
                for sort_order, descriptor in enumerate(item.get("descriptors", [])):
                    self.db.execute(
                        """
                        insert into class_descriptors
                        (id, schema_id, class_id, class_name, descriptor, sort_order)
                        values (?, ?, ?, ?, ?, ?)
                        """,
                        (new_id(), schema_id, class_id, class_name, str(descriptor), sort_order),
                    )
        schema = self.get_class_schema(schema_id)
        assert schema is not None
        return schema

    def get_class_schema(self, schema_id: str) -> dict[str, Any] | None:
        schema = row_to_dict(
            self.db.execute("select * from class_schemas where id = ?", (schema_id,)).fetchone()
        )
        if not schema:
            return None
        rows = self.db.execute(
            """
            select class_id, class_name, descriptor
            from class_descriptors
            where schema_id = ?
            order by class_id asc, sort_order asc
            """,
            (schema_id,),
        ).fetchall()
        grouped: dict[int, dict[str, Any]] = {}
        for row in rows:
            class_id = int(row["class_id"])
            grouped.setdefault(
                class_id,
                {"class_id": class_id, "class_name": row["class_name"], "descriptors": []},
            )
            grouped[class_id]["descriptors"].append(row["descriptor"])
        schema["classes"] = [grouped[key] for key in sorted(grouped)]
        return schema

    def list_class_schemas(self, project_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "select id from class_schemas where project_id = ? order by created_at desc",
            (project_id,),
        ).fetchall()
        return [schema for row in rows if (schema := self.get_class_schema(row["id"])) is not None]

    def list_models(self) -> dict[str, list[str]]:
        def pt_files(path: Path) -> list[str]:
            return sorted(item.name for item in path.glob("*.pt")) if path.exists() else []

        output_models: list[str] = []
        if self.paths.output_model_dir.exists():
            output_models = sorted(
                str(item.relative_to(self.paths.output_model_dir))
                for item in self.paths.output_model_dir.rglob("*")
                if item.suffix in {".pt", ".tflite", ".onnx", ".torchscript"}
            )
        return {
            "world_models": pt_files(self.paths.world_model_dir),
            "input_models": pt_files(self.paths.input_model_dir),
            "output_models": output_models,
        }

    def create_job(
        self,
        name: str,
        project_id: str | None = None,
        related_type: str | None = None,
        related_id: str | None = None,
    ) -> dict[str, Any]:
        job_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into jobs
                (id, project_id, related_type, related_id, name, status, progress, message, created_at, updated_at)
                values (?, ?, ?, ?, ?, 'queued', 0, 'Queued', ?, ?)
                """,
                (job_id, project_id, related_type, related_id, name, now, now),
            )
        job = self.get_job(job_id)
        assert job is not None
        return job

    def update_job(self, job_id: str, **patch: Any) -> None:
        allowed = {"status", "progress", "message", "result_json", "error"}
        updates = {key: value for key, value in patch.items() if key in allowed}
        if not updates:
            return
        updates["updated_at"] = utc_now()
        columns = ", ".join(f"{key} = ?" for key in updates)
        values = list(updates.values()) + [job_id]
        with transaction(self.db):
            self.db.execute(f"update jobs set {columns} where id = ?", values)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        job = row_to_dict(self.db.execute("select * from jobs where id = ?", (job_id,)).fetchone())
        if job and job.get("result_json"):
            job["result"] = json.loads(job["result_json"])
        elif job:
            job["result"] = None
        return job

    def list_jobs(self) -> list[dict[str, Any]]:
        rows = self.db.execute("select * from jobs order by created_at desc limit 100").fetchall()
        jobs = []
        for row in rows:
            job = dict(row)
            job["result"] = json.loads(job["result_json"]) if job.get("result_json") else None
            jobs.append(job)
        return jobs

    def create_source_asset(self, project_id: str, kind: str, path: str) -> dict[str, Any]:
        source_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into source_assets (id, project_id, kind, path, created_at)
                values (?, ?, ?, ?, ?)
                """,
                (source_id, project_id, kind, path, now),
            )
        source = self.get_source_asset(source_id)
        assert source is not None
        return source

    def get_source_asset(self, source_asset_id: str) -> dict[str, Any] | None:
        return row_to_dict(
            self.db.execute("select * from source_assets where id = ?", (source_asset_id,)).fetchone()
        )

    def list_source_assets(self, project_id: str) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                "select * from source_assets where project_id = ? order by created_at desc",
                (project_id,),
            ).fetchall()
        )

    def create_image(
        self,
        project_id: str,
        path: str,
        source_asset_id: str | None = None,
        pseudo_label_run_id: str | None = None,
        width: int | None = None,
        height: int | None = None,
    ) -> dict[str, Any]:
        image_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into images
                (id, project_id, source_asset_id, pseudo_label_run_id, path, width, height, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (image_id, project_id, source_asset_id, pseudo_label_run_id, path, width, height, now),
            )
        image = self.get_image(image_id)
        assert image is not None
        return image

    def get_image(self, image_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from images where id = ?", (image_id,)).fetchone())

    def list_images(self, project_id: str, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                """
                select * from images
                where project_id = ?
                order by path asc
                limit ? offset ?
                """,
                (project_id, limit, offset),
            ).fetchall()
        )

    def replace_image_annotations(
        self,
        image_id: str,
        annotations: list[dict[str, Any]],
        review_status: str,
    ) -> list[dict[str, Any]]:
        image = self.get_image(image_id)
        if not image:
            raise ValueError(f"Image not found: {image_id}")
        now = utc_now()
        with transaction(self.db):
            self.db.execute("delete from annotations where image_id = ?", (image_id,))
            for item in annotations:
                self.db.execute(
                    """
                    insert into annotations
                    (id, image_id, class_id, class_name, x_center, y_center, width, height,
                     confidence, source_descriptor, source_type, edited, created_at, updated_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item.get("id") or new_id(),
                        image_id,
                        int(item["class_id"]),
                        item["class_name"],
                        float(item["x_center"]),
                        float(item["y_center"]),
                        float(item["width"]),
                        float(item["height"]),
                        item.get("confidence"),
                        item.get("source_descriptor"),
                        item.get("source_type", "manual"),
                        1 if item.get("edited") else 0,
                        now,
                        now,
                    ),
                )
            self.db.execute(
                "update images set review_status = ? where id = ?",
                (review_status, image_id),
            )
        return self.list_annotations(image_id)

    def list_annotations(self, image_id: str) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                "select * from annotations where image_id = ? order by created_at asc",
                (image_id,),
            ).fetchall()
        )

    def create_pseudo_label_run_record(
        self,
        project_id: str,
        schema_id: str,
        source_asset_id: str | None,
        world_model: str,
        output_dir: str,
        confidence: float,
        iou: float,
        image_count: int,
        labeled_count: int,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        run_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into pseudo_label_runs
                (id, project_id, schema_id, source_asset_id, world_model, output_dir,
                 confidence, iou, image_count, labeled_count, job_id, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    project_id,
                    schema_id,
                    source_asset_id,
                    world_model,
                    output_dir,
                    confidence,
                    iou,
                    image_count,
                    labeled_count,
                    job_id,
                    now,
                ),
            )
        row = self.db.execute("select * from pseudo_label_runs where id = ?", (run_id,)).fetchone()
        return dict(row)

    def create_dataset_split_record(
        self,
        project_id: str,
        name: str,
        train_ratio: float,
        val_ratio: float,
        test_ratio: float,
        output_dir: str,
        dataset_yaml_path: str,
        image_ids_json: str,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        split_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into dataset_splits
                (id, project_id, name, train_ratio, val_ratio, test_ratio, output_dir,
                 dataset_yaml_path, image_ids_json, job_id, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    split_id,
                    project_id,
                    name,
                    train_ratio,
                    val_ratio,
                    test_ratio,
                    output_dir,
                    dataset_yaml_path,
                    image_ids_json,
                    job_id,
                    now,
                ),
            )
        row = self.db.execute("select * from dataset_splits where id = ?", (split_id,)).fetchone()
        return dict(row)

    def get_dataset_split(self, split_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from dataset_splits where id = ?", (split_id,)).fetchone())

    def list_dataset_splits(self, project_id: str) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                "select * from dataset_splits where project_id = ? order by created_at desc",
                (project_id,),
            ).fetchall()
        )

    def create_training_run_record(
        self,
        project_id: str,
        dataset_split_id: str,
        input_model: str,
        output_dir: str,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        run_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into training_runs
                (id, project_id, dataset_split_id, input_model, output_dir, status, job_id, created_at, updated_at)
                values (?, ?, ?, ?, ?, 'running', ?, ?, ?)
                """,
                (run_id, project_id, dataset_split_id, input_model, output_dir, job_id, now, now),
            )
        run = self.get_training_run(run_id)
        assert run is not None
        return run

    def update_training_run(self, training_run_id: str, **patch: Any) -> None:
        allowed = {"best_model_path", "last_model_path", "status"}
        updates = {key: value for key, value in patch.items() if key in allowed}
        if not updates:
            return
        updates["updated_at"] = utc_now()
        columns = ", ".join(f"{key} = ?" for key in updates)
        values = list(updates.values()) + [training_run_id]
        with transaction(self.db):
            self.db.execute(f"update training_runs set {columns} where id = ?", values)

    def get_training_run(self, training_run_id: str) -> dict[str, Any] | None:
        return row_to_dict(
            self.db.execute("select * from training_runs where id = ?", (training_run_id,)).fetchone()
        )

    def list_training_runs(self, project_id: str) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                "select * from training_runs where project_id = ? order by created_at desc",
                (project_id,),
            ).fetchall()
        )

    def create_model_export_record(
        self,
        project_id: str,
        training_run_id: str,
        source_model_path: str,
        export_format: str,
        output_path: str | None,
        status: str,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        export_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into model_exports
                (id, project_id, training_run_id, source_model_path, export_format,
                 output_path, status, job_id, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    export_id,
                    project_id,
                    training_run_id,
                    source_model_path,
                    export_format,
                    output_path,
                    status,
                    job_id,
                    now,
                    now,
                ),
            )
        row = self.db.execute("select * from model_exports where id = ?", (export_id,)).fetchone()
        return dict(row)
