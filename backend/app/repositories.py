from __future__ import annotations

import json
import re
import shutil
from collections.abc import Sequence
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
    "opendata",
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
    def __init__(
        self,
        db: Any,
        paths: AppPaths,
        *,
        process_started_at: str | None = None,
    ) -> None:
        self.db = db
        self.paths = paths
        self.process_started_at = process_started_at or utc_now()

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

    def get_active_open_data_import(self, project_id: str) -> dict[str, Any] | None:
        row = self.db.execute(
            "select * from open_data_imports where project_id = ? and status = 'active' order by created_at desc limit 1",
            (project_id,),
        ).fetchone()
        result = row_to_dict(row)
        if result:
            result["mapping"] = json.loads(result["mapping_json"])
        return result

    def list_open_data_imports(self, project_id: str) -> list[dict[str, Any]]:
        results = rows_to_dicts(self.db.execute(
            "select * from open_data_imports where project_id = ? order by created_at desc",
            (project_id,),
        ).fetchall())
        for result in results:
            result["mapping"] = json.loads(result["mapping_json"])
        return results

    def replace_active_open_data_import(
        self,
        *,
        import_id: str,
        project_id: str,
        dataset_key: str,
        version_name: str,
        schema_id: str,
        mapping: dict[str, int | None],
        sample_percentage: int,
        random_seed: int,
        project_dir: str,
        summary: dict[str, Any],
        images: list[dict[str, Any]],
        job_id: str,
    ) -> tuple[dict[str, Any], str | None]:
        now = utc_now()
        previous = self.get_active_open_data_import(project_id)
        with transaction(self.db):
            if previous:
                self.db.execute(
                    "update open_data_imports set status = 'saved', updated_at = ? where id = ?",
                    (now, previous["id"]),
                )
            self.db.execute(
                """
                insert into open_data_imports
                (id, project_id, dataset_key, version_name, schema_id, mapping_json, sample_percentage,
                 random_seed, project_dir, source_image_count, eligible_image_count,
                 selected_image_count, selected_annotation_count, status, job_id, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
                """,
                (
                    import_id, project_id, dataset_key, version_name, schema_id,
                    json.dumps(mapping, sort_keys=True), sample_percentage, random_seed,
                    project_dir, summary["source_image_count"], summary["eligible_image_count"],
                    summary["selected_image_count"], summary["selected_annotation_count"],
                    job_id, now, now,
                ),
            )
            for item in images:
                image_id = new_id()
                self.db.execute(
                    """
                    insert into images
                    (id, project_id, open_data_import_id, source_origin, source_split, source_key,
                     path, width, height, review_status, created_at)
                    values (?, ?, ?, 'open_data', ?, ?, ?, ?, ?, 'pending_review', ?)
                    """,
                    (image_id, project_id, import_id, item["split"], item["source_key"],
                     item["path"], item["width"], item["height"], now),
                )
                for annotation in item["annotations"]:
                    self.db.execute(
                        """
                        insert into annotations
                        (id, image_id, class_id, class_name, x_center, y_center, width, height,
                         confidence, source_descriptor, source_type, edited, created_at, updated_at)
                        values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, 'open_data', 0, ?, ?)
                        """,
                        (new_id(), image_id, annotation["class_id"], annotation["class_name"],
                         annotation["x_center"], annotation["y_center"], annotation["width"], annotation["height"],
                         annotation.get("source_descriptor"), now, now),
                    )
        result = self.get_active_open_data_import(project_id)
        assert result is not None
        return result, None

    def remove_active_open_data_import(self, project_id: str) -> dict[str, Any] | None:
        current = self.get_active_open_data_import(project_id)
        if not current:
            return None
        with transaction(self.db):
            self.db.execute(
                "update dataset_splits set outdated = 1, outdated_reason = ? where project_id = ? and open_data_import_id = ?",
                (json.dumps({"code": "open_data_removed"}), project_id, current["id"]),
            )
            self.db.execute("delete from open_data_imports where id = ?", (current["id"],))
        return current

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

    def mark_job_related_cancelled(self, job_id: str) -> None:
        """Keep durable run records aligned with a cooperatively cancelled job."""
        now = utc_now()
        with transaction(self.db):
            for table in ("training_runs", "model_conversion_runs", "model_exports", "model_export_bundles"):
                self.db.execute(
                    f"update {table} set status = 'cancelled', updated_at = ? "
                    "where job_id = ? and status not in ('completed', 'failed', 'cancelled')",
                    (now, job_id),
                )
            self.db.execute(
                """
                update model_conversion_artifacts
                set status = 'cancelled', updated_at = ?
                where conversion_run_id in (select id from model_conversion_runs where job_id = ?)
                  and status not in ('completed', 'failed', 'cancelled')
                """,
                (now, job_id),
            )

    def mark_interrupted_jobs(self) -> int:
        stale_rows = self.db.execute(
            "select id from jobs where status in ('queued', 'running', 'cancel_requested')"
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
            where project_id = ? and name = ? and status in ('queued', 'running', 'cancel_requested')
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
        open_data_import_id: str | None = None,
        source_origin: str = "project",
        source_split: str | None = None,
        source_key: str | None = None,
        width: int | None = None,
        height: int | None = None,
    ) -> dict[str, Any]:
        image_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into images
                (id, project_id, source_asset_id, pseudo_label_run_id, augmentation_run_id,
                 open_data_import_id, source_origin, source_split, source_key, path, width, height, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (image_id, project_id, source_asset_id, pseudo_label_run_id, augmentation_run_id,
                 open_data_import_id, source_origin, source_split, source_key, path, width, height, now),
            )
        image = self.get_image(image_id)
        assert image is not None
        return image

    def get_image(self, image_id: str, *, include_removed: bool = False) -> dict[str, Any] | None:
        removed_clause = "" if include_removed else " and removed_at is null"
        return row_to_dict(
            self.db.execute(
                f"select * from images where id = ?{removed_clause}",
                (image_id,),
            ).fetchone()
        )

    def get_image_by_path(self, path: str, *, include_removed: bool = False) -> dict[str, Any] | None:
        removed_clause = "" if include_removed else " and removed_at is null"
        return row_to_dict(
            self.db.execute(
                f"select * from images where path = ?{removed_clause}",
                (path,),
            ).fetchone()
        )

    def get_image_removal_operation(self, operation_id: str) -> dict[str, Any] | None:
        return row_to_dict(
            self.db.execute(
                "select * from image_removal_operations where id = ?",
                (operation_id,),
            ).fetchone()
        )

    def list_unresolved_image_removal_operations_before(
        self,
        cutoff: str,
    ) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                """
                select * from image_removal_operations
                where restored_at is null and removed_at < ?
                order by removed_at, id
                """,
                (cutoff,),
            ).fetchall()
        )

    def clear_image_removal_trash_paths(
        self,
        operation_id: str,
        *,
        image: bool,
        label: bool,
    ) -> dict[str, Any]:
        assignments = []
        if image:
            assignments.append("trash_image_path = null")
        if label:
            assignments.append("trash_label_path = null")
        if assignments:
            with transaction(self.db):
                cursor = self.db.execute(
                    f"update image_removal_operations set {', '.join(assignments)} where id = ?",
                    (operation_id,),
                )
                if cursor.rowcount != 1:
                    raise FileNotFoundError(
                        f"Image removal operation not found: {operation_id}"
                    )
        operation = self.get_image_removal_operation(operation_id)
        if operation is None:
            raise FileNotFoundError(f"Image removal operation not found: {operation_id}")
        return operation

    def create_image_removal_operation(
        self,
        project_id: str,
        image_id: str,
        original_image_path: str,
        trash_image_path: str | None,
        original_label_path: str | None,
        trash_label_path: str | None,
        *,
        operation_id: str | None = None,
    ) -> dict[str, Any]:
        operation_id = operation_id or new_id()
        removed_at = utc_now()
        with transaction(self.db):
            image = self.db.execute(
                "select id from images where id = ? and project_id = ? and removed_at is null",
                (image_id, project_id),
            ).fetchone()
            if image is None:
                raise FileNotFoundError(f"Active image not found: {image_id}")
            self.db.execute(
                """
                insert into image_removal_operations
                (id, project_id, image_id, original_image_path, trash_image_path,
                 original_label_path, trash_label_path, removed_at, restored_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, null)
                """,
                (
                    operation_id,
                    project_id,
                    image_id,
                    original_image_path,
                    trash_image_path,
                    original_label_path,
                    trash_label_path,
                    removed_at,
                ),
            )
            self._mark_image_removed(image_id, operation_id, removed_at)
            self._recompute_lineage_staleness(project_id)
            operation = self.get_image_removal_operation(operation_id)
            if operation is None:
                raise RuntimeError(
                    f"Failed to read image removal operation before commit: {operation_id}"
                )
        return operation

    def mark_image_removed(
        self,
        image_id: str,
        removal_operation_id: str,
    ) -> dict[str, Any]:
        with transaction(self.db):
            operation = self.db.execute(
                """
                select * from image_removal_operations
                where id = ? and image_id = ? and restored_at is null
                """,
                (removal_operation_id, image_id),
            ).fetchone()
            if operation is None:
                raise FileNotFoundError(
                    f"Active image removal operation not found: {removal_operation_id}"
                )
            self._mark_image_removed(image_id, removal_operation_id, operation["removed_at"])
            self._recompute_lineage_staleness(operation["project_id"])
        image = self.get_image(image_id, include_removed=True)
        assert image is not None
        return image

    def _mark_image_removed(
        self,
        image_id: str,
        removal_operation_id: str,
        removed_at: str,
    ) -> None:
        image = self.db.execute(
            "select removed_at, removal_operation_id from images where id = ?",
            (image_id,),
        ).fetchone()
        if image is None:
            raise FileNotFoundError(f"Image not found: {image_id}")
        if image["removed_at"] is not None:
            if image["removal_operation_id"] == removal_operation_id:
                return
            raise ValueError(f"Image already removed by a different operation: {image_id}")
        cursor = self.db.execute(
            """
            update images
            set removed_at = ?, removal_operation_id = ?
            where id = ? and removed_at is null
            """,
            (removed_at, removal_operation_id, image_id),
        )
        if cursor.rowcount != 1:
            raise FileNotFoundError(f"Active image not found: {image_id}")

    def restore_image_removal_operation(self, operation_id: str) -> dict[str, Any]:
        with transaction(self.db):
            operation = self.db.execute(
                "select * from image_removal_operations where id = ?",
                (operation_id,),
            ).fetchone()
            if operation is None:
                raise FileNotFoundError(f"Image removal operation not found: {operation_id}")
            if operation["restored_at"] is None:
                image = self.db.execute(
                    "select removed_at, removal_operation_id from images where id = ?",
                    (operation["image_id"],),
                ).fetchone()
                if (
                    image is None
                    or image["removed_at"] is None
                    or image["removal_operation_id"] != operation_id
                ):
                    raise ValueError(
                        f"Image removal operation does not own removed image: {operation_id}"
                    )
                restored_at = utc_now()
                cursor = self.db.execute(
                    """
                    update images
                    set removed_at = null, removal_operation_id = null
                    where id = ? and removal_operation_id = ?
                    """,
                    (operation["image_id"], operation_id),
                )
                if cursor.rowcount != 1:
                    raise RuntimeError(f"Failed to restore removed image: {operation['image_id']}")
                self.db.execute(
                    "update image_removal_operations set restored_at = ? where id = ?",
                    (restored_at, operation_id),
                )
                self._recompute_lineage_staleness(operation["project_id"])
            restored = self.get_image_removal_operation(operation_id)
            if restored is None:
                raise RuntimeError(
                    f"Failed to read restored image removal operation before commit: {operation_id}"
                )
        return restored

    def recompute_lineage_staleness(self, project_id: str) -> None:
        with transaction(self.db):
            self._recompute_lineage_staleness(project_id)

    def _recompute_lineage_staleness(self, project_id: str) -> None:
        removed_ids = sorted(
            row["id"]
            for row in self.db.execute(
                "select id from images where project_id = ? and removed_at is not null",
                (project_id,),
            ).fetchall()
        )
        removed_id_set = set(removed_ids)

        augmentation_rows = self.db.execute(
            "select id, source_image_ids_json from augmentation_runs where project_id = ?",
            (project_id,),
        ).fetchall()
        augmentation_affected_ids: dict[str, list[str]] = {}
        for row in augmentation_rows:
            source_ids = self._json_image_ids(row["source_image_ids_json"])
            affected_ids = (
                removed_ids
                if source_ids is None
                else sorted(removed_id_set.intersection(source_ids))
            )
            augmentation_affected_ids[row["id"]] = affected_ids
            self._set_lineage_staleness("augmentation_runs", row["id"], affected_ids)

        image_augmentation_ids = {
            row["id"]: row["augmentation_run_id"]
            for row in self.db.execute(
                "select id, augmentation_run_id from images where project_id = ? and augmentation_run_id is not null",
                (project_id,),
            ).fetchall()
        }
        split_rows = self.db.execute(
            "select id, image_ids_json, augmentation_run_id from dataset_splits where project_id = ?",
            (project_id,),
        ).fetchall()
        for row in split_rows:
            split_ids = self._json_image_ids(row["image_ids_json"]) or set()
            upstream_augmentation_ids = {
                augmentation_id
                for image_id in split_ids
                if (augmentation_id := image_augmentation_ids.get(image_id))
            }
            if row["augmentation_run_id"]:
                upstream_augmentation_ids.add(row["augmentation_run_id"])
            affected_ids = sorted(
                removed_id_set.intersection(split_ids).union(
                    image_id
                    for augmentation_id in upstream_augmentation_ids
                    for image_id in augmentation_affected_ids.get(augmentation_id, [])
                )
            )
            self._set_lineage_staleness("dataset_splits", row["id"], affected_ids)

    @staticmethod
    def _json_image_ids(raw_value: str | None) -> set[str] | None:
        if raw_value is None:
            return None
        try:
            value = json.loads(raw_value)
        except (json.JSONDecodeError, TypeError):
            return None
        if isinstance(value, list):
            return {str(image_id) for image_id in value}
        if isinstance(value, dict):
            return {
                str(image_id)
                for bucket in value.values()
                if isinstance(bucket, list)
                for image_id in bucket
            }
        return set()

    def _set_lineage_staleness(
        self,
        table: str,
        record_id: str,
        affected_ids: list[str],
    ) -> None:
        reason = None
        if affected_ids:
            reason = json.dumps(
                {"code": "project_image_removed", "image_ids": affected_ids},
                sort_keys=True,
                separators=(",", ":"),
            )
        elif table == "dataset_splits":
            current = self.db.execute("select outdated, outdated_reason from dataset_splits where id = ?", (record_id,)).fetchone()
            if current and current["outdated"] and current["outdated_reason"]:
                try:
                    current_code = json.loads(current["outdated_reason"]).get("code")
                except (json.JSONDecodeError, AttributeError):
                    current_code = None
                if current_code not in {None, "project_image_removed"}:
                    return
        self.db.execute(
            f"update {table} set outdated = ?, outdated_reason = ? where id = ?",
            (int(bool(affected_ids)), reason, record_id),
        )

    def _active_image_filter_clause(
        self,
        project_id: str,
        review_status: str | None = None,
        has_low_confidence: bool | None = None,
        source_asset_id: str | None = None,
        source_origin: str | None = None,
        source_groups: list[str] | None = None,
        low_confidence_threshold: float = 0.5,
    ) -> tuple[str, list[Any]]:
        filters = [
            "images.project_id = ?",
            "images.removed_at is null",
            "(images.source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))",
        ]
        params: list[Any] = [project_id]

        if review_status is not None:
            filters.append("images.review_status = ?")
            params.append(review_status)
        if source_asset_id is not None:
            filters.append("images.source_asset_id = ?")
            params.append(source_asset_id)
        if source_origin is not None:
            filters.append("images.source_origin = ?")
            params.append(source_origin)
        if source_groups is not None:
            clauses = []
            if "pseudo" in source_groups:
                clauses.append("(images.source_origin = 'project' and images.augmentation_run_id is null and images.pseudo_label_run_id is not null)")
            if "augment" in source_groups:
                clauses.append("(images.source_origin = 'project' and images.augmentation_run_id is not null)")
            if "open_data" in source_groups:
                clauses.append("images.source_origin = 'open_data'")
            filters.append(f"({' or '.join(clauses)})" if clauses else "0")
        if has_low_confidence is not None:
            low_confidence_clause = """
                exists (
                    select 1
                    from annotations
                    where annotations.image_id = images.id
                      and annotations.confidence is not null
                      and annotations.confidence < ?
                )
            """
            filters.append(
                low_confidence_clause if has_low_confidence else f"not {low_confidence_clause}"
            )
            params.append(low_confidence_threshold)

        return " and ".join(filters), params

    def list_images(
        self,
        project_id: str,
        review_status: str | None = None,
        has_low_confidence: bool | None = None,
        source_asset_id: str | None = None,
        source_origin: str | None = None,
        source_groups: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
        low_confidence_threshold: float = 0.5,
    ) -> list[dict[str, Any]]:
        where_clause, params = self._active_image_filter_clause(
            project_id,
            review_status=review_status,
            has_low_confidence=has_low_confidence,
            source_asset_id=source_asset_id,
            source_origin=source_origin,
            source_groups=source_groups,
            low_confidence_threshold=low_confidence_threshold,
        )
        params.extend([limit, offset])
        return rows_to_dicts(
            self.db.execute(
                f"""
                select images.*,
                    (select avg(a.confidence) from annotations a where a.image_id = images.id) as mean_confidence,
                    (select count(*) from annotations a where a.image_id = images.id) as annotation_count,
                    (select min(a.confidence) from annotations a where a.image_id = images.id and a.confidence is not null) as min_confidence,
                    (select max(a.confidence) from annotations a where a.image_id = images.id and a.confidence is not null) as max_confidence,
                    (select count(*) from annotations a where a.image_id = images.id and a.confidence < 0.5) as low_confidence_count
                from images
                where {where_clause}
                order by images.path asc, images.id asc
                limit ? offset ?
                """,
                params,
            ).fetchall()
        )

    def get_review_source_counts(self, project_id: str) -> dict[str, int]:
        row = self.db.execute("""
            select
              sum(case when source_origin = 'project' and augmentation_run_id is null and pseudo_label_run_id is not null then 1 else 0 end) pseudo,
              sum(case when source_origin = 'project' and augmentation_run_id is not null then 1 else 0 end) augment,
              sum(case when source_origin = 'open_data' then 1 else 0 end) open_data
            from images where project_id = ? and removed_at is null
              and (source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))
        """, (project_id,)).fetchone()
        return {key: int(row[key] or 0) for key in ("pseudo", "augment", "open_data")}

    def get_bbox_histogram(self, project_id: str, source_groups: list[str] | None = None) -> list[dict[str, Any]]:
        where, params = self._active_image_filter_clause(project_id, source_groups=source_groups)
        rows = self.db.execute(f"""
            select annotations.class_id, annotations.class_name,
              annotations.width * annotations.height * 100 area_percent
            from annotations join images on images.id = annotations.image_id
            where {where}
            order by annotations.class_id, area_percent
        """, params).fetchall()
        grouped: dict[tuple[int, str], list[float]] = {}
        for row in rows:
            key = (int(row["class_id"]), str(row["class_name"]))
            grouped.setdefault(key, []).append(max(0.0, min(100.0, float(row["area_percent"]))))

        base_boundaries = [0.0, 1.0, 5.0, 10.0, 25.0, 50.0, 100.0]
        result: list[dict[str, Any]] = []
        for key, areas in grouped.items():
            bins: list[dict[str, float | int]] = []
            overload_threshold = max(5, len(areas) * 0.35)

            def append_bins(values: list[float], lower: float, upper: float, depth: int = 0) -> None:
                if len(values) >= overload_threshold and upper - lower > 0.04 and depth < 3:
                    step = (upper - lower) / 5
                    boundaries = [round(lower + step * index, 6) for index in range(6)]
                    for child_lower, child_upper in zip(boundaries, boundaries[1:]):
                        child_values = [
                            area for area in values
                            if child_lower <= area < child_upper or (child_upper == 100 and area == 100)
                        ]
                        append_bins(child_values, child_lower, child_upper, depth + 1)
                    return
                bins.append({"lower": lower, "upper": upper, "count": len(values)})

            for lower, upper in zip(base_boundaries, base_boundaries[1:]):
                values = [area for area in areas if lower <= area < upper or (upper == 100 and area == 100)]
                append_bins(values, lower, upper)
            result.append({"class_id": key[0], "class_name": key[1], "bins": bins})
        return result

    def get_image_source_summary(self, project_id: str) -> dict[str, Any]:
        origin_rows = self.db.execute(
            """
            select source_origin, count(*) as image_count
            from images
            where project_id = ? and removed_at is null
              and (source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))
            group by source_origin
            """,
            (project_id,),
        ).fetchall()
        class_rows = self.db.execute(
            """
            select images.source_origin, annotations.class_name, count(*) as annotation_count
            from images
            join annotations on annotations.image_id = images.id
            where images.project_id = ? and images.removed_at is null
              and (images.source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))
            group by images.source_origin, annotations.class_name
            order by images.source_origin, annotations.class_name
            """,
            (project_id,),
        ).fetchall()
        images = {str(row["source_origin"]): int(row["image_count"]) for row in origin_rows}
        classes: dict[str, dict[str, int]] = {}
        for row in class_rows:
            classes.setdefault(str(row["source_origin"]), {})[str(row["class_name"])] = int(row["annotation_count"])
        return {"images": images, "classes": classes}

    def get_image_position(
        self,
        project_id: str,
        image_id: str,
        review_status: str | None = None,
        has_low_confidence: bool | None = None,
        source_asset_id: str | None = None,
        source_origin: str | None = None,
        source_groups: list[str] | None = None,
        low_confidence_threshold: float = 0.5,
    ) -> dict[str, int] | None:
        active_image = self.db.execute(
            """select id, path from images where id = ? and project_id = ? and removed_at is null
               and (source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))""",
            (image_id, project_id),
        ).fetchone()
        if active_image is None:
            return None

        filtered_where, filtered_params = self._active_image_filter_clause(
            project_id,
            review_status=review_status,
            has_low_confidence=has_low_confidence,
            source_asset_id=source_asset_id,
            source_origin=source_origin,
            source_groups=source_groups,
            low_confidence_threshold=low_confidence_threshold,
        )
        rank_params = [active_image["path"], active_image["path"], active_image["id"]]
        filtered_row = self.db.execute(
            f"""
            select
                coalesce(sum(case when images.path < ? or (images.path = ? and images.id <= ?) then 1 else 0 end), 0) as image_index,
                count(*) as image_total
            from images
            where {filtered_where}
            """,
            [*rank_params, *filtered_params],
        ).fetchone()
        project_row = self.db.execute(
            """
            select
                coalesce(sum(case when images.path < ? or (images.path = ? and images.id <= ?) then 1 else 0 end), 0) as image_index,
                count(*) as image_total
            from images
            where images.project_id = ?
              and images.removed_at is null
              and (images.source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))
            """,
            [*rank_params, project_id],
        ).fetchone()
        assert filtered_row is not None
        assert project_row is not None
        return {
            "filtered_index": int(filtered_row["image_index"]),
            "filtered_total": int(filtered_row["image_total"]),
            "project_index": int(project_row["image_index"]),
            "project_total": int(project_row["image_total"]),
        }

    def list_annotated_images(self, project_id: str, limit: int = 12, offset: int = 0) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                """
                select images.*
                from images
                where images.project_id = ?
                  and images.removed_at is null
                  and (images.source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))
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
              and removed_at is null
              and (source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))
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
              and images.removed_at is null
              and (images.source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))
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
              and images.removed_at is null
              and (images.source_origin != 'open_data' or exists (select 1 from open_data_imports odi where odi.id = images.open_data_import_id and odi.status = 'active'))
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
        existing = self.list_annotations(image_id)
        compare_keys = ("class_id", "class_name", "x_center", "y_center", "width", "height")
        annotations_changed = [tuple(item.get(key) for key in compare_keys) for item in existing] != [
            tuple(item.get(key) for key in compare_keys) for item in annotations
        ]
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
            if annotations_changed:
                self.db.execute(
                    "update dataset_splits set outdated = 1, outdated_reason = ? where project_id = ? and is_current = 1",
                    (json.dumps({"code": "annotations_changed", "image_id": image_id}), image["project_id"]),
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
        *,
        source_image_ids: Sequence[str],
    ) -> dict[str, Any]:
        run_id = new_id()
        now = utc_now()
        source_image_ids_json = self._serialize_source_image_ids(source_image_ids)
        with transaction(self.db):
            self.db.execute(
                """
                insert into augmentation_runs
                (id, project_id, pseudo_label_run_id, name, output_dir, settings_json,
                 source_image_count, created_image_count, job_id, created_at,
                 source_image_ids_json)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    project_id,
                    pseudo_label_run_id,
                    name,
                    output_dir,
                    settings_json,
                    source_image_count,
                    created_image_count,
                    job_id,
                    now,
                    source_image_ids_json,
                ),
            )
        row = self.db.execute("select * from augmentation_runs where id = ?", (run_id,)).fetchone()
        result = self._hydrate_lineage_record(row)
        assert result is not None
        return result

    @staticmethod
    def _serialize_source_image_ids(source_image_ids: Sequence[str]) -> str:
        if isinstance(source_image_ids, (str, bytes)) or not isinstance(
            source_image_ids, Sequence
        ):
            raise TypeError("source_image_ids must be a sequence of strings")
        if any(not isinstance(image_id, str) for image_id in source_image_ids):
            raise TypeError("source_image_ids must be a sequence of strings")
        return json.dumps(sorted(set(source_image_ids)))

    def list_augmentation_runs(self, project_id: str) -> list[dict[str, Any]]:
        return [
            self._hydrate_lineage_record(row)
            for row in self.db.execute(
                "select * from augmentation_runs where project_id = ? order by created_at desc",
                (project_id,),
            ).fetchall()
        ]

    def get_augmentation_run(self, run_id: str) -> dict[str, Any] | None:
        return self._hydrate_lineage_record(
            self.db.execute("select * from augmentation_runs where id = ?", (run_id,)).fetchone()
        )

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
        open_data_import_id: str | None = None,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        with transaction(self.db):
            return self.create_dataset_split_record_in_transaction(
                project_id=project_id,
                name=name,
                train_ratio=train_ratio,
                val_ratio=val_ratio,
                test_ratio=test_ratio,
                output_dir=output_dir,
                dataset_yaml_path=dataset_yaml_path,
                image_ids_json=image_ids_json,
                pseudo_label_run_id=pseudo_label_run_id,
                augmentation_run_id=augmentation_run_id,
                open_data_import_id=open_data_import_id,
                job_id=job_id,
            )

    def create_dataset_split_record_in_transaction(
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
        open_data_import_id: str | None = None,
    ) -> dict[str, Any]:
        split_id = new_id()
        now = utc_now()
        self.db.execute(
            """
            update dataset_splits set is_current = 0 where project_id = ?;
            """,
            (project_id,),
        )
        self.db.execute(
            """
            insert into dataset_splits
            (id, project_id, name, train_ratio, val_ratio, test_ratio, output_dir,
             dataset_yaml_path, image_ids_json, pseudo_label_run_id, augmentation_run_id,
             open_data_import_id, is_current, job_id, created_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
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
                open_data_import_id,
                job_id,
                now,
            ),
        )
        row = self.db.execute("select * from dataset_splits where id = ?", (split_id,)).fetchone()
        result = self._hydrate_lineage_record(row)
        assert result is not None
        return result

    def get_dataset_split(self, split_id: str) -> dict[str, Any] | None:
        return self._hydrate_lineage_record(
            self.db.execute("select * from dataset_splits where id = ?", (split_id,)).fetchone()
        )

    def get_current_dataset_split(self, project_id: str) -> dict[str, Any] | None:
        return self._hydrate_lineage_record(self.db.execute(
            "select * from dataset_splits where project_id = ? and is_current = 1 order by created_at desc limit 1",
            (project_id,),
        ).fetchone())

    def list_dataset_splits(self, project_id: str) -> list[dict[str, Any]]:
        return [
            self._hydrate_lineage_record(row)
            for row in self.db.execute(
                "select * from dataset_splits where project_id = ? order by created_at desc",
                (project_id,),
            ).fetchall()
        ]

    @staticmethod
    def _hydrate_lineage_record(row: Any) -> dict[str, Any] | None:
        if row is None:
            return None
        result = dict(row)
        result["outdated"] = bool(result["outdated"])
        result["is_current"] = bool(result.get("is_current", 1))
        return result

    def create_training_run_record(
        self,
        project_id: str,
        dataset_split_id: str,
        input_model: str,
        output_dir: str,
        rect: bool = True,
        amp: bool = True,
        run_name: str | None = None,
        job_id: str | None = None,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        run_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into training_runs
                (id, project_id, dataset_split_id, input_model, output_dir, rect, amp, run_name, settings_json, metrics_json, status, job_id, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'running', ?, ?, ?)
                """,
                (run_id, project_id, dataset_split_id, input_model, output_dir, int(rect), int(amp), run_name, json.dumps(settings or {}, sort_keys=True), job_id, now, now),
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
        run = row_to_dict(
            self.db.execute("select * from training_runs where id = ?", (training_run_id,)).fetchone()
        )
        if run is not None and "rect" in run:
            run["rect"] = bool(run["rect"])
        if run is not None and "amp" in run:
            run["amp"] = bool(run["amp"])
        if run is not None:
            run["settings"] = json.loads(run.get("settings_json") or "{}")
        return run

    def list_training_runs(self, project_id: str) -> list[dict[str, Any]]:
        runs = rows_to_dicts(
            self.db.execute(
                "select * from training_runs where project_id = ? order by created_at desc",
                (project_id,),
            ).fetchall()
        )
        for run in runs:
            if "rect" in run:
                run["rect"] = bool(run["rect"])
            if "amp" in run:
                run["amp"] = bool(run["amp"])
            run["settings"] = json.loads(run.get("settings_json") or "{}")
        return runs

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
        layout: str = "NCHW",
    ) -> dict[str, Any]:
        artifact_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into model_conversion_artifacts
                (id, conversion_run_id, project_id, format, precision, layout, output_path, status, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (artifact_id, conversion_id, project_id, format, precision, layout, output_path, status, now, now),
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

    def build_history_deletion_plan(
        self, project_id: str, artifact_type: str, artifact_id: str
    ) -> dict[str, Any]:
        """Resolve one history deletion and every downstream dependent record."""
        table_by_type = {
            "open_data": "open_data_imports",
            "pseudo": "pseudo_label_runs",
            "augmentation": "augmentation_runs",
            "split": "dataset_splits",
            "training": "training_runs",
            "conversion": "model_conversion_runs",
            "export": "model_export_bundles",
        }
        table = table_by_type.get(artifact_type)
        if table is None:
            raise ValueError(f"Unsupported history artifact type: {artifact_type}")
        target = self.db.execute(
            f"select * from {table} where id = ? and project_id = ?",
            (artifact_id, project_id),
        ).fetchone()
        if target is None:
            raise FileNotFoundError(f"{artifact_type.title()} history not found: {artifact_id}")

        ids: dict[str, set[str]] = {key: set() for key in table_by_type}
        ids[artifact_type].add(artifact_id)

        def select_ids(sql: str, values: Sequence[Any]) -> set[str]:
            return {str(row["id"]) for row in self.db.execute(sql, values).fetchall()}

        if ids["pseudo"]:
            pseudo_marks = ", ".join("?" for _ in ids["pseudo"])
            ids["augmentation"].update(select_ids(
                f"select id from augmentation_runs where project_id = ? and pseudo_label_run_id in ({pseudo_marks})",
                [project_id, *ids["pseudo"]],
            ))
        if ids["open_data"] or ids["pseudo"] or ids["augmentation"]:
            clauses: list[str] = []
            values: list[Any] = [project_id]
            if ids["open_data"]:
                clauses.append(f"open_data_import_id in ({', '.join('?' for _ in ids['open_data'])})")
                values.extend(ids["open_data"])
            if ids["pseudo"]:
                clauses.append(f"pseudo_label_run_id in ({', '.join('?' for _ in ids['pseudo'])})")
                values.extend(ids["pseudo"])
            if ids["augmentation"]:
                clauses.append(f"augmentation_run_id in ({', '.join('?' for _ in ids['augmentation'])})")
                values.extend(ids["augmentation"])
            ids["split"].update(select_ids(
                f"select id from dataset_splits where project_id = ? and ({' or '.join(clauses)})",
                values,
            ))
        if ids["split"]:
            marks = ", ".join("?" for _ in ids["split"])
            ids["training"].update(select_ids(
                f"select id from training_runs where project_id = ? and dataset_split_id in ({marks})",
                [project_id, *ids["split"]],
            ))
        if ids["training"]:
            marks = ", ".join("?" for _ in ids["training"])
            ids["conversion"].update(select_ids(
                f"select id from model_conversion_runs where project_id = ? and training_run_id in ({marks})",
                [project_id, *ids["training"]],
            ))
        if ids["conversion"]:
            marks = ", ".join("?" for _ in ids["conversion"])
            ids["export"].update(select_ids(
                f"select id from model_export_bundles where project_id = ? and conversion_run_id in ({marks})",
                [project_id, *ids["conversion"]],
            ))

        all_ids = sorted({item for values in ids.values() for item in values})
        job_ids: set[str] = set()
        for kind, values in ids.items():
            if not values:
                continue
            source_table = table_by_type[kind]
            marks = ", ".join("?" for _ in values)
            job_ids.update(
                str(row["job_id"])
                for row in self.db.execute(
                    f"select job_id from {source_table} where id in ({marks}) and job_id is not null",
                    list(values),
                ).fetchall()
            )
        if all_ids:
            related_marks = ", ".join("?" for _ in all_ids)
            job_clause = ""
            query_values: list[Any] = [project_id, *all_ids]
            if job_ids:
                job_clause = f" or id in ({', '.join('?' for _ in job_ids)})"
                query_values.extend(job_ids)
            active = self.db.execute(
                f"select id from jobs where project_id = ? and (related_id in ({related_marks}){job_clause}) "
                "and status in ('queued', 'running', 'cancel_requested') limit 1",
                query_values,
            ).fetchone()
            if active is not None:
                raise ValueError("History cannot be deleted while a related job is still running")

        paths: set[str] = set()
        path_columns = {
            "pseudo": ("pseudo_label_runs", ("output_dir",)),
            "augmentation": ("augmentation_runs", ("output_dir",)),
            "split": ("dataset_splits", ("output_dir",)),
            # output_dir is the shared output_model/runs parent. Only the
            # Ultralytics save_dir belongs to one completed training run.
            "training": ("training_runs", ("save_dir",)),
            "conversion": ("model_conversion_runs", ("output_dir",)),
            "export": ("model_export_bundles", ("output_dir",)),
        }
        for kind, values in ids.items():
            if not values or kind not in path_columns:
                continue
            source_table, columns = path_columns[kind]
            marks = ", ".join("?" for _ in values)
            rows = self.db.execute(
                f"select id, {', '.join(columns)} from {source_table} where id in ({marks})",
                list(values),
            ).fetchall()
            for row in rows:
                for column in columns:
                    raw_path = row[column]
                    if not raw_path:
                        continue
                    still_referenced = self.db.execute(
                        f"select 1 from {source_table} where project_id = ? and id not in ({marks}) "
                        f"and {column} = ? limit 1",
                        [project_id, *values, raw_path],
                    ).fetchone()
                    if still_referenced is None:
                        paths.add(str(raw_path))

        return {
            "artifact_type": artifact_type,
            "artifact_id": artifact_id,
            "ids": {kind: sorted(values) for kind, values in ids.items()},
            "job_ids": sorted(job_ids),
            "paths": sorted(paths),
        }

    def delete_history_records(self, project_id: str, plan: dict[str, Any]) -> dict[str, int]:
        ids = {kind: list(values) for kind, values in plan["ids"].items()}

        def delete_ids(table: str, values: list[str]) -> None:
            if not values:
                return
            marks = ", ".join("?" for _ in values)
            self.db.execute(
                f"delete from {table} where project_id = ? and id in ({marks})",
                [project_id, *values],
            )

        related_ids = sorted({item for values in ids.values() for item in values})
        with transaction(self.db):
            delete_ids("model_export_bundles", ids["export"])
            delete_ids("model_conversion_runs", ids["conversion"])
            if ids["training"]:
                marks = ", ".join("?" for _ in ids["training"])
                self.db.execute(
                    f"delete from model_exports where project_id = ? and training_run_id in ({marks})",
                    [project_id, *ids["training"]],
                )
            delete_ids("training_runs", ids["training"])
            delete_ids("dataset_splits", ids["split"])
            if ids["augmentation"]:
                marks = ", ".join("?" for _ in ids["augmentation"])
                self.db.execute(
                    f"delete from images where project_id = ? and augmentation_run_id in ({marks})",
                    [project_id, *ids["augmentation"]],
                )
            delete_ids("augmentation_runs", ids["augmentation"])
            delete_ids("pseudo_label_runs", ids["pseudo"])
            # Imported image/annotation rows are owned by this version and
            # cascade from the record. project_dir is a shared download cache
            # and is intentionally absent from the filesystem deletion plan.
            delete_ids("open_data_imports", ids["open_data"])
            if related_ids or plan.get("job_ids"):
                marks = ", ".join("?" for _ in related_ids)
                clauses = [f"related_id in ({marks})"] if related_ids else []
                values: list[Any] = [project_id, *related_ids]
                job_ids = list(plan.get("job_ids") or [])
                if job_ids:
                    clauses.append(f"id in ({', '.join('?' for _ in job_ids)})")
                    values.extend(job_ids)
                self.db.execute(f"delete from jobs where project_id = ? and ({' or '.join(clauses)})", values)
            self.db.execute("update dataset_splits set is_current = 0 where project_id = ?", (project_id,))
            newest = self.db.execute(
                "select id from dataset_splits where project_id = ? order by created_at desc, id desc limit 1",
                (project_id,),
            ).fetchone()
            if newest is not None:
                self.db.execute("update dataset_splits set is_current = 1 where id = ?", (newest["id"],))
        return {kind: len(values) for kind, values in ids.items() if values}
