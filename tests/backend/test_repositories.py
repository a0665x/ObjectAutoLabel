from pathlib import Path

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
