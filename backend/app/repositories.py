from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .config import AppPaths
from .db import row_to_dict, rows_to_dicts, transaction


PROJECT_WORKSPACE_DIRS = (
    "sources",
    "pseudo_labels",
    "reviewed_labels",
    "splits",
    "metadata",
    "augmentations",
    "output_model",
)
PROJECT_OUTPUT_SUBDIRS = ("runs", "conversions", "exports")
PROJECT_SOURCE_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


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

    def project_output_model_dir(self, project: dict[str, Any]) -> Path:
        return Path(project["root_path"]) / "output_model"

    def ensure_project_output_model_index(self, project: dict[str, Any]) -> Path:
        output_dir = self.project_output_model_dir(project)
        output_dir.mkdir(parents=True, exist_ok=True)
        self.paths.output_model_dir.mkdir(parents=True, exist_ok=True)
        index_path = self.paths.output_model_dir / str(project["slug"])
        link_target = Path("..") / output_dir.relative_to(self.paths.project_root)
        if index_path.is_symlink():
            if index_path.resolve() != output_dir.resolve() or index_path.readlink().is_absolute():
                index_path.unlink()
                index_path.symlink_to(link_target, target_is_directory=True)
            return index_path
        if not index_path.exists():
            index_path.symlink_to(link_target, target_is_directory=True)
        return index_path

    def ensure_project_workspace(self, project: dict[str, Any]) -> None:
        root_path = Path(project["root_path"])
        for child in PROJECT_WORKSPACE_DIRS:
            (root_path / child).mkdir(parents=True, exist_ok=True)
        for child in PROJECT_OUTPUT_SUBDIRS:
            (root_path / "output_model" / child).mkdir(parents=True, exist_ok=True)

    def migrate_project_output_models(self) -> None:
        for project in self.list_projects():
            root_path = Path(str(project.get("root_path") or ""))
            if not root_path.exists():
                # Do not silently recreate a manually removed project package.
                # Leaving the DB row stale lets the UI warn and offer cleanup.
                continue
            self.ensure_project_workspace(project)
            self.ensure_project_output_model_index(project)
            legacy_dir = self.paths.output_model_dir / str(project["id"])
            if not legacy_dir.exists() or legacy_dir.is_symlink() or not legacy_dir.is_dir():
                continue
            target_dir = self.project_output_model_dir(project)
            target_dir.mkdir(parents=True, exist_ok=True)
            for item in legacy_dir.iterdir():
                destination = target_dir / item.name
                if destination.exists() and destination.is_dir() and item.is_dir():
                    self._merge_directory(item, destination)
                elif destination.exists():
                    continue
                else:
                    shutil.move(str(item), str(destination))
            legacy_dir.rmdir()
            self._replace_project_output_model_paths(project, legacy_dir, target_dir)

    def _merge_directory(self, source: Path, destination: Path) -> None:
        for item in source.iterdir():
            target = destination / item.name
            if target.exists() and target.is_dir() and item.is_dir():
                self._merge_directory(item, target)
            elif target.exists():
                continue
            else:
                shutil.move(str(item), str(target))
        source.rmdir()

    def _replace_project_output_model_paths(self, project: dict[str, Any], old_root: Path, new_root: Path) -> None:
        old_prefix = str(old_root)
        new_prefix = str(new_root)
        replacements = {
            "training_runs": ("output_dir", "save_dir", "best_model_path", "last_model_path"),
            "model_exports": ("source_model_path", "output_path"),
            "model_conversion_runs": ("source_model_path", "output_dir", "manifest_path"),
            "model_conversion_artifacts": ("output_path",),
            "model_export_bundles": ("output_dir",),
        }
        with transaction(self.db):
            for table, columns in replacements.items():
                for column in columns:
                    self.db.execute(
                        f"""
                        update {table}
                        set {column} = replace({column}, ?, ?)
                        where project_id = ?
                          and {column} is not null
                          and {column} like ?
                        """,
                        (old_prefix, new_prefix, project["id"], f"{old_prefix}%"),
                    )

    def migrate_project_source_copies(self) -> int:
        """Ensure project image records point at project-owned source copies.

        `data/input` and other operator-selected folders are treated as reusable raw inputs.
        Once a folder is assigned to a project, image files should be copied under
        `data/projects/<slug>/sources/<source_asset_id>/images/` so deleting the
        project removes its working copy, labels, splits, and model artifacts without
        touching the raw input library.
        """
        migrated = 0
        for project in self.list_projects():
            project_root = Path(str(project.get("root_path") or ""))
            if not project_root.exists():
                # A missing workspace means the operator manually removed the
                # project package. Keep it stale instead of recreating folders.
                continue
            self.ensure_project_workspace(project)
            for source in self.list_source_assets(project["id"]):
                source_root = project_root / "sources" / source["id"]
                target_dir = source_root / "images" if source["kind"] == "image_folder" else source_root
                target_dir.mkdir(parents=True, exist_ok=True)
                if source["kind"] != "image_folder":
                    continue
                rows = self.db.execute(
                    """
                    select id, path from images
                    where project_id = ? and source_asset_id = ?
                    """,
                    (project["id"], source["id"]),
                ).fetchall()
                source_path = Path(source["path"])
                for row in rows:
                    current_path = Path(row["path"])
                    try:
                        current_path.resolve().relative_to(project_root.resolve())
                        continue
                    except (OSError, ValueError):
                        pass
                    if current_path.suffix.lower() not in PROJECT_SOURCE_IMAGE_EXTENSIONS:
                        continue
                    copy_from = current_path if current_path.exists() else source_path / current_path.name
                    if not copy_from.exists() or not copy_from.is_file():
                        continue
                    copied_path = target_dir / current_path.name
                    if copy_from.resolve() != copied_path.resolve():
                        shutil.copy2(copy_from, copied_path)
                    with transaction(self.db):
                        self.db.execute("update images set path = ? where id = ?", (str(copied_path), row["id"]))
                    migrated += 1
        return migrated

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
        project_stub = {"root_path": str(root_path)}
        self.ensure_project_workspace(project_stub)
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
        self.ensure_project_output_model_index(project)
        return project

    def list_projects(self) -> list[dict[str, Any]]:
        rows = self.db.execute("select * from projects order by created_at desc").fetchall()
        return rows_to_dicts(rows)

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from projects where id = ?", (project_id,)).fetchone())

    def get_project_storage_status(self, project_id: str) -> dict[str, Any] | None:
        project = self.get_project(project_id)
        if not project:
            return None
        root_raw = project.get("root_path")
        root_path = Path(str(root_raw)) if root_raw else None
        output_index = self.paths.output_model_dir / str(project["slug"])
        workspace_exists = bool(root_path and root_path.exists() and root_path.is_dir())
        output_index_exists = output_index.exists() and (output_index.is_dir() or output_index.is_file())
        missing: list[str] = []
        if not workspace_exists:
            missing.append("project workspace")
        if not output_index_exists:
            missing.append("output model index")
        return {
            "workspace_exists": workspace_exists,
            "output_index_exists": output_index_exists,
            "is_stale": bool(missing),
            "missing": missing,
        }

    def cleanup_stale_project(self, project_id: str) -> bool:
        status = self.get_project_storage_status(project_id)
        if not status or not status["is_stale"]:
            return False
        return self.delete_project(project_id)

    def delete_project(self, project_id: str) -> bool:
        project = self.get_project(project_id)
        if not project:
            return False
        with transaction(self.db):
            self.db.execute("delete from jobs where project_id = ?", (project_id,))
            self.db.execute("delete from projects where id = ?", (project_id,))
        root_raw = project.get("root_path")
        root_path = Path(str(root_raw)) if root_raw else None
        for output_index in (
            self.paths.output_model_dir / str(project["slug"]),
            self.paths.output_model_dir / str(project["id"]),
        ):
            if output_index.is_symlink() or output_index.is_file():
                output_index.unlink()
            elif output_index.exists() and output_index.is_dir():
                shutil.rmtree(output_index)
        if root_path and root_path.exists() and root_path.is_dir():
            shutil.rmtree(root_path)
        return True

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
        weight_suffixes = {".pt", ".pth"}

        def weight_files(path: Path) -> list[str]:
            if not path.exists():
                return []
            return sorted(item.name for item in path.iterdir() if item.is_file() and item.suffix in weight_suffixes)

        output_suffix_order = {".pt": 0, ".pth": 1, ".onnx": 2, ".torchscript": 3, ".tflite": 4}

        def output_model_sort_key(path: Path) -> tuple[str, int, str]:
            relative = path.relative_to(self.paths.output_model_dir)
            stem_path = str(relative.with_suffix(""))
            return (stem_path, output_suffix_order.get(path.suffix, len(output_suffix_order)), str(relative))

        output_models: list[str] = []
        if self.paths.output_model_dir.exists():
            for base in sorted(self.paths.output_model_dir.iterdir(), key=lambda item: item.name):
                if base.is_symlink() and base.is_dir():
                    search_root = base.resolve()
                    prefix = Path(base.name)
                    for item in search_root.rglob("*"):
                        if item.is_file() and item.suffix in {".pt", ".pth", ".tflite", ".onnx", ".torchscript"}:
                            output_models.append(str(prefix / item.relative_to(search_root)))
                elif base.is_file() and base.suffix in {".pt", ".pth", ".tflite", ".onnx", ".torchscript"}:
                    output_models.append(base.name)
                elif base.is_dir():
                    for item in base.rglob("*"):
                        if item.is_file() and item.suffix in {".pt", ".pth", ".tflite", ".onnx", ".torchscript"}:
                            output_models.append(str(item.relative_to(self.paths.output_model_dir)))
            output_models = sorted(set(output_models), key=lambda relative_path: output_model_sort_key(self.paths.output_model_dir / relative_path))
        return {
            "world_models": weight_files(self.paths.world_model_dir),
            "input_models": weight_files(self.paths.input_model_dir),
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

    def mark_interrupted_jobs(self) -> int:
        stale_rows = self.db.execute(
            "select id from jobs where status in ('queued', 'running')"
        ).fetchall()
        stale_job_ids = [row["id"] for row in stale_rows]
        now = utc_now()
        with transaction(self.db):
            if stale_job_ids:
                placeholders = ", ".join("?" for _ in stale_job_ids)
                self.db.execute(
                    f"""
                    update jobs
                    set status = 'failed',
                        message = 'Interrupted by service restart',
                        error = 'The service restarted before this background job finished.',
                        updated_at = ?
                    where id in ({placeholders})
                    """,
                    [now, *stale_job_ids],
                )
            conversion_run_ids = [
                row["id"]
                for row in self.db.execute(
                    """
                    select m.id
                    from model_conversion_runs m
                    left join jobs j on j.id = m.job_id
                    where m.status in ('queued', 'running')
                      and (m.job_id is null or j.id is null or j.status not in ('queued', 'running'))
                    """
                ).fetchall()
            ]
            if not conversion_run_ids:
                return len(stale_job_ids)
            run_placeholders = ", ".join("?" for _ in conversion_run_ids)
            self.db.execute(
                f"""
                update model_conversion_runs
                set status = 'failed', updated_at = ?
                where id in ({run_placeholders})
                """,
                [now, *conversion_run_ids],
            )
            self.db.execute(
                f"""
                update model_conversion_artifacts
                set status = 'failed', updated_at = ?
                where conversion_run_id in ({run_placeholders}) and status in ('queued', 'running')
                """,
                [now, *conversion_run_ids],
            )
        return len(stale_job_ids)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        job = row_to_dict(self.db.execute("select * from jobs where id = ?", (job_id,)).fetchone())
        if job and job.get("result_json"):
            job["result"] = json.loads(job["result_json"])
        elif job:
            job["result"] = None
        return job

    def list_jobs(self, project_id: str | None = None) -> list[dict[str, Any]]:
        if project_id:
            rows = self.db.execute("select * from jobs where project_id = ? order by created_at desc limit 100", (project_id,)).fetchall()
        else:
            rows = self.db.execute("select * from jobs order by created_at desc limit 100").fetchall()
        jobs = []
        for row in rows:
            job = dict(row)
            job["result"] = json.loads(job["result_json"]) if job.get("result_json") else None
            jobs.append(job)
        return jobs

    def find_active_job(self, project_id: str, name: str) -> dict[str, Any] | None:
        row = self.db.execute(
            """
            select * from jobs
            where project_id = ? and name = ? and status in ('queued', 'running')
            order by created_at desc
            limit 1
            """,
            (project_id, name),
        ).fetchone()
        if row is None:
            return None
        job = dict(row)
        job["result"] = json.loads(job["result_json"]) if job.get("result_json") else None
        return job

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
        augmentation_run_id: str | None = None,
        width: int | None = None,
        height: int | None = None,
    ) -> dict[str, Any]:
        image_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into images
                (id, project_id, source_asset_id, pseudo_label_run_id, augmentation_run_id, path, width, height, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (image_id, project_id, source_asset_id, pseudo_label_run_id, augmentation_run_id, path, width, height, now),
            )
        image = self.get_image(image_id)
        assert image is not None
        return image

    def get_image(self, image_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from images where id = ?", (image_id,)).fetchone())

    def get_image_by_path(self, path: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from images where path = ?", (path,)).fetchone())

    def list_images(
        self,
        project_id: str,
        review_status: str | None = None,
        has_low_confidence: bool | None = None,
        source_asset_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
        low_confidence_threshold: float = 0.5,
    ) -> list[dict[str, Any]]:
        filters = ["project_id = ?"]
        params: list[Any] = [project_id]

        if review_status is not None:
            filters.append("review_status = ?")
            params.append(review_status)
        if source_asset_id is not None:
            filters.append("source_asset_id = ?")
            params.append(source_asset_id)
        if has_low_confidence is not None:
            clause = """
                exists (
                    select 1
                    from annotations
                    where annotations.image_id = images.id
                      and annotations.confidence is not null
                      and annotations.confidence < ?
                )
            """
            filters.append(clause if has_low_confidence else f"not {clause}")
            params.append(low_confidence_threshold)

        params.extend([limit, offset])
        where_clause = " and ".join(filters)
        return rows_to_dicts(
            self.db.execute(
                f"""
                select * from images
                where {where_clause}
                order by path asc
                limit ? offset ?
                """,
                params,
            ).fetchall()
        )

    def list_annotated_images(self, project_id: str, limit: int = 12, offset: int = 0) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                """
                select images.*
                from images
                where images.project_id = ?
                  and exists (
                    select 1
                    from annotations
                    where annotations.image_id = images.id
                  )
                order by images.path asc
                limit ? offset ?
                """,
                (project_id, limit, offset),
            ).fetchall()
        )

    def get_review_stats(
        self, project_id: str, low_confidence_threshold: float = 0.5
    ) -> dict[str, int]:
        stats = {
            "unreviewed": 0,
            "pending_review": 0,
            "needs_fix": 0,
            "reviewed": 0,
            "skipped": 0,
            "edited": 0,
            "low_confidence": 0,
        }
        status_rows = self.db.execute(
            """
            select review_status, count(*) as count
            from images
            where project_id = ?
            group by review_status
            """,
            (project_id,),
        ).fetchall()
        for row in status_rows:
            review_status = row["review_status"]
            if review_status in stats:
                stats[review_status] = int(row["count"])

        edited_row = self.db.execute(
            """
            select count(distinct images.id) as count
            from images
            join annotations on annotations.image_id = images.id
            where images.project_id = ?
              and annotations.edited = 1
            """,
            (project_id,),
        ).fetchone()
        low_confidence_row = self.db.execute(
            """
            select count(distinct images.id) as count
            from images
            join annotations on annotations.image_id = images.id
            where images.project_id = ?
              and annotations.confidence is not null
              and annotations.confidence < ?
            """,
            (project_id, low_confidence_threshold),
        ).fetchone()
        stats["edited"] = int(edited_row["count"]) if edited_row is not None else 0
        stats["low_confidence"] = int(low_confidence_row["count"]) if low_confidence_row is not None else 0
        return stats

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
        raw_detection_count: int = 0,
        merged_detection_count: int = 0,
        merge_rate: float = 0.0,
        last_image_path: str | None = None,
        job_id: str | None = None,
        run_name: str | None = None,
    ) -> dict[str, Any]:
        run_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into pseudo_label_runs
                (id, project_id, run_name, schema_id, source_asset_id, world_model, output_dir,
                 confidence, iou, image_count, labeled_count, raw_detection_count,
                 merged_detection_count, merge_rate, last_image_path, job_id, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    project_id,
                    run_name,
                    schema_id,
                    source_asset_id,
                    world_model,
                    output_dir,
                    confidence,
                    iou,
                    image_count,
                    labeled_count,
                    raw_detection_count,
                    merged_detection_count,
                    merge_rate,
                    last_image_path,
                    job_id,
                    now,
                ),
            )
        row = self.db.execute("select * from pseudo_label_runs where id = ?", (run_id,)).fetchone()
        return dict(row)

    def list_pseudo_label_runs(self, project_id: str) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                """
                select pseudo_label_runs.*, class_schemas.name as schema_name
                from pseudo_label_runs
                left join class_schemas on class_schemas.id = pseudo_label_runs.schema_id
                where pseudo_label_runs.project_id = ?
                order by pseudo_label_runs.created_at desc
                """,
                (project_id,),
            ).fetchall()
        )

    def get_pseudo_label_run(self, run_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from pseudo_label_runs where id = ?", (run_id,)).fetchone())

    def assign_pseudo_label_run_to_images(self, run_id: str, image_ids: list[str]) -> None:
        if not image_ids:
            return
        with transaction(self.db):
            self.db.executemany(
                "update images set pseudo_label_run_id = ? where id = ?",
                [(run_id, image_id) for image_id in image_ids],
            )

    def create_augmentation_run_record(
        self,
        project_id: str,
        pseudo_label_run_id: str | None,
        name: str,
        output_dir: str,
        settings_json: str,
        source_image_count: int,
        created_image_count: int,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        run_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into augmentation_runs
                (id, project_id, pseudo_label_run_id, name, output_dir, settings_json,
                 source_image_count, created_image_count, job_id, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (run_id, project_id, pseudo_label_run_id, name, output_dir, settings_json, source_image_count, created_image_count, job_id, now),
            )
        row = self.db.execute("select * from augmentation_runs where id = ?", (run_id,)).fetchone()
        return dict(row)

    def list_augmentation_runs(self, project_id: str) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                "select * from augmentation_runs where project_id = ? order by created_at desc",
                (project_id,),
            ).fetchall()
        )

    def get_augmentation_run(self, run_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from augmentation_runs where id = ?", (run_id,)).fetchone())

    def assign_augmentation_run_to_images(self, run_id: str, image_ids: list[str]) -> None:
        if not image_ids:
            return
        with transaction(self.db):
            self.db.executemany(
                "update images set augmentation_run_id = ? where id = ?",
                [(run_id, image_id) for image_id in image_ids],
            )

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
        pseudo_label_run_id: str | None = None,
        augmentation_run_id: str | None = None,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        split_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into dataset_splits
                (id, project_id, name, train_ratio, val_ratio, test_ratio, output_dir,
                 dataset_yaml_path, image_ids_json, pseudo_label_run_id, augmentation_run_id, job_id, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    pseudo_label_run_id,
                    augmentation_run_id,
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
        run_name: str | None = None,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        run_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into training_runs
                (id, project_id, dataset_split_id, input_model, output_dir, run_name, metrics_json, status, job_id, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, '[]', 'running', ?, ?, ?)
                """,
                (run_id, project_id, dataset_split_id, input_model, output_dir, run_name, job_id, now, now),
            )
        run = self.get_training_run(run_id)
        assert run is not None
        return run

    def update_training_run(self, training_run_id: str, **patch: Any) -> None:
        allowed = {"run_name", "save_dir", "best_model_path", "last_model_path", "metrics_json", "status"}
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

    def create_model_conversion_run(
        self,
        project_id: str,
        training_run_id: str | None,
        source_model_path: str,
        package_name: str,
        output_dir: str,
        schema_id: str | None,
        schema_name: str,
        schema_snapshot: list[dict[str, Any]],
        status: str = "queued",
        job_id: str | None = None,
        manifest_path: str | None = None,
    ) -> dict[str, Any]:
        conversion_id = new_id()
        now = utc_now()
        schema_snapshot_json = json.dumps(schema_snapshot)
        with transaction(self.db):
            self.db.execute(
                """
                insert into model_conversion_runs
                (id, project_id, training_run_id, source_model_path, package_name, output_dir,
                 schema_id, schema_name, schema_snapshot_json, manifest_path, status, job_id,
                 created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conversion_id,
                    project_id,
                    training_run_id,
                    source_model_path,
                    package_name,
                    output_dir,
                    schema_id,
                    schema_name,
                    schema_snapshot_json,
                    manifest_path,
                    status,
                    job_id,
                    now,
                    now,
                ),
            )
        conversion = self.get_model_conversion_run(conversion_id)
        assert conversion is not None
        return conversion

    def update_model_conversion_run(self, conversion_run_id: str, **patch: Any) -> None:
        allowed = {"manifest_path", "status"}
        updates = {key: value for key, value in patch.items() if key in allowed}
        if not updates:
            return
        updates["updated_at"] = utc_now()
        columns = ", ".join(f"{key} = ?" for key in updates)
        values = list(updates.values()) + [conversion_run_id]
        with transaction(self.db):
            self.db.execute(f"update model_conversion_runs set {columns} where id = ?", values)

    def add_model_conversion_artifact(
        self,
        conversion_id: str,
        project_id: str,
        format: str,
        precision: str,
        output_path: str | None,
        status: str = "queued",
    ) -> dict[str, Any]:
        artifact_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into model_conversion_artifacts
                (id, conversion_run_id, project_id, format, precision, output_path, status, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (artifact_id, conversion_id, project_id, format, precision, output_path, status, now, now),
            )
        artifact = row_to_dict(
            self.db.execute("select * from model_conversion_artifacts where id = ?", (artifact_id,)).fetchone()
        )
        assert artifact is not None
        return artifact

    def list_model_conversion_artifacts(self, conversion_run_id: str) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                """
                select * from model_conversion_artifacts
                where conversion_run_id = ?
                order by format asc, precision asc, created_at asc
                """,
                (conversion_run_id,),
            ).fetchall()
        )

    def _hydrate_model_conversion_run(self, row: Any) -> dict[str, Any] | None:
        conversion = row_to_dict(row)
        if not conversion:
            return None
        conversion["schema_snapshot"] = json.loads(conversion["schema_snapshot_json"])
        conversion["artifacts"] = self.list_model_conversion_artifacts(conversion["id"])
        return conversion

    def get_model_conversion_run(self, conversion_run_id: str) -> dict[str, Any] | None:
        return self._hydrate_model_conversion_run(
            self.db.execute("select * from model_conversion_runs where id = ?", (conversion_run_id,)).fetchone()
        )

    def list_model_conversion_runs(self, project_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            """
            select * from model_conversion_runs
            where project_id = ?
            order by created_at desc
            """,
            (project_id,),
        ).fetchall()
        return [conversion for row in rows if (conversion := self._hydrate_model_conversion_run(row)) is not None]

    def create_model_export_bundle(
        self,
        project_id: str,
        conversion_run_id: str,
        bundle_name: str,
        output_dir: str,
        included_artifacts_json: str,
        status: str,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        bundle_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into model_export_bundles
                (id, project_id, conversion_run_id, bundle_name, output_dir,
                 included_artifacts_json, status, job_id, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    bundle_id,
                    project_id,
                    conversion_run_id,
                    bundle_name,
                    output_dir,
                    included_artifacts_json,
                    status,
                    job_id,
                    now,
                    now,
                ),
            )
        bundle = self.get_model_export_bundle(bundle_id)
        assert bundle is not None
        return bundle

    def _hydrate_model_export_bundle(self, row: Any) -> dict[str, Any] | None:
        bundle = row_to_dict(row)
        if not bundle:
            return None
        bundle["included_artifacts"] = json.loads(bundle["included_artifacts_json"])
        return bundle

    def get_model_export_bundle(self, bundle_id: str) -> dict[str, Any] | None:
        return self._hydrate_model_export_bundle(
            self.db.execute("select * from model_export_bundles where id = ?", (bundle_id,)).fetchone()
        )

    def list_model_export_bundles(self, project_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            """
            select * from model_export_bundles
            where project_id = ?
            order by created_at desc
            """,
            (project_id,),
        ).fetchall()
        return [bundle for row in rows if (bundle := self._hydrate_model_export_bundle(row)) is not None]
