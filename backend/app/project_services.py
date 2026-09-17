from __future__ import annotations

import base64
import hashlib
import math
import random
import platform
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import quote
import zipfile

import cv2
import json
import os
import numpy as np
import shutil
import yaml

from .artifact_naming import versioned_artifact_name
from .job_control import JobCancelled, raise_if_cancelled
from .label_io import AnnotationRow, write_yolo_labels
from .db import transaction
from .repositories import Repository, new_id
from .conversion_runtime import (
    CONVERSION_HANDOFF_REASON,
    detect_conversion_capabilities,
    export_fp32_artifact,
)


SPLIT_BUCKETS = ("train", "valid", "test")


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".wmv"}


def delete_history_artifact(
    repo: Repository, project_id: str, artifact_type: str, artifact_id: str
) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    plan = repo.build_history_deletion_plan(project_id, artifact_type, artifact_id)
    project_root = Path(project["root_path"]).resolve()
    safe_paths: list[Path] = []
    for raw_path in plan["paths"]:
        candidate = Path(raw_path).expanduser().resolve()
        try:
            relative = candidate.relative_to(project_root)
        except ValueError as exc:
            raise ValueError(f"Refusing to delete history path outside the project package: {candidate}") from exc
        if not relative.parts:
            raise ValueError("Refusing to delete the project package root as history")
        allowed_prefixes = (
            ("pseudo_labels",),
            ("augmentations",),
            ("splits",),
            ("output_model", "runs"),
            ("output_model", "conversions"),
            ("output_model", "exports"),
        )
        if not any(
            len(relative.parts) > len(prefix) and relative.parts[:len(prefix)] == prefix
            for prefix in allowed_prefixes
        ):
            raise ValueError(f"Refusing to delete a non-artifact project path: {candidate}")
        safe_paths.append(candidate)

    deleted = repo.delete_history_records(project_id, plan)
    unique_paths = sorted(set(safe_paths), key=lambda path: len(path.parts))
    removed_paths: list[str] = []
    for path in unique_paths:
        if any(path != parent and path.is_relative_to(parent) for parent in unique_paths):
            continue
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
            removed_paths.append(str(path))
        elif path.exists() or path.is_symlink():
            path.unlink()
            removed_paths.append(str(path))
    return {"deleted": deleted, "removed_paths": removed_paths}


def _is_project_owned(path: Path, project_root: Path) -> bool:
    try:
        path.resolve().relative_to(project_root.resolve())
        return True
    except (OSError, ValueError):
        return False


def _operation_trash_root(project_root: Path, operation_id: str) -> Path | None:
    resolved_project_root = project_root.resolve()
    review_root = resolved_project_root / ".trash" / "review"
    if review_root.resolve() != review_root:
        return None
    unresolved_operation_root = review_root / operation_id
    operation_root = unresolved_operation_root.resolve()
    if operation_root != unresolved_operation_root:
        return None
    try:
        relative = operation_root.relative_to(review_root)
    except ValueError:
        return None
    if relative.parts != (operation_id,):
        return None
    return operation_root


def _prune_empty_trash_dirs(project_root: Path, operation_id: str) -> None:
    operation_dir = _operation_trash_root(project_root, operation_id)
    if operation_dir is None:
        return
    for directory in (
        operation_dir / "image",
        operation_dir / "label",
        operation_dir,
        operation_dir.parent,
        operation_dir.parent.parent,
    ):
        try:
            directory.rmdir()
        except OSError:
            pass


def _is_operation_trash_file(
    path: Path,
    project_root: Path,
    operation_id: str,
    kind: str,
    expected_filename: str,
) -> bool:
    operation_root = _operation_trash_root(project_root, operation_id)
    if operation_root is None:
        return False
    expected_parent = operation_root / kind
    if expected_parent.resolve() != expected_parent:
        return False
    try:
        resolved = path.resolve()
    except OSError:
        return False
    return (
        path.is_absolute()
        and path == resolved
        and _is_project_owned(resolved, project_root)
        and resolved.parent == expected_parent
        and resolved.name == expected_filename
    )


def _move_files_back(moves: list[tuple[Path, Path]]) -> list[Exception]:
    failures: list[Exception] = []
    for original, trash in reversed(moves):
        try:
            if trash.is_file() and not original.exists():
                original.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(trash), str(original))
        except Exception as exc:
            failures.append(exc)
    return failures


def _move_restored_files_back(moves: list[tuple[Path, Path]]) -> list[Exception]:
    failures: list[Exception] = []
    for original, trash in reversed(moves):
        try:
            if original.is_file() and not trash.exists():
                trash.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(original), str(trash))
        except Exception as exc:
            failures.append(exc)
    return failures


def _raise_rollback_failure(original_error: Exception, failures: list[Exception]) -> None:
    if failures:
        details = "; ".join(str(failure) for failure in failures)
        raise RuntimeError(f"{original_error}; rollback failures: {details}") from original_error


def _remove_project_image(repo: Repository, project_id: str, image_id: str) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if project is None:
        raise FileNotFoundError(f"Project not found: {project_id}")
    image = repo.get_image(image_id)
    if image is None or image["project_id"] != project_id:
        raise FileNotFoundError(f"Active image not found: {image_id}")

    project_root = Path(project["root_path"]).resolve()
    original_image_path = Path(image["path"]).expanduser().absolute()
    if image.get("source_origin") == "open_data" and image.get("open_data_import_id"):
        open_import = repo.get_active_open_data_import(project_id)
        labels_root = Path(open_import["project_dir"]) / "reviewed_labels" if open_import else project_root / "reviewed_labels"
    else:
        labels_root = project_root / "reviewed_labels"
    original_label_path = (labels_root / f"{original_image_path.stem}.txt").absolute()
    operation_id = new_id()
    operation_root = _operation_trash_root(project_root, operation_id)
    if operation_root is None:
        raise ValueError(f"Unsafe project removal trash root: {project_root}")

    candidates = (
        (original_image_path, operation_root / "image" / original_image_path.name),
        (original_label_path, operation_root / "label" / original_label_path.name),
    )
    moves = [
        (source, destination)
        for source, destination in candidates
        if _is_project_owned(source, project_root) and source.is_file()
    ]
    for _source, destination in moves:
        if destination.exists():
            raise FileExistsError(f"Removal trash destination already exists: {destination}")

    moved: list[tuple[Path, Path]] = []
    try:
        for source, destination in moves:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(destination))
            moved.append((source, destination))
        operation = repo.create_image_removal_operation(
            project_id,
            image_id,
            str(original_image_path),
            str(candidates[0][1]) if candidates[0] in moves else None,
            str(original_label_path),
            str(candidates[1][1]) if candidates[1] in moves else None,
            operation_id=operation_id,
        )
    except Exception as exc:
        rollback_failures = _move_files_back(moved)
        _prune_empty_trash_dirs(project_root, operation_id)
        _raise_rollback_failure(exc, rollback_failures)
        raise
    return operation


def remove_project_image(repo: Repository, project_id: str, image_id: str) -> dict[str, Any]:
    with repo.db.synchronized():
        return _remove_project_image(repo, project_id, image_id)


def _restore_project_image(
    repo: Repository,
    project_id: str,
    operation_id: str,
) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if project is None:
        raise FileNotFoundError(f"Project not found: {project_id}")
    operation = repo.get_image_removal_operation(operation_id)
    if operation is None or operation["project_id"] != project_id:
        raise FileNotFoundError(f"Image removal operation not found: {operation_id}")
    if operation["restored_at"] is not None:
        return operation

    project_root = Path(project["root_path"]).resolve()
    removed_image = repo.get_image(operation["image_id"], include_removed=True)
    if (
        removed_image is None
        or removed_image["project_id"] != project_id
        or removed_image["removal_operation_id"] != operation_id
    ):
        raise ValueError(f"Image removal operation does not own tombstoned image: {operation_id}")
    image_path = Path(removed_image["path"]).expanduser().resolve()
    recorded_image_path = Path(operation["original_image_path"]).expanduser().resolve()
    if recorded_image_path != image_path:
        raise ValueError(f"Unsafe original image path for removal operation: {operation_id}")
    label_path = (project_root / "reviewed_labels" / f"{image_path.stem}.txt").resolve()
    if operation["original_label_path"]:
        recorded_label_path = Path(operation["original_label_path"]).expanduser().resolve()
        if recorded_label_path != label_path:
            raise ValueError(f"Unsafe original label path for removal operation: {operation_id}")
    if operation["trash_image_path"] is None and _is_project_owned(image_path, project_root):
        if not image_path.exists():
            raise FileNotFoundError(
                f"Removal trash is no longer available for operation: {operation_id}"
            )
        raise FileExistsError(f"Restore conflict: destination already exists: {image_path}")

    recorded_pairs = (
        ("image", image_path, operation["trash_image_path"]),
        ("label", label_path, operation["trash_label_path"]),
    )
    moves: list[tuple[Path, Path]] = []
    for kind, original_value, trash_value in recorded_pairs:
        if not trash_value:
            continue
        original = Path(original_value).resolve()
        trash = Path(trash_value).expanduser().resolve()
        if not (
            _is_project_owned(original, project_root)
            and _is_operation_trash_file(
                trash,
                project_root,
                operation_id,
                kind,
                original.name,
            )
        ):
            raise ValueError(f"Unsafe {kind} removal trash path: {trash_value}")
        if not trash.is_file():
            raise FileNotFoundError(f"Removal trash file not found: {trash}")
        if original.exists():
            raise FileExistsError(f"Restore conflict: destination already exists: {original}")
        moves.append((original, trash))

    restored_files: list[tuple[Path, Path]] = []
    try:
        for original, trash in moves:
            original.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(trash), str(original))
            restored_files.append((original, trash))
        restored = repo.restore_image_removal_operation(operation_id)
    except Exception as exc:
        rollback_failures = _move_restored_files_back(restored_files)
        _raise_rollback_failure(exc, rollback_failures)
        raise
    _prune_empty_trash_dirs(project_root, operation_id)
    return restored


def restore_project_image(
    repo: Repository,
    project_id: str,
    operation_id: str,
) -> dict[str, Any]:
    with repo.db.synchronized():
        return _restore_project_image(repo, project_id, operation_id)


