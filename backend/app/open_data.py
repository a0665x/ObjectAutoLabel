from __future__ import annotations

import json
import math
import random
import shutil
import hashlib
import os
import re
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

from PIL import Image

from .artifact_naming import versioned_artifact_name
from .config import AppPaths
from .repositories import Repository
from .repositories import new_id
from .label_io import AnnotationRow, write_yolo_labels


VISDRONE_LABELS = [
    "pedestrian",
    "people",
    "bicycle",
    "car",
    "van",
    "truck",
    "tricycle",
    "awning-tricycle",
    "bus",
    "motor",
]
VISDRONE_ARCHIVES = (
    "VisDrone2019-DET-train.zip",
    "VisDrone2019-DET-val.zip",
    "VisDrone2019-DET-test-dev.zip",
)
VISDRONE_ASSETS_URL = "https://github.com/ultralytics/assets/releases/download/v0.0.0"
ULTRALYTICS_PLATFORM_URL = "https://platform.ultralytics.com"
PLATFORM_KEY_PREFIX = "ultralytics:"
SUPPORTED_PLATFORM_TASK = "detect"
MAX_PLATFORM_IMAGE_BYTES = 100 * 1024 * 1024
PLATFORM_IMAGE_DOWNLOAD_ATTEMPTS = 4
PLATFORM_IMAGE_DOWNLOAD_WORKERS = 4
TRUSTED_PLATFORM_DOWNLOAD_HOSTS = (".ul.run", ".googleapis.com", ".googleusercontent.com")
_DOWNLOAD_LOCK = Lock()


def _platform_dataset_key(owner: str, dataset: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", owner):
        raise ValueError("Invalid Ultralytics dataset owner")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", dataset):
        raise ValueError("Invalid Ultralytics dataset name")
    return f"{PLATFORM_KEY_PREFIX}{owner}:{dataset}"


def _platform_identity(dataset_key: str) -> tuple[str, str]:
    if not dataset_key.startswith(PLATFORM_KEY_PREFIX):
        raise ValueError(f"Unsupported Open Data dataset: {dataset_key}")
    parts = dataset_key[len(PLATFORM_KEY_PREFIX):].split(":")
    if len(parts) != 2:
        raise ValueError("Invalid Ultralytics dataset key")
    owner, dataset = parts
    _platform_dataset_key(owner, dataset)
    return owner, dataset


def _cache_dir(paths: AppPaths, dataset_key: str) -> Path:
    if dataset_key == "visdrone2019-det":
        return paths.open_data_dir / dataset_key
    owner, dataset = _platform_identity(dataset_key)
    return paths.open_data_dir / "ultralytics" / owner / dataset


def _parse_platform_dataset_url(value: str) -> tuple[str, str]:
    raw = value.strip()
    if raw.startswith("ul://"):
        parsed = urlparse(raw)
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) == 2 and parts[0] == "datasets":
            return parsed.netloc, parts[1]
        raise ValueError("Use ul://<owner>/datasets/<dataset>.")
    parsed = urlparse(raw)
    if parsed.scheme != "https" or parsed.netloc != "platform.ultralytics.com":
        raise ValueError("Paste a https://platform.ultralytics.com/<owner>/datasets/<dataset> URL.")
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) != 3 or parts[1] != "datasets":
        raise ValueError("The URL must point to one Ultralytics Platform dataset.")
    return parts[0], parts[2]


def _platform_headers(api_key: str | None = None) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "ObjectAutoLabel/1.0"}
    resolved = (api_key or os.environ.get("ULTRALYTICS_API_KEY", "")).strip()
    if resolved:
        headers["Authorization"] = f"Bearer {resolved}"
    return headers


def _platform_json(path: str, api_key: str | None = None) -> dict[str, Any]:
    request = urllib.request.Request(f"{ULTRALYTICS_PLATFORM_URL}{path}", headers=_platform_headers(api_key))
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in {401, 403}:
            raise PermissionError("Ultralytics download needs a valid API key. Add it here or configure ULTRALYTICS_API_KEY on the host.") from exc
        if exc.code == 404:
            raise FileNotFoundError("Ultralytics dataset was not found or is not public.") from exc
        raise RuntimeError(f"Ultralytics Platform returned HTTP {exc.code}.") from exc
    except (URLError, TimeoutError) as exc:
        raise ConnectionError("Could not reach Ultralytics Platform. Check the network and try again.") from exc
    except json.JSONDecodeError as exc:
        raise ValueError("Ultralytics Platform returned an invalid response.") from exc


