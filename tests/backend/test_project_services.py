import ast
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from types import ModuleType, SimpleNamespace

import cv2
import numpy as np
import pytest
import torch

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app import project_services
from backend.app.project_services import _training_loss_values, _training_metric_entry, register_image_folder
from backend.app.repositories import Repository


def test_register_image_folder_creates_image_records(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Images")
    source = repo.create_source_asset(project["id"], "image_folder", str(tmp_path / "images"))
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    image = np.zeros((20, 30, 3), dtype=np.uint8)
    cv2.imwrite(str(image_dir / "a.jpg"), image)

    result = register_image_folder(repo, project["id"], source["id"], str(image_dir))
    images = repo.list_images(project["id"])

    assert result == {"registered_images": 1}
    assert images[0]["width"] == 30
    assert images[0]["height"] == 20


def test_validation_preview_samples_multiple_unique_images_with_one_model_load(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    paths = AppPaths(project_root=tmp_path)
    repo = Repository(db=db, paths=paths)
    project = repo.create_project("Validation samples")
    image_dir = tmp_path / "validation"
    image_dir.mkdir()
    for index in range(3):
        cv2.imwrite(str(image_dir / f"sample-{index}.jpg"), np.zeros((12, 16, 3), dtype=np.uint8))
    paths.input_model_dir.mkdir(parents=True, exist_ok=True)
    (paths.input_model_dir / "model.pt").touch()

    loads: list[str] = []

    class FakeYOLO:
        def __init__(self, model_path: str) -> None:
            loads.append(model_path)
            self.names = {}

        def predict(self, image_path: str, **_: object) -> list[SimpleNamespace]:
            return [SimpleNamespace(boxes=[], names={})]

    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=FakeYOLO))

    previews = project_services.run_validation_previews(
        repo,
        project["id"],
        "model.pt",
        folder_path=str(image_dir),
        sample_count=2,
    )

    assert len(previews) == 2
    assert len({item["image_path"] for item in previews}) == 2
    assert len(loads) == 1