def sweep_pending_image_removal_trash(repo: Repository) -> None:
    operations = repo.list_unresolved_image_removal_operations_before(
        repo.process_started_at
    )
    for operation in operations:
        project = repo.get_project(operation["project_id"])
        if project is None:
            continue
        project_root = Path(project["root_path"]).resolve()
        cleared: dict[str, bool] = {"image": False, "label": False}
        for kind, field in (
            ("image", "trash_image_path"),
            ("label", "trash_label_path"),
        ):
            path_value = operation[field]
            if not path_value:
                continue
            original_field = (
                "original_image_path" if kind == "image" else "original_label_path"
            )
            original_value = operation[original_field]
            trash_path = Path(path_value).expanduser()
            if not _is_operation_trash_file(
                trash_path,
                project_root,
                operation["id"],
                kind,
                Path(original_value).name if original_value else "",
            ):
                cleared[kind] = True
                continue
            resolved_trash_path = trash_path.resolve()
            if not resolved_trash_path.exists():
                cleared[kind] = True
                continue
            if not resolved_trash_path.is_file():
                cleared[kind] = True
                continue
            try:
                resolved_trash_path.unlink()
            except OSError:
                continue
            cleared[kind] = True
        if cleared["image"] or cleared["label"]:
            repo.clear_image_removal_trash_paths(
                operation["id"],
                image=cleared["image"],
                label=cleared["label"],
            )
        _prune_empty_trash_dirs(project_root, operation["id"])


def analyze_project_sources(repo: Repository, project_id: str, source_asset_id: str | None = None) -> dict[str, Any]:
    images = repo.list_images(project_id, source_asset_id=source_asset_id, limit=100000, offset=0)
    widths = [int(image["width"]) for image in images if image.get("width")]
    heights = [int(image["height"]) for image in images if image.get("height")]
    extensions: dict[str, int] = {}
    for image in images:
        suffix = Path(image["path"]).suffix.lower() or "unknown"
        extensions[suffix] = extensions.get(suffix, 0) + 1
    sizes: dict[str, int] = {}
    for width, height in zip(widths, heights):
        key = f"{width}×{height}"
        sizes[key] = sizes.get(key, 0) + 1
    return {
        "image_count": len(images),
        "known_dimensions": len(widths),
        "min_width": min(widths) if widths else None,
        "max_width": max(widths) if widths else None,
        "min_height": min(heights) if heights else None,
        "max_height": max(heights) if heights else None,
        "extensions": extensions,
        "top_sizes": sorted(sizes.items(), key=lambda item: item[1], reverse=True)[:8],
    }


def _safe_direct_match_count(folder: Path, extensions: set[str]) -> int:
    if not folder.exists() or not folder.is_dir():
        return 0
    try:
        return sum(1 for item in folder.iterdir() if item.is_file() and item.suffix.lower() in extensions)
    except OSError:
        return 0


def _file_browser_shortcuts(mode: str, preferred_roots: list[Path] | None = None) -> list[dict[str, Any]]:
    runtime_root = os.environ.get("OBJECT_AUTOLABEL_PROJECT_ROOT", str(Path(__file__).resolve().parents[2]))
    autolabel_roots = preferred_roots or [Path(runtime_root)]
    home = Path.home()
    allowed = IMAGE_EXTENSIONS if mode == "image_folder" else VIDEO_EXTENSIONS
    definitions: list[tuple[str, Path, str]] = []
    for root in autolabel_roots:
        if (root / "ObjectAutoLabel").is_dir():
            definitions.extend(
                [
                    ("0629 raw data", root / "0629", "Original unlabeled folder for the current aerial person/car work."),
                    ("Project input/0629", root / "ObjectAutoLabel" / "data" / "input" / "0629", "Copied working input folder inside ObjectAutoLabel."),
                    ("Autolabel workspace", root, "Parent workspace containing ObjectAutoLabel and raw source folders."),
                    ("ObjectAutoLabel project", root / "ObjectAutoLabel", "Project root; use data/input or data/projects below this folder."),
                    ("Project data/input", root / "ObjectAutoLabel" / "data" / "input", "Imported source image folders for the app."),
                    ("Project data/projects", root / "ObjectAutoLabel" / "data" / "projects", "Per-project generated labels, splits, and model artifacts."),
                ]
            )
        else:
            definitions.extend(
                [
                    ("ObjectAutoLabel project", root, "Container-visible application root."),
                    ("Project data/input", root / "data" / "input", "Imported source image folders mounted into the app."),
                    ("Project data/projects", root / "data" / "projects", "Per-project generated labels, splits, and model artifacts."),
                    ("Output models", root / "output_model", "Converted and trained model artifacts."),
                    ("Input models", root / "input_model", "Native input model weights."),
                    ("CLI workspace", root / "cli_workspace", "Mounted terminal workspace."),
                ]
            )
    definitions.extend(
        [
            ("Desktop", home / "Desktop", "Desktop folder on this device."),
            ("Home", home, "User home folder on this device."),
        ]
    )
    seen: set[str] = set()
    shortcuts = []
    for label, path, description in definitions:
        resolved = path.expanduser()
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        exists = resolved.exists()
        match_count = _safe_direct_match_count(resolved, allowed)
        shortcuts.append(
            {
                "label": label,
                "path": str(resolved),
                "description": description,
                "exists": exists,
                "match_count": match_count,
            }
        )
    return shortcuts


def _default_browser_path(mode: str, preferred_roots: list[Path] | None = None) -> Path:
    shortcuts = _file_browser_shortcuts(mode, preferred_roots)
    if mode == "image_folder":
        for shortcut in shortcuts:
            if shortcut["exists"] and shortcut["match_count"] > 0:
                return Path(shortcut["path"])
    for shortcut in shortcuts:
        if shortcut["exists"]:
            return Path(shortcut["path"])
    runtime_root = os.environ.get("OBJECT_AUTOLABEL_PROJECT_ROOT", str(Path(__file__).resolve().parents[2]))
    return (preferred_roots or [Path(runtime_root)])[0]


def browse_local_files(path: str | None, mode: str = "image_folder", preferred_roots: list[Path] | None = None) -> dict[str, Any]:
    shortcuts = _file_browser_shortcuts(mode, preferred_roots)
    base = Path(path).expanduser() if path else _default_browser_path(mode, preferred_roots)
    if not base.exists():
        base = _default_browser_path(mode, preferred_roots)
    if base.is_file():
        base = base.parent
    allowed = IMAGE_EXTENSIONS if mode == "image_folder" else VIDEO_EXTENSIONS
    entries = []
    try:
        children = sorted(base.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))[:300]
    except OSError:
        children = []
    for child in children:
        if child.name.startswith("."):
            continue
        if child.is_dir():
            count = _safe_direct_match_count(child, allowed)
            entries.append({"name": child.name, "path": str(child), "kind": "directory", "selectable": mode == "image_folder" and count > 0, "match_count": count})
        elif child.suffix.lower() in allowed:
            entries.append({"name": child.name, "path": str(child), "kind": "file", "selectable": mode == "video", "match_count": 1})
    parent = str(base.parent) if base.parent != base else None
    current_match_count = _safe_direct_match_count(base, allowed)
    return {"path": str(base), "parent": parent, "mode": mode, "current_match_count": current_match_count, "shortcuts": shortcuts, "entries": entries}


def _validate_annotation_bounds(annotations: list[dict[str, Any]]) -> None:
    for item in annotations:
        width = float(item["width"])
        height = float(item["height"])
        x_center = float(item["x_center"])
        y_center = float(item["y_center"])
        if width <= 0 or height <= 0:
            raise ValueError("Annotation bbox width and height must be greater than 0")
        if x_center - (width / 2) < 0 or x_center + (width / 2) > 1:
            raise ValueError("Annotation bbox must stay within normalized image bounds")
        if y_center - (height / 2) < 0 or y_center + (height / 2) > 1:
            raise ValueError("Annotation bbox must stay within normalized image bounds")


def register_image_folder(repo: Repository, project_id: str, source_asset_id: str, folder: str) -> dict[str, Any]:
    folder_path = Path(folder)
    if not folder_path.exists():
        raise FileNotFoundError(f"Image folder does not exist: {folder}")
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    project_source_dir = Path(project["root_path"]) / "sources" / source_asset_id / "images"
    project_source_dir.mkdir(parents=True, exist_ok=True)
    image_paths = sorted(path for path in folder_path.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS)
    created = 0
    for image_path in image_paths:
        copied_path = project_source_dir / image_path.name
        if image_path.resolve() != copied_path.resolve():
            shutil.copy2(image_path, copied_path)
        image = cv2.imread(str(copied_path))
        height = width = None
        if image is not None:
            height, width = image.shape[:2]
        repo.create_image(
            project_id=project_id,
            source_asset_id=source_asset_id,
            path=str(copied_path),
            width=width,
            height=height,
        )
        created += 1
    return {"registered_images": created}


def split_video_into_frames(
    repo: Repository,
    project_id: str,
    source_asset_id: str,
    video_path: str,
    output_dir: str,
    frames_per_second: float,
    resize_enabled: bool = False,
    resize_width: int | None = None,
    resize_height: int | None = None,
    *,
    job_id: str,
) -> dict[str, Any]:
    if frames_per_second <= 0:
        raise ValueError("frames_per_second must be greater than 0")
    if resize_enabled and (not resize_width or not resize_height):
        raise ValueError("resize_width and resize_height are required when resize is enabled")

    images_dir = Path(output_dir) / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Unable to read video: {video_path}")

    frame_rate = cap.get(cv2.CAP_PROP_FPS) or frames_per_second
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_interval = max(1, int(frame_rate / frames_per_second))
    video_filename = Path(video_path).stem
    saved = 0
    frame_index = 0

    try:
        while True:
            raise_if_cancelled(repo, job_id)
            ok, frame = cap.read()
            if not ok:
                break
            if frame_index % frame_interval == 0:
                if resize_enabled:
                    frame = cv2.resize(frame, (resize_width, resize_height), interpolation=cv2.INTER_AREA)
                timestamp = frame_index / frame_rate
                output_file = images_dir / f"{video_filename}_{frame_index:06d}_time_{timestamp:.2f}.jpg"
                cv2.imwrite(str(output_file), frame)
                height, width = frame.shape[:2]
                repo.create_image(
                    project_id=project_id,
                    source_asset_id=source_asset_id,
                    path=str(output_file),
                    width=width,
                    height=height,
                )
                saved += 1
            frame_index += 1
            if total_frames:
                progress = min(99, int(frame_index / total_frames * 100))
                repo.update_job(job_id, progress=progress, message=f"Processed {frame_index}/{total_frames} frames")
    finally:
        cap.release()
    return {"images_dir": str(images_dir), "saved_frames": saved}