def _platform_catalog_item(dataset: dict[str, Any], paths: AppPaths) -> dict[str, Any]:
    owner = str(dataset.get("owner") or "")
    slug = str(dataset.get("dataset") or "")
    key = _platform_dataset_key(owner, slug)
    task = str(dataset.get("task") or "unknown").lower()
    split_counts = dataset.get("splits") or {}
    cache_dir = _cache_dir(paths, key)
    manifest_path = cache_dir / "manifest.json"
    downloaded = False
    status = "not_downloaded"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            downloaded = manifest.get("status") == "verified" and (cache_dir / "images" / "train").is_dir()
            status = "verified" if downloaded else "incomplete"
        except (OSError, json.JSONDecodeError):
            status = "incomplete"
    labels = [str(value) for value in (dataset.get("classNames") or [])]
    compatible = task == SUPPORTED_PLATFORM_TASK and bool(labels) and len(labels) == len(set(labels))
    if task != SUPPORTED_PLATFORM_TASK:
        reason = f"{task.upper()} labels are not compatible with this bbox-only workflow."
    elif not labels:
        reason = "No source classes are declared."
    elif len(labels) != len(set(labels)):
        reason = "Duplicate source class names cannot be mapped safely."
    else:
        reason = "Ready for bbox mapping."
    return {
        "key": key,
        "name": str(dataset.get("name") or slug),
        "provider": "ultralytics_platform",
        "source_url": f"{ULTRALYTICS_PLATFORM_URL}/{owner}/datasets/{slug}",
        "owner": owner,
        "task": task,
        "compatible": compatible,
        "compatibility_reason": reason,
        "image_count": int(dataset.get("imageCount") or 0),
        "train_count": int(split_counts.get("train") or 0),
        "val_count": int(split_counts.get("val") or 0),
        "test_count": int(split_counts.get("test") or 0),
        "labels": labels,
        "downloaded": downloaded,
        "status": status,
        "cache_path": str(cache_dir),
        "license": str(dataset.get("license") or "No license declared; verify intended use."),
        "format": str(dataset.get("format") or "unknown"),
        "download_requires_api_key": True,
    }


def inspect_ultralytics_dataset(paths: AppPaths, dataset_url: str, api_key: str | None = None) -> dict[str, Any]:
    owner, dataset = _parse_platform_dataset_url(dataset_url)
    payload = _platform_json(f"/api/datasets/{owner}/{dataset}", api_key)
    result = payload.get("dataset")
    if not isinstance(result, dict):
        raise ValueError("Ultralytics Platform response did not contain a dataset.")
    return _platform_catalog_item(result, paths)


def resolve_open_data_image(paths: AppPaths, dataset_key: str, split: str, filename: str) -> Path | None:
    if split not in {"train", "val"} or Path(filename).name != filename:
        return None
    if dataset_key == "visdrone2019-det":
        source = paths.open_data_dir / dataset_key / f"VisDrone2019-DET-{split}" / "images" / filename
    else:
        try:
            source = _cache_dir(paths, dataset_key) / "images" / split / filename
        except ValueError:
            return None
    return source if source.is_file() else None


def list_open_data_catalog(paths: AppPaths) -> list[dict[str, Any]]:
    cache_dir = paths.open_data_dir / "visdrone2019-det"
    manifest_path = cache_dir / "manifest.json"
    status = "not_downloaded"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            extracted = all(
                (cache_dir / f"VisDrone2019-DET-{split}" / "images").is_dir()
                and (cache_dir / f"VisDrone2019-DET-{split}" / "annotations").is_dir()
                for split in ("train", "val")
            )
            status = "verified" if manifest.get("status") == "verified" and extracted else "incomplete"
        except (OSError, json.JSONDecodeError):
            status = "incomplete"
    catalog = [
        {
            "key": "visdrone2019-det",
            "name": "VisDrone2019-DET",
            "provider": "built_in",
            "source_url": "https://docs.ultralytics.com/datasets/detect/visdrone/",
            "owner": "ultralytics",
            "task": "detect",
            "compatible": True,
            "compatibility_reason": "Ready for bbox mapping.",
            "image_count": 8629,
            "train_count": 6471,
            "val_count": 548,
            "test_count": 1610,
            "labels": list(VISDRONE_LABELS),
            "downloaded": status == "verified",
            "status": status,
            "cache_path": str(cache_dir),
            "license": "License not clearly stated; verify intended use.",
            "format": "visdrone",
            "download_requires_api_key": False,
        }
    ]
    platform_root = paths.open_data_dir / "ultralytics"
    if platform_root.is_dir():
        for manifest_path in sorted(platform_root.glob("*/*/manifest.json")):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                dataset = manifest.get("dataset")
                if isinstance(dataset, dict):
                    catalog.append(_platform_catalog_item(dataset, paths))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
    return catalog


def _safe_extract(archive: zipfile.ZipFile, destination: Path) -> None:
    root = destination.resolve()
    for member in archive.infolist():
        target = (destination / member.filename).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"Unsafe archive member: {member.filename}") from exc
    archive.extractall(destination)


def download_visdrone(repo: Repository, *, job_id: str) -> dict[str, Any]:
    from .job_control import raise_if_cancelled

    with _DOWNLOAD_LOCK:
        cache_dir = repo.paths.open_data_dir / "visdrone2019-det"
        current = list_open_data_catalog(repo.paths)[0]
        if current["downloaded"]:
            return current
        downloads_dir = repo.paths.open_data_dir / ".downloads"
        staging_dir = repo.paths.open_data_dir / ".visdrone2019-det.staging"
        downloads_dir.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(staging_dir, ignore_errors=True)
        staging_dir.mkdir(parents=True)
        hashes: dict[str, str] = {}
        try:
            return _download_visdrone_locked(repo, job_id, cache_dir, downloads_dir, staging_dir, hashes)
        except Exception:
            shutil.rmtree(staging_dir, ignore_errors=True)
            raise


