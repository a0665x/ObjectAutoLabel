from pathlib import Path
from datetime import datetime
from io import BytesIO
import hashlib
import json
import zipfile
from urllib.error import HTTPError

from PIL import Image
import pytest

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.open_data import (
    _parse_platform_dataset_url,
    _normalized_platform_boxes,
    _safe_extract,
    build_open_data_preview,
    download_ultralytics_dataset,
    inspect_ultralytics_dataset,
    list_open_data_catalog,
    publish_open_data_import,
)
from backend.app.project_services import create_dataset_split, create_image_augmentation_run, list_dataset_split_samples, save_image_annotations
from backend.app.repositories import Repository


class FakeHttpResponse(BytesIO):
    def __init__(self, payload: bytes, headers: dict[str, str] | None = None) -> None:
        super().__init__(payload)
        self.headers = headers or {}


def _jpeg_bytes() -> bytes:
    stream = BytesIO()
    Image.new("RGB", (16, 16), "white").save(stream, format="JPEG")
    return stream.getvalue()


def test_platform_download_recovers_when_one_image_connection_times_out_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    paths = AppPaths(project_root=tmp_path)
    repo = Repository(connect(tmp_path / "test.db"), paths)
    initialize_schema(repo.db)
    project = repo.create_project("Retry Platform")
    job = repo.create_job("open_data_download", project_id=project["id"])
    dataset = {
        "owner": "acme", "dataset": "roads", "name": "Roads", "task": "detect",
        "imageCount": 1, "classNames": ["car"], "splits": {"train": 1, "val": 0},
    }
    ndjson = "\n".join([
        json.dumps({"type": "dataset", "task": "detect", "class_names": {"0": "car"}}),
        json.dumps({
            "type": "image", "file": "M0704_img000550.jpg",
            "url": "https://storage.googleapis.com/example/M0704_img000550.jpg",
            "split": "train", "annotations": {"boxes": [[0, 0.5, 0.5, 0.2, 0.2]]},
        }),
    ]).encode()
    image_attempts = 0

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        nonlocal image_attempts
        url = request.full_url
        if url.endswith("/api/datasets/acme/roads"):
            return FakeHttpResponse(json.dumps({"dataset": dataset}).encode())
        if url.endswith("/api/datasets/acme/roads/export"):
            return FakeHttpResponse(json.dumps({"downloadUrl": "https://storage.googleapis.com/example/dataset.ndjson"}).encode())
        if url.endswith("dataset.ndjson"):
            return FakeHttpResponse(ndjson)
        image_attempts += 1
        if image_attempts == 1:
            raise TimeoutError("timed out")
        return FakeHttpResponse(_jpeg_bytes(), {"Content-Length": str(len(_jpeg_bytes()))})

    monkeypatch.setattr("backend.app.open_data.urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda _seconds: None)

    result = download_ultralytics_dataset(
        repo, "ultralytics:acme:roads", "ul_test", job_id=job["id"]
    )

    assert result["downloaded"] is True
    assert image_attempts == 2
    assert len(list((paths.open_data_dir / "ultralytics" / "acme" / "roads" / "images" / "train").glob("*M0704_img000550.jpg"))) == 1


def test_platform_download_resumes_verified_images_from_a_matching_staging_export(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    paths = AppPaths(project_root=tmp_path)
    repo = Repository(connect(tmp_path / "test.db"), paths)
    initialize_schema(repo.db)
    project = repo.create_project("Resume Platform")
    job = repo.create_job("open_data_download", project_id=project["id"])
    dataset = {
        "owner": "acme", "dataset": "roads", "name": "Roads", "task": "detect",
        "imageCount": 1, "classNames": ["car"], "splits": {"train": 1, "val": 0},
    }
    ndjson = "\n".join([
        json.dumps({"type": "dataset", "task": "detect", "class_names": {"0": "car"}}),
        json.dumps({
            "type": "image", "file": "M0704_img000550.jpg",
            "url": "https://storage.googleapis.com/example/M0704_img000550.jpg",
            "split": "train", "annotations": {"boxes": [[0, 0.5, 0.5, 0.2, 0.2]]},
        }),
    ]).encode()
    staging = paths.open_data_dir / "ultralytics" / "acme" / ".roads.staging"
    staged_image = staging / "images" / "train" / "00000000_M0704_img000550.jpg"
    staged_label = staging / "labels" / "train" / "00000000_M0704_img000550.txt"
    staged_image.parent.mkdir(parents=True)
    staged_label.parent.mkdir(parents=True)
    staged_image.write_bytes(_jpeg_bytes())
    staged_label.write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")
    (staging / ".resume.json").write_text(
        json.dumps({"export_sha256": hashlib.sha256(ndjson).hexdigest()}), encoding="utf-8"
    )
    image_requests = 0

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        nonlocal image_requests
        url = request.full_url
        if url.endswith("/api/datasets/acme/roads"):
            return FakeHttpResponse(json.dumps({"dataset": dataset}).encode())
        if url.endswith("/api/datasets/acme/roads/export"):
            return FakeHttpResponse(json.dumps({"downloadUrl": "https://storage.googleapis.com/example/dataset.ndjson"}).encode())
        if url.endswith("dataset.ndjson"):
            return FakeHttpResponse(ndjson)
        image_requests += 1
        raise TimeoutError("completed staged image should not be fetched again")

    monkeypatch.setattr("backend.app.open_data.urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda _seconds: None)

    result = download_ultralytics_dataset(
        repo, "ultralytics:acme:roads", "ul_test", job_id=job["id"]
    )

    assert result["downloaded"] is True
    assert image_requests == 0


def test_platform_download_reports_an_expired_signed_image_url_without_retrying(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    paths = AppPaths(project_root=tmp_path)
    repo = Repository(connect(tmp_path / "test.db"), paths)
    initialize_schema(repo.db)
    project = repo.create_project("Expired Platform URL")
    job = repo.create_job("open_data_download", project_id=project["id"])
    dataset = {
        "owner": "acme", "dataset": "roads", "name": "Roads", "task": "detect",
        "imageCount": 1, "classNames": ["car"], "splits": {"train": 1, "val": 0},
    }
    ndjson = "\n".join([
        json.dumps({"type": "dataset", "task": "detect", "class_names": {"0": "car"}}),
        json.dumps({
            "type": "image", "file": "expired.jpg",
            "url": "https://storage.googleapis.com/example/expired.jpg",
            "split": "train", "annotations": {"boxes": [[0, 0.5, 0.5, 0.2, 0.2]]},
        }),
    ]).encode()
    image_attempts = 0

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        nonlocal image_attempts
        url = request.full_url
        if url.endswith("/api/datasets/acme/roads"):
            return FakeHttpResponse(json.dumps({"dataset": dataset}).encode())
        if url.endswith("/api/datasets/acme/roads/export"):
            return FakeHttpResponse(json.dumps({"downloadUrl": "https://storage.googleapis.com/example/dataset.ndjson"}).encode())
        if url.endswith("dataset.ndjson"):
            return FakeHttpResponse(ndjson)
        image_attempts += 1
        raise HTTPError(url, 403, "Forbidden", {}, None)

    monkeypatch.setattr("backend.app.open_data.urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda _seconds: None)

    with pytest.raises(PermissionError, match="signed image URL.*expired"):
        download_ultralytics_dataset(
            repo, "ultralytics:acme:roads", "ul_test", job_id=job["id"]
        )

    assert image_attempts == 1
    assert (paths.open_data_dir / "ultralytics" / "acme" / ".roads.staging").is_dir()


def test_catalog_reports_supported_labels_and_shared_cache_state(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)

    missing = list_open_data_catalog(paths)[0]
    assert missing["key"] == "visdrone2019-det"
    assert missing["labels"] == [
        "pedestrian", "people", "bicycle", "car", "van", "truck",
        "tricycle", "awning-tricycle", "bus", "motor",
    ]
    assert missing["downloaded"] is False

    cache = paths.open_data_dir / "visdrone2019-det"
    cache.mkdir(parents=True)
    for split in ("train", "val"):
        (cache / f"VisDrone2019-DET-{split}" / "images").mkdir(parents=True)
        (cache / f"VisDrone2019-DET-{split}" / "annotations").mkdir(parents=True)
    (cache / "manifest.json").write_text('{"status":"verified"}', encoding="utf-8")

    downloaded = list_open_data_catalog(paths)[0]
    assert downloaded["downloaded"] is True
    assert downloaded["status"] == "verified"


def test_open_data_archive_rejects_path_traversal(tmp_path: Path) -> None:
    archive_path = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("../escape.txt", "unsafe")

    with zipfile.ZipFile(archive_path) as archive, pytest.raises(ValueError, match="Unsafe archive member"):
        _safe_extract(archive, tmp_path / "extract")

    assert not (tmp_path / "escape.txt").exists()


def test_inspect_platform_dataset_accepts_only_dataset_urls_and_gates_non_detect(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    assert _parse_platform_dataset_url("https://platform.ultralytics.com/acme/datasets/road-small") == ("acme", "road-small")
    assert _parse_platform_dataset_url("ul://acme/datasets/road-small") == ("acme", "road-small")
    with pytest.raises(ValueError, match="platform.ultralytics.com"):
        _parse_platform_dataset_url("https://example.com/acme/datasets/road-small")

    monkeypatch.setattr("backend.app.open_data._platform_json", lambda *_args, **_kwargs: {"dataset": {
        "owner": "ultralytics", "dataset": "vsai", "name": "VSAI", "task": "obb",
        "imageCount": 444, "classNames": ["small-vehicle", "large-vehicle"],
        "splits": {"train": 256, "val": 73, "test": 115}, "format": "yolo",
    }})
    inspected = inspect_ultralytics_dataset(AppPaths(project_root=tmp_path), "https://platform.ultralytics.com/ultralytics/datasets/vsai")
    assert inspected["key"] == "ultralytics:ultralytics:vsai"
    assert inspected["compatible"] is False
    assert "OBB" in inspected["compatibility_reason"]


def test_platform_box_normalization_rejects_other_tasks_and_clips_edges() -> None:
    record = {"annotations": {"boxes": [[0, 0.95, 0.5, 0.2, 0.4], [2, 0.5, 0.5, 0.2, 0.2]], "obb": [[0, 0, 0, 1, 0, 1, 1, 0, 1]]}}
    boxes = _normalized_platform_boxes(record, 1)
    assert len(boxes) == 1
    assert boxes[0] == pytest.approx((0, 0.925, 0.5, 0.15, 0.4))


def _write_platform_cache(paths: AppPaths, owner: str, slug: str, labels: list[str]) -> str:
    key = f"ultralytics:{owner}:{slug}"
    cache = paths.open_data_dir / "ultralytics" / owner / slug
    for split in ("train", "val"):
        (cache / "images" / split).mkdir(parents=True, exist_ok=True)
        (cache / "labels" / split).mkdir(parents=True, exist_ok=True)
    dataset = {
        "owner": owner, "dataset": slug, "name": "UAVDT", "task": "detect", "format": "yolo",
        "imageCount": 4, "classNames": labels, "splits": {"train": 4, "val": 0, "test": 0},
    }
    (cache / "manifest.json").write_text(__import__("json").dumps({"status": "verified", "dataset_key": key, "dataset": dataset}), encoding="utf-8")
    for index in range(4):
        Image.new("RGB", (100, 80), "white").save(cache / "images" / "train" / f"{index}.jpg")
        (cache / "labels" / "train" / f"{index}.txt").write_text("1 0.5 0.5 0.2 0.2\n2 0.4 0.4 0.1 0.1", encoding="utf-8")
    return key


def test_platform_detect_cache_reuses_mapping_review_and_split_with_val_fallback(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    repo = Repository(connect(tmp_path / "test.db"), paths)
    initialize_schema(repo.db)
    project = repo.create_project("Platform")
    schema = repo.create_class_schema(project["id"], "vehicles", [{"class_id": 0, "class_name": "car", "descriptors": ["vehicle"]}])
    key = _write_platform_cache(paths, "ultralytics", "uavdt", ["bus", "car", "truck"])
    mapping = {"bus": 0, "car": 0, "truck": 0}

    preview = build_open_data_preview(repo, project["id"], key, schema["id"], mapping, 100, 42)

    assert preview["selected_image_count"] == 4
    assert preview["selected_annotation_count"] == 8
    assert preview["selected_by_split"] == {"train": 3, "val": 1}
    assert preview["split_policy"] == "deterministic_90_10_fallback"
    assert {item["split"] for item in preview["samples"]} == {"train", "val"}
    assert "/train/" in next(item["image_url"] for item in preview["samples"] if item["split"] == "val")

    published = publish_open_data_import(repo, project["id"], key, schema["id"], mapping, 100, 42, "UAVDT-all", job_id="job-platform")
    imported = repo.list_images(project["id"], source_origin="open_data", limit=100)
    assert published["dataset_key"] == key
    assert {item["source_split"] for item in imported} == {"train", "val"}
    assert all(Path(item["path"]).is_symlink() for item in imported)
    split = create_dataset_split(repo, project["id"], "platform-current", 0.8, 0.1, 0.1, open_data_import_id=published["id"], job_id="job-platform-split")
    buckets = __import__("json").loads(split["image_ids_json"])
    by_id = {item["id"]: item for item in imported}
    assert {by_id[image_id]["source_split"] for image_id in buckets["train"]} == {"train"}
    assert {by_id[image_id]["source_split"] for image_id in buckets["valid"]} == {"val"}


def _write_visdrone_item(root: Path, split: str, name: str, rows: list[str]) -> None:
    source = root / f"VisDrone2019-DET-{split}"
    (source / "images").mkdir(parents=True, exist_ok=True)
    (source / "annotations").mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (100, 80), "white").save(source / "images" / f"{name}.jpg")
    (source / "annotations" / f"{name}.txt").write_text("\n".join(rows), encoding="utf-8")


def _mark_cache_verified(root: Path) -> None:
    for split in ("train", "val"):
        (root / f"VisDrone2019-DET-{split}" / "images").mkdir(parents=True, exist_ok=True)
        (root / f"VisDrone2019-DET-{split}" / "annotations").mkdir(parents=True, exist_ok=True)
    (root / "manifest.json").write_text('{"status":"verified"}', encoding="utf-8")


def test_preview_maps_first_then_samples_each_official_split(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    repo = Repository(connect(tmp_path / "test.db"), paths)
    initialize_schema(repo.db)
    project = repo.create_project("Aerial")
    schema = repo.create_class_schema(project["id"], "people-car", [
        {"class_id": 0, "class_name": "people", "descriptors": ["person"]},
        {"class_id": 1, "class_name": "car", "descriptors": ["car"]},
    ])
    cache = paths.open_data_dir / "visdrone2019-det"
    _mark_cache_verified(cache)
    for split, count in (("train", 4), ("val", 2)):
        for index in range(count):
            _write_visdrone_item(cache, split, f"{split}-{index}", [
                "10,10,20,20,1,1,0,0",  # pedestrian -> people
                "30,20,20,20,1,4,0,0",  # car -> car
            ])
    _write_visdrone_item(cache, "train", "ignored-only", ["1,1,5,5,1,3,0,0"])
    mapping = {name: None for name in list_open_data_catalog(paths)[0]["labels"]}
    mapping.update({"pedestrian": 0, "car": 1})

    preview = build_open_data_preview(repo, project["id"], "visdrone2019-det", schema["id"], mapping, 50, 42)

    assert preview["eligible_image_count"] == 6
    assert preview["excluded_empty_count"] == 1
    assert preview["selected_image_count"] == 3
    assert preview["selected_by_split"] == {"train": 2, "val": 1}
    assert preview["target_class_counts"] == {"people": 3, "car": 3}


def test_preview_seed_rerolls_only_visual_samples(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    repo = Repository(connect(tmp_path / "test.db"), paths)
    initialize_schema(repo.db)
    project = repo.create_project("Aerial")
    schema = repo.create_class_schema(project["id"], "people", [
        {"class_id": 0, "class_name": "people", "descriptors": ["person"]},
    ])
    cache = paths.open_data_dir / "visdrone2019-det"
    _mark_cache_verified(cache)
    for index in range(12):
        _write_visdrone_item(cache, "train", f"train-{index:02d}", ["10,10,20,20,1,1,0,0"])
    mapping = {name: None for name in list_open_data_catalog(paths)[0]["labels"]}
    mapping["pedestrian"] = 0

    first = build_open_data_preview(repo, project["id"], "visdrone2019-det", schema["id"], mapping, 100, 42, 10)
    second = build_open_data_preview(repo, project["id"], "visdrone2019-det", schema["id"], mapping, 100, 42, 11)

    assert first["selected_image_count"] == second["selected_image_count"] == 12
    assert [item["file_name"] for item in first["samples"]] != [item["file_name"] for item in second["samples"]]


def test_publish_creates_a_selectable_version_and_registers_review_images(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    repo = Repository(connect(tmp_path / "test.db"), paths)
    initialize_schema(repo.db)
    project = repo.create_project("Aerial")
    schema = repo.create_class_schema(project["id"], "people-car", [
        {"class_id": 0, "class_name": "people", "descriptors": ["person"]},
        {"class_id": 1, "class_name": "car", "descriptors": ["car"]},
    ])
    cache = paths.open_data_dir / "visdrone2019-det"
    _mark_cache_verified(cache)
    for index in range(2):
        _write_visdrone_item(cache, "train", f"train-{index}", ["10,10,20,20,1,1,0,0"])
    _write_visdrone_item(cache, "val", "val-0", ["30,20,20,20,1,4,0,0"])
    mapping = {name: None for name in list_open_data_catalog(paths)[0]["labels"]}
    mapping.update({"pedestrian": 0, "car": 1})

    published = publish_open_data_import(repo, project["id"], "visdrone2019-det", schema["id"], mapping, 100, 42, job_id="job-open")

    assert published["status"] == "active"
    assert published["version_name"] == f"OpenData_{datetime.now().strftime('%m%d')}_v001"
    assert published["selected_image_count"] == 3
    imported = repo.list_images(project["id"], source_origin="open_data", limit=100)
    assert len(imported) == 3
    assert {item["source_split"] for item in imported} == {"train", "val"}
    assert all(Path(item["path"]).is_symlink() for item in imported)
    assert {row["source_type"] for item in imported for row in repo.list_annotations(item["id"])} == {"open_data"}

    split = create_dataset_split(repo, project["id"], "current", 0.8, 0.1, 0.1, open_data_import_id=published["id"], job_id="job-split")
    buckets = __import__("json").loads(split["image_ids_json"])
    by_id = {item["id"]: item for item in imported}
    assert {by_id[image_id]["source_split"] for image_id in buckets["train"]} == {"train"}
    assert {by_id[image_id]["source_split"] for image_id in buckets["valid"]} == {"val"}
    assert buckets["test"] == []
    assert split["open_data_import_id"] == published["id"]
    assert split["is_current"] == 1

    first = imported[0]
    saved = save_image_annotations(repo, first["id"], repo.list_annotations(first["id"]), "reviewed")
    assert Path(saved["label_path"]).is_file()
    assert Path(saved["label_path"]).is_relative_to(Path(published["project_dir"]))
    assert repo.get_dataset_split(split["id"])["outdated"] is False

    changed = repo.list_annotations(first["id"])
    changed[0]["width"] = float(changed[0]["width"]) / 2
    save_image_annotations(repo, first["id"], changed, "reviewed")
    assert repo.get_dataset_split(split["id"])["outdated"] is True

    summary = repo.get_image_source_summary(project["id"])
    assert summary["images"] == {"open_data": 3}
    assert sum(summary["classes"]["open_data"].values()) == 3

    augmentation = create_image_augmentation_run(repo, project["id"], "project-only", skip_augment=True, job_id="job-augment")
    assert augmentation["source_images"] == 0

    second = publish_open_data_import(repo, project["id"], "visdrone2019-det", schema["id"], mapping, 50, 43, "VisDrone_half_v2", job_id="job-open-2")
    versions = repo.list_open_data_imports(project["id"])
    assert [(item["id"], item["status"]) for item in versions] == [(second["id"], "active"), (published["id"], "saved")]
    assert second["version_name"] == "VisDrone_half_v2"
    assert Path(published["project_dir"]).is_dir()
    assert {image["open_data_import_id"] for image in repo.list_images(project["id"], source_origin="open_data", limit=100)} == {second["id"]}

    saved_version_split = create_dataset_split(
        repo, project["id"], "saved-version", 0.8, 0.1, 0.1,
        open_data_import_id=published["id"], job_id="job-saved-version-split",
    )
    assert saved_version_split["open_data_import_id"] == published["id"]
    assert sum(len(bucket) for bucket in __import__("json").loads(saved_version_split["image_ids_json"]).values()) == 3
    sampled_names = {
        tuple(item["file_name"] for item in list_dataset_split_samples(repo, project["id"], saved_version_split["id"], 1, seed)["train"])
        for seed in range(12)
    }
    assert len(sampled_names) > 1