def save_image_annotations(
    repo: Repository,
    image_id: str,
    annotations: list[dict[str, Any]],
    review_status: str,
) -> dict[str, Any]:
    image = repo.get_image(image_id)
    if not image:
        raise FileNotFoundError(f"Image not found: {image_id}")
    _validate_annotation_bounds(annotations)
    saved = repo.replace_image_annotations(image_id, annotations, review_status)
    image_path = Path(image["path"])
    project = repo.get_project(image["project_id"])
    assert project is not None
    if image.get("source_origin") == "open_data" and image.get("open_data_import_id"):
        open_import = repo.get_active_open_data_import(image["project_id"])
        labels_dir = Path(open_import["project_dir"]) / "reviewed_labels" if open_import else Path(project["root_path"]) / "reviewed_labels"
    else:
        labels_dir = Path(project["root_path"]) / "reviewed_labels"
    label_path = labels_dir / f"{image_path.stem}.txt"
    write_yolo_labels(
        label_path,
        [
            AnnotationRow(
                class_id=int(item["class_id"]),
                x_center=float(item["x_center"]),
                y_center=float(item["y_center"]),
                width=float(item["width"]),
                height=float(item["height"]),
            )
            for item in saved
        ],
    )
    return {"annotations": saved, "label_path": str(label_path)}


OUTDATED_AUGMENTATION_SPLIT_MESSAGE = "Augmentation run is outdated; rebuild Augment before creating a split."
CHANGED_SPLIT_SOURCE_MESSAGE = "A source image was removed or changed while the split was being built; retry the split."


def validate_dataset_split_augmentation(
    repo: Repository,
    project_id: str,
    augmentation_run_id: str | None,
) -> dict[str, Any] | None:
    if not augmentation_run_id:
        return None
    augmentation_run = repo.get_augmentation_run(augmentation_run_id)
    if not augmentation_run or augmentation_run["project_id"] != project_id:
        raise FileNotFoundError(f"Augmentation run not found: {augmentation_run_id}")
    if augmentation_run.get("outdated"):
        raise ValueError(OUTDATED_AUGMENTATION_SPLIT_MESSAGE)
    return augmentation_run