def _safe_platform_file_name(index: int, source_name: str) -> str:
    raw_name = Path(source_name).name
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", Path(raw_name).stem).strip("._") or "image"
    suffix = Path(raw_name).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}:
        suffix = ".jpg"
    return f"{index:08d}_{stem[:120]}{suffix}"


def _normalized_platform_boxes(record: dict[str, Any], class_count: int) -> list[tuple[int, float, float, float, float]]:
    annotations = record.get("annotations") or {}
    boxes = annotations.get("boxes") if isinstance(annotations, dict) else None
    if not isinstance(boxes, list):
        return []
    valid: list[tuple[int, float, float, float, float]] = []
    for box in boxes:
        if not isinstance(box, list) or len(box) != 5:
            continue
        try:
            class_id = int(box[0])
            x_center, y_center, width, height = (float(value) for value in box[1:])
        except (TypeError, ValueError):
            continue
        if class_id < 0 or class_id >= class_count or width <= 0 or height <= 0:
            continue
        x1, y1 = max(0.0, x_center - width / 2), max(0.0, y_center - height / 2)
        x2, y2 = min(1.0, x_center + width / 2), min(1.0, y_center + height / 2)
        if x2 <= x1 or y2 <= y1:
            continue
        valid.append((class_id, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1))
    return valid


