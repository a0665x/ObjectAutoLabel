from pathlib import Path

import cv2
import numpy as np

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.project_services import (
    analyze_project_sources,
    browse_local_files,
    create_dataset_split,
    create_image_augmentation_run,
    list_augmentation_run_samples,
    list_augmentation_preview_samples,
    list_dataset_split_samples,
)
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_dataset_split_includes_pending_pseudo_labels_and_writes_yolo_labels(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("All Images Train")
    repo.create_class_schema(
        project_id=project["id"],
        name="aerial person car",
        classes=[
            {"class_id": 0, "class_name": "person", "descriptors": ["standing person"]},
            {"class_id": 1, "class_name": "car", "descriptors": ["aerial car"]},
        ],
    )
    image_path = tmp_path / "source.jpg"
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(image_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [
            {
                "class_id": 1,
                "class_name": "car",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.25,
                "height": 0.25,
                "confidence": 0.8,
                "source_descriptor": "aerial car",
                "source_type": "pseudo",
                "edited": False,
            }
        ],
        review_status="pending_review",
    )

    split = create_dataset_split(repo, project["id"], "all-data", 0.8, 0.1, 0.1, job_id="job-1")

    label_files = sorted(Path(split["output_dir"]).glob("**/labels/*.txt"))
    assert len(label_files) == 1
    assert label_files[0].read_text(encoding="utf-8").strip() == "1 0.500000 0.500000 0.250000 0.250000"
    assert "names:\n  0: person\n  1: car" in Path(split["dataset_yaml_path"]).read_text(encoding="utf-8")


def test_image_augmentation_copies_annotations_and_flips_bbox(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Augment")
    image_path = tmp_path / "source.jpg"
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(image_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [
            {
                "class_id": 0,
                "class_name": "person",
                "x_center": 0.25,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.3,
                "confidence": 0.9,
                "source_descriptor": "walking person",
                "source_type": "pseudo",
                "edited": False,
            }
        ],
        review_status="pending_review",
    )

    result = create_image_augmentation_run(
        repo,
        project["id"],
        name="flip-smoke",
        brightness=0,
        noise=0,
        blur=0,
        horizontal_flip=True,
        copies=1,
        job_id="job-2",
    )

    assert result["created_images"] == 1
    augmented = [item for item in repo.list_images(project["id"], limit=10) if item["id"] != image["id"]][0]
    annotations = repo.list_annotations(augmented["id"])
    assert annotations[0]["x_center"] == 0.75
    assert annotations[0]["source_type"] == "augmented"


def test_skip_augmentation_creates_passthrough_build_with_original_count_and_samples(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Skip Augment")
    image_path = tmp_path / "source.jpg"
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(image_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [
            {
                "class_id": 0,
                "class_name": "person",
                "x_center": 0.25,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.3,
                "confidence": 0.9,
                "source_descriptor": "walking person",
                "source_type": "pseudo",
                "edited": False,
            }
        ],
        review_status="pending_review",
    )

    result = create_image_augmentation_run(
        repo,
        project["id"],
        name="source-build",
        brightness=0,
        noise=0,
        blur=0,
        horizontal_flip=False,
        copies=3,
        skip_augment=True,
        job_id="job-skip",
    )

    assert result["source_images"] == 1
    assert result["created_images"] == 1
    assert result["skip_augment"] is True
    passthrough = [item for item in repo.list_images(project["id"], limit=10) if item["id"] != image["id"]][0]
    assert passthrough["augmentation_run_id"] == result["id"]
    annotations = repo.list_annotations(passthrough["id"])
    assert annotations[0]["x_center"] == 0.25
    assert annotations[0]["source_type"] == "source_passthrough"

    samples = list_augmentation_run_samples(repo, project["id"], result["id"], limit=1)
    assert len(samples) == 1
    assert samples[0]["file_name"].startswith("source")
    assert samples[0]["annotations"][0]["class_name"] == "person"


def test_augmentation_preview_samples_apply_transforms_and_keep_bboxes(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Augment Preview")
    image_path = tmp_path / "source.jpg"
    source = np.zeros((20, 30, 3), dtype=np.uint8)
    source[:, :10] = (10, 20, 30)
    source[:, 10:] = (40, 50, 60)
    cv2.imwrite(str(image_path), source)
    image = repo.create_image(project["id"], str(image_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [
            {
                "class_id": 0,
                "class_name": "person",
                "x_center": 0.25,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.3,
                "confidence": 0.9,
                "source_descriptor": "walking person",
                "source_type": "pseudo",
                "edited": False,
            }
        ],
        review_status="pending_review",
    )

    samples = list_augmentation_preview_samples(
        repo,
        project["id"],
        brightness=20,
        noise=0,
        blur=0,
        horizontal_flip=True,
        limit=1,
    )

    assert len(samples) == 1
    sample = samples[0]
    assert sample["file_name"] == "source.jpg"
    assert sample["preview_url"].startswith("data:image/jpeg;base64,")
    assert sample["width"] == 30
    assert sample["height"] == 20
    assert sample["annotations"] == [
        {"class_id": 0, "class_name": "person", "x_center": 0.75, "y_center": 0.5, "width": 0.2, "height": 0.3}
    ]


def test_dataset_split_samples_return_train_valid_test_images_with_bboxes(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Split Preview")
    repo.create_class_schema(
        project_id=project["id"],
        name="person car",
        classes=[{"class_id": 0, "class_name": "person", "descriptors": ["person"]}],
    )
    for index in range(5):
        image_path = tmp_path / f"source_{index}.jpg"
        cv2.imwrite(str(image_path), np.zeros((40, 80, 3), dtype=np.uint8))
        image = repo.create_image(project["id"], str(image_path), width=80, height=40)
        repo.replace_image_annotations(
            image["id"],
            [
                {
                    "class_id": 0,
                    "class_name": "person",
                    "x_center": 0.5,
                    "y_center": 0.25,
                    "width": 0.2,
                    "height": 0.3,
                    "confidence": 0.9,
                    "source_descriptor": "person",
                    "source_type": "pseudo",
                    "edited": False,
                }
            ],
            review_status="pending_review",
        )
    split = create_dataset_split(repo, project["id"], "preview", 0.6, 0.2, 0.2, job_id="job-3")

    samples = list_dataset_split_samples(repo, project["id"], split["id"], limit_per_bucket=2)

    assert set(samples) == {"train", "valid", "test"}
    assert len(samples["train"]) == 2
    assert len(samples["valid"]) == 1
    assert len(samples["test"]) == 1
    first = samples["train"][0]
    assert first["image_url"].startswith("/api/files?path=")
    assert first["bucket"] == "train"
    assert first["width"] == 80
    assert first["height"] == 40
    assert first["annotations"] == [
        {"class_id": 0, "class_name": "person", "x_center": 0.5, "y_center": 0.25, "width": 0.2, "height": 0.3}
    ]


def test_source_analysis_reports_counts_dimensions_and_extensions(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Source analysis")
    source = repo.create_source_asset(project["id"], "image_folder", str(tmp_path))
    image_path = tmp_path / "a.png"
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    repo.create_image(project["id"], str(image_path), width=30, height=20, source_asset_id=source["id"])

    analysis = analyze_project_sources(repo, project["id"], source["id"])

    assert analysis["image_count"] == 1
    assert analysis["min_width"] == 30
    assert analysis["max_height"] == 20
    assert analysis["extensions"] == {".png": 1}
    assert analysis["top_sizes"] == [("30×20", 1)]


def test_file_browser_marks_image_folders_and_video_files_selectable(tmp_path: Path) -> None:
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    cv2.imwrite(str(image_dir / "a.jpg"), np.zeros((10, 10, 3), dtype=np.uint8))
    (tmp_path / "clip.webm").write_bytes(b"fake")

    image_browser = browse_local_files(str(tmp_path), mode="image_folder")
    video_browser = browse_local_files(str(tmp_path), mode="video")

    image_entry = next(item for item in image_browser["entries"] if item["name"] == "images")
    video_entry = next(item for item in video_browser["entries"] if item["name"] == "clip.webm")
    assert image_entry["selectable"] is True
    assert image_entry["match_count"] == 1
    assert video_entry["selectable"] is True


def test_file_browser_returns_operator_shortcuts_and_default_root(tmp_path: Path) -> None:
    root = tmp_path / "autolabel"
    root.mkdir()
    raw_0629 = root / "0629"
    raw_0629.mkdir()
    cv2.imwrite(str(raw_0629 / "sample.png"), np.zeros((10, 10, 3), dtype=np.uint8))
    project_input = root / "ObjectAutoLabel" / "data" / "input" / "0629"
    project_input.mkdir(parents=True)
    cv2.imwrite(str(project_input / "sample.jpg"), np.zeros((10, 10, 3), dtype=np.uint8))

    browser = browse_local_files(None, mode="image_folder", preferred_roots=[root])

    assert browser["path"] == str(raw_0629)
    shortcut_labels = [shortcut["label"] for shortcut in browser["shortcuts"]]
    assert shortcut_labels[:3] == ["0629 raw data", "Project input/0629", "Autolabel workspace"]
    shortcut_0629 = browser["shortcuts"][0]
    assert shortcut_0629["path"] == str(raw_0629)
    assert shortcut_0629["exists"] is True
    assert shortcut_0629["match_count"] == 1
    assert browser["current_match_count"] == 1