def create_dataset_split(
    repo: Repository,
    project_id: str,
    name: str,
    train_ratio: float,
    val_ratio: float,
    test_ratio: float,
    pseudo_label_run_id: str | None = None,
    augmentation_run_id: str | None = None,
    open_data_import_id: str | None = None,
    *,
    job_id: str,
) -> dict[str, Any]:
    if round(train_ratio + val_ratio + test_ratio, 6) != 1.0:
        raise ValueError("Split ratios must add up to 1.0")
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    if pseudo_label_run_id:
        pseudo_run = repo.get_pseudo_label_run(pseudo_label_run_id)
        if not pseudo_run or pseudo_run["project_id"] != project_id:
            raise FileNotFoundError(f"Pseudo-label run not found: {pseudo_label_run_id}")
    if augmentation_run_id:
        augmentation_run = validate_dataset_split_augmentation(repo, project_id, augmentation_run_id)
        assert augmentation_run is not None
        if pseudo_label_run_id is None:
            pseudo_label_run_id = augmentation_run.get("pseudo_label_run_id")
    outdated_augmentation_ids = {
        run["id"]
        for run in repo.list_augmentation_runs(project_id)
        if run.get("outdated")
    }
    # Training should use every image that currently has labels, regardless of
    # whether a human has reviewed it. The review UI now tracks a checked ratio;
    # it is not a gate that blocks pseudo-labeled data from training.
    project_images = [
        image
        for image in repo.list_images(project_id, limit=100000, offset=0)
        if image.get("source_origin") != "open_data"
        and repo.list_annotations(image["id"])
        and (pseudo_label_run_id is None or image.get("pseudo_label_run_id") == pseudo_label_run_id)
        and (augmentation_run_id is None or image.get("augmentation_run_id") == augmentation_run_id)
        and image.get("augmentation_run_id") not in outdated_augmentation_ids
    ]
    random.Random(42).shuffle(project_images)
    open_data_import = None
    if open_data_import_id:
        open_data_import = next(
            (item for item in repo.list_open_data_imports(project_id) if item["id"] == open_data_import_id),
            None,
        )
        if not open_data_import:
            raise FileNotFoundError(f"Open Data version not found: {open_data_import_id}")
    open_data_rows = repo.db.execute(
        "select * from images where project_id = ? and open_data_import_id = ? and removed_at is null order by path asc",
        (project_id, open_data_import_id),
    ).fetchall() if open_data_import_id else []
    open_data_images = [dict(image) for image in open_data_rows if repo.list_annotations(image["id"])]
    images = [*project_images, *open_data_images]
    output_dir = Path(project["root_path"]) / "splits" / name
    staging_dir = output_dir.parent / f".{output_dir.name}.{new_id()}.staging"
    backup_dir = output_dir.parent / f".{output_dir.name}.{new_id()}.backup"
    output_swap_completed = False
    buckets = {"train": [], "valid": [], "test": []}
    train_cut = int(len(project_images) * train_ratio)
    val_cut = train_cut + int(len(project_images) * val_ratio)
    try:
        for index, image in enumerate(images):
            raise_if_cancelled(repo, job_id)
            if image.get("source_origin") == "open_data":
                bucket = "train" if image.get("source_split") == "train" else "valid"
            else:
                bucket = "train" if index < train_cut else "valid" if index < val_cut else "test"
            buckets[bucket].append(image["id"])
            image_path = Path(image["path"])
            target_image = staging_dir / bucket / "images" / image_path.name
            target_label = staging_dir / bucket / "labels" / f"{image_path.stem}.txt"
            target_image.parent.mkdir(parents=True, exist_ok=True)
            target_label.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image_path, target_image)
            write_yolo_labels(
                target_label,
                [
                    AnnotationRow(
                        class_id=int(item["class_id"]),
                        x_center=float(item["x_center"]),
                        y_center=float(item["y_center"]),
                        width=float(item["width"]),
                        height=float(item["height"]),
                    )
                    for item in repo.list_annotations(image["id"])
                ],
            )
            progress = int((index + 1) / max(1, len(images)) * 100)
            repo.update_job(
                job_id,
                progress=min(99, progress),
                message=f"Split {index + 1}/{len(images)} labeled images · train/val/test={train_ratio:.2f}/{val_ratio:.2f}/{test_ratio:.2f}",
            )
        schema_id = open_data_import.get("schema_id") if open_data_import else None
        if schema_id is None and pseudo_label_run_id:
            pseudo_run = repo.get_pseudo_label_run(pseudo_label_run_id)
            schema_id = pseudo_run.get("schema_id") if pseudo_run else None
        if schema_id is None:
            latest_schema = repo.db.execute(
                "select id from class_schemas where project_id = ? order by created_at desc limit 1",
                (project_id,),
            ).fetchone()
            schema_id = latest_schema["id"] if latest_schema else None
        schema_rows = repo.db.execute(
            "select distinct class_id, class_name from class_descriptors where schema_id = ? order by class_id asc",
            (schema_id,),
        ).fetchall() if schema_id else []
        names = {int(row["class_id"]): row["class_name"] for row in schema_rows}
        staging_dir.mkdir(parents=True, exist_ok=True)
        (staging_dir / "dataset.yaml").write_text(
            yaml.safe_dump(
                {
                    "train": str(output_dir / "train" / "images"),
                    "val": str(output_dir / "valid" / "images"),
                    "test": str(output_dir / "test" / "images"),
                    "names": names,
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        # The outer reentrant repository lock intentionally outlives the inner
        # transaction context. Commit failures are raised after that context's
        # body, so rollback must finish before another same-name publisher can
        # acquire the repository and replace the output again.
        with repo.db.synchronized():
            try:
                with transaction(repo.db):
                    current_images: list[dict[str, Any]] = []
                    for source_image in images:
                        current_image = repo.get_image(source_image["id"])
                        if (
                            current_image is None
                            or current_image["project_id"] != project_id
                            or current_image.get("pseudo_label_run_id") != source_image.get("pseudo_label_run_id")
                            or current_image.get("augmentation_run_id") != source_image.get("augmentation_run_id")
                            or current_image.get("open_data_import_id") != source_image.get("open_data_import_id")
                        ):
                            raise ValueError(CHANGED_SPLIT_SOURCE_MESSAGE)
                        current_images.append(current_image)
                    current_augmentation_ids = {
                        str(image["augmentation_run_id"])
                        for image in current_images
                        if image.get("augmentation_run_id")
                    }
                    if augmentation_run_id:
                        current_augmentation_ids.add(augmentation_run_id)
                    for current_augmentation_id in current_augmentation_ids:
                        validate_dataset_split_augmentation(repo, project_id, current_augmentation_id)
                    current_open_data = next(
                        (item for item in repo.list_open_data_imports(project_id) if item["id"] == open_data_import_id),
                        None,
                    ) if open_data_import_id else None
                    if (current_open_data or {}).get("id") != (open_data_import or {}).get("id"):
                        raise ValueError(CHANGED_SPLIT_SOURCE_MESSAGE)
                    if output_dir.exists():
                        output_dir.rename(backup_dir)
                    staging_dir.rename(output_dir)
                    output_swap_completed = True
                    split = repo.create_dataset_split_record_in_transaction(
                        project_id=project_id,
                        name=name,
                        train_ratio=train_ratio,
                        val_ratio=val_ratio,
                        test_ratio=test_ratio,
                        output_dir=str(output_dir),
                        dataset_yaml_path=str(output_dir / "dataset.yaml"),
                        image_ids_json=json.dumps(buckets),
                        pseudo_label_run_id=pseudo_label_run_id,
                        augmentation_run_id=augmentation_run_id,
                        open_data_import_id=open_data_import.get("id") if open_data_import else None,
                        job_id=job_id,
                    )
                output_swap_completed = False
            except Exception as exc:
                rollback_failures: list[Exception] = []
                if output_swap_completed and output_dir.exists():
                    try:
                        output_dir.rename(staging_dir)
                    except Exception as rollback_error:
                        rollback_failures.append(rollback_error)
                if backup_dir.exists() and not output_dir.exists():
                    try:
                        backup_dir.rename(output_dir)
                    except Exception as rollback_error:
                        rollback_failures.append(rollback_error)
                if staging_dir.exists():
                    try:
                        shutil.rmtree(staging_dir)
                    except Exception as rollback_error:
                        rollback_failures.append(rollback_error)
                _raise_rollback_failure(exc, rollback_failures)
                raise
        shutil.rmtree(backup_dir, ignore_errors=True)
        return split
    except Exception as exc:
        rollback_failures: list[Exception] = []
        if staging_dir.exists():
            try:
                shutil.rmtree(staging_dir)
            except Exception as rollback_error:
                rollback_failures.append(rollback_error)
        _raise_rollback_failure(exc, rollback_failures)
        raise


def list_dataset_split_samples(
    repo: Repository,
    project_id: str,
    split_id: str,
    limit_per_bucket: int = 6,
    sample_seed: int | None = None,
) -> dict[str, list[dict[str, Any]]]:
    split = repo.get_dataset_split(split_id)
    if not split or split["project_id"] != project_id:
        raise FileNotFoundError(f"Dataset split not found: {split_id}")
    limit = max(1, min(24, int(limit_per_bucket)))
    output_dir = Path(split["output_dir"])
    buckets = json.loads(split.get("image_ids_json") or "{}")
    samples: dict[str, list[dict[str, Any]]] = {bucket: [] for bucket in SPLIT_BUCKETS}
    for bucket in SPLIT_BUCKETS:
        image_ids = list(buckets.get(bucket, []))
        random.Random(f"{split_id}:{sample_seed if sample_seed is not None else 0}:{bucket}").shuffle(image_ids)
        image_ids = image_ids[:limit]
        for image_id in image_ids:
            image = repo.get_image(image_id)
            if not image:
                continue
            source_image = Path(image["path"])
            split_image = output_dir / bucket / "images" / source_image.name
            served_path = split_image if split_image.exists() else source_image
            annotations = [
                {
                    "class_id": int(item["class_id"]),
                    "class_name": str(item.get("class_name") or item["class_id"]),
                    "x_center": float(item["x_center"]),
                    "y_center": float(item["y_center"]),
                    "width": float(item["width"]),
                    "height": float(item["height"]),
                }
                for item in repo.list_annotations(image_id)
            ]
            samples[bucket].append(
                {
                    "bucket": bucket,
                    "image_id": image_id,
                    "image_path": str(served_path),
                    "image_url": f"/api/files?path={str(served_path)}",
                    "file_name": source_image.name,
                    "width": image.get("width"),
                    "height": image.get("height"),
                    "annotations": annotations,
                }
            )
    return samples


def _apply_box_motion_blur(frame: np.ndarray, annotations: list[dict[str, Any]], strength: float) -> np.ndarray:
    if not strength or not annotations:
        return frame
    kernel = max(1, int(round(float(strength))))
    if kernel <= 1:
        return frame
    motion_kernel = np.zeros((kernel, kernel), dtype=np.float32)
    motion_kernel[kernel // 2, :] = 1.0 / kernel
    height, width = frame.shape[:2]
    next_frame = frame.copy()
    for item in annotations:
        x_center = float(item["x_center"]) * width
        y_center = float(item["y_center"]) * height
        box_width = float(item["width"]) * width
        box_height = float(item["height"]) * height
        x1 = max(0, int(round(x_center - box_width / 2)))
        y1 = max(0, int(round(y_center - box_height / 2)))
        x2 = min(width, int(round(x_center + box_width / 2)))
        y2 = min(height, int(round(y_center + box_height / 2)))
        if x2 <= x1 or y2 <= y1:
            continue
        next_frame[y1:y2, x1:x2] = cv2.filter2D(next_frame[y1:y2, x1:x2], -1, motion_kernel)
    return next_frame


def _rotate_annotations(annotations: list[dict[str, Any]], *, angle: float, width: int, height: int) -> list[dict[str, Any]]:
    if not angle:
        return annotations
    center = np.array([width / 2.0, height / 2.0], dtype=np.float32)
    matrix = cv2.getRotationMatrix2D((float(center[0]), float(center[1])), angle, 1.0)
    rotated: list[dict[str, Any]] = []
    for item in annotations:
        x_center = float(item["x_center"]) * width
        y_center = float(item["y_center"]) * height
        box_width = float(item["width"]) * width
        box_height = float(item["height"]) * height
        corners = np.array([
            [x_center - box_width / 2, y_center - box_height / 2, 1.0],
            [x_center + box_width / 2, y_center - box_height / 2, 1.0],
            [x_center + box_width / 2, y_center + box_height / 2, 1.0],
            [x_center - box_width / 2, y_center + box_height / 2, 1.0],
        ], dtype=np.float32)
        transformed = corners @ matrix.T
        x1, y1 = np.maximum(transformed.min(axis=0), [0, 0])
        x2, y2 = np.minimum(transformed.max(axis=0), [width, height])
        if x2 <= x1 or y2 <= y1:
            continue
        next_item = dict(item)
        next_item["x_center"] = float(((x1 + x2) / 2) / width)
        next_item["y_center"] = float(((y1 + y2) / 2) / height)
        next_item["width"] = float((x2 - x1) / width)
        next_item["height"] = float((y2 - y1) / height)
        rotated.append(next_item)
    return rotated


def _apply_augmentation_preview(
    frame: np.ndarray,
    *,
    brightness: float,
    hue: float,
    exposure: float,
    noise: float,
    blur: float,
    gain: float,
    box_motion_blur: float,
    rotation: float,
    horizontal_flip: bool,
    vertical_flip: bool,
    annotations: list[dict[str, Any]] | None = None,
    polarity: int = 1,
    rng: np.random.Generator,
) -> np.ndarray:
    next_frame = frame.copy()
    sign = -1 if int(polarity) < 0 else 1
    if hue:
        hsv = cv2.cvtColor(next_frame, cv2.COLOR_BGR2HSV).astype(np.int16)
        hsv[:, :, 0] = (hsv[:, :, 0] + int(round(float(hue) * sign))) % 180
        next_frame = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    beta = float(brightness) + float(exposure) * sign
    alpha = max(0.05, 1.0 + (float(gain) * sign) / 100.0)
    if beta or gain:
        next_frame = cv2.convertScaleAbs(next_frame, alpha=alpha, beta=beta)
    if noise:
        noise_frame = rng.normal(0, float(noise), next_frame.shape).astype(np.int16)
        next_frame = np.clip(next_frame.astype(np.int16) + noise_frame, 0, 255).astype(np.uint8)
    if blur:
        kernel = max(1, int(round(float(blur))) * 2 + 1)
        next_frame = cv2.GaussianBlur(next_frame, (kernel, kernel), 0)
    if box_motion_blur:
        next_frame = _apply_box_motion_blur(next_frame, annotations or [], box_motion_blur)
    if rotation:
        height, width = next_frame.shape[:2]
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), float(rotation) * sign, 1.0)
        next_frame = cv2.warpAffine(next_frame, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    if horizontal_flip:
        next_frame = cv2.flip(next_frame, 1)
    if vertical_flip:
        next_frame = cv2.flip(next_frame, 0)
    return next_frame


def _preview_annotations(repo: Repository, image_id: str, *, horizontal_flip: bool, vertical_flip: bool = False, rotation: float = 0, polarity: int = 1) -> list[dict[str, Any]]:
    annotations: list[dict[str, Any]] = []
    for item in repo.list_annotations(image_id):
        annotations.append(
            {
                "class_id": int(item["class_id"]),
                "class_name": str(item.get("class_name") or item["class_id"]),
                "x_center": float(item["x_center"]),
                "y_center": float(item["y_center"]),
                "width": float(item["width"]),
                "height": float(item["height"]),
            }
        )
    if rotation:
        image = repo.get_image(image_id)
        width = float(image.get("width") or 0) if image else 0
        height = float(image.get("height") or 0) if image else 0
        if width > 0 and height > 0:
            annotations = _rotate_annotations(annotations, angle=float(rotation) * (-1 if int(polarity) < 0 else 1), width=int(width), height=int(height))
    if horizontal_flip or vertical_flip:
        for annotation in annotations:
            if horizontal_flip:
                annotation["x_center"] = 1.0 - float(annotation["x_center"])
            if vertical_flip:
                annotation["y_center"] = 1.0 - float(annotation["y_center"])
    return annotations


def list_augmentation_preview_samples(
    repo: Repository,
    project_id: str,
    brightness: float = 0,
    hue: float = 0,
    exposure: float = 0,
    noise: float = 0,
    blur: float = 0,
    gain: float = 0,
    box_motion_blur: float = 0,
    rotation: float = 0,
    horizontal_flip: bool = False,
    vertical_flip: bool = False,
    mirror_probability: float = 1.0,
    polarity: int = 1,
    limit: int = 3,
) -> list[dict[str, Any]]:
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    sample_limit = max(1, min(12, int(limit)))
    images = repo.list_annotated_images(project_id, limit=sample_limit)
    rng = np.random.default_rng(42)
    samples: list[dict[str, Any]] = []
    for image in images[:sample_limit]:
        source = cv2.imread(str(image["path"]))
        if source is None:
            continue
        mirror_this_sample = bool(horizontal_flip or vertical_flip) and rng.random() < max(0.0, min(1.0, float(mirror_probability)))
        horizontal_flip_this_sample = horizontal_flip and mirror_this_sample
        vertical_flip_this_sample = vertical_flip and mirror_this_sample
        annotations = _preview_annotations(repo, image["id"], horizontal_flip=horizontal_flip_this_sample, vertical_flip=vertical_flip_this_sample, rotation=rotation, polarity=polarity)
        frame = _apply_augmentation_preview(
            source,
            brightness=brightness,
            hue=hue,
            exposure=exposure,
            noise=noise,
            blur=blur,
            gain=gain,
            box_motion_blur=box_motion_blur,
            rotation=rotation,
            horizontal_flip=horizontal_flip_this_sample,
            vertical_flip=vertical_flip_this_sample,
            annotations=annotations,
            polarity=polarity,
            rng=rng,
        )
        ok, buffer = cv2.imencode(".jpg", frame)
        if not ok:
            continue
        height, width = frame.shape[:2]
        samples.append(
            {
                "image_id": image["id"],
                "file_name": Path(image["path"]).name,
                "width": width,
                "height": height,
                "preview_url": "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii"),
                "annotations": annotations,
                "polarity": polarity,
            }
        )
    return samples


def create_image_augmentation_run(
    repo: Repository,
    project_id: str,
    name: str,
    pseudo_label_run_id: str | None = None,
    brightness: float = 0,
    hue: float = 0,
    exposure: float = 0,
    noise: float = 0,
    blur: float = 0,
    gain: float = 0,
    box_motion_blur: float = 0,
    rotation: float = 0,
    horizontal_flip: bool = False,
    vertical_flip: bool = False,
    mirror_probability: float = 1.0,
    copies: int = 1,
    skip_augment: bool = False,
    *,
    job_id: str,
) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    if copies < 1:
        raise ValueError("copies must be at least 1")
    if pseudo_label_run_id:
        pseudo_run = repo.get_pseudo_label_run(pseudo_label_run_id)
        if not pseudo_run or pseudo_run["project_id"] != project_id:
            raise FileNotFoundError(f"Pseudo-label run not found: {pseudo_label_run_id}")
    output_dir = Path(project["root_path"]) / "augmentations" / name
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    images = [
        image
        for image in repo.list_images(project_id, limit=100000, offset=0)
        if image.get("source_origin") != "open_data"
        and repo.list_annotations(image["id"])
        and (pseudo_label_run_id is None or image.get("pseudo_label_run_id") == pseudo_label_run_id)
    ]
    augmentation_run = repo.create_augmentation_run_record(
        project_id=project_id,
        pseudo_label_run_id=pseudo_label_run_id,
        name=name,
        output_dir=str(output_dir),
        settings_json=json.dumps(
            {
                "brightness": brightness,
                "hue": hue,
                "exposure": exposure,
                "noise": noise,
                "blur": blur,
                "gain": gain,
                "box_motion_blur": box_motion_blur,
                "rotation": rotation,
                "horizontal_flip": horizontal_flip,
                "vertical_flip": vertical_flip,
                "mirror_probability": mirror_probability,
                "copies": copies,
                "skip_augment": skip_augment,
            },
            sort_keys=True,
        ),
        source_image_count=len(images),
        created_image_count=0,
        source_image_ids=[image["id"] for image in images],
        job_id=job_id,
    )
    created = 0
    rng = np.random.default_rng(42)
    total = len(images) if skip_augment else len(images) * copies

    def sample_signed(value: float) -> float:
        magnitude = abs(float(value))
        return float(rng.uniform(-magnitude, magnitude)) if magnitude else 0.0

    def sample_unsigned(value: float) -> float:
        magnitude = abs(float(value))
        return float(rng.uniform(0, magnitude)) if magnitude else 0.0

    for image_index, image in enumerate(images):
        raise_if_cancelled(repo, job_id)
        source = cv2.imread(str(image["path"]))
        if source is None:
            continue
        if skip_augment:
            source_path = Path(image["path"])
            output_path = images_dir / f"{source_path.stem}_source{source_path.suffix}"
            shutil.copy2(source_path, output_path)
            height, width = source.shape[:2]
            passthrough_image = repo.create_image(project_id, str(output_path), image.get("source_asset_id"), pseudo_label_run_id=pseudo_label_run_id, augmentation_run_id=augmentation_run["id"], width=width, height=height)
            next_annotations: list[dict[str, Any]] = []
            for item in repo.list_annotations(image["id"]):
                next_item = dict(item)
                next_item.pop("id", None)
                next_item["source_type"] = "source_passthrough"
                next_item["edited"] = False
                next_annotations.append(next_item)
            repo.replace_image_annotations(passthrough_image["id"], next_annotations, review_status="pending_review")
            created += 1
            repo.update_job(
                job_id,
                progress=min(99, int(created / max(1, total) * 100)),
                message=f"Built source dataset {created}/{total} images without augmentation",
            )
            continue
        for copy_index in range(copies):
            raise_if_cancelled(repo, job_id)
            suffix = f"aug{copy_index + 1}"
            mirror_this_copy = bool(horizontal_flip or vertical_flip) and rng.random() < max(0.0, min(1.0, float(mirror_probability)))
            flip_this_copy = horizontal_flip and mirror_this_copy
            vertical_flip_this_copy = vertical_flip and mirror_this_copy
            sampled = {
                "brightness": sample_signed(brightness),
                "hue": sample_signed(hue),
                "exposure": sample_signed(exposure),
                "noise": sample_unsigned(noise),
                "blur": sample_unsigned(blur),
                "gain": sample_signed(gain),
                "box_motion_blur": sample_unsigned(box_motion_blur),
                "rotation": sample_signed(rotation),
            }
            source_annotations = _preview_annotations(repo, image["id"], horizontal_flip=flip_this_copy, vertical_flip=vertical_flip_this_copy, rotation=sampled["rotation"], polarity=1)
            frame = _apply_augmentation_preview(
                source,
                brightness=sampled["brightness"],
                hue=sampled["hue"],
                exposure=sampled["exposure"],
                noise=sampled["noise"],
                blur=sampled["blur"],
                gain=sampled["gain"],
                box_motion_blur=sampled["box_motion_blur"],
                rotation=sampled["rotation"],
                horizontal_flip=flip_this_copy,
                vertical_flip=vertical_flip_this_copy,
                annotations=source_annotations,
                polarity=1,
                rng=rng,
            )
            if flip_this_copy:
                suffix += "_hflip"
            if vertical_flip_this_copy:
                suffix += "_vflip"
            source_path = Path(image["path"])
            output_path = images_dir / f"{source_path.stem}_{suffix}{source_path.suffix}"
            cv2.imwrite(str(output_path), frame)
            height, width = frame.shape[:2]
            augmented_image = repo.create_image(project_id, str(output_path), image.get("source_asset_id"), pseudo_label_run_id=pseudo_label_run_id, augmentation_run_id=augmentation_run["id"], width=width, height=height)
            next_annotations: list[dict[str, Any]] = []
            for item in source_annotations:
                next_item = dict(item)
                next_item.pop("id", None)
                next_item["source_type"] = "augmented"
                next_item["edited"] = False
                next_annotations.append(next_item)
            repo.replace_image_annotations(augmented_image["id"], next_annotations, review_status="pending_review")
            created += 1
            repo.update_job(
                job_id,
                progress=min(99, int(created / max(1, total) * 100)),
                message=f"Augmented {created}/{total} images · sampled ranges brightness=±{abs(brightness)}, noise=0..{abs(noise)}, blur=0..{abs(blur)}, mirror_probability={max(0.0, min(1.0, float(mirror_probability))):.0%}",
            )
    repo.db.execute("update augmentation_runs set created_image_count = ? where id = ?", (created, augmentation_run["id"]))
    return {"id": augmentation_run["id"], "output_dir": str(output_dir), "created_images": created, "source_images": len(images), "pseudo_label_run_id": pseudo_label_run_id, "skip_augment": skip_augment}


def list_augmentation_run_samples(repo: Repository, project_id: str, augmentation_run_id: str, limit: int = 3) -> list[dict[str, Any]]:
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    augmentation_run = repo.get_augmentation_run(augmentation_run_id)
    if not augmentation_run or augmentation_run["project_id"] != project_id:
        raise FileNotFoundError(f"Augmentation run not found: {augmentation_run_id}")
    sample_limit = max(1, min(12, int(limit)))
    images = [
        image
        for image in repo.list_images(project_id, limit=100000, offset=0)
        if image.get("augmentation_run_id") == augmentation_run_id and repo.list_annotations(image["id"])
    ]
    rng = np.random.default_rng()
    if len(images) > sample_limit:
        indexes = rng.choice(len(images), size=sample_limit, replace=False)
        images = [images[int(index)] for index in indexes]
    samples: list[dict[str, Any]] = []
    for image in images[:sample_limit]:
        samples.append(
            {
                "image_id": image["id"],
                "file_name": Path(image["path"]).name,
                "image_path": image["path"],
                "image_url": f"/api/files?path={quote(str(image['path']))}",
                "preview_url": f"/api/files?path={quote(str(image['path']))}",
                "width": image.get("width"),
                "height": image.get("height"),
                "annotations": [
                    {
                        "class_id": int(annotation["class_id"]),
                        "class_name": str(annotation.get("class_name") or annotation["class_id"]),
                        "x_center": float(annotation["x_center"]),
                        "y_center": float(annotation["y_center"]),
                        "width": float(annotation["width"]),
                        "height": float(annotation["height"]),
                    }
                    for annotation in repo.list_annotations(image["id"])
                ],
            }
        )
    return samples


def _resolve_input_model(repo: Repository, model_name: str) -> Path:
    model_path = Path(model_name)
    if model_path.is_absolute():
        return model_path
    for base in (repo.paths.output_model_dir, repo.paths.input_model_dir, repo.paths.world_model_dir):
        candidate = base / model_name
        if candidate.exists():
            return candidate
    return repo.paths.input_model_dir / model_name


def run_validation_previews(
    repo: Repository,
    project_id: str,
    model_name: str,
    schema_id: str | None = None,
    image_path: str | None = None,
    folder_path: str | None = None,
    sample_count: int = 1,
    confidence: float = 0.25,
    iou: float = 0.7,
) -> list[dict[str, Any]]:
    from ultralytics import YOLO

    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    model_path = _resolve_input_model(repo, model_name)
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    candidates: list[Path] = []
    if image_path:
        candidates = [Path(image_path).expanduser()]
    elif folder_path:
        folder = Path(folder_path).expanduser()
        candidates = sorted(path for path in folder.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS)
    else:
        candidates = [Path(item["path"]) for item in repo.list_images(project_id, limit=100000, offset=0)]
    candidates = [path for path in candidates if path.exists() and path.is_file()]
    if not candidates:
        raise FileNotFoundError("No image available for validation preview")
    selected_paths = candidates[:1] if image_path else random.sample(candidates, min(max(1, int(sample_count)), len(candidates)))
    yolo = YOLO(str(model_path))
    schema = repo.get_class_schema(schema_id) if schema_id else None
    schema_names = {int(item["class_id"]): item["class_name"] for item in (schema or {}).get("classes", [])} if schema else {}
    previews: list[dict[str, Any]] = []
    for selected in selected_paths:
        frame = cv2.imread(str(selected))
        if frame is None:
            continue
        height, width = frame.shape[:2]
        result = yolo.predict(str(selected), conf=confidence, iou=iou, verbose=False)[0]
        model_names = getattr(result, "names", {}) or getattr(yolo, "names", {}) or {}
        annotations = []
        for box in getattr(result, "boxes", []) or []:
            xywhn = box.xywhn[0].tolist()
            class_id = int(box.cls[0])
            annotations.append(
                {
                    "class_id": class_id,
                    "class_name": schema_names.get(class_id) or str(model_names.get(class_id, class_id)),
                    "x_center": float(xywhn[0]),
                    "y_center": float(xywhn[1]),
                    "width": float(xywhn[2]),
                    "height": float(xywhn[3]),
                    "confidence": float(box.conf[0]) if getattr(box, "conf", None) is not None else None,
                }
            )
        previews.append(
            {
                "file_name": selected.name,
                "image_path": str(selected),
                "image_url": f"/api/files?path={str(selected)}",
                "width": width,
                "height": height,
                "model_name": str(model_name),
                "schema_name": str(schema.get("name")) if schema else "model native classes",
                "annotations": annotations,
            }
        )
    if not previews:
        raise FileNotFoundError("Unable to read the selected validation images")
    return previews


def run_validation_preview(
    repo: Repository,
    project_id: str,
    model_name: str,
    schema_id: str | None = None,
    image_path: str | None = None,
    folder_path: str | None = None,
    confidence: float = 0.25,
    iou: float = 0.7,
) -> dict[str, Any]:
    """Compatibility wrapper for callers that still request one preview."""
    return run_validation_previews(
        repo,
        project_id,
        model_name,
        schema_id=schema_id,
        image_path=image_path,
        folder_path=folder_path,
        sample_count=1,
        confidence=confidence,
        iou=iou,
    )[0]


def _training_metric_entry(epoch: int, total_epochs: int, loss_items: Any, metrics: dict[str, Any]) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "epoch": epoch,
        "total_epochs": total_epochs,
    }
    if loss_items is not None:
        values = _training_loss_values(loss_items)
        for key, value in zip(("box_loss", "cls_loss", "dfl_loss"), values):
            entry[key] = value
        for index, value in enumerate(values[3:], start=4):
            entry[f"loss_{index}"] = value
    for key, value in (metrics or {}).items():
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            entry[str(key)] = float(value)
    return entry


def _training_loss_values(loss_items: Any) -> list[float]:
    raw_values = loss_items.values() if isinstance(loss_items, Mapping) else loss_items
    try:
        return [float(item) for item in raw_values]
    except (TypeError, ValueError):
        return []


def _training_diagnostic_delta(before: Any, after: Any) -> dict[str, float]:
    if before is None or after is None:
        return {"max_abs": 0.0, "mean_abs": 0.0}
    difference = (after.detach().float().cpu() - before).abs()
    return {
        "max_abs": float(difference.max().item()) if difference.numel() else 0.0,
        "mean_abs": float(difference.mean().item()) if difference.numel() else 0.0,
    }


def _training_diagnostic_batch_signature(batch: Any, batch_index: int, epoch: int) -> dict[str, Any]:
    class_counts: dict[str, int] = {}
    if isinstance(batch, dict):
        classes = batch.get("cls")
        try:
            for class_id in classes.detach().cpu().reshape(-1).tolist():
                key = str(int(class_id))
                class_counts[key] = class_counts.get(key, 0) + 1
        except (AttributeError, TypeError):
            pass
    files = batch.get("im_file", []) if isinstance(batch, dict) else []
    file_names = [Path(str(path)).name for path in files]
    return {
        "batch_index": batch_index,
        "epoch": epoch,
        "image_count": len(file_names),
        "label_count": sum(class_counts.values()),
        "label_classes": class_counts,
        "image_signature": hashlib.sha256("\n".join(file_names).encode("utf-8")).hexdigest(),
    }


def _training_diagnostic_artifact(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False}
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"exists": True, "size": path.stat().st_size, "sha256": digest.hexdigest()}


