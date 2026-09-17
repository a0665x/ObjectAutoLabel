import json
import sqlite3
from pathlib import Path

import pytest

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_create_project_creates_project_folders(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)

    project = repo.create_project(name="Drone Cars", description="aerial labels")

    assert project["slug"] == "drone-cars"
    assert Path(project["root_path"]).exists()
    assert (Path(project["root_path"]) / "sources").exists()
    assert (Path(project["root_path"]) / "reviewed_labels").exists()
    assert (Path(project["root_path"]) / "output_model").exists()
    output_index = tmp_path / "output_model" / project["slug"]
    assert output_index.is_symlink()
    assert not output_index.readlink().is_absolute()
    assert output_index.resolve() == (Path(project["root_path"]) / "output_model").resolve()


def test_delete_project_removes_project_folder_and_output_model_index(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Remove Me", description="")
    root_path = Path(project["root_path"])
    output_index = tmp_path / "output_model" / project["slug"]

    assert repo.delete_project(project["id"]) is True

    assert not root_path.exists()
    assert not output_index.exists()


def test_migrate_project_output_models_moves_legacy_project_id_folder_and_updates_paths(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Legacy Outputs", description="")
    split = repo.create_dataset_split_record(
        project_id=project["id"],
        name="main",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(Path(project["root_path"]) / "splits" / "main"),
        dataset_yaml_path=str(Path(project["root_path"]) / "splits" / "main" / "dataset.yaml"),
        image_ids_json="[]",
    )
    legacy_dir = tmp_path / "output_model" / project["id"]
    best = legacy_dir / "train" / "weights" / "best.pt"
    best.parent.mkdir(parents=True)
    best.write_text("pt", encoding="utf-8")
    training = repo.create_training_run_record(
        project_id=project["id"],
        dataset_split_id=split["id"],
        input_model="yolov8n.pt",
        output_dir=str(legacy_dir),
    )
    repo.update_training_run(training["id"], best_model_path=str(best), status="completed")

    repo.migrate_project_output_models()

    migrated_best = Path(project["root_path"]) / "output_model" / "train" / "weights" / "best.pt"
    loaded = repo.get_training_run(training["id"])
    assert migrated_best.exists()
    assert not legacy_dir.exists()
    assert loaded is not None
    assert loaded["best_model_path"] == str(migrated_best)
    assert loaded["output_dir"] == str(Path(project["root_path"]) / "output_model")


def test_training_run_record_keeps_user_name_actual_save_dir_and_metrics(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Train Lineage", description="")
    split = repo.create_dataset_split_record(
        project_id=project["id"],
        name="Split_20260707_v001",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(Path(project["root_path"]) / "splits" / "Split_20260707_v001"),
        dataset_yaml_path=str(Path(project["root_path"]) / "splits" / "Split_20260707_v001" / "dataset.yaml"),
        image_ids_json="[]",
    )

    training = repo.create_training_run_record(
        project_id=project["id"],
        dataset_split_id=split["id"],
        input_model="yolov8n.pt",
        output_dir=str(Path(project["root_path"]) / "output_model" / "runs"),
        amp=False,
        run_name="Train_person_car_augx3_v001",
    )
    save_dir = Path(project["root_path"]) / "output_model" / "runs" / "train2"
    repo.update_training_run(
        training["id"],
        save_dir=str(save_dir),
        best_model_path=str(save_dir / "weights" / "best.pt"),
        last_model_path=str(save_dir / "weights" / "last.pt"),
        metrics_json='[{"epoch":1,"box_loss":1.2,"cls_loss":0.8,"dfl_loss":0.4}]',
        status="completed",
    )

    loaded = repo.get_training_run(training["id"])

    assert loaded is not None
    assert loaded["run_name"] == "Train_person_car_augx3_v001"
    assert loaded["amp"] is False
    assert loaded["save_dir"] == str(save_dir)
    assert loaded["metrics_json"] == '[{"epoch":1,"box_loss":1.2,"cls_loss":0.8,"dfl_loss":0.4}]'


def test_create_class_schema_preserves_class_id_order(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Demo", description="")

    schema = repo.create_class_schema(
        project_id=project["id"],
        name="Default",
        classes=[
            {"class_id": 0, "class_name": "person", "descriptors": ["standing person", "walking person"]},
            {"class_id": 1, "class_name": "car", "descriptors": ["sedan car", "aerial vehicle"]},
        ],
    )
    loaded = repo.get_class_schema(schema["id"])

    assert loaded is not None
    assert loaded["classes"][0]["class_id"] == 0
    assert loaded["classes"][0]["descriptors"] == ["standing person", "walking person"]
    assert loaded["classes"][1]["class_name"] == "car"


def test_migrate_project_source_copies_moves_image_records_into_project_sources(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Source Copy", description="")
    raw_dir = tmp_path / "data" / "input" / "raw"
    raw_dir.mkdir(parents=True)
    raw_image = raw_dir / "sample.jpg"
    raw_image.write_bytes(b"image-bytes")
    source = repo.create_source_asset(project["id"], "image_folder", str(raw_dir))
    image = repo.create_image(project["id"], str(raw_image), source_asset_id=source["id"])

    migrated = repo.migrate_project_source_copies()

    loaded = repo.get_image(image["id"])
    copied_path = Path(project["root_path"]) / "sources" / source["id"] / "images" / "sample.jpg"
    assert migrated == 1
    assert copied_path.exists()
    assert loaded is not None
    assert loaded["path"] == str(copied_path)
    assert raw_image.exists()


def test_delete_project_removes_jobs_and_legacy_output_id_folder(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Delete Bundle", description="")
    job = repo.create_job("training", project_id=project["id"])
    legacy_output = tmp_path / "output_model" / project["id"]
    (legacy_output / "weights").mkdir(parents=True)
    (legacy_output / "weights" / "best.pt").write_text("pt", encoding="utf-8")

    assert repo.delete_project(project["id"]) is True

    assert repo.get_job(job["id"]) is None
    assert not Path(project["root_path"]).exists()
    assert not legacy_output.exists()


def test_project_storage_status_marks_missing_workspace_as_stale(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Manual Delete", description="")
    root_path = Path(project["root_path"])
    output_index = tmp_path / "output_model" / project["slug"]
    assert root_path.exists()
    assert output_index.exists()

    for child in root_path.iterdir():
        if child.is_dir():
            import shutil
            shutil.rmtree(child)
        else:
            child.unlink()
    root_path.rmdir()

    status = repo.get_project_storage_status(project["id"])

    assert status == {
        "workspace_exists": False,
        "output_index_exists": False,
        "is_stale": True,
        "missing": ["project workspace", "output model index"],
    }


def test_project_storage_status_treats_empty_root_path_as_stale(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Legacy Empty Root", description="")
    repo.db.execute("update projects set root_path = '' where id = ?", (project["id"],))

    status = repo.get_project_storage_status(project["id"])

    assert status is not None
    assert status["workspace_exists"] is False
    assert status["is_stale"] is True
    assert "project workspace" in status["missing"]


def test_cleanup_stale_project_record_deletes_db_row_without_input_library(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    raw_input = tmp_path / "data" / "input" / "0629"
    raw_input.mkdir(parents=True)
    (raw_input / "sample.jpg").write_text("raw", encoding="utf-8")
    project = repo.create_project(name="Stale Cleanup", description="")
    root_path = Path(project["root_path"])
    import shutil
    shutil.rmtree(root_path)

    result = repo.cleanup_stale_project(project["id"])

    assert result is True
    assert repo.get_project(project["id"]) is None
    assert raw_input.exists()
    assert (raw_input / "sample.jpg").exists()


def test_cleanup_stale_project_record_refuses_healthy_project(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Healthy", description="")

    result = repo.cleanup_stale_project(project["id"])

    assert result is False
    assert repo.get_project(project["id"]) is not None


def test_list_annotated_images_returns_only_labeled_preview_candidates(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Preview Candidates", description="")
    unlabeled_path = tmp_path / "a_unlabeled.jpg"
    labeled_path = tmp_path / "b_labeled.jpg"
    unlabeled_path.write_bytes(b"unlabeled")
    labeled_path.write_bytes(b"labeled")
    repo.create_image(project["id"], str(unlabeled_path), width=10, height=10)
    labeled = repo.create_image(project["id"], str(labeled_path), width=10, height=10)
    repo.replace_image_annotations(
        labeled["id"],
        [
            {
                "class_id": 0,
                "class_name": "person",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.2,
                "confidence": 0.9,
                "source_type": "pseudo",
                "edited": False,
            }
        ],
        review_status="pending_review",
    )

    candidates = repo.list_annotated_images(project["id"], limit=5)

    assert [item["id"] for item in candidates] == [labeled["id"]]


def test_image_position_reports_filtered_and_project_rank(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Position Queue", description="")
    image_1 = repo.create_image(project["id"], str(tmp_path / "a.jpg"))
    image_2 = repo.create_image(project["id"], str(tmp_path / "b.jpg"))
    image_3 = repo.create_image(project["id"], str(tmp_path / "c.jpg"))
    repo.replace_image_annotations(image_2["id"], [], review_status="pending_review")
    repo.replace_image_annotations(image_3["id"], [], review_status="pending_review")

    position = repo.get_image_position(project["id"], image_2["id"], review_status="pending_review")

    assert position == {
        "filtered_index": 1,
        "filtered_total": 2,
        "project_index": 2,
        "project_total": 3,
    }
    assert [item["id"] for item in repo.list_images(project["id"])] == [
        image_1["id"],
        image_2["id"],
        image_3["id"],
    ]


def test_image_position_shares_all_active_filters_and_breaks_path_ties_by_id(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Position Filters", description="")
    source = repo.create_source_asset(project["id"], "image_folder", str(tmp_path / "source"))
    other_source = repo.create_source_asset(project["id"], "image_folder", str(tmp_path / "other-source"))
    same_path = str(tmp_path / "same.jpg")
    matching_1 = repo.create_image(project["id"], same_path, source_asset_id=source["id"])
    matching_2 = repo.create_image(project["id"], same_path, source_asset_id=source["id"])
    wrong_source = repo.create_image(project["id"], same_path, source_asset_id=other_source["id"])
    high_confidence = repo.create_image(project["id"], str(tmp_path / "high.jpg"), source_asset_id=source["id"])
    low_confidence_annotation = {
        "class_id": 0,
        "class_name": "object",
        "x_center": 0.5,
        "y_center": 0.5,
        "width": 0.2,
        "height": 0.2,
        "confidence": 0.4,
        "source_type": "pseudo",
        "edited": False,
    }
    high_confidence_annotation = {**low_confidence_annotation, "confidence": 0.5}
    for image in (matching_1, matching_2, wrong_source):
        repo.replace_image_annotations(
            image["id"], [low_confidence_annotation], review_status="pending_review"
        )
    repo.replace_image_annotations(
        high_confidence["id"], [high_confidence_annotation], review_status="pending_review"
    )
    matching_ids = sorted([matching_1["id"], matching_2["id"]])
    target_id = matching_ids[1]

    position = repo.get_image_position(
        project["id"],
        target_id,
        review_status="pending_review",
        has_low_confidence=True,
        source_asset_id=source["id"],
    )

    assert position is not None
    assert position["filtered_index"] == 2
    assert position["filtered_total"] == 2
    assert [item["id"] for item in repo.list_images(
        project["id"],
        review_status="pending_review",
        has_low_confidence=True,
        source_asset_id=source["id"],
    )] == matching_ids


def test_list_models_uses_world_and_input_dirs(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    (tmp_path / "world_model").mkdir()
    (tmp_path / "input_model").mkdir()
    (tmp_path / "world_model" / "yolov8s-world.pt").write_text("x", encoding="utf-8")
    (tmp_path / "world_model" / "custom-world.pth").write_text("x", encoding="utf-8")
    (tmp_path / "input_model" / "yolov8n.pt").write_text("x", encoding="utf-8")
    (tmp_path / "input_model" / "custom-input.pth").write_text("x", encoding="utf-8")

    models = repo.list_models()

    assert models == {
        "world_models": ["custom-world.pth", "yolov8s-world.pt"],
        "input_models": ["custom-input.pth", "yolov8n.pt"],
        "output_models": [],
    }


def test_image_removal_hides_image_and_marks_exact_lineage_outdated(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Removal lineage", description="")
    image_path = tmp_path / "source.jpg"
    image_path.write_bytes(b"image")
    image = repo.create_image(project["id"], str(image_path), width=10, height=10)
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
                "confidence": 0.4,
                "source_type": "pseudo",
                "edited": True,
            }
        ],
        review_status="pending_review",
    )
    augmentation = repo.create_augmentation_run_record(
        project_id=project["id"],
        pseudo_label_run_id=None,
        name="augmentation",
        output_dir=str(tmp_path / "augmentation"),
        settings_json="{}",
        source_image_count=1,
        created_image_count=1,
        source_image_ids=[image["id"]],
    )
    split = repo.create_dataset_split_record(
        project_id=project["id"],
        name="split",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(tmp_path / "split"),
        dataset_yaml_path=str(tmp_path / "split" / "dataset.yaml"),
        image_ids_json=json.dumps({"train": [image["id"]], "valid": [], "test": []}),
    )

    operation = repo.create_image_removal_operation(
        project["id"],
        image["id"],
        str(image_path),
        str(tmp_path / "trash" / "source.jpg"),
        str(tmp_path / "source.txt"),
        str(tmp_path / "trash" / "source.txt"),
    )

    remarked = repo.mark_image_removed(image["id"], operation["id"])

    assert repo.list_images(project["id"]) == []
    assert repo.list_annotated_images(project["id"]) == []
    assert repo.get_image(image["id"]) is None
    assert repo.get_image_by_path(str(image_path)) is None
    removed = repo.get_image(image["id"], include_removed=True)
    assert removed is not None
    assert removed["removed_at"] is not None
    assert removed["removal_operation_id"] == operation["id"]
    assert remarked["removal_operation_id"] == operation["id"]
    assert repo.get_image_position(project["id"], image["id"]) is None
    assert repo.get_review_stats(project["id"]) == {
        "unreviewed": 0,
        "pending_review": 0,
        "needs_fix": 0,
        "reviewed": 0,
        "skipped": 0,
        "edited": 0,
        "low_confidence": 0,
    }
    expected_reason = json.dumps(
        {"code": "project_image_removed", "image_ids": [image["id"]]},
        sort_keys=True,
        separators=(",", ":"),
    )
    loaded_augmentation = repo.get_augmentation_run(augmentation["id"])
    loaded_split = repo.get_dataset_split(split["id"])
    assert loaded_augmentation is not None
    assert loaded_augmentation["outdated"] is True
    assert loaded_augmentation["outdated_reason"] == expected_reason
    assert loaded_split is not None
    assert loaded_split["outdated"] is True
    assert loaded_split["outdated_reason"] == expected_reason

    restored = repo.restore_image_removal_operation(operation["id"])

    assert restored["restored_at"] is not None
    assert [item["id"] for item in repo.list_images(project["id"])] == [image["id"]]
    assert repo.get_augmentation_run(augmentation["id"])["outdated"] is False
    assert repo.get_dataset_split(split["id"])["outdated"] is False
    assert repo.get_dataset_split(split["id"])["outdated_reason"] is None
    assert repo.get_image_removal_operation(operation["id"])["restored_at"] is not None


def test_image_removal_marks_a_split_of_generated_images_outdated_through_augmentation_lineage(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Generated split lineage", description="")
    source_path = tmp_path / "source.jpg"
    generated_path = tmp_path / "generated.jpg"
    source_path.write_bytes(b"source")
    generated_path.write_bytes(b"generated")
    source = repo.create_image(project["id"], str(source_path))
    augmentation = repo.create_augmentation_run_record(
        project_id=project["id"],
        pseudo_label_run_id=None,
        name="augmentation",
        output_dir=str(tmp_path / "augmentation"),
        settings_json="{}",
        source_image_count=1,
        created_image_count=1,
        source_image_ids=[source["id"]],
    )
    generated = repo.create_image(
        project["id"],
        str(generated_path),
        augmentation_run_id=augmentation["id"],
    )
    split = repo.create_dataset_split_record(
        project_id=project["id"],
        name="generated split",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(tmp_path / "split"),
        dataset_yaml_path=str(tmp_path / "split" / "dataset.yaml"),
        image_ids_json=json.dumps({"train": [generated["id"]], "valid": [], "test": []}),
        augmentation_run_id=augmentation["id"],
    )
    operation = repo.create_image_removal_operation(
        project["id"],
        source["id"],
        str(source_path),
        str(tmp_path / "trash" / "source.jpg"),
        None,
        None,
    )

    repo.mark_image_removed(source["id"], operation["id"])

    expected_reason = json.dumps(
        {"code": "project_image_removed", "image_ids": [source["id"]]},
        sort_keys=True,
        separators=(",", ":"),
    )
    assert repo.get_dataset_split(split["id"])["outdated"] is True
    assert repo.get_dataset_split(split["id"])["outdated_reason"] == expected_reason


def test_augmentation_record_canonicalizes_source_image_ids(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Canonical provenance", description="")
    source_ids = ["image-b", "image-a", "image-b"]

    augmentation = repo.create_augmentation_run_record(
        project["id"],
        None,
        "canonical augmentation",
        str(tmp_path / "augmentation"),
        "{}",
        2,
        2,
        source_image_ids=source_ids,
    )

    assert augmentation["source_image_ids_json"] == json.dumps(sorted(set(source_ids)))


def test_augmentation_record_requires_source_image_ids(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Required provenance", description="")

    with pytest.raises(TypeError, match="source_image_ids"):
        repo.create_augmentation_run_record(
            project["id"],
            None,
            "missing provenance",
            str(tmp_path / "augmentation"),
            "{}",
            0,
            0,
        )


def test_augmentation_record_preserves_positional_job_id(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Positional job compatibility", description="")
    job = repo.create_job("augmentation", project_id=project["id"])

    augmentation = repo.create_augmentation_run_record(
        project["id"],
        None,
        "positional job",
        str(tmp_path / "augmentation"),
        "{}",
        1,
        1,
        job["id"],
        source_image_ids=["image-a"],
    )

    assert augmentation["job_id"] == job["id"]


@pytest.mark.parametrize(
    "source_image_ids",
    [None, "image-a", ["image-a", 1]],
)
def test_augmentation_record_rejects_malformed_source_image_ids(
    tmp_path: Path,
    source_image_ids: object,
) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Invalid provenance", description="")

    with pytest.raises(TypeError, match="source_image_ids must be a sequence of strings"):
        repo.create_augmentation_run_record(
            project["id"],
            None,
            "invalid provenance",
            str(tmp_path / "augmentation"),
            "{}",
            1,
            1,
            source_image_ids=source_image_ids,
        )


def test_restoring_one_removal_keeps_shared_lineage_outdated_until_all_restored(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Shared removal lineage", description="")
    images = [
        repo.create_image(project["id"], str(tmp_path / filename))
        for filename in ("a.jpg", "b.jpg")
    ]
    source_ids = sorted(image["id"] for image in images)
    augmentation = repo.create_augmentation_run_record(
        project["id"],
        None,
        "shared augmentation",
        str(tmp_path / "augmentation"),
        "{}",
        2,
        2,
        source_image_ids=source_ids,
    )
    split = repo.create_dataset_split_record(
        project_id=project["id"],
        name="shared split",
        train_ratio=0.5,
        val_ratio=0.5,
        test_ratio=0,
        output_dir=str(tmp_path / "split"),
        dataset_yaml_path=str(tmp_path / "split" / "dataset.yaml"),
        image_ids_json=json.dumps(
            {"train": [images[0]["id"]], "valid": [images[1]["id"]], "test": []}
        ),
    )
    operations = [
        repo.create_image_removal_operation(
            project["id"],
            image["id"],
            image["path"],
            str(tmp_path / "trash" / Path(image["path"]).name),
            None,
            None,
        )
        for image in images
    ]

    repo.restore_image_removal_operation(operations[0]["id"])

    remaining_id = images[1]["id"]
    remaining_reason = json.dumps(
        {"code": "project_image_removed", "image_ids": [remaining_id]},
        sort_keys=True,
        separators=(",", ":"),
    )
    assert repo.get_augmentation_run(augmentation["id"])["outdated"] is True
    assert repo.get_augmentation_run(augmentation["id"])["outdated_reason"] == remaining_reason
    assert repo.get_dataset_split(split["id"])["outdated"] is True
    assert repo.get_dataset_split(split["id"])["outdated_reason"] == remaining_reason

    repo.restore_image_removal_operation(operations[1]["id"])

    assert repo.get_augmentation_run(augmentation["id"])["outdated"] is False
    assert repo.get_dataset_split(split["id"])["outdated"] is False


def test_legacy_augmentation_is_stale_while_any_project_image_is_removed(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Legacy augmentation", description="")
    image = repo.create_image(project["id"], str(tmp_path / "source.jpg"))
    legacy_id = "legacy-augmentation"
    repo.db.execute(
        """
        insert into augmentation_runs
        (id, project_id, name, output_dir, settings_json,
         source_image_count, created_image_count, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            legacy_id,
            project["id"],
            "legacy",
            str(tmp_path / "legacy"),
            "{}",
            1,
            1,
            "legacy-created-at",
        ),
    )
    repo.db.commit()
    legacy = repo.get_augmentation_run(legacy_id)
    assert legacy is not None
    assert legacy["source_image_ids_json"] is None

    operation = repo.create_image_removal_operation(
        project["id"], image["id"], image["path"], None, None, None
    )

    loaded = repo.get_augmentation_run(legacy["id"])
    assert loaded is not None
    assert loaded["outdated"] is True
    assert json.loads(loaded["outdated_reason"])["image_ids"] == [image["id"]]

    repo.restore_image_removal_operation(operation["id"])

    assert repo.get_augmentation_run(legacy["id"])["outdated"] is False
    assert repo.get_augmentation_run(legacy["id"])["outdated_reason"] is None


def test_image_removal_metadata_and_staleness_roll_back_together(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Removal rollback", description="")
    image = repo.create_image(project["id"], str(tmp_path / "source.jpg"))
    repo.create_augmentation_run_record(
        project["id"],
        None,
        "rollback lineage",
        str(tmp_path / "augmentation"),
        "{}",
        1,
        1,
        source_image_ids=[image["id"]],
    )
    repo.db.execute(
        """
        create trigger fail_lineage_recompute
        before update of outdated on augmentation_runs
        begin
            select raise(abort, 'lineage recompute failed');
        end
        """
    )

    with pytest.raises(sqlite3.IntegrityError, match="lineage recompute failed"):
        repo.create_image_removal_operation(
            project["id"], image["id"], image["path"], None, None, None
        )

    assert repo.get_image(image["id"]) is not None
    operation_count = repo.db.execute(
        "select count(*) as count from image_removal_operations"
    ).fetchone()["count"]
    assert operation_count == 0


def test_restore_does_not_complete_history_for_a_different_active_operation(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Restore ownership", description="")
    image = repo.create_image(project["id"], str(tmp_path / "source.jpg"))
    operation = repo.create_image_removal_operation(
        project["id"], image["id"], image["path"], None, None, None
    )
    repo.db.execute(
        "update images set removal_operation_id = ? where id = ?",
        ("different-operation", image["id"]),
    )
    repo.db.commit()

    with pytest.raises(ValueError, match="does not own removed image"):
        repo.restore_image_removal_operation(operation["id"])

    loaded_operation = repo.get_image_removal_operation(operation["id"])
    removed_image = repo.get_image(image["id"], include_removed=True)
    assert loaded_operation is not None
    assert loaded_operation["restored_at"] is None
    assert removed_image is not None
    assert removed_image["removed_at"] is not None
    assert removed_image["removal_operation_id"] == "different-operation"


def test_review_source_groups_confidence_stats_and_bbox_histogram(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Review groups")
    schema = repo.create_class_schema(project["id"], "default", [{"class_id": 0, "class_name": "person", "descriptors": ["person"]}])
    pseudo_run = repo.create_pseudo_label_run_record(project["id"], schema["id"], None, "world.pt", str(tmp_path), .1, .7, 1, 1)
    augment_run = repo.create_augmentation_run_record(project["id"], pseudo_run["id"], "x3", str(tmp_path), "{}", 1, 1, source_image_ids=[])
    pseudo = repo.create_image(project["id"], str(tmp_path / "pseudo.jpg"), pseudo_label_run_id=pseudo_run["id"])
    augment = repo.create_image(project["id"], str(tmp_path / "augment.jpg"), augmentation_run_id=augment_run["id"])
    raw = repo.create_image(project["id"], str(tmp_path / "raw.jpg"))
    repo.replace_image_annotations(pseudo["id"], [
        {"class_id": 0, "class_name": "person", "x_center": .5, "y_center": .5, "width": .1, "height": .1, "confidence": .9},
        {"class_id": 0, "class_name": "person", "x_center": .5, "y_center": .5, "width": .4, "height": .5, "confidence": .6},
    ], "pending_review")
    repo.replace_image_annotations(augment["id"], [{"class_id": 0, "class_name": "person", "x_center": .5, "y_center": .5, "width": .8, "height": .8, "confidence": .4}], "pending_review")

    pseudo_rows = repo.list_images(project["id"], source_groups=["pseudo"])
    assert [row["id"] for row in pseudo_rows] == [pseudo["id"]]
    assert pseudo_rows[0]["mean_confidence"] == pytest.approx(.75)
    assert pseudo_rows[0]["min_confidence"] == pytest.approx(.6)
    assert pseudo_rows[0]["max_confidence"] == pytest.approx(.9)
    assert pseudo_rows[0]["low_confidence_count"] == 0
    assert raw["id"] not in {row["id"] for row in repo.list_images(project["id"], source_groups=["pseudo", "augment"])}
    assert repo.get_review_source_counts(project["id"]) == {"pseudo": 1, "augment": 1, "open_data": 0}
    histogram = repo.get_bbox_histogram(project["id"], ["pseudo"])
    assert histogram[0]["class_id"] == 0
    assert histogram[0]["class_name"] == "person"
    assert [bin["count"] for bin in histogram[0]["bins"]] == [0, 1, 0, 1, 0, 0]


def test_bbox_histogram_breaks_down_concentrated_small_boxes(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Small boxes")
    image = repo.create_image(project["id"], str(tmp_path / "small.jpg"))
    annotations = [
        {"class_id": 0, "class_name": "person", "x_center": .5, "y_center": .5, "width": width, "height": .1}
        for width in [.01, .03, .05, .07, .09] for _ in range(2)
    ]
    annotations.append({"class_id": 0, "class_name": "person", "x_center": .5, "y_center": .5, "width": 1, "height": 1})
    repo.replace_image_annotations(image["id"], annotations, "pending_review")
    bins = repo.get_bbox_histogram(project["id"])[0]["bins"]
    assert bins[:5] == [
        {"lower": 0, "upper": .2, "count": 2},
        {"lower": .2, "upper": .4, "count": 2},
        {"lower": .4, "upper": .6, "count": 2},
        {"lower": .6, "upper": .8, "count": 2},
        {"lower": .8, "upper": 1, "count": 2},
    ]
    assert sum(bin["count"] for bin in bins) == len(annotations)
    assert bins[-1] == {"lower": 50, "upper": 100, "count": 1}


def test_bbox_histogram_recursively_splits_a_still_overloaded_child(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Tiny boxes")
    image = repo.create_image(project["id"], str(tmp_path / "tiny.jpg"))
    annotations = [
        {"class_id": 0, "class_name": "person", "x_center": .5, "y_center": .5, "width": .001, "height": .1}
        for _ in range(10)
    ]
    annotations.append({"class_id": 0, "class_name": "person", "x_center": .5, "y_center": .5, "width": 1, "height": 1})
    repo.replace_image_annotations(image["id"], annotations, "pending_review")
    bins = repo.get_bbox_histogram(project["id"])[0]["bins"]
    dense = next(bin for bin in bins if bin["count"] == 10)
    assert dense["upper"] - dense["lower"] <= .04
    assert sum(bin["count"] for bin in bins) == len(annotations)