def _download_platform_image(item: dict[str, Any], staging_dir: Path) -> dict[str, Any]:
    image_url = str(item["url"])
    parsed = urlparse(image_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Ultralytics export contains an unsafe image URL.")
    host = parsed.hostname.lower()
    if not any(host == suffix[1:] or host.endswith(suffix) for suffix in TRUSTED_PLATFORM_DOWNLOAD_HOSTS):
        raise ValueError("Ultralytics export contains an image outside trusted Platform storage.")
    split = str(item["split"])
    image_path = staging_dir / "images" / split / str(item["file_name"])
    label_path = staging_dir / "labels" / split / f"{Path(str(item['file_name'])).stem}.txt"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    if image_path.is_file() and label_path.is_file():
        try:
            with Image.open(image_path) as image:
                image.verify()
            return item
        except Exception:
            image_path.unlink(missing_ok=True)
            label_path.unlink(missing_ok=True)
    request = urllib.request.Request(image_url, headers={"User-Agent": "ObjectAutoLabel/1.0"})
    for attempt in range(1, PLATFORM_IMAGE_DOWNLOAD_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=120) as response, image_path.open("wb") as output:
                declared_size = int(response.headers.get("Content-Length", "0") or 0)
                if declared_size > MAX_PLATFORM_IMAGE_BYTES:
                    raise ValueError(f"Exported image is larger than 100 MB: {item['source_name']}")
                downloaded = 0
                while chunk := response.read(1024 * 1024):
                    downloaded += len(chunk)
                    if downloaded > MAX_PLATFORM_IMAGE_BYTES:
                        raise ValueError(f"Exported image is larger than 100 MB: {item['source_name']}")
                    output.write(chunk)
            break
        except HTTPError as exc:
            image_path.unlink(missing_ok=True)
            if exc.code in {401, 403}:
                raise PermissionError(
                    f"Ultralytics signed image URL for {item['source_name']} was rejected or expired. "
                    "Retry the download to refresh the export URLs."
                ) from exc
            retryable = exc.code == 408 or exc.code == 429 or 500 <= exc.code <= 599
            if not retryable:
                raise ConnectionError(
                    f"Could not download exported image {item['source_name']}: storage returned HTTP {exc.code}."
                ) from exc
            if attempt == PLATFORM_IMAGE_DOWNLOAD_ATTEMPTS:
                if exc.code == 429:
                    raise ConnectionError(
                        f"Ultralytics image storage rate-limited {item['source_name']} after "
                        f"{PLATFORM_IMAGE_DOWNLOAD_ATTEMPTS} attempts."
                    ) from exc
                raise ConnectionError(
                    f"Could not download exported image {item['source_name']} after "
                    f"{PLATFORM_IMAGE_DOWNLOAD_ATTEMPTS} attempts (HTTP {exc.code})."
                ) from exc
            time.sleep(2 ** (attempt - 1))
        except (URLError, TimeoutError) as exc:
            image_path.unlink(missing_ok=True)
            reason = getattr(exc, "reason", None)
            timed_out = (
                isinstance(exc, TimeoutError)
                or isinstance(reason, TimeoutError)
                or "timed out" in str(exc).lower()
            )
            if attempt == PLATFORM_IMAGE_DOWNLOAD_ATTEMPTS:
                if timed_out:
                    raise ConnectionError(
                        f"Timed out downloading exported image {item['source_name']} after "
                        f"{PLATFORM_IMAGE_DOWNLOAD_ATTEMPTS} attempts."
                    ) from exc
                raise ConnectionError(
                    f"Network error downloading exported image {item['source_name']} after "
                    f"{PLATFORM_IMAGE_DOWNLOAD_ATTEMPTS} attempts."
                ) from exc
            time.sleep(2 ** (attempt - 1))
    try:
        with Image.open(image_path) as image:
            image.verify()
    except Exception as exc:
        image_path.unlink(missing_ok=True)
        raise ValueError(f"Downloaded image is invalid: {item['source_name']}") from exc
    write_yolo_labels(label_path, [AnnotationRow(*box) for box in item["boxes"]])
    return item


def download_ultralytics_dataset(
    repo: Repository,
    dataset_key: str,
    api_key: str | None = None,
    *,
    job_id: str,
) -> dict[str, Any]:
    from .job_control import raise_if_cancelled

    owner, dataset_slug = _platform_identity(dataset_key)
    with _DOWNLOAD_LOCK:
        cache_dir = _cache_dir(repo.paths, dataset_key)
        if (cache_dir / "manifest.json").is_file():
            catalog = {item["key"]: item for item in list_open_data_catalog(repo.paths)}
            if catalog.get(dataset_key, {}).get("downloaded"):
                return catalog[dataset_key]
        metadata_payload = _platform_json(f"/api/datasets/{owner}/{dataset_slug}", api_key)
        dataset = metadata_payload.get("dataset")
        if not isinstance(dataset, dict):
            raise ValueError("Ultralytics Platform response did not contain a dataset.")
        catalog_item = _platform_catalog_item(dataset, repo.paths)
        if not catalog_item["compatible"]:
            raise ValueError(catalog_item["compatibility_reason"])
        if not catalog_item["labels"]:
            raise ValueError("This dataset has no declared source classes to map.")
        raise_if_cancelled(repo, job_id)
        repo.update_job(job_id, progress=3, message=f"Preparing {catalog_item['name']} export")
        export_payload = _platform_json(f"/api/datasets/{owner}/{dataset_slug}/export", api_key)
        download_url = str(export_payload.get("downloadUrl") or "")
        export_host = (urlparse(download_url).hostname or "").lower()
        if not download_url.startswith("https://") or not any(export_host == suffix[1:] or export_host.endswith(suffix) for suffix in TRUSTED_PLATFORM_DOWNLOAD_HOSTS):
            raise ValueError("Ultralytics Platform did not return a downloadable export.")

        staging_dir = cache_dir.parent / f".{cache_dir.name}.staging"
        staging_dir.mkdir(parents=True, exist_ok=True)
        export_path = staging_dir / "dataset.ndjson"
        try:
            request = urllib.request.Request(download_url, headers={"User-Agent": "ObjectAutoLabel/1.0"})
            with urllib.request.urlopen(request, timeout=120) as response, export_path.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
            digest_builder = hashlib.sha256()
            with export_path.open("rb") as export_stream:
                while chunk := export_stream.read(1024 * 1024):
                    digest_builder.update(chunk)
            export_hash = digest_builder.hexdigest()
            resume_path = staging_dir / ".resume.json"
            try:
                resume_state = json.loads(resume_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                resume_state = {}
            if resume_state.get("export_sha256") != export_hash:
                shutil.rmtree(staging_dir / "images", ignore_errors=True)
                shutil.rmtree(staging_dir / "labels", ignore_errors=True)
            resume_path.write_text(json.dumps({"export_sha256": export_hash}), encoding="utf-8")
            records: list[dict[str, Any]] = []
            export_dataset: dict[str, Any] | None = None
            class_count = len(catalog_item["labels"])
            for line_number, raw_line in enumerate(export_path.open("r", encoding="utf-8"), start=1):
                if not raw_line.strip():
                    continue
                try:
                    record = json.loads(raw_line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Invalid Ultralytics NDJSON at line {line_number}.") from exc
                if record.get("type") == "dataset":
                    export_dataset = record
                    continue
                if record.get("type") != "image" or record.get("split") not in {"train", "val"}:
                    continue
                boxes = _normalized_platform_boxes(record, class_count)
                if not boxes:
                    continue
                image_url = str(record.get("url") or "")
                source_name = str(record.get("file") or f"image-{line_number}.jpg")
                records.append({
                    "url": image_url,
                    "source_name": source_name,
                    "file_name": _safe_platform_file_name(len(records), source_name),
                    "split": str(record["split"]),
                    "boxes": boxes,
                })
            if export_dataset is None:
                raise ValueError("Ultralytics export is missing its dataset metadata row.")
            if str(export_dataset.get("task") or "").lower() != SUPPORTED_PLATFORM_TASK:
                raise ValueError("The downloaded dataset is no longer a Detect/bbox dataset.")
            raw_export_names = export_dataset.get("class_names") or {}
            if isinstance(raw_export_names, dict):
                try:
                    export_names = [str(raw_export_names[key]) for key in sorted(raw_export_names, key=lambda value: int(value))]
                except (TypeError, ValueError):
                    export_names = []
            elif isinstance(raw_export_names, list):
                export_names = [str(value) for value in raw_export_names]
            else:
                export_names = []
            if export_names != catalog_item["labels"]:
                raise ValueError("Ultralytics class names changed between inspection and export. Inspect the dataset again.")
            if not records or not any(item["split"] == "train" for item in records):
                raise ValueError("No labeled training images with valid bounding boxes were found.")

            total = len(records)
            with ThreadPoolExecutor(max_workers=min(PLATFORM_IMAGE_DOWNLOAD_WORKERS, total)) as executor:
                completed = 0
                for batch_start in range(0, total, 32):
                    raise_if_cancelled(repo, job_id)
                    batch = records[batch_start:batch_start + 32]
                    for _ in executor.map(lambda item: _download_platform_image(item, staging_dir), batch):
                        completed += 1
                        if completed == total or completed % max(1, total // 100) == 0:
                            repo.update_job(job_id, progress=5 + int(completed / total * 90), message=f"Downloading labeled images {completed}/{total}")
            manifest = {
                "status": "verified",
                "dataset_key": dataset_key,
                "provider": "ultralytics_platform",
                "dataset": dataset,
                "export_version": export_payload.get("version", export_dataset.get("version") if export_dataset else None),
                "export_sha256": export_hash,
                "downloaded_image_count": total,
                "source_url": catalog_item["source_url"],
            }
            export_path.unlink(missing_ok=True)
            resume_path.unlink(missing_ok=True)
            (staging_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
            if cache_dir.exists():
                shutil.rmtree(cache_dir)
            cache_dir.parent.mkdir(parents=True, exist_ok=True)
            staging_dir.rename(cache_dir)
            return {item["key"]: item for item in list_open_data_catalog(repo.paths)}[dataset_key]
        except (ConnectionError, PermissionError):
            raise
        except Exception:
            shutil.rmtree(staging_dir, ignore_errors=True)
            raise


def _download_visdrone_locked(
    repo: Repository,
    job_id: str,
    cache_dir: Path,
    downloads_dir: Path,
    staging_dir: Path,
    hashes: dict[str, str],
) -> dict[str, Any]:
    from .job_control import raise_if_cancelled

    try:
        for archive_index, archive_name in enumerate(VISDRONE_ARCHIVES):
            raise_if_cancelled(repo, job_id)
            partial_path = downloads_dir / f"{archive_name}.part"
            existing = partial_path.stat().st_size if partial_path.exists() else 0
            request = urllib.request.Request(f"{VISDRONE_ASSETS_URL}/{archive_name}")
            if existing:
                request.add_header("Range", f"bytes={existing}-")
            try:
                response = urllib.request.urlopen(request, timeout=120)
            except HTTPError as exc:
                if not (existing and exc.code == 416):
                    raise
                response = None
            if response is not None:
                with response:
                    append = existing > 0 and getattr(response, "status", None) == 206
                    if not append:
                        existing = 0
                    content_length = int(response.headers.get("Content-Length", "0") or 0)
                    expected = existing + content_length
                    with partial_path.open("ab" if append else "wb") as output:
                        downloaded = existing
                        while chunk := response.read(1024 * 1024):
                            raise_if_cancelled(repo, job_id)
                            output.write(chunk)
                            downloaded += len(chunk)
                            within = downloaded / expected if expected else 0
                            progress = int(((archive_index + within) / len(VISDRONE_ARCHIVES)) * 70)
                            repo.update_job(job_id, progress=max(1, min(69, progress)), message=f"Downloading {archive_name} · {downloaded // (1024 * 1024)} MB")
            digest_builder = hashlib.sha256()
            with partial_path.open("rb") as downloaded_archive:
                while chunk := downloaded_archive.read(1024 * 1024):
                    digest_builder.update(chunk)
            digest = digest_builder.hexdigest()
            with zipfile.ZipFile(partial_path) as archive:
                corrupt = archive.testzip()
                if corrupt:
                    raise ValueError(f"Archive integrity check failed: {archive_name}/{corrupt}")
                _safe_extract(archive, staging_dir)
            hashes[archive_name] = digest
            repo.update_job(job_id, progress=70 + int((archive_index + 1) / len(VISDRONE_ARCHIVES) * 25), message=f"Verified and extracted {archive_name}")
        (staging_dir / "manifest.json").write_text(json.dumps({"status": "verified", "dataset_key": "visdrone2019-det", "sha256": hashes}, indent=2, sort_keys=True), encoding="utf-8")
        if cache_dir.exists():
            shutil.rmtree(cache_dir)
        staging_dir.rename(cache_dir)
        return list_open_data_catalog(repo.paths)[0]
    finally:
        # Partial downloads intentionally remain resumable; staging is disposable.
        if staging_dir.exists() and not cache_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)


def _visdrone_source_root(cache_dir: Path, split: str) -> Path:
    return cache_dir / f"VisDrone2019-DET-{split}"


def _mapped_visdrone_item(
    annotation_path: Path,
    image_path: Path,
    split: str,
    mapping: dict[str, int | None],
    target_classes: dict[int, str],
) -> dict[str, Any] | None:
    annotations: list[dict[str, Any]] = []
    with Image.open(image_path) as image:
        image_width, image_height = image.size
    if image_width <= 0 or image_height <= 0:
        return None
    for raw_line in annotation_path.read_text(encoding="utf-8").splitlines():
        row = [part.strip() for part in raw_line.split(",")]
        if len(row) < 6 or row[4] == "0":
            continue
        source_index = int(row[5]) - 1
        if source_index < 0 or source_index >= len(VISDRONE_LABELS):
            continue
        target_id = mapping[VISDRONE_LABELS[source_index]]
        if target_id is None:
            continue
        x, y, width, height = (float(value) for value in row[:4])
        x1, y1 = max(0.0, x), max(0.0, y)
        x2, y2 = min(float(image_width), x + width), min(float(image_height), y + height)
        width, height = x2 - x1, y2 - y1
        if width <= 0 or height <= 0:
            continue
        annotations.append(
            {
                "class_id": target_id,
                "class_name": target_classes[target_id],
                "x_center": (x1 + width / 2) / image_width,
                "y_center": (y1 + height / 2) / image_height,
                "width": width / image_width,
                "height": height / image_height,
                "source_type": "open_data",
                "source_descriptor": VISDRONE_LABELS[source_index],
            }
        )
    if not annotations:
        return None
    return {"image_path": image_path, "split": split, "storage_split": split, "annotations": annotations}


def _build_visdrone_plan(
    repo: Repository,
    project_id: str,
    schema_id: str,
    mapping: dict[str, int | None],
    sample_percentage: int,
    seed: int,
    preview_seed: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    project = repo.get_project(project_id)
    schema = repo.get_class_schema(schema_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    if not schema or schema["project_id"] != project_id:
        raise FileNotFoundError(f"Class schema not found: {schema_id}")
    if set(mapping) != set(VISDRONE_LABELS):
        missing = sorted(set(VISDRONE_LABELS) - set(mapping))
        raise ValueError(f"Every source label must be mapped or ignored; unresolved: {', '.join(missing)}")
    target_classes = {int(item["class_id"]): str(item["class_name"]) for item in schema["classes"]}
    unknown_targets = sorted({value for value in mapping.values() if value is not None and value not in target_classes})
    if unknown_targets:
        raise ValueError(f"Mapping contains unknown target class ids: {unknown_targets}")
    if sample_percentage < 1 or sample_percentage > 100:
        raise ValueError("Sample percentage must be between 1 and 100")

    cache_dir = repo.paths.open_data_dir / "visdrone2019-det"
    if not list_open_data_catalog(repo.paths)[0]["downloaded"]:
        raise FileNotFoundError("VisDrone2019-DET is not downloaded and verified")
    eligible: dict[str, list[dict[str, Any]]] = {"train": [], "val": []}
    source_count = 0
    for split in ("train", "val"):
        source_root = _visdrone_source_root(cache_dir, split)
        for annotation_path in sorted((source_root / "annotations").glob("*.txt")):
            source_count += 1
            image_path = source_root / "images" / f"{annotation_path.stem}.jpg"
            if not image_path.is_file():
                continue
            item = _mapped_visdrone_item(annotation_path, image_path, split, mapping, target_classes)
            if item:
                eligible[split].append(item)

    selected: list[dict[str, Any]] = []
    selected_by_split: dict[str, int] = {}
    for split, items in eligible.items():
        shuffled = list(items)
        random.Random(f"{seed}:{split}").shuffle(shuffled)
        count = min(len(shuffled), math.ceil(len(shuffled) * sample_percentage / 100))
        selected.extend(shuffled[:count])
        selected_by_split[split] = count

    target_class_counts = {name: 0 for name in target_classes.values()}
    for item in selected:
        for annotation in item["annotations"]:
            target_class_counts[annotation["class_name"]] += 1
    target_class_counts = {key: value for key, value in target_class_counts.items() if value}
    summary = {
        "dataset_key": "visdrone2019-det",
        "schema_id": schema_id,
        "schema_name": schema["name"],
        "sample_percentage": sample_percentage,
        "seed": seed,
        "source_image_count": source_count,
        "eligible_image_count": sum(len(items) for items in eligible.values()),
        "excluded_empty_count": source_count - sum(len(items) for items in eligible.values()),
        "selected_image_count": len(selected),
        "selected_annotation_count": sum(len(item["annotations"]) for item in selected),
        "selected_by_split": selected_by_split,
        "target_class_counts": target_class_counts,
        "samples": [
            {
                "file_name": Path(item["image_path"]).name,
                "split": item["split"],
                "image_url": f"/api/open-data/files/visdrone2019-det/{item['split']}/{Path(item['image_path']).name}",
                "annotations": item["annotations"],
            }
            for item in random.Random(preview_seed if preview_seed is not None else seed).sample(selected, min(6, len(selected)))
        ],
    }
    return selected, summary


def _platform_cache_metadata(repo: Repository, dataset_key: str) -> tuple[Path, dict[str, Any], list[str]]:
    cache_dir = _cache_dir(repo.paths, dataset_key)
    manifest_path = cache_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError("This Ultralytics dataset is not downloaded and verified.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("The cached Ultralytics dataset manifest is invalid. Download it again.") from exc
    dataset = manifest.get("dataset")
    if manifest.get("status") != "verified" or not isinstance(dataset, dict):
        raise ValueError("The cached Ultralytics dataset is incomplete. Download it again.")
    labels = [str(value) for value in (dataset.get("classNames") or [])]
    if not labels:
        raise ValueError("The cached Ultralytics dataset has no source classes.")
    return cache_dir, dataset, labels


def _mapped_platform_item(
    label_path: Path,
    image_path: Path,
    split: str,
    source_labels: list[str],
    mapping: dict[str, int | None],
    target_classes: dict[int, str],
) -> dict[str, Any] | None:
    annotations: list[dict[str, Any]] = []
    for raw_line in label_path.read_text(encoding="utf-8").splitlines():
        parts = raw_line.split()
        if len(parts) != 5:
            continue
        try:
            source_index = int(parts[0])
            x_center, y_center, width, height = (float(value) for value in parts[1:])
        except (TypeError, ValueError):
            continue
        if source_index < 0 or source_index >= len(source_labels) or width <= 0 or height <= 0:
            continue
        source_label = source_labels[source_index]
        target_id = mapping[source_label]
        if target_id is None:
            continue
        annotations.append({
            "class_id": target_id,
            "class_name": target_classes[target_id],
            "x_center": x_center,
            "y_center": y_center,
            "width": width,
            "height": height,
            "source_type": "open_data",
            "source_descriptor": source_label,
        })
    if not annotations:
        return None
    return {"image_path": image_path, "split": split, "storage_split": split, "annotations": annotations}


def _build_platform_plan(
    repo: Repository,
    project_id: str,
    dataset_key: str,
    schema_id: str,
    mapping: dict[str, int | None],
    sample_percentage: int,
    seed: int,
    preview_seed: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    project = repo.get_project(project_id)
    schema = repo.get_class_schema(schema_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    if not schema or schema["project_id"] != project_id:
        raise FileNotFoundError(f"Class schema not found: {schema_id}")
    cache_dir, dataset, source_labels = _platform_cache_metadata(repo, dataset_key)
    if set(mapping) != set(source_labels):
        missing = sorted(set(source_labels) - set(mapping))
        raise ValueError(f"Every source label must be mapped or ignored; unresolved: {', '.join(missing)}")
    target_classes = {int(item["class_id"]): str(item["class_name"]) for item in schema["classes"]}
    unknown_targets = sorted({value for value in mapping.values() if value is not None and value not in target_classes})
    if unknown_targets:
        raise ValueError(f"Mapping contains unknown target class ids: {unknown_targets}")
    if sample_percentage < 1 or sample_percentage > 100:
        raise ValueError("Sample percentage must be between 1 and 100")

    eligible: dict[str, list[dict[str, Any]]] = {"train": [], "val": []}
    source_count = 0
    for split in ("train", "val"):
        label_dir = cache_dir / "labels" / split
        image_dir = cache_dir / "images" / split
        if not label_dir.is_dir():
            continue
        for label_path in sorted(label_dir.glob("*.txt")):
            source_count += 1
            image_candidates = sorted(image_dir.glob(f"{label_path.stem}.*"))
            if not image_candidates:
                continue
            item = _mapped_platform_item(label_path, image_candidates[0], split, source_labels, mapping, target_classes)
            if item:
                eligible[split].append(item)

    selected_by_split: dict[str, int] = {}
    selected: list[dict[str, Any]] = []
    has_official_val = bool(eligible["val"])
    for split, items in eligible.items():
        if split == "val" and not items:
            continue
        shuffled = list(items)
        random.Random(f"{seed}:{split}").shuffle(shuffled)
        count = min(len(shuffled), math.ceil(len(shuffled) * sample_percentage / 100))
        chosen = shuffled[:count]
        selected.extend(chosen)
        selected_by_split[split] = len(chosen)
    split_policy = "official_train_val"
    if selected and not has_official_val:
        if len(selected) < 2:
            raise ValueError("At least two eligible images are required when the source has no validation split.")
        fallback_count = max(1, round(len(selected) * 0.1))
        fallback_count = min(fallback_count, len(selected) - 1)
        for item in selected[-fallback_count:]:
            item["split"] = "val"
        selected_by_split = {"train": len(selected) - fallback_count, "val": fallback_count}
        split_policy = "deterministic_90_10_fallback"

    target_class_counts = {name: 0 for name in target_classes.values()}
    for item in selected:
        for annotation in item["annotations"]:
            target_class_counts[annotation["class_name"]] += 1
    target_class_counts = {key: value for key, value in target_class_counts.items() if value}
    owner, slug = _platform_identity(dataset_key)
    summary = {
        "dataset_key": dataset_key,
        "dataset_name": str(dataset.get("name") or slug),
        "schema_id": schema_id,
        "schema_name": schema["name"],
        "sample_percentage": sample_percentage,
        "seed": seed,
        "source_image_count": source_count,
        "eligible_image_count": sum(len(items) for items in eligible.values()),
        "excluded_empty_count": source_count - sum(len(items) for items in eligible.values()),
        "selected_image_count": len(selected),
        "selected_annotation_count": sum(len(item["annotations"]) for item in selected),
        "selected_by_split": selected_by_split,
        "split_policy": split_policy,
        "target_class_counts": target_class_counts,
        "samples": [
            {
                "file_name": Path(item["image_path"]).name,
                "split": item["split"],
                "image_url": f"/api/open-data/files/{dataset_key}/{item['storage_split']}/{Path(item['image_path']).name}",
                "annotations": item["annotations"],
            }
            for item in random.Random(preview_seed if preview_seed is not None else seed).sample(selected, min(6, len(selected)))
        ],
        "source_owner": owner,
    }
    return selected, summary


def build_open_data_preview(
    repo: Repository,
    project_id: str,
    dataset_key: str,
    schema_id: str,
    mapping: dict[str, int | None],
    sample_percentage: int,
    seed: int = 42,
    preview_seed: int | None = None,
) -> dict[str, Any]:
    if dataset_key == "visdrone2019-det":
        _, summary = _build_visdrone_plan(repo, project_id, schema_id, mapping, sample_percentage, seed, preview_seed)
    else:
        _, summary = _build_platform_plan(repo, project_id, dataset_key, schema_id, mapping, sample_percentage, seed, preview_seed)
    return summary


def publish_open_data_import(
    repo: Repository,
    project_id: str,
    dataset_key: str,
    schema_id: str,
    mapping: dict[str, int | None],
    sample_percentage: int,
    seed: int = 42,
    version_name: str | None = None,
    *,
    job_id: str,
) -> dict[str, Any]:
    if dataset_key == "visdrone2019-det":
        selected, summary = _build_visdrone_plan(repo, project_id, schema_id, mapping, sample_percentage, seed)
    else:
        selected, summary = _build_platform_plan(repo, project_id, dataset_key, schema_id, mapping, sample_percentage, seed)
    if not selected:
        raise ValueError("No Open Data images remain after class mapping")
    project = repo.get_project(project_id)
    assert project is not None
    import_id = new_id()
    resolved_version_name = (version_name or "").strip() or versioned_artifact_name(
        "OpenData", (item.get("version_name") or "" for item in repo.list_open_data_imports(project_id))
    )
    open_data_root = Path(project["root_path"]) / "opendata"
    source_link = open_data_root / hashlib.sha256(dataset_key.encode("utf-8")).hexdigest()[:16]
    open_data_root.mkdir(parents=True, exist_ok=True)
    if not source_link.exists() and not source_link.is_symlink():
        source_link.symlink_to(_cache_dir(repo.paths, dataset_key), target_is_directory=True)
    staging_dir = open_data_root / "imports" / f".{import_id}.staging"
    final_dir = open_data_root / "imports" / import_id
    registered: list[dict[str, Any]] = []
    try:
        total = max(1, len(selected))
        for index, item in enumerate(selected):
            source_path = Path(item["image_path"])
            split = str(item["split"])
            safe_dataset = re.sub(r"[^a-zA-Z0-9_-]+", "_", dataset_key)[:80]
            unique_name = f"{safe_dataset}_{split}_{source_path.name}"
            linked_path = staging_dir / "images" / split / unique_name
            linked_path.parent.mkdir(parents=True, exist_ok=True)
            linked_path.symlink_to(source_path)
            label_path = staging_dir / "labels" / split / f"{Path(unique_name).stem}.txt"
            write_yolo_labels(label_path, [
                AnnotationRow(
                    class_id=int(annotation["class_id"]),
                    x_center=float(annotation["x_center"]),
                    y_center=float(annotation["y_center"]),
                    width=float(annotation["width"]),
                    height=float(annotation["height"]),
                )
                for annotation in item["annotations"]
            ])
            with Image.open(source_path) as image:
                width, height = image.size
            registered.append({
                "path": str(final_dir / "images" / split / unique_name),
                "source_key": source_path.stem,
                "split": split,
                "width": width,
                "height": height,
                "annotations": item["annotations"],
            })
            if index % 100 == 0 or index + 1 == len(selected):
                repo.update_job(job_id, progress=min(90, int((index + 1) / total * 90)), message=f"Preparing Open Data {index + 1}/{len(selected)}")
        (staging_dir / "manifest.json").write_text(json.dumps({**summary, "mapping": mapping}, indent=2, sort_keys=True), encoding="utf-8")
        final_dir.parent.mkdir(parents=True, exist_ok=True)
        staging_dir.rename(final_dir)
        result, _ = repo.replace_active_open_data_import(
            import_id=import_id,
            project_id=project_id,
            dataset_key=dataset_key,
            version_name=resolved_version_name,
            schema_id=schema_id,
            mapping=mapping,
            sample_percentage=sample_percentage,
            random_seed=seed,
            project_dir=str(final_dir),
            summary=summary,
            images=registered,
            job_id=job_id,
        )
        return {**result, **summary}
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        active = repo.get_active_open_data_import(project_id)
        if final_dir.exists() and (active is None or active.get("id") != import_id):
            shutil.rmtree(final_dir, ignore_errors=True)
        raise


def remove_project_import_files(repo: Repository, project_id: str, project_dir: str) -> None:
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    root = (Path(project["root_path"]) / "opendata" / "imports").resolve()
    target = Path(project_dir).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("Unsafe Open Data import path") from exc
    if target != root and target.exists():
        shutil.rmtree(target)