def run_training(
    repo: Repository,
    project_id: str,
    dataset_split_id: str,
    input_model: str,
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    patience: int,
    optimizer: str,
    lr0: float,
    lrf: float,
    rect: bool = True,
    run_name: str | None = None,
    diagnostics: bool = False,
    amp: bool = True,
    *,
    job_id: str,
) -> dict[str, Any]:
    from ultralytics import YOLO

    split = repo.get_dataset_split(dataset_split_id)
    if not split or split["project_id"] != project_id:
        raise FileNotFoundError(f"Dataset split not found: {dataset_split_id}")
    model_path = _resolve_input_model(repo, input_model)
    if not model_path.exists():
        raise FileNotFoundError(f"Input model not found: {model_path}")
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")

    output_dir = repo.project_output_model_dir(project) / "runs"
    output_dir.mkdir(parents=True, exist_ok=True)
    repo.ensure_project_output_model_index(project)
    training_run = repo.create_training_run_record(
        project_id=project_id,
        dataset_split_id=dataset_split_id,
        input_model=str(model_path),
        output_dir=str(output_dir),
        rect=rect,
        amp=amp,
        run_name=(run_name or "").strip() or versioned_artifact_name(
            "Train", (item.get("run_name") or "" for item in repo.list_training_runs(project_id))
        ),
        job_id=job_id,
        settings={
            "epochs": epochs,
            "imgsz": imgsz,
            "batch": batch,
            "device": device,
            "patience": patience,
            "optimizer": optimizer,
            "lr0": lr0,
            "lrf": lrf,
            "rect": rect,
            "amp": amp,
        },
    )
    repo.update_job(job_id, progress=5, message="Training started")
    raise_if_cancelled(repo, job_id)
    metrics_history: list[dict[str, Any]] = []
    diagnostic_result: dict[str, Any] | None = {"enabled": True, "optimizer_steps": []} if diagnostics else None
    try:
        yolo = YOLO(str(model_path))

        def stop_training_when_cancelled(_: Any) -> None:
            raise_if_cancelled(repo, job_id)

        yolo.add_callback("on_train_batch_start", stop_training_when_cancelled)

        if diagnostic_result is not None:

            def install_training_diagnostics(trainer: Any) -> None:
                import torch

                parameters = [(name, parameter) for name, parameter in trainer.model.named_parameters() if parameter.requires_grad]
                head = next((item for item in parameters if ".cv3." in item[0]), parameters[-1] if parameters else (None, None))
                backbone = next((item for item in parameters if item[0] != head[0]), head)
                selected = {name: parameter for name, parameter in (backbone, head) if name is not None and parameter is not None}
                initial_model = {name: parameter.detach().float().cpu().clone() for name, parameter in selected.items()}
                ema_model = getattr(getattr(trainer, "ema", None), "ema", None)
                ema_parameters = dict(ema_model.named_parameters()) if ema_model is not None else {}
                initial_ema = {
                    name: ema_parameters[name].detach().float().cpu().clone() for name in selected if name in ema_parameters
                }
                latest_batch: dict[str, Any] | None = None
                batch_index = 0
                original_preprocess_batch = trainer.preprocess_batch
                original_optimizer_step = trainer.optimizer_step
                original_scaler_step = trainer.scaler.step
                original_optimizer_step_method = trainer.optimizer.step
                current_event: dict[str, Any] = {}

                def traced_preprocess_batch(batch: Any) -> Any:
                    nonlocal latest_batch, batch_index
                    latest_batch = _training_diagnostic_batch_signature(batch, batch_index, int(getattr(trainer, "epoch", -1)) + 1)
                    batch_index += 1
                    return original_preprocess_batch(batch)

                def traced_optimizer_step_method(*args: Any, **kwargs: Any) -> Any:
                    current_event["optimizer_step_called"] = True
                    return original_optimizer_step_method(*args, **kwargs)

                def traced_scaler_step(optimizer: Any, *args: Any, **kwargs: Any) -> Any:
                    result = original_scaler_step(optimizer, *args, **kwargs)
                    state = getattr(trainer.scaler, "_per_optimizer_states", {}).get(id(optimizer), {})
                    found_inf_values = state.get("found_inf_per_device", {}).values() if isinstance(state, dict) else []
                    current_event["found_inf"] = float(sum(float(value.item()) for value in found_inf_values))
                    return result

                def current_deltas(initial: dict[str, Any], model: Any) -> dict[str, dict[str, float]]:
                    current_parameters = dict(model.named_parameters()) if model is not None else {}
                    return {
                        name: _training_diagnostic_delta(initial.get(name), current_parameters.get(name)) for name in selected
                    }

                def traced_optimizer_step() -> Any:
                    gradients = [parameter.grad.detach().float() for _, parameter in parameters if parameter.grad is not None]
                    finite_gradients = [gradient[torch.isfinite(gradient)] for gradient in gradients]
                    finite_values = sum(int(gradient.numel()) for gradient in finite_gradients)
                    nonfinite_values = sum(int((~torch.isfinite(gradient)).sum().item()) for gradient in gradients)
                    squared_norm = sum(float(gradient.square().sum().item()) for gradient in finite_gradients)
                    loss = getattr(trainer, "loss", None)
                    current_event.clear()
                    current_event.update(
                        {
                            **(latest_batch or {"batch_index": None, "epoch": int(getattr(trainer, "epoch", -1)) + 1}),
                            "loss_finite": bool(torch.isfinite(loss).all().item()) if isinstance(loss, torch.Tensor) else None,
                            "grad_finite_values": finite_values,
                            "grad_nonfinite_values": nonfinite_values,
                            "grad_l2_norm": math.sqrt(squared_norm),
                            "scaler_scale_before": float(trainer.scaler.get_scale()),
                            "optimizer_step_called": False,
                        }
                    )
                    trainer.optimizer.step = traced_optimizer_step_method
                    trainer.scaler.step = traced_scaler_step
                    try:
                        result = original_optimizer_step()
                    finally:
                        trainer.optimizer.step = original_optimizer_step_method
                        trainer.scaler.step = original_scaler_step
                    current_event["scaler_scale_after"] = float(trainer.scaler.get_scale())
                    current_event.setdefault("found_inf", None)
                    current_event["model_deltas"] = current_deltas(initial_model, trainer.model)
                    current_event["ema_deltas"] = current_deltas(initial_ema, ema_model)
                    current_event["ema_updates"] = int(getattr(getattr(trainer, "ema", None), "updates", 0))
                    diagnostic_result["optimizer_steps"].append(dict(current_event))
                    return result

                def capture_pre_strip(_: Any) -> None:
                    diagnostic_result["pre_strip"] = {
                        "ema_updates": int(getattr(getattr(trainer, "ema", None), "updates", 0)),
                        "model_deltas": current_deltas(initial_model, trainer.model),
                        "ema_deltas": current_deltas(initial_ema, ema_model),
                    }

                trainer.preprocess_batch = traced_preprocess_batch
                trainer.optimizer_step = traced_optimizer_step
                yolo.add_callback("on_model_save", capture_pre_strip)

            yolo.add_callback("on_pretrain_routine_end", install_training_diagnostics)

        def update_training_progress(trainer: Any) -> None:
            reported_epoch = int(getattr(trainer, "epoch", -1)) + 1
            total_epochs = int(getattr(trainer, "epochs", epochs) or epochs)
            if reported_epoch < 1 or total_epochs < 1:
                return
            # Ultralytics invokes on_fit_epoch_end again from final_eval after incrementing
            # trainer.epoch to log best-model validation. Fold that final callback into the
            # completed epoch so persisted history contains one entry per configured epoch.
            epoch = min(reported_epoch, total_epochs)
            metrics = getattr(trainer, "metrics", {}) or {}
            loss_items = getattr(trainer, "loss_items", None)
            metric_entry = _training_metric_entry(epoch, total_epochs, loss_items, metrics)
            loss_text = ""
            if loss_items is not None:
                values = _training_loss_values(loss_items)
                if values:
                    loss_text = " · loss=" + ",".join(f"{value:.4f}" for value in values)
            if metrics:
                metric_bits = [f"{key}={float(value):.4f}" for key, value in list(metrics.items())[:3] if isinstance(value, (int, float))]
                if metric_bits:
                    loss_text += " · " + " ".join(metric_bits)
            # JobRunner owns terminal completion (100); a fit-end callback still runs
            # while the training function can fail during final checkpoint handling.
            progress = min(99, max(5, int(epoch / total_epochs * 100)))
            if metric_entry:
                if metrics_history and metrics_history[-1].get("epoch") == metric_entry.get("epoch"):
                    metrics_history[-1] = metric_entry
                else:
                    metrics_history.append(metric_entry)
                repo.update_training_run(training_run["id"], metrics_json=json.dumps(metrics_history, sort_keys=True))
            repo.update_job(job_id, progress=progress, message=f"Epoch {epoch}/{total_epochs}{loss_text}")

        yolo.add_callback("on_fit_epoch_end", update_training_progress)
        results = yolo.train(
            data=split["dataset_yaml_path"],
            epochs=epochs,
            imgsz=imgsz,
            batch=batch,
            device=device,
            patience=patience,
            optimizer=optimizer,
            lr0=lr0,
            lrf=lrf,
            rect=rect,
            amp=amp,
            project=str(output_dir),
        )
        save_dir = Path(results.save_dir)
        best_model = save_dir / "weights" / "best.pt"
        last_model = save_dir / "weights" / "last.pt"
        repo.update_training_run(
            training_run["id"],
            save_dir=str(save_dir),
            best_model_path=str(best_model) if best_model.exists() else None,
            last_model_path=str(last_model) if last_model.exists() else None,
            status="completed",
        )
        completed_run = repo.get_training_run(training_run["id"]) or training_run
        if diagnostic_result is not None:
            best_artifact = _training_diagnostic_artifact(best_model)
            last_artifact = _training_diagnostic_artifact(last_model)
            diagnostic_result["post_strip"] = {
                "best_model": best_artifact,
                "last_model": last_artifact,
                "best_model_size": best_artifact.get("size"),
                "last_model_size": last_artifact.get("size"),
            }
            return {**completed_run, "diagnostics": diagnostic_result}
        return completed_run
    except JobCancelled:
        repo.update_training_run(training_run["id"], status="cancelled")
        raise
    except Exception:
        repo.update_training_run(training_run["id"], status="failed")
        raise