def test_register_image_folder_copies_images_into_project_sources(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Copied Images")
    raw_dir = tmp_path / "data" / "input" / "raw"
    raw_dir.mkdir(parents=True)
    image = np.zeros((12, 16, 3), dtype=np.uint8)
    cv2.imwrite(str(raw_dir / "a.jpg"), image)
    source = repo.create_source_asset(project["id"], "image_folder", str(raw_dir))

    register_image_folder(repo, project["id"], source["id"], str(raw_dir))

    images = repo.list_images(project["id"])
    copied_path = Path(images[0]["path"])
    assert copied_path.parent == Path(project["root_path"]) / "sources" / source["id"] / "images"
    assert copied_path.exists()
    assert copied_path.read_bytes() == (raw_dir / "a.jpg").read_bytes()


def test_remove_project_image_moves_owned_image_and_label_then_restore_returns_them(
    tmp_path: Path,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Restorable image")
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    raw_path = raw_dir / "source.jpg"
    raw_path.write_bytes(b"raw image")
    source = repo.create_source_asset(project["id"], "image_folder", str(raw_dir))
    register_image_folder(repo, project["id"], source["id"], str(raw_dir))
    image = repo.list_images(project["id"])[0]
    image_path = Path(image["path"])
    saved = project_services.save_image_annotations(
        repo,
        image["id"],
        [
            {
                "class_id": 0,
                "class_name": "object",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.2,
            }
        ],
        "reviewed",
    )
    label_path = Path(saved["label_path"])

    operation = project_services.remove_project_image(repo, project["id"], image["id"])

    assert raw_path.read_bytes() == b"raw image"
    assert not image_path.exists()
    assert not label_path.exists()
    assert Path(operation["trash_image_path"]).read_bytes() == b"raw image"
    assert Path(operation["trash_label_path"]).is_file()
    expected_operation_root = (
        Path(project["root_path"]) / ".trash" / "review" / operation["id"]
    )
    assert Path(operation["trash_image_path"]) == expected_operation_root / "image" / "source.jpg"
    assert Path(operation["trash_label_path"]) == expected_operation_root / "label" / "source.txt"
    assert repo.get_image(image["id"]) is None

    restored = project_services.restore_project_image(repo, project["id"], operation["id"])

    assert restored["restored_at"] is not None
    assert image_path.read_bytes() == b"raw image"
    assert label_path.is_file()
    assert not Path(operation["trash_image_path"]).exists()
    assert not Path(operation["trash_label_path"]).exists()
    assert repo.get_image(image["id"]) is not None
    assert len(repo.list_annotations(image["id"])) == 1


def test_remove_project_image_tombstones_external_path_without_touching_file(
    tmp_path: Path,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("External image")
    external_path = tmp_path / "raw" / "external.jpg"
    external_path.parent.mkdir()
    external_path.write_bytes(b"external image")
    image = repo.create_image(project["id"], str(external_path))

    operation = project_services.remove_project_image(repo, project["id"], image["id"])

    assert external_path.read_bytes() == b"external image"
    assert operation["trash_image_path"] is None
    assert repo.get_image(image["id"]) is None
    assert repo.get_image(image["id"], include_removed=True)["removed_at"] is not None


def test_restore_project_image_collision_leaves_tombstone_and_trash_unchanged(
    tmp_path: Path,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Restore collision")
    image_path = Path(project["root_path"]) / "sources" / "collision.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"original")
    image = repo.create_image(project["id"], str(image_path))
    operation = project_services.remove_project_image(repo, project["id"], image["id"])
    trash_path = Path(operation["trash_image_path"])
    image_path.write_bytes(b"collision")

    with pytest.raises(FileExistsError, match="Restore conflict"):
        project_services.restore_project_image(repo, project["id"], operation["id"])

    assert image_path.read_bytes() == b"collision"
    assert trash_path.read_bytes() == b"original"
    assert repo.get_image(image["id"]) is None
    assert repo.get_image_removal_operation(operation["id"])["restored_at"] is None


def test_remove_project_image_rolls_files_back_when_metadata_persistence_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Removal metadata rollback")
    image_path = Path(project["root_path"]) / "sources" / "rollback.jpg"
    label_path = Path(project["root_path"]) / "reviewed_labels" / "rollback.txt"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"image")
    label_path.write_bytes(b"label")
    image = repo.create_image(project["id"], str(image_path))

    def fail_metadata(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise RuntimeError("metadata failed")

    monkeypatch.setattr(repo, "create_image_removal_operation", fail_metadata)

    with pytest.raises(RuntimeError, match="metadata failed"):
        project_services.remove_project_image(repo, project["id"], image["id"])

    assert image_path.read_bytes() == b"image"
    assert label_path.read_bytes() == b"label"
    assert repo.get_image(image["id"]) is not None
    assert not (Path(project["root_path"]) / ".trash").exists()


def test_remove_project_image_rolls_first_move_back_when_second_move_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Removal file rollback")
    image_path = Path(project["root_path"]) / "sources" / "rollback.jpg"
    label_path = Path(project["root_path"]) / "reviewed_labels" / "rollback.txt"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"image")
    label_path.write_bytes(b"label")
    image = repo.create_image(project["id"], str(image_path))
    real_move = project_services.shutil.move

    def fail_label_move(source: str, destination: str) -> str:
        if Path(source).name == "rollback.txt":
            raise OSError("label move failed")
        return real_move(source, destination)

    monkeypatch.setattr(project_services.shutil, "move", fail_label_move)

    with pytest.raises(OSError, match="label move failed"):
        project_services.remove_project_image(repo, project["id"], image["id"])

    assert image_path.read_bytes() == b"image"
    assert label_path.read_bytes() == b"label"
    assert repo.get_image(image["id"]) is not None
    assert not (Path(project["root_path"]) / ".trash").exists()


def test_restore_project_image_rolls_files_back_when_metadata_persistence_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Restore metadata rollback")
    image_path = Path(project["root_path"]) / "sources" / "rollback.jpg"
    label_path = Path(project["root_path"]) / "reviewed_labels" / "rollback.txt"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"image")
    label_path.write_bytes(b"label")
    image = repo.create_image(project["id"], str(image_path))
    operation = project_services.remove_project_image(repo, project["id"], image["id"])
    trash_image_path = Path(operation["trash_image_path"])
    trash_label_path = Path(operation["trash_label_path"])

    def fail_metadata(_operation_id: str) -> dict[str, object]:
        raise RuntimeError("restore metadata failed")

    monkeypatch.setattr(repo, "restore_image_removal_operation", fail_metadata)

    with pytest.raises(RuntimeError, match="restore metadata failed"):
        project_services.restore_project_image(repo, project["id"], operation["id"])

    assert not image_path.exists()
    assert not label_path.exists()
    assert trash_image_path.read_bytes() == b"image"
    assert trash_label_path.read_bytes() == b"label"
    assert repo.get_image(image["id"]) is None
    assert repo.get_image_removal_operation(operation["id"])["restored_at"] is None


def test_remove_project_image_rolls_database_back_when_operation_readback_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Removal readback rollback")
    image_path = Path(project["root_path"]) / "sources" / "readback.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"image")
    image = repo.create_image(project["id"], str(image_path))

    def fail_readback(_operation_id: str) -> dict[str, object]:
        raise RuntimeError("operation readback failed")

    monkeypatch.setattr(repo, "get_image_removal_operation", fail_readback)

    with pytest.raises(RuntimeError, match="operation readback failed"):
        project_services.remove_project_image(repo, project["id"], image["id"])

    assert image_path.read_bytes() == b"image"
    assert repo.get_image(image["id"]) is not None
    assert repo.db.execute(
        "select count(*) as count from image_removal_operations"
    ).fetchone()["count"] == 0


def test_restore_project_image_rolls_database_back_when_operation_readback_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Restore readback rollback")
    image_path = Path(project["root_path"]) / "sources" / "readback.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"image")
    image = repo.create_image(project["id"], str(image_path))
    operation = project_services.remove_project_image(repo, project["id"], image["id"])
    trash_path = Path(operation["trash_image_path"])
    real_readback = repo.get_image_removal_operation
    readback_count = 0

    def fail_second_readback(operation_id: str) -> dict[str, object] | None:
        nonlocal readback_count
        readback_count += 1
        if readback_count == 2:
            raise RuntimeError("restore readback failed")
        return real_readback(operation_id)

    monkeypatch.setattr(repo, "get_image_removal_operation", fail_second_readback)

    with pytest.raises(RuntimeError, match="restore readback failed"):
        project_services.restore_project_image(repo, project["id"], operation["id"])

    assert not image_path.exists()
    assert trash_path.read_bytes() == b"image"
    removed = repo.get_image(image["id"], include_removed=True)
    assert removed["removed_at"] is not None
    persisted_operation = real_readback(operation["id"])
    assert persisted_operation["restored_at"] is None


def test_remove_project_image_attempts_every_rollback_when_one_rollback_move_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Best effort remove rollback")
    image_path = Path(project["root_path"]) / "sources" / "rollback.jpg"
    label_path = Path(project["root_path"]) / "reviewed_labels" / "rollback.txt"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"image")
    label_path.write_bytes(b"label")
    image = repo.create_image(project["id"], str(image_path))
    real_move = project_services.shutil.move

    def fail_label_rollback(source: str, destination: str) -> str:
        if ".trash" in Path(source).parts and Path(source).name == "rollback.txt":
            raise OSError("label rollback failed")
        return real_move(source, destination)

    def fail_metadata(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise RuntimeError("metadata failed")

    monkeypatch.setattr(project_services.shutil, "move", fail_label_rollback)
    monkeypatch.setattr(repo, "create_image_removal_operation", fail_metadata)

    with pytest.raises(RuntimeError, match="rollback failures"):
        project_services.remove_project_image(repo, project["id"], image["id"])

    assert image_path.read_bytes() == b"image"
    assert not label_path.exists()
    assert repo.get_image(image["id"]) is not None


def test_restore_project_image_attempts_every_rollback_when_one_rollback_move_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Best effort restore rollback")
    image_path = Path(project["root_path"]) / "sources" / "rollback.jpg"
    label_path = Path(project["root_path"]) / "reviewed_labels" / "rollback.txt"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"image")
    label_path.write_bytes(b"label")
    image = repo.create_image(project["id"], str(image_path))
    operation = project_services.remove_project_image(repo, project["id"], image["id"])
    trash_image_path = Path(operation["trash_image_path"])
    real_move = project_services.shutil.move

    def fail_label_rollback(source: str, destination: str) -> str:
        if Path(source) == label_path:
            raise OSError("label rollback failed")
        return real_move(source, destination)

    def fail_metadata(_operation_id: str) -> dict[str, object]:
        raise RuntimeError("restore metadata failed")

    monkeypatch.setattr(project_services.shutil, "move", fail_label_rollback)
    monkeypatch.setattr(repo, "restore_image_removal_operation", fail_metadata)

    with pytest.raises(RuntimeError, match="rollback failures"):
        project_services.restore_project_image(repo, project["id"], operation["id"])

    assert not image_path.exists()
    assert trash_image_path.read_bytes() == b"image"
    assert label_path.read_bytes() == b"label"
    assert repo.get_image(image["id"]) is None


def test_remove_project_image_serializes_concurrent_removals(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Concurrent removal")
    image_path = Path(project["root_path"]) / "sources" / "concurrent.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"image")
    image = repo.create_image(project["id"], str(image_path))
    real_create = repo.create_image_removal_operation
    first_create_entered = threading.Event()
    second_create_entered = threading.Event()
    call_guard = threading.Lock()
    call_count = 0

    def interleaved_create(*args: object, **kwargs: object) -> dict[str, object]:
        nonlocal call_count
        with call_guard:
            call_count += 1
            call_index = call_count
        if call_index == 1:
            first_create_entered.set()
            second_create_entered.wait(timeout=0.5)
        else:
            second_create_entered.set()
        return real_create(*args, **kwargs)

    monkeypatch.setattr(repo, "create_image_removal_operation", interleaved_create)

    def remove() -> dict[str, object]:
        first_create_entered.wait(timeout=0.5)
        return project_services.remove_project_image(repo, project["id"], image["id"])

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(remove) for _ in range(2)]
        outcomes: list[dict[str, object] | Exception] = []
        for future in futures:
            try:
                outcomes.append(future.result(timeout=3))
            except Exception as exc:
                outcomes.append(exc)

    successes = [item for item in outcomes if isinstance(item, dict)]
    failures = [item for item in outcomes if isinstance(item, Exception)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], FileNotFoundError)
    assert not image_path.exists()
    assert Path(successes[0]["trash_image_path"]).read_bytes() == b"image"


