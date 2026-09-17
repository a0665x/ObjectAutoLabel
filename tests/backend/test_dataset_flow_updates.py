import json
from contextlib import contextmanager
from pathlib import Path
from threading import Event, Thread, current_thread

import cv2
import numpy as np
import pytest

from backend.app import project_services
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


def test_dataset_split_rejects_outdated_augmentation_before_files_or_records(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Stale Augment Split")
    augmentation = repo.create_augmentation_run_record(
        project_id=project["id"],
        pseudo_label_run_id=None,
        name="stale-source",
        output_dir=str(tmp_path / "augment"),
        settings_json="{}",
        source_image_count=0,
        created_image_count=0,
        source_image_ids=[],
    )
    repo.db.execute(
        "update augmentation_runs set outdated = 1, outdated_reason = ? where id = ?",
        ('{"code":"project_image_removed","image_ids":["image-1"]}', augmentation["id"]),
    )
    repo.db.commit()
    split_dir = Path(project["root_path"]) / "splits" / "must-not-exist"

    with pytest.raises(ValueError, match="Augmentation run is outdated; rebuild Augment before creating a split"):
        create_dataset_split(
            repo,
            project["id"],
            "must-not-exist",
            0.8,
            0.1,
            0.1,
            augmentation_run_id=augmentation["id"],
            job_id="job-must-not-exist",
        )

    assert split_dir.exists() is False
    assert repo.list_dataset_splits(project["id"]) == []


def test_dataset_split_without_an_augment_build_excludes_images_from_outdated_runs(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Current Sources Only")
    augmentation = repo.create_augmentation_run_record(
        project_id=project["id"],
        pseudo_label_run_id=None,
        name="stale-source",
        output_dir=str(tmp_path / "augment"),
        settings_json="{}",
        source_image_count=1,
        created_image_count=1,
        source_image_ids=[],
    )
    source_path = tmp_path / "source.jpg"
    stale_path = tmp_path / "stale-generated.jpg"
    cv2.imwrite(str(source_path), np.zeros((20, 30, 3), dtype=np.uint8))
    cv2.imwrite(str(stale_path), np.zeros((20, 30, 3), dtype=np.uint8))
    source = repo.create_image(project["id"], str(source_path), width=30, height=20)
    stale = repo.create_image(
        project["id"],
        str(stale_path),
        augmentation_run_id=augmentation["id"],
        width=30,
        height=20,
    )
    for image in (source, stale):
        repo.replace_image_annotations(
            image["id"],
            [{
                "class_id": 0,
                "class_name": "object",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.2,
                "confidence": 0.8,
                "source_type": "pseudo",
                "edited": False,
            }],
            review_status="pending_review",
        )
    repo.db.execute(
        "update augmentation_runs set outdated = 1, outdated_reason = ? where id = ?",
        ('{"code":"project_image_removed","image_ids":["removed-source"]}', augmentation["id"]),
    )
    repo.db.commit()

    split = create_dataset_split(repo, project["id"], "current-only", 0.8, 0.1, 0.1, job_id="job-current-only")
    split_image_ids = {
        image_id
        for bucket in json.loads(split["image_ids_json"]).values()
        for image_id in bucket
    }

    assert split_image_ids == {source["id"]}


def test_dataset_split_rechecks_augmentation_before_publish_and_cleans_partial_output(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Concurrent Stale Augment")
    augmentation = repo.create_augmentation_run_record(
        project_id=project["id"],
        pseudo_label_run_id=None,
        name="current-source",
        output_dir=str(tmp_path / "augment"),
        settings_json="{}",
        source_image_count=1,
        created_image_count=1,
        source_image_ids=[],
    )
    image_path = tmp_path / "generated.jpg"
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(
        project["id"],
        str(image_path),
        augmentation_run_id=augmentation["id"],
        width=30,
        height=20,
    )
    repo.replace_image_annotations(
        image["id"],
        [{
            "class_id": 0,
            "class_name": "object",
            "x_center": 0.5,
            "y_center": 0.5,
            "width": 0.2,
            "height": 0.2,
            "confidence": 0.8,
            "source_type": "augmented",
            "edited": False,
        }],
        review_status="pending_review",
    )
    original_write = project_services.write_yolo_labels
    became_stale = False

    def write_then_mark_stale(path, rows):  # type: ignore[no-untyped-def]
        nonlocal became_stale
        original_write(path, rows)
        if became_stale:
            return
        became_stale = True
        repo.db.execute(
            "update augmentation_runs set outdated = 1, outdated_reason = ? where id = ?",
            ('{"code":"project_image_removed","image_ids":["removed-source"]}', augmentation["id"]),
        )
        repo.db.commit()

    monkeypatch.setattr(project_services, "write_yolo_labels", write_then_mark_stale)
    split_dir = Path(project["root_path"]) / "splits" / "concurrent-stale"

    with pytest.raises(ValueError, match="Augmentation run is outdated; rebuild Augment before creating a split"):
        create_dataset_split(
            repo,
            project["id"],
            "concurrent-stale",
            0.8,
            0.1,
            0.1,
            augmentation_run_id=augmentation["id"],
            job_id="job-concurrent-stale",
        )

    assert split_dir.exists() is False
    assert repo.list_dataset_splits(project["id"]) == []


def test_dataset_split_rechecks_direct_images_are_active_before_publish(tmp_path: Path, monkeypatch) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Concurrent Direct Removal")
    source_path = Path(project["root_path"]) / "sources" / "direct.jpg"
    cv2.imwrite(str(source_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(source_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [{
            "class_id": 0,
            "class_name": "object",
            "x_center": 0.5,
            "y_center": 0.5,
            "width": 0.2,
            "height": 0.2,
            "confidence": 0.8,
            "source_type": "pseudo",
            "edited": False,
        }],
        review_status="pending_review",
    )
    original_write = project_services.write_yolo_labels
    removed = False

    def write_then_remove_source(path, rows):  # type: ignore[no-untyped-def]
        nonlocal removed
        original_write(path, rows)
        if removed:
            return
        removed = True
        project_services.remove_project_image(repo, project["id"], image["id"])

    monkeypatch.setattr(project_services, "write_yolo_labels", write_then_remove_source)
    split_dir = Path(project["root_path"]) / "splits" / "removed-direct"

    with pytest.raises(ValueError, match="source image.*removed.*split",):
        create_dataset_split(
            repo,
            project["id"],
            "removed-direct",
            0.8,
            0.1,
            0.1,
            job_id="job-removed-direct",
        )

    assert split_dir.exists() is False
    assert repo.list_dataset_splits(project["id"]) == []


def test_dataset_split_copy_failure_preserves_existing_same_name_output(tmp_path: Path, monkeypatch) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Preserve Existing Split")
    source_path = Path(project["root_path"]) / "sources" / "source.jpg"
    cv2.imwrite(str(source_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(source_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [{
            "class_id": 0,
            "class_name": "object",
            "x_center": 0.5,
            "y_center": 0.5,
            "width": 0.2,
            "height": 0.2,
            "confidence": 0.8,
            "source_type": "pseudo",
            "edited": False,
        }],
        review_status="pending_review",
    )
    output_dir = Path(project["root_path"]) / "splits" / "stable-name"
    output_dir.mkdir(parents=True)
    sentinel = output_dir / "existing-data.txt"
    sentinel.write_text("previous split remains usable", encoding="utf-8")
    existing = repo.create_dataset_split_record(
        project_id=project["id"],
        name="stable-name",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(output_dir),
        dataset_yaml_path=str(output_dir / "dataset.yaml"),
        image_ids_json=json.dumps({"train": [image["id"]], "valid": [], "test": []}),
    )

    def fail_label_materialization(_path, _rows):  # type: ignore[no-untyped-def]
        raise OSError("simulated label write failure")

    monkeypatch.setattr(project_services, "write_yolo_labels", fail_label_materialization)

    with pytest.raises(OSError, match="simulated label write failure"):
        create_dataset_split(
            repo,
            project["id"],
            "stable-name",
            0.8,
            0.1,
            0.1,
            job_id="job-stable-name-rebuild",
        )

    assert sentinel.read_text(encoding="utf-8") == "previous split remains usable"
    assert [split["id"] for split in repo.list_dataset_splits(project["id"])] == [existing["id"]]
    assert not list(output_dir.parent.glob(".stable-name.*"))


def test_dataset_split_readback_failure_rolls_back_insert_and_restores_existing_output(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Rollback Split Readback")
    source_path = Path(project["root_path"]) / "sources" / "source.jpg"
    cv2.imwrite(str(source_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(source_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [{
            "class_id": 0,
            "class_name": "object",
            "x_center": 0.5,
            "y_center": 0.5,
            "width": 0.2,
            "height": 0.2,
            "confidence": 0.8,
            "source_type": "pseudo",
            "edited": False,
        }],
        review_status="pending_review",
    )
    output_dir = Path(project["root_path"]) / "splits" / "stable-readback"
    output_dir.mkdir(parents=True)
    sentinel = output_dir / "existing-data.txt"
    sentinel.write_text("previous split remains usable", encoding="utf-8")
    repo.create_dataset_split_record(
        project_id=project["id"],
        name="stable-readback",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(output_dir),
        dataset_yaml_path=str(output_dir / "dataset.yaml"),
        image_ids_json=json.dumps({"train": [image["id"]], "valid": [], "test": []}),
    )
    original_hydrate = repo._hydrate_lineage_record

    def fail_new_split_readback(row):  # type: ignore[no-untyped-def]
        if row is not None and "dataset_yaml_path" in row.keys() and row["name"] == "stable-readback":
            raise RuntimeError("simulated split readback failure")
        return original_hydrate(row)

    monkeypatch.setattr(repo, "_hydrate_lineage_record", fail_new_split_readback)

    with pytest.raises(RuntimeError, match="simulated split readback failure"):
        create_dataset_split(
            repo,
            project["id"],
            "stable-readback",
            0.8,
            0.1,
            0.1,
            job_id="job-stable-readback-rebuild",
        )

    record_count = repo.db.execute(
        "select count(*) as count from dataset_splits where project_id = ?",
        (project["id"],),
    ).fetchone()["count"]
    assert record_count == 1
    assert sentinel.read_text(encoding="utf-8") == "previous split remains usable"
    assert not list(output_dir.parent.glob(".stable-readback.*"))


def test_dataset_split_outer_commit_failure_reverses_output_swap_and_database_insert(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Rollback Split Commit")
    source_path = Path(project["root_path"]) / "sources" / "source.jpg"
    cv2.imwrite(str(source_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(source_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [{
            "class_id": 0,
            "class_name": "object",
            "x_center": 0.5,
            "y_center": 0.5,
            "width": 0.2,
            "height": 0.2,
            "confidence": 0.8,
            "source_type": "pseudo",
            "edited": False,
        }],
        review_status="pending_review",
    )
    output_dir = Path(project["root_path"]) / "splits" / "stable-commit"
    output_dir.mkdir(parents=True)
    sentinel = output_dir / "existing-data.txt"
    sentinel.write_text("previous split remains usable", encoding="utf-8")
    repo.create_dataset_split_record(
        project_id=project["id"],
        name="stable-commit",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(output_dir),
        dataset_yaml_path=str(output_dir / "dataset.yaml"),
        image_ids_json=json.dumps({"train": [image["id"]], "valid": [], "test": []}),
    )

    @contextmanager
    def fail_after_transaction_body(db):  # type: ignore[no-untyped-def]
        with db.synchronized():
            try:
                yield db
                db.rollback()
                raise RuntimeError("simulated outer commit failure")
            except Exception:
                db.rollback()
                raise

    monkeypatch.setattr(project_services, "transaction", fail_after_transaction_body)

    with pytest.raises(RuntimeError, match="simulated outer commit failure"):
        create_dataset_split(
            repo,
            project["id"],
            "stable-commit",
            0.8,
            0.1,
            0.1,
            job_id="job-stable-commit-rebuild",
        )

    record_count = repo.db.execute(
        "select count(*) as count from dataset_splits where project_id = ?",
        (project["id"],),
    ).fetchone()["count"]
    assert record_count == 1
    assert sentinel.read_text(encoding="utf-8") == "previous split remains usable"
    assert not list(output_dir.parent.glob(".stable-commit.*"))


def test_same_name_split_failure_cannot_roll_back_over_a_later_success(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Serialized Same Name Split")
    source_path = Path(project["root_path"]) / "sources" / "source.jpg"
    cv2.imwrite(str(source_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(source_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [{
            "class_id": 0,
            "class_name": "object",
            "x_center": 0.5,
            "y_center": 0.5,
            "width": 0.2,
            "height": 0.2,
            "confidence": 0.8,
            "source_type": "pseudo",
            "edited": False,
        }],
        review_status="pending_review",
    )
    output_dir = Path(project["root_path"]) / "splits" / "shared-name"
    output_dir.mkdir(parents=True)
    (output_dir / "old-output.txt").write_text("old output", encoding="utf-8")

    original_write = project_services.write_yolo_labels
    original_transaction = project_services.transaction
    a_database_unlocked = Event()
    b_lock_state_known = Event()
    b_committed = Event()
    b_lock_was_blocked: list[bool] = []
    errors: dict[str, Exception] = {}

    class InstrumentedRLock:
        def __init__(self, wrapped):  # type: ignore[no-untyped-def]
            self.wrapped = wrapped

        def acquire(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            if current_thread().name == "split-B" and not b_lock_was_blocked:
                acquired = self.wrapped.acquire(blocking=False)
                b_lock_was_blocked.append(not acquired)
                b_lock_state_known.set()
                if acquired:
                    return True
            return self.wrapped.acquire(*args, **kwargs)

        def release(self) -> None:
            self.wrapped.release()

        def __enter__(self):  # type: ignore[no-untyped-def]
            self.acquire()
            return self

        def __exit__(self, *_args) -> None:  # type: ignore[no-untyped-def]
            self.release()

    def write_worker_marker(path, rows):  # type: ignore[no-untyped-def]
        original_write(path, rows)
        worker_name = current_thread().name
        path.write_text(worker_name, encoding="utf-8")

    @contextmanager
    def orchestrated_transaction(db):  # type: ignore[no-untyped-def]
        worker_name = current_thread().name
        if worker_name != "split-A":
            with original_transaction(db) as connection:
                yield connection
            if worker_name == "split-B":
                b_committed.set()
            return

        with db.synchronized():
            try:
                yield db
                db.rollback()
            except Exception:
                db.rollback()
                raise
        a_database_unlocked.set()
        if not b_lock_state_known.wait(timeout=5):
            raise AssertionError("split B did not attempt the repository lock")
        # Under the old code B acquires the released lock and must finish its
        # publish before A rolls back. With the fix, the nonblocking probe
        # proves B is already blocked behind A's outer repository lock.
        if not b_lock_was_blocked[0] and not b_committed.wait(timeout=5):
            raise AssertionError("split B acquired the repository but did not publish")
        raise RuntimeError("simulated split A commit failure")

    monkeypatch.setattr(project_services, "write_yolo_labels", write_worker_marker)
    monkeypatch.setattr(project_services, "transaction", orchestrated_transaction)
    monkeypatch.setattr(repo.db, "_lock", InstrumentedRLock(repo.db._lock))

    def run_split(worker_name: str) -> None:
        try:
            create_dataset_split(
                repo,
                project["id"],
                "shared-name",
                0.8,
                0.1,
                0.1,
                job_id=f"job-{worker_name}",
            )
        except Exception as exc:  # noqa: BLE001 - worker failures are asserted below.
            errors[worker_name] = exc

    worker_a = Thread(target=run_split, args=("A",), name="split-A")
    worker_a.start()
    assert a_database_unlocked.wait(timeout=5)
    worker_b = Thread(target=run_split, args=("B",), name="split-B")
    worker_b.start()
    worker_a.join(timeout=10)
    worker_b.join(timeout=10)

    assert worker_a.is_alive() is False
    assert worker_b.is_alive() is False
    assert str(errors["A"]) == "simulated split A commit failure"
    assert "B" not in errors
    assert b_lock_was_blocked == [True]
    assert b_committed.is_set()
    rows = repo.db.execute(
        "select job_id, output_dir, dataset_yaml_path from dataset_splits where project_id = ?",
        (project["id"],),
    ).fetchall()
    assert [row["job_id"] for row in rows] == ["job-B"]
    assert Path(rows[0]["output_dir"]) == output_dir
    assert Path(rows[0]["dataset_yaml_path"]).is_file()
    final_label = next(output_dir.glob("**/labels/source.txt"))
    assert final_label.read_text(encoding="utf-8") == "split-B"
    assert not list(output_dir.parent.glob(".shared-name.*"))


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


def test_mirror_probability_can_leave_generated_images_unflipped(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Optional mirror")
    image_path = tmp_path / "source.jpg"
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(image_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [{"class_id": 0, "class_name": "person", "x_center": 0.25, "y_center": 0.5, "width": 0.2, "height": 0.3}],
        review_status="pending_review",
    )

    result = create_image_augmentation_run(
        repo,
        project["id"],
        name="optional-flip",
        horizontal_flip=True,
        mirror_probability=0,
        copies=1,
        job_id="job-no-flip",
    )

    augmented = [item for item in repo.list_images(project["id"], limit=10) if item["augmentation_run_id"] == result["id"]][0]
    assert repo.list_annotations(augmented["id"])[0]["x_center"] == 0.25


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