def export_training_model(
    repo: Repository,
    project_id: str,
    training_run_id: str,
    export_format: str,
    imgsz: int,
    int8: bool,
    *,
    job_id: str,
) -> dict[str, Any]:
    from ultralytics import YOLO

    training_run = repo.get_training_run(training_run_id)
    if not training_run or training_run["project_id"] != project_id:
        raise FileNotFoundError(f"Training run not found: {training_run_id}")
    source_model = training_run.get("best_model_path") or training_run.get("last_model_path")
    if not source_model:
        raise FileNotFoundError("Training run does not have a model artifact yet")
    repo.update_job(job_id, progress=10, message=f"Exporting {export_format}")
    raise_if_cancelled(repo, job_id)
    model = YOLO(source_model)
    exported = model.export(format=export_format, imgsz=imgsz, int8=int8)
    return repo.create_model_export_record(
        project_id=project_id,
        training_run_id=training_run_id,
        source_model_path=source_model,
        export_format=export_format,
        output_path=str(exported),
        status="completed",
        job_id=job_id,
    )


def _class_schema_snapshot(schema: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"id": int(item["class_id"]), "name": str(item["class_name"])}
        for item in schema.get("classes", [])
    ]


def _export_conversion_artifact(source_model: Path, output_dir: Path, target: dict[str, Any], imgsz: int) -> Path:
    export_format = str(target["format"])
    precision = str(target["precision"])
    if precision != "fp32" or export_format not in {"onnx", "tflite"}:
        raise ValueError(f"Unsupported conversion target: {export_format}/{precision}")
    layout = str(target.get("layout", "NCHW")).upper()
    if export_format == "onnx" and layout != "NCHW":
        raise ValueError("ONNX conversion uses NCHW layout")
    return export_fp32_artifact(source_model, output_dir, export_format, imgsz, opset=int(target.get("opset", 11)), layout=layout)  # type: ignore[arg-type]