def test_restore_project_image_rejects_project_file_outside_its_operation_trash(
    tmp_path: Path,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Unsafe restore metadata")
    image_path = Path(project["root_path"]) / "sources" / "owned.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"owned")
    image = repo.create_image(project["id"], str(image_path))
    operation = project_services.remove_project_image(repo, project["id"], image["id"])
    actual_trash_path = Path(operation["trash_image_path"])
    unrelated_path = Path(project["root_path"]) / "metadata" / "unrelated.jpg"
    unrelated_path.parent.mkdir(parents=True, exist_ok=True)
    unrelated_path.write_bytes(b"unrelated")
    repo.db.execute(
        "update image_removal_operations set trash_image_path = ? where id = ?",
        (str(unrelated_path), operation["id"]),
    )
    repo.db.commit()

    with pytest.raises(ValueError, match="Unsafe image removal trash path"):
        project_services.restore_project_image(repo, project["id"], operation["id"])

    assert unrelated_path.read_bytes() == b"unrelated"
    assert actual_trash_path.read_bytes() == b"owned"
    assert repo.get_image(image["id"]) is None
    assert repo.get_image_removal_operation(operation["id"])["restored_at"] is None


def test_restore_project_image_rejects_original_path_not_bound_to_tombstoned_image(
    tmp_path: Path,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Bound restore destination")
    image_path = Path(project["root_path"]) / "sources" / "owned.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"owned")
    image = repo.create_image(project["id"], str(image_path))
    operation = project_services.remove_project_image(repo, project["id"], image["id"])
    trash_path = Path(operation["trash_image_path"])
    unrelated_destination = Path(project["root_path"]) / "metadata" / "relocated.jpg"
    repo.db.execute(
        "update image_removal_operations set original_image_path = ? where id = ?",
        (str(unrelated_destination), operation["id"]),
    )
    repo.db.commit()

    with pytest.raises(ValueError, match="original image path"):
        project_services.restore_project_image(repo, project["id"], operation["id"])

    assert not unrelated_destination.exists()
    assert trash_path.read_bytes() == b"owned"
    assert repo.get_image(image["id"]) is None


@pytest.mark.parametrize(
    "metadata_field",
    ["original_label_path", "trash_image_path", "trash_label_path"],
)
def test_restore_project_image_binds_derived_label_and_exact_trash_filenames(
    tmp_path: Path,
    metadata_field: str,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project(f"Bound {metadata_field}")
    project_root = Path(project["root_path"])
    image_path = project_root / "sources" / "owned.jpg"
    label_path = project_root / "reviewed_labels" / "owned.txt"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"owned")
    label_path.write_bytes(b"label")
    image = repo.create_image(project["id"], str(image_path))
    operation = project_services.remove_project_image(repo, project["id"], image["id"])
    if metadata_field == "original_label_path":
        forged_path = project_root / "metadata" / "relocated.txt"
    else:
        actual_trash_path = Path(operation[metadata_field])
        forged_path = actual_trash_path.with_name(f"wrong-{actual_trash_path.name}")
        forged_path.write_bytes(actual_trash_path.read_bytes())
    repo.db.execute(
        f"update image_removal_operations set {metadata_field} = ? where id = ?",
        (str(forged_path), operation["id"]),
    )
    repo.db.commit()

    with pytest.raises(ValueError, match="Unsafe"):
        project_services.restore_project_image(repo, project["id"], operation["id"])

    assert repo.get_image(image["id"]) is None
    assert Path(operation["trash_image_path"]).is_file()
    assert Path(operation["trash_label_path"]).is_file()


def test_sweep_pending_project_image_trash_waits_for_next_boot_and_never_unlinks_external_file(
    tmp_path: Path,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    repo.process_started_at = "0001-01-01T00:00:00+00:00"
    project = repo.create_project("Later sweep")
    image_path = Path(project["root_path"]) / "sources" / "owned.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"owned")
    image = repo.create_image(project["id"], str(image_path))
    repo.replace_image_annotations(
        image["id"],
        [
            {
                "class_id": 0,
                "class_name": "object",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.2,
            }
        ],
        "reviewed",
    )
    operation = project_services.remove_project_image(repo, project["id"], image["id"])
    trash_path = Path(operation["trash_image_path"])

    external_path = tmp_path / "raw" / "must-survive.jpg"
    external_path.parent.mkdir()
    external_path.write_bytes(b"external")
    external_image = repo.create_image(project["id"], str(external_path))
    external_operation = repo.create_image_removal_operation(
        project["id"],
        external_image["id"],
        str(external_path),
        str(external_path),
        None,
        None,
    )

    project_services.sweep_pending_image_removal_trash(repo)

    assert trash_path.read_bytes() == b"owned"
    assert external_path.read_bytes() == b"external"
    assert repo.get_image_removal_operation(operation["id"])["trash_image_path"] == str(trash_path)

    next_boot_repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    next_boot_repo.process_started_at = "9999-12-31T23:59:59+00:00"
    project_services.sweep_pending_image_removal_trash(next_boot_repo)

    assert not trash_path.exists()
    swept = next_boot_repo.get_image_removal_operation(operation["id"])
    assert swept["trash_image_path"] is None
    assert next_boot_repo.get_image(image["id"]) is None
    assert len(next_boot_repo.list_annotations(image["id"])) == 1
    assert external_path.read_bytes() == b"external"
    assert next_boot_repo.get_image_removal_operation(external_operation["id"])["trash_image_path"] is None

    with pytest.raises(FileNotFoundError, match="no longer available"):
        project_services.restore_project_image(
            next_boot_repo,
            project["id"],
            operation["id"],
        )
    assert next_boot_repo.get_image(image["id"]) is None


def test_sweep_pending_project_image_trash_skips_restored_operations(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Restored sweep")
    image_path = Path(project["root_path"]) / "sources" / "restored.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"restored")
    image = repo.create_image(project["id"], str(image_path))
    operation = project_services.remove_project_image(repo, project["id"], image["id"])
    project_services.restore_project_image(repo, project["id"], operation["id"])
    next_boot_repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    next_boot_repo.process_started_at = "9999-12-31T23:59:59+00:00"

    project_services.sweep_pending_image_removal_trash(next_boot_repo)

    assert image_path.read_bytes() == b"restored"
    assert next_boot_repo.get_image(image["id"]) is not None
    assert next_boot_repo.get_image_removal_operation(operation["id"])["restored_at"] is not None


def test_sweep_pending_project_image_trash_rejects_traversing_operation_id(
    tmp_path: Path,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    repo.process_started_at = "9999-12-31T23:59:59+00:00"
    project = repo.create_project("Traversal-safe sweep")
    victim_path = Path(project["root_path"]) / "sources" / "image" / "victim.jpg"
    victim_path.parent.mkdir(parents=True, exist_ok=True)
    victim_path.write_bytes(b"must survive")
    image_path = Path(project["root_path"]) / "sources" / "record.jpg"
    image_path.write_bytes(b"record")
    image = repo.create_image(project["id"], str(image_path))
    operation = repo.create_image_removal_operation(
        project["id"],
        image["id"],
        str(image_path),
        str(victim_path),
        None,
        None,
        operation_id="../../sources",
    )

    project_services.sweep_pending_image_removal_trash(repo)

    assert victim_path.read_bytes() == b"must survive"
    assert victim_path.parent.is_dir()
    assert repo.get_image_removal_operation(operation["id"])["trash_image_path"] is None


def test_sweep_pending_project_image_trash_rejects_symlinked_review_directory(
    tmp_path: Path,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    repo.process_started_at = "9999-12-31T23:59:59+00:00"
    project = repo.create_project("Symlink-safe sweep")
    project_root = Path(project["root_path"])
    operation_id = "forged-operation"
    victim_path = (
        project_root / "sources" / "aliased-trash" / operation_id / "image" / "victim.jpg"
    )
    victim_path.parent.mkdir(parents=True, exist_ok=True)
    victim_path.write_bytes(b"must survive")
    trash_parent = project_root / ".trash"
    trash_parent.mkdir()
    (trash_parent / "review").symlink_to(
        project_root / "sources" / "aliased-trash",
        target_is_directory=True,
    )
    image_path = project_root / "sources" / "record.jpg"
    image_path.write_bytes(b"record")
    image = repo.create_image(project["id"], str(image_path))
    operation = repo.create_image_removal_operation(
        project["id"],
        image["id"],
        str(image_path),
        str(victim_path),
        None,
        None,
        operation_id=operation_id,
    )

    project_services.sweep_pending_image_removal_trash(repo)

    assert victim_path.read_bytes() == b"must survive"
    assert repo.get_image_removal_operation(operation["id"])["trash_image_path"] is None


def test_sweep_pending_project_image_trash_rejects_symlinked_kind_directory(
    tmp_path: Path,
) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    repo.process_started_at = "9999-12-31T23:59:59+00:00"
    project = repo.create_project("Symlink-safe kind")
    project_root = Path(project["root_path"])
    operation_id = "forged-operation"
    victim_path = project_root / "sources" / "victim.jpg"
    victim_path.parent.mkdir(parents=True, exist_ok=True)
    victim_path.write_bytes(b"must survive")
    operation_root = project_root / ".trash" / "review" / operation_id
    operation_root.mkdir(parents=True)
    (operation_root / "image").symlink_to(
        victim_path.parent,
        target_is_directory=True,
    )
    image_path = project_root / "sources" / "record.jpg"
    image_path.write_bytes(b"record")
    image = repo.create_image(project["id"], str(image_path))
    operation = repo.create_image_removal_operation(
        project["id"],
        image["id"],
        str(image_path),
        str(operation_root / "image" / victim_path.name),
        None,
        None,
        operation_id=operation_id,
    )

    project_services.sweep_pending_image_removal_trash(repo)

    assert victim_path.read_bytes() == b"must survive"
    assert repo.get_image_removal_operation(operation["id"])["trash_image_path"] is None


def test_project_image_trash_sweep_is_registered_in_backend_lifespan() -> None:
    main_source = Path(project_services.__file__).with_name("main.py").read_text(
        encoding="utf-8"
    )
    module = ast.parse(main_source)
    initialize_schema_call = next(
        node
        for node in module.body
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "initialize_schema"
    )
    repo_assignment = next(
        node
        for node in module.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "repo" for target in node.targets)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "Repository"
    )
    lifespan = next(
        node
        for node in module.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "app_lifespan"
    )
    app_assignment = next(
        node
        for node in module.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "app" for target in node.targets)
    )

    assert isinstance(app_assignment.value, ast.Call)
    lifespan_keyword = next(
        keyword for keyword in app_assignment.value.keywords if keyword.arg == "lifespan"
    )
    assert isinstance(lifespan_keyword.value, ast.Name)
    assert lifespan_keyword.value.id == "app_lifespan"
    assert len(lifespan.body) == 2
    sweep_statement, yield_statement = lifespan.body
    assert isinstance(sweep_statement, ast.Expr)
    assert isinstance(sweep_statement.value, ast.Call)
    assert isinstance(sweep_statement.value.func, ast.Attribute)
    assert isinstance(sweep_statement.value.func.value, ast.Name)
    assert sweep_statement.value.func.value.id == "project_services"
    assert sweep_statement.value.func.attr == "sweep_pending_image_removal_trash"
    assert len(sweep_statement.value.args) == 1
    assert isinstance(sweep_statement.value.args[0], ast.Name)
    assert sweep_statement.value.args[0].id == "repo"
    assert isinstance(yield_statement, ast.Expr)
    assert isinstance(yield_statement.value, ast.Yield)
    assert initialize_schema_call.lineno < repo_assignment.lineno < sweep_statement.lineno
    assert sweep_statement.lineno < yield_statement.lineno


def test_create_augmentation_run_persists_exact_sorted_input_image_ids(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Augmentation provenance")
    images = []
    for filename in ("z.jpg", "a.jpg"):
        image_path = tmp_path / filename
        cv2.imwrite(str(image_path), np.zeros((12, 16, 3), dtype=np.uint8))
        image = repo.create_image(project["id"], str(image_path), width=16, height=12)
        repo.replace_image_annotations(
            image["id"],
            [
                {
                    "class_id": 0,
                    "class_name": "object",
                    "x_center": 0.5,
                    "y_center": 0.5,
                    "width": 0.2,
                    "height": 0.2,
                }
            ],
            review_status="pending_review",
        )
        images.append(image)
    job = repo.create_job("augmentation", project_id=project["id"])

    result = project_services.create_image_augmentation_run(
        repo,
        project["id"],
        "provenance",
        skip_augment=True,
        job_id=job["id"],
    )

    run = repo.get_augmentation_run(result["id"])
    expected_ids = sorted(image["id"] for image in images)
    assert run is not None
    assert run["source_image_ids_json"] == json.dumps(expected_ids)


def test_vertical_mirror_flips_pixels_and_yolo_y_center(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Vertical mirror")
    image_path = tmp_path / "mirror.jpg"
    cv2.imwrite(str(image_path), np.zeros((10, 20, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(image_path), width=20, height=10)
    repo.replace_image_annotations(
        image["id"],
        [{"class_id": 0, "class_name": "object", "x_center": 0.25, "y_center": 0.2, "width": 0.1, "height": 0.2}],
        review_status="pending_review",
    )

    annotations = project_services._preview_annotations(
        repo,
        image["id"],
        horizontal_flip=False,
        vertical_flip=True,
    )
    source = np.repeat(np.array([[[1], [2]], [[3], [4]]], dtype=np.uint8), 3, axis=2)
    frame = project_services._apply_augmentation_preview(
        source,
        brightness=0,
        hue=0,
        exposure=0,
        noise=0,
        blur=0,
        gain=0,
        box_motion_blur=0,
        rotation=0,
        horizontal_flip=False,
        vertical_flip=True,
        rng=np.random.default_rng(42),
    )

    assert annotations[0]["x_center"] == pytest.approx(0.25)
    assert annotations[0]["y_center"] == pytest.approx(0.8)
    assert frame[:, :, 0].tolist() == [[3, 4], [1, 2]]


def test_training_metric_entry_records_mapping_loss_items() -> None:
    entry = _training_metric_entry(
        epoch=1,
        total_epochs=1,
        loss_items={"box_loss": 1.25, "cls_loss": 2.5, "dfl_loss": 0.75},
        metrics={},
    )

    assert entry == {
        "epoch": 1,
        "total_epochs": 1,
        "box_loss": 1.25,
        "cls_loss": 2.5,
        "dfl_loss": 0.75,
    }


def test_training_metric_entry_drops_nonfinite_validation_metrics() -> None:
    entry = _training_metric_entry(
        epoch=2,
        total_epochs=2,
        loss_items=[1.0, 0.8, 0.4],
        metrics={"metrics/mAP50(B)": 0.5, "val/cls_loss": float("nan"), "val/dfl_loss": float("inf")},
    )

    assert entry["metrics/mAP50(B)"] == 0.5
    assert "val/cls_loss" not in entry
    assert "val/dfl_loss" not in entry


class TensorLikeLoss:
    def __init__(self, value: float) -> None:
        self.value = value

    def __float__(self) -> float:
        return self.value


@pytest.mark.parametrize(
    ("loss_items", "expected"),
    [
        ({"box_loss": TensorLikeLoss(1.25), "cls_loss": TensorLikeLoss(2.5), "dfl_loss": TensorLikeLoss(0.75)}, [1.25, 2.5, 0.75]),
        ([TensorLikeLoss(1.25), TensorLikeLoss(2.5), TensorLikeLoss(0.75)], [1.25, 2.5, 0.75]),
        ((TensorLikeLoss(1.25), TensorLikeLoss(2.5), TensorLikeLoss(0.75)), [1.25, 2.5, 0.75]),
    ],
)
def test_training_loss_values_preserve_mapping_list_and_tuple_order(loss_items: object, expected: list[float]) -> None:
    assert _training_loss_values(loss_items) == expected


def make_training_repo(tmp_path: Path) -> tuple[Repository, dict[str, object], dict[str, object], dict[str, object]]:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Training callbacks")
    input_model = repo.paths.input_model_dir / "input.pt"
    input_model.parent.mkdir(parents=True)
    input_model.write_bytes(b"weights")
    split_dir = tmp_path / "split"
    split_dir.mkdir()
    dataset_yaml = split_dir / "dataset.yaml"
    dataset_yaml.write_text("path: .\n", encoding="utf-8")
    split = repo.create_dataset_split_record(
        project_id=project["id"],
        name="split",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(split_dir),
        dataset_yaml_path=str(dataset_yaml),
        image_ids_json="{}",
    )
    job = repo.create_job("training", project_id=project["id"], related_type="training_run")
    return repo, project, split, job


def test_training_persists_one_epoch_metric_when_final_eval_repeats_fit_end_callback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo, project, split, job = make_training_repo(tmp_path)

    class FakeYOLO:
        instance: "FakeYOLO | None" = None

        def __init__(self, model_path: str) -> None:
            self.model_path = model_path
            self.callbacks: dict[str, list[object]] = {}
            self.train_kwargs: dict[str, object] = {}
            FakeYOLO.instance = self

        def add_callback(self, event: str, callback: object) -> None:
            self.callbacks.setdefault(event, []).append(callback)

        def train(self, **kwargs: object) -> SimpleNamespace:
            self.train_kwargs = kwargs
            trainer = SimpleNamespace(
                epoch=0,
                epochs=1,
                loss_items={"box_loss": TensorLikeLoss(1.25), "cls_loss": TensorLikeLoss(2.5), "dfl_loss": TensorLikeLoss(0.75)},
                metrics={"metrics/mAP50(B)": 0.5},
            )
            for callback in self.callbacks.get("on_train_epoch_end", []):
                callback(trainer)
            for callback in self.callbacks.get("on_fit_epoch_end", []):
                callback(trainer)
            trainer.epoch = 1  # Ultralytics final_eval logs best-model metrics at epochs + 1.
            trainer.metrics = {"metrics/mAP50(B)": 0.6}
            for callback in self.callbacks.get("on_fit_epoch_end", []):
                callback(trainer)
            save_dir = Path(str(kwargs["project"])) / "fake-train"
            weights = save_dir / "weights"
            weights.mkdir(parents=True)
            (weights / "best.pt").write_bytes(b"best")
            (weights / "last.pt").write_bytes(b"last")
            return SimpleNamespace(save_dir=save_dir)

    ultralytics = ModuleType("ultralytics")
    ultralytics.YOLO = FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", ultralytics)

    result = project_services.run_training(
        repo,
        str(project["id"]),
        str(split["id"]),
        "input.pt",
        epochs=1,
        imgsz=640,
        batch=8,
        device="cuda",
        patience=10,
        optimizer="MuSGD",
        lr0=0.01,
        lrf=0.01,
        rect=False,
        amp=False,
        job_id=str(job["id"]),
    )

    assert FakeYOLO.instance is not None
    assert FakeYOLO.instance.callbacks.get("on_train_epoch_end", []) == []
    assert len(FakeYOLO.instance.callbacks.get("on_fit_epoch_end", [])) == 1
    assert FakeYOLO.instance.train_kwargs["rect"] is False
    assert FakeYOLO.instance.train_kwargs["amp"] is False
    assert FakeYOLO.instance.train_kwargs["optimizer"] == "MuSGD"
    assert result["rect"] is False
    assert result["amp"] is False
    assert result["run_name"] == f"Train_{datetime.now().strftime('%m%d')}_v001"
    assert result["settings"] == {
        "epochs": 1, "imgsz": 640, "batch": 8, "device": "cuda", "patience": 10,
        "optimizer": "MuSGD", "lr0": 0.01, "lrf": 0.01, "rect": False, "amp": False,
    }
    assert json.loads(str(result["metrics_json"])) == [
        {
            "box_loss": 1.25,
            "cls_loss": 2.5,
            "dfl_loss": 0.75,
            "epoch": 1,
            "metrics/mAP50(B)": 0.6,
            "total_epochs": 1,
        }
    ]
    persisted_job = repo.get_job(str(job["id"]))
    assert persisted_job is not None
    assert persisted_job["progress"] == 99
    assert persisted_job["message"] == "Epoch 1/1 · loss=1.2500,2.5000,0.7500 · metrics/mAP50(B)=0.6000"


def test_training_keeps_intermediate_metrics_and_caps_running_progress_before_final_eval(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo, project, split, job = make_training_repo(tmp_path)

    class FakeYOLO:
        def __init__(self, model_path: str) -> None:
            self.callbacks: dict[str, list[object]] = {}

        def add_callback(self, event: str, callback: object) -> None:
            self.callbacks.setdefault(event, []).append(callback)

        def train(self, **kwargs: object) -> SimpleNamespace:
            trainer = SimpleNamespace(
                epoch=0,
                epochs=2,
                loss_items=[1.0, 2.0, 3.0],
                metrics={"metrics/mAP50(B)": 0.1},
            )
            for callback in self.callbacks["on_fit_epoch_end"]:
                callback(trainer)
            trainer.epoch = 1
            trainer.metrics = {"metrics/mAP50(B)": 0.2}
            for callback in self.callbacks["on_fit_epoch_end"]:
                callback(trainer)
            trainer.epoch = 2  # Ultralytics final_eval temporary epoch increment.
            trainer.metrics = {"metrics/mAP50(B)": 0.3}
            for callback in self.callbacks["on_fit_epoch_end"]:
                callback(trainer)
            save_dir = Path(str(kwargs["project"])) / "fake-train"
            weights = save_dir / "weights"
            weights.mkdir(parents=True)
            (weights / "best.pt").write_bytes(b"best")
            (weights / "last.pt").write_bytes(b"last")
            return SimpleNamespace(save_dir=save_dir)

    ultralytics = ModuleType("ultralytics")
    ultralytics.YOLO = FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", ultralytics)

    result = project_services.run_training(
        repo,
        str(project["id"]),
        str(split["id"]),
        "input.pt",
        epochs=2,
        imgsz=640,
        batch=8,
        device="cuda",
        patience=10,
        optimizer="SGD",
        lr0=0.01,
        lrf=0.01,
        job_id=str(job["id"]),
    )

    assert json.loads(str(result["metrics_json"])) == [
        {"box_loss": 1.0, "cls_loss": 2.0, "dfl_loss": 3.0, "epoch": 1, "metrics/mAP50(B)": 0.1, "total_epochs": 2},
        {"box_loss": 1.0, "cls_loss": 2.0, "dfl_loss": 3.0, "epoch": 2, "metrics/mAP50(B)": 0.3, "total_epochs": 2},
    ]
    persisted_job = repo.get_job(str(job["id"]))
    assert persisted_job is not None
    assert persisted_job["progress"] == 99
    assert persisted_job["message"] == "Epoch 2/2 · loss=1.0000,2.0000,3.0000 · metrics/mAP50(B)=0.3000"


def test_training_diagnostics_records_real_optimizer_and_ema_step_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo, project, split, job = make_training_repo(tmp_path)

    class FakeScaler:
        def __init__(self) -> None:
            self._per_optimizer_states: dict[int, dict[str, object]] = {}

        def get_scale(self) -> float:
            return 128.0

        def step(self, optimizer: torch.optim.Optimizer) -> None:
            self._per_optimizer_states[id(optimizer)] = {"found_inf_per_device": {"cpu": torch.tensor(0.0)}}
            optimizer.step()

        def update(self) -> None:
            pass

    class FakeYOLO:
        def __init__(self, model_path: str) -> None:
            self.callbacks: dict[str, list[object]] = {}

        def add_callback(self, event: str, callback: object) -> None:
            self.callbacks.setdefault(event, []).append(callback)

        def train(self, **kwargs: object) -> SimpleNamespace:
            model = torch.nn.Sequential()
            model.add_module("backbone", torch.nn.Linear(2, 1, bias=False))
            model.add_module("head", torch.nn.Linear(1, 1, bias=False))
            optimizer = torch.optim.SGD(model.parameters(), lr=0.01)
            trainer = SimpleNamespace(
                epoch=0,
                epochs=1,
                model=model,
                ema=SimpleNamespace(ema=None, updates=0),
                optimizer=optimizer,
                scaler=FakeScaler(),
                loss_items=[1.0, 2.0, 3.0],
                metrics={"metrics/mAP50(B)": 0.5},
            )
            trainer.ema.ema = torch.nn.Sequential()
            trainer.ema.ema.add_module("backbone", torch.nn.Linear(2, 1, bias=False))
            trainer.ema.ema.add_module("head", torch.nn.Linear(1, 1, bias=False))
            trainer.ema.ema.load_state_dict(model.state_dict())

            def preprocess_batch(batch: dict[str, object]) -> dict[str, object]:
                return batch

            def optimizer_step() -> None:
                trainer.scaler.step(trainer.optimizer)
                trainer.scaler.update()
                trainer.ema.ema.load_state_dict(trainer.model.state_dict())
                trainer.ema.updates += 1
                trainer.optimizer.zero_grad()

            trainer.preprocess_batch = preprocess_batch
            trainer.optimizer_step = optimizer_step
            for callback in self.callbacks["on_pretrain_routine_end"]:
                callback(trainer)
            batch = {
                "cls": torch.tensor([0.0, 1.0]),
                "batch_idx": torch.tensor([0, 0]),
                "im_file": ["/dataset/a.png"],
            }
            trainer.preprocess_batch(batch)
            trainer.loss = trainer.model(torch.tensor([[1.0, 2.0]])).sum()
            trainer.loss.backward()
            trainer.optimizer_step()
            for callback in self.callbacks["on_model_save"]:
                callback(trainer)
            for callback in self.callbacks["on_fit_epoch_end"]:
                callback(trainer)
            save_dir = Path(str(kwargs["project"])) / "fake-train"
            weights = save_dir / "weights"
            weights.mkdir(parents=True)
            (weights / "best.pt").write_bytes(b"best")
            (weights / "last.pt").write_bytes(b"last")
            return SimpleNamespace(save_dir=save_dir)

    ultralytics = ModuleType("ultralytics")
    ultralytics.YOLO = FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", ultralytics)

    result = project_services.run_training(
        repo,
        str(project["id"]),
        str(split["id"]),
        "input.pt",
        epochs=1,
        imgsz=640,
        batch=8,
        device="cuda",
        patience=10,
        optimizer="SGD",
        lr0=0.01,
        lrf=0.01,
        diagnostics=True,
        job_id=str(job["id"]),
    )

    diagnostics = result["diagnostics"]
    assert diagnostics["enabled"] is True
    assert diagnostics["pre_strip"]["ema_updates"] == 1
    assert diagnostics["post_strip"]["best_model_size"] == 4
    event = diagnostics["optimizer_steps"][0]
    assert event["batch_index"] == 0
    assert event["label_classes"] == {"0": 1, "1": 1}
    assert event["loss_finite"] is True
    assert event["grad_nonfinite_values"] == 0
    assert event["found_inf"] == 0.0
    assert event["optimizer_step_called"] is True
    assert event["model_deltas"]["backbone.weight"]["max_abs"] > 0
    assert event["ema_deltas"]["backbone.weight"]["max_abs"] > 0