def build_conversion_manifest(conversion: dict[str, Any]) -> dict[str, Any]:
    return {
        "project_id": conversion["project_id"],
        "training_run_id": conversion["training_run_id"],
        "source_model_path": conversion["source_model_path"],
        "schema_id": conversion["schema_id"],
        "schema_name": conversion["schema_name"],
        "classes": conversion["schema_snapshot"],
        "artifacts": [
            {
                "id": artifact["id"],
                "format": artifact["format"],
                "precision": artifact["precision"],
                "layout": artifact.get("layout", "NCHW"),
                "path": artifact["output_path"],
                "status": artifact["status"],
            }
            for artifact in conversion.get("artifacts", [])
        ],
    }


def _relative_output_model_path(repo: Repository, path: Path) -> str:
    resolved = path.resolve()
    for project in repo.list_projects():
        project_output = repo.project_output_model_dir(project).resolve()
        try:
            return f"{project['slug']}/{resolved.relative_to(project_output)}"
        except ValueError:
            continue
    try:
        return str(path.relative_to(repo.paths.output_model_dir))
    except ValueError:
        return str(path)


def _model_source_id(relative_path: str) -> str:
    safe = relative_path.replace("\\", "/").replace("/", "__").replace(" ", "_")
    return f"model::{safe}"


def _project_for_output_relative_path(repo: Repository, relative_path: str) -> str | None:
    first = relative_path.split("/", 1)[0]
    project = repo.get_project(first)
    if project:
        return str(project["id"])
    for candidate in repo.list_projects():
        if candidate["slug"] == first:
            return str(candidate["id"])
    return None


def list_project_model_sources(repo: Repository, project_id: str) -> list[dict[str, Any]]:
    from .model_lineage import compact_training_lineage_label
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    # Read-only model/source listing must not recreate a manually deleted
    # project workspace. If the folder is gone, storage-status should remain
    # stale so the UI can warn and offer cleanup.
    sources: dict[str, dict[str, Any]] = {}

    for run in repo.list_training_runs(project_id):
        if run.get("status") != "completed":
            continue
        for key, rank in (("best_model_path", 0), ("last_model_path", 1)):
            raw_path = run.get(key)
            if not raw_path:
                continue
            path = Path(str(raw_path))
            if not path.exists() or path.suffix.lower() not in {".pt", ".pth"}:
                continue
            relative_path = _relative_output_model_path(repo, path)
            run_label = compact_training_lineage_label(repo, run)
            weight_label = "best.pt" if key == "best_model_path" else "last.pt"
            sources[relative_path] = {
                "id": _model_source_id(relative_path),
                "label": f"{run_label} · {weight_label}",
                "path": str(path),
                "relative_path": relative_path,
                "scope": "current_project",
                "source_type": "training_run",
                "training_run_id": run["id"],
                "project_id": project_id,
                "status": run["status"],
                "rank": rank,
            }

    scan_roots = [repo.project_output_model_dir(project), repo.paths.output_model_dir]
    for root in scan_roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".pt", ".pth"}:
                continue
            if root == repo.project_output_model_dir(project):
                relative_path = f"{project['slug']}/{path.relative_to(root)}"
            else:
                relative_path = _relative_output_model_path(repo, path)
            if relative_path in sources:
                continue
            owner_project_id = _project_for_output_relative_path(repo, relative_path)
            if owner_project_id == project_id:
                scope = "current_project"
            elif owner_project_id:
                scope = "other_project"
            else:
                scope = "loose_output"
            sources[relative_path] = {
                "id": _model_source_id(relative_path),
                "label": relative_path,
                "path": str(path),
                "relative_path": relative_path,
                "scope": scope,
                "source_type": "discovered_output",
                "training_run_id": None,
                "project_id": owner_project_id,
                "status": "completed",
                "rank": 10 if scope == "current_project" else 20 if scope == "other_project" else 30,
            }

    return sorted(sources.values(), key=lambda item: (int(item["rank"]), str(item["relative_path"])))


def get_project_artifact_context(repo: Repository, project_id: str) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    model_sources = list_project_model_sources(repo, project_id)
    class_schemas = repo.list_class_schemas(project_id)
    dataset_splits = repo.list_dataset_splits(project_id)
    pseudo_label_runs = repo.list_pseudo_label_runs(project_id)
    augmentation_runs = repo.list_augmentation_runs(project_id)
    training_runs = repo.list_training_runs(project_id)
    conversions = repo.list_model_conversion_runs(project_id)
    bundles = repo.list_model_export_bundles(project_id)
    return {
        "project": project,
        "counts": {
            "sources": len(repo.list_source_assets(project_id)),
            "source_images": len(repo.list_images(project_id, limit=1_000_000)),
            "class_schemas": len(class_schemas),
            "pseudo_label_runs": len(pseudo_label_runs),
            "augmentation_runs": len(augmentation_runs),
            "dataset_splits": len(dataset_splits),
            "training_runs": len(training_runs),
            "model_sources": len(model_sources),
            "conversion_packages": len(conversions),
            "export_bundles": len(bundles),
        },
        "model_sources": model_sources,
        "pseudo_label_runs": pseudo_label_runs,
        "augmentation_runs": augmentation_runs,
        "dataset_splits": dataset_splits,
        "training_runs": training_runs,
        "conversion_packages": conversions,
        "export_bundles": bundles,
    }


def create_model_conversion_package(
    repo: Repository,
    project_id: str,
    training_run_id: str | None,
    schema_id: str,
    targets: list[dict[str, Any]],
    imgsz: int,
    *,
    source_model_path: str | None = None,
    opset: int = 11,
    job_id: str,
) -> dict[str, Any]:
    capabilities = detect_conversion_capabilities(platform.machine())
    available_targets = {
        (capability.format, capability.precision)
        for capability in capabilities
        if capability.available
    }
    if not available_targets:
        raise RuntimeError(capabilities[0].reason or CONVERSION_HANDOFF_REASON)
    if not targets:
        raise ValueError("At least one conversion target is required")
    normalized_targets: list[dict[str, str]] = []
    seen_targets: set[tuple[str, str, str]] = set()
    for target in targets:
        export_format = str(target.get("format", "")).lower()
        precision = str(target.get("precision", "fp32")).lower()
        layout = str(target.get("layout", "NCHW")).upper()
        target_key = (export_format, precision, layout)
        if (export_format, precision) not in available_targets:
            raise ValueError(f"Unsupported conversion target: {export_format}/{precision}")
        if target_key in seen_targets:
            raise ValueError(f"Duplicate conversion target: {export_format}/{precision}")
        seen_targets.add(target_key)
        if layout not in {"NCHW", "NHWC"} or (export_format == "onnx" and layout != "NCHW"):
            raise ValueError(f"Unsupported conversion layout: {export_format}/{layout}")
        normalized_targets.append({"format": export_format, "precision": precision, "layout": layout})

    training_run = repo.get_training_run(training_run_id) if training_run_id else None
    if training_run_id and (not training_run or training_run["project_id"] != project_id):
        raise FileNotFoundError(f"Training run not found: {training_run_id}")
    source_model = source_model_path or (training_run.get("best_model_path") or training_run.get("last_model_path") if training_run else None)
    if not source_model:
        raise FileNotFoundError("A source model path or training run model artifact is required")
    source_model_path = Path(source_model)
    if not source_model_path.exists():
        raise FileNotFoundError(f"Source model not found: {source_model_path}")
    schema = repo.get_class_schema(schema_id)
    if not schema or schema["project_id"] != project_id:
        raise FileNotFoundError(f"Class schema not found: {schema_id}")
    existing_count = len(repo.list_model_conversion_runs(project_id))
    package_name = f"conversion-{existing_count + 1:03d}"
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    repo.ensure_project_output_model_index(project)
    output_dir = repo.project_output_model_dir(project) / "conversions" / package_name
    output_dir.mkdir(parents=True, exist_ok=True)

    schema_snapshot = _class_schema_snapshot(schema)
    conversion = repo.create_model_conversion_run(
        project_id=project_id,
        training_run_id=training_run_id,
        source_model_path=str(source_model_path),
        package_name=package_name,
        output_dir=str(output_dir),
        schema_id=schema_id,
        schema_name=str(schema["name"]),
        schema_snapshot=schema_snapshot,
        status="running",
        job_id=job_id,
    )
    repo.update_job(job_id, progress=5, message="Preparing conversion package")
    raise_if_cancelled(repo, job_id)

    (output_dir / "classes.json").write_text(json.dumps(schema_snapshot, indent=2), encoding="utf-8")
    artifact_progress_step = max(1, int(80 / len(normalized_targets)))
    for index, target in enumerate(normalized_targets, start=1):
        raise_if_cancelled(repo, job_id)
        message = f"Converting {target['format']} {target['precision']}"
        repo.update_job(job_id, progress=min(90, 10 + (index - 1) * artifact_progress_step), message=message)
        export_target = {**target, "opset": opset} if target["format"] == "onnx" else target
        try:
            exported = _export_conversion_artifact(source_model_path, output_dir, export_target, imgsz)
        except Exception:
            repo.update_model_conversion_run(conversion["id"], status="failed")
            raise
        repo.add_model_conversion_artifact(
            conversion_id=conversion["id"],
            project_id=project_id,
            format=target["format"],
            precision=target["precision"],
            layout=target.get("layout", "NCHW"),
            output_path=str(exported),
            status="completed",
        )

    conversion = repo.get_model_conversion_run(conversion["id"]) or conversion
    metadata_path = output_dir / "metadata.json"
    metadata = build_conversion_manifest(conversion)
    metadata["export_settings"] = {
        "imgsz": imgsz,
        "onnx_opset": opset if any(t["format"] == "onnx" for t in normalized_targets) else None,
        "layouts": {f"{target['format']}/{target['precision']}": target["layout"] for target in normalized_targets},
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    repo.update_model_conversion_run(conversion["id"], manifest_path=str(metadata_path), status="completed")
    return repo.get_model_conversion_run(conversion["id"]) or conversion


def create_model_export_bundle(
    repo: Repository,
    project_id: str,
    conversion_run_id: str,
    include_artifact_ids: list[str],
    include_native_pt: bool,
    *,
    job_id: str,
) -> dict[str, Any]:
    conversion = repo.get_model_conversion_run(conversion_run_id)
    if not conversion or conversion["project_id"] != project_id:
        raise FileNotFoundError(f"Conversion package not found: {conversion_run_id}")

    existing_count = len(repo.list_model_export_bundles(project_id))
    bundle_name = f"export-{existing_count + 1:03d}"
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    repo.ensure_project_output_model_index(project)
    output_dir = repo.project_output_model_dir(project) / "exports" / bundle_name
    output_dir.mkdir(parents=True, exist_ok=True)

    files: dict[str, str] = {}
    raise_if_cancelled(repo, job_id)
    conversion_dir = Path(conversion["output_dir"])
    for manifest_name, key in (("classes.json", "classes_json"), ("metadata.json", "metadata_json")):
        source = conversion_dir / manifest_name
        if source.exists():
            destination = output_dir / manifest_name
            shutil.copy2(source, destination)
            files[key] = str(destination)

    included: list[str] = ["classes_json", "metadata_json"]
    if include_native_pt:
        source_model = Path(conversion["source_model_path"])
        if source_model.exists():
            destination = output_dir / source_model.name
            shutil.copy2(source_model, destination)
            files["native_pt"] = str(destination)
        included.append("native_pt")

    artifacts_by_id = {artifact["id"]: artifact for artifact in conversion.get("artifacts", [])}
    for artifact_id in include_artifact_ids:
        raise_if_cancelled(repo, job_id)
        artifact = artifacts_by_id.get(artifact_id)
        if not artifact:
            continue
        source = Path(str(artifact.get("output_path") or ""))
        if source.exists():
            destination = output_dir / source.name
            shutil.copy2(source, destination)
            files[artifact_id] = str(destination)
        included.append(artifact_id)

    # Keep training evidence beside deployment files, never copy the full run tree.
    training = repo.get_training_run(conversion["training_run_id"]) if conversion.get("training_run_id") else None
    if training and training["project_id"] == project_id:
        training_dir = output_dir / "training"
        training_dir.mkdir(exist_ok=True)
        record_path = training_dir / "run.json"
        record_path.write_text(json.dumps(training, indent=2), encoding="utf-8")
        files["training_run"] = str(record_path)
        included.append("training")
        run_dir = Path(training.get("save_dir") or Path(conversion["source_model_path"]).parent.parent)
        runs_root = repo.project_output_model_dir(project) / "runs"
        if run_dir.resolve().is_relative_to(runs_root.resolve()) and run_dir.is_dir() and not run_dir.is_symlink():
            for source in sorted(run_dir.iterdir()):
                raise_if_cancelled(repo, job_id)
                if source.is_symlink() or not source.is_file():
                    continue
                if source.name == "args.yaml":
                    destination = training_dir / "args.yaml"
                elif source.suffix.lower() in {".csv", ".png", ".jpg", ".jpeg"}:
                    destination = training_dir / "results" / source.name
                else:
                    continue
                destination.parent.mkdir(exist_ok=True)
                shutil.copy2(source, destination)
                files[f"training/{source.name}"] = str(destination)
        else:
            files["training_evidence_note"] = "Training result directory is unavailable; persisted run configuration is included."

    bundle_manifest = {
        "project_id": project_id,
        "conversion_run_id": conversion_run_id,
        "bundle_name": bundle_name,
        "included_artifacts": included,
        "files": files,
    }
    (output_dir / "bundle.json").write_text(json.dumps(bundle_manifest, indent=2), encoding="utf-8")
    return repo.create_model_export_bundle(
        project_id=project_id,
        conversion_run_id=conversion_run_id,
        bundle_name=bundle_name,
        output_dir=str(output_dir),
        included_artifacts_json=json.dumps(included),
        status="completed",
        job_id=job_id,
    )


def create_model_export_bundle_zip(
    repo: Repository,
    project_id: str,
    conversion_run_id: str,
) -> tuple[dict[str, Any], Path]:
    conversion = repo.get_model_conversion_run(conversion_run_id)
    if not conversion or conversion["project_id"] != project_id:
        raise FileNotFoundError(f"Conversion package not found: {conversion_run_id}")
    completed_artifact_ids = [
        artifact["id"]
        for artifact in conversion.get("artifacts", [])
        if artifact.get("status") == "completed" and artifact.get("output_path") and Path(str(artifact["output_path"])).exists()
    ]
    bundle = create_model_export_bundle(
        repo,
        project_id,
        conversion_run_id,
        include_artifact_ids=completed_artifact_ids,
        include_native_pt=True,
        job_id="direct-download",
    )
    bundle_dir = Path(bundle["output_dir"])
    zip_path = bundle_dir.with_suffix(".zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in sorted(bundle_dir.rglob("*")):
            if item.is_file() and not item.is_symlink():
                archive.write(item, arcname=str(item.relative_to(bundle_dir)))
    return bundle, zip_path
