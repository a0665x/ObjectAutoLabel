from pathlib import Path

import pytest

from backend.app import project_services
from backend.app.model_lineage import list_conversions
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def build_lineage(repo: Repository, tmp_path: Path) -> dict[str, dict[str, object]]:
    project = repo.create_project("History cascade")
    root = Path(project["root_path"])
    schema = repo.create_class_schema(
        project_id=project["id"],
        name="person-car-v1",
        classes=[{"class_id": 0, "class_name": "person", "descriptors": ["person"]}],
    )
    pseudo_dir = root / "pseudo_labels" / "pseudo-v1"
    augment_dir = root / "augmentations" / "augment-v1"
    split_dir = root / "splits" / "split-v1"
    training_root = root / "output_model" / "runs"
    train_dir = training_root / "train-v1"
    conversion_dir = root / "output_model" / "conversions" / "conversion-001"
    export_dir = root / "output_model" / "exports" / "export-001"
    for directory in (pseudo_dir, augment_dir, split_dir, train_dir, conversion_dir, export_dir):
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "artifact.txt").write_text("artifact", encoding="utf-8")

    pseudo = repo.create_pseudo_label_run_record(
        project_id=project["id"], schema_id=schema["id"], source_asset_id=None,
        world_model="world.pt", output_dir=str(pseudo_dir), confidence=0.1, iou=0.7,
        image_count=1, labeled_count=1, run_name="people-v1",
    )
    augment = repo.create_augmentation_run_record(
        project_id=project["id"], pseudo_label_run_id=pseudo["id"], name="mirror-v1",
        output_dir=str(augment_dir), settings_json="{}", source_image_count=1,
        created_image_count=1, source_image_ids=[],
    )
    split = repo.create_dataset_split_record(
        project_id=project["id"], name="80-10-10-v1", train_ratio=0.8,
        val_ratio=0.1, test_ratio=0.1, output_dir=str(split_dir),
        dataset_yaml_path=str(split_dir / "dataset.yaml"), image_ids_json="{}",
        pseudo_label_run_id=pseudo["id"], augmentation_run_id=augment["id"],
    )
    training = repo.create_training_run_record(
        project_id=project["id"], dataset_split_id=split["id"], input_model="yolo11n.pt",
        output_dir=str(training_root), run_name="detector-v1",
        settings={"optimizer": "MuSGD", "epochs": 100, "imgsz": 640},
    )
    best_path = train_dir / "best.pt"
    best_path.write_bytes(b"weights")
    repo.update_training_run(
        training["id"], status="completed", save_dir=str(train_dir),
        best_model_path=str(best_path), last_model_path=str(train_dir / "last.pt"),
    )
    training = repo.get_training_run(training["id"])
    assert training is not None
    conversion = repo.create_model_conversion_run(
        project_id=project["id"], training_run_id=training["id"],
        source_model_path=str(best_path), package_name="conversion-001",
        output_dir=str(conversion_dir), schema_id=schema["id"], schema_name=schema["name"],
        schema_snapshot=[{"id": 0, "name": "person"}], status="completed",
    )
    bundle = repo.create_model_export_bundle(
        project_id=project["id"], conversion_run_id=conversion["id"],
        bundle_name="export-001", output_dir=str(export_dir),
        included_artifacts_json="[]", status="completed",
    )
    return {
        "project": project, "pseudo": pseudo, "augment": augment, "split": split,
        "training": training, "conversion": conversion, "bundle": bundle,
    }


def test_deleting_training_history_cascades_conversion_and_export_records_and_files(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    lineage = build_lineage(repo, tmp_path)

    result = project_services.delete_history_artifact(
        repo, lineage["project"]["id"], "training", lineage["training"]["id"]
    )

    assert result["deleted"] == {
        "training": 1,
        "conversion": 1,
        "export": 1,
    }
    assert repo.list_training_runs(lineage["project"]["id"]) == []
    assert repo.list_model_conversion_runs(lineage["project"]["id"]) == []
    assert repo.list_model_export_bundles(lineage["project"]["id"]) == []
    assert not Path(lineage["training"]["save_dir"]).exists()
    assert Path(lineage["training"]["output_dir"]).is_dir()
    assert not Path(lineage["conversion"]["output_dir"]).exists()
    assert not Path(lineage["bundle"]["output_dir"]).exists()
    assert repo.list_dataset_splits(lineage["project"]["id"])


def test_deleting_upstream_history_cascades_every_dependent_history_record(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    lineage = build_lineage(repo, tmp_path)

    result = project_services.delete_history_artifact(
        repo, lineage["project"]["id"], "pseudo", lineage["pseudo"]["id"]
    )

    assert result["deleted"] == {
        "pseudo": 1,
        "augmentation": 1,
        "split": 1,
        "training": 1,
        "conversion": 1,
        "export": 1,
    }
    assert repo.list_pseudo_label_runs(lineage["project"]["id"]) == []
    assert repo.list_augmentation_runs(lineage["project"]["id"]) == []
    assert repo.list_dataset_splits(lineage["project"]["id"]) == []
    assert repo.list_training_runs(lineage["project"]["id"]) == []


def test_deleting_open_data_history_cascades_downstream_but_keeps_shared_cache(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    lineage = build_lineage(repo, tmp_path)
    cache_dir = tmp_path / "data" / "opendata" / "shared-dataset"
    cache_dir.mkdir(parents=True)
    (cache_dir / "source.jpg").write_bytes(b"source")
    job = repo.create_job("open_data_import", project_id=lineage["project"]["id"])
    imported, _ = repo.replace_active_open_data_import(
        import_id="open-data-v1",
        project_id=lineage["project"]["id"],
        dataset_key="shared-dataset",
        version_name="aerial-v1",
        schema_id=lineage["pseudo"]["schema_id"],
        mapping={"person": 0},
        sample_percentage=50,
        random_seed=42,
        project_dir=str(cache_dir),
        summary={
            "source_image_count": 1,
            "eligible_image_count": 1,
            "selected_image_count": 0,
            "selected_annotation_count": 0,
        },
        images=[],
        job_id=job["id"],
    )
    repo.db.execute(
        "update dataset_splits set open_data_import_id = ? where id = ?",
        (imported["id"], lineage["split"]["id"]),
    )
    repo.update_job(job["id"], status="completed")

    result = project_services.delete_history_artifact(
        repo, lineage["project"]["id"], "open_data", imported["id"]
    )

    assert result["deleted"] == {
        "open_data": 1,
        "split": 1,
        "training": 1,
        "conversion": 1,
        "export": 1,
    }
    assert repo.list_open_data_imports(lineage["project"]["id"]) == []
    assert repo.list_pseudo_label_runs(lineage["project"]["id"])
    assert repo.list_augmentation_runs(lineage["project"]["id"])
    assert cache_dir.is_dir()


def test_deleting_current_split_promotes_newest_remaining_split(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    lineage = build_lineage(repo, tmp_path)
    older = lineage["split"]
    newer_dir = Path(lineage["project"]["root_path"]) / "splits" / "split-v2"
    newer_dir.mkdir(parents=True)
    newer = repo.create_dataset_split_record(
        project_id=lineage["project"]["id"], name="80-10-10-v2", train_ratio=0.8,
        val_ratio=0.1, test_ratio=0.1, output_dir=str(newer_dir),
        dataset_yaml_path=str(newer_dir / "dataset.yaml"), image_ids_json="{}",
    )

    project_services.delete_history_artifact(
        repo, lineage["project"]["id"], "split", newer["id"]
    )

    remaining = repo.get_dataset_split(older["id"])
    assert remaining is not None
    assert remaining["is_current"] is True


def test_history_deletion_refuses_a_running_related_job(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    lineage = build_lineage(repo, tmp_path)
    job = repo.create_job(
        "training", project_id=lineage["project"]["id"], related_type="training_run"
    )
    repo.db.execute(
        "update training_runs set job_id = ? where id = ?",
        (job["id"], lineage["training"]["id"]),
    )

    with pytest.raises(ValueError, match="still running"):
        project_services.delete_history_artifact(
            repo, lineage["project"]["id"], "training", lineage["training"]["id"]
        )


def test_model_source_and_conversion_labels_use_compact_named_lineage(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    lineage = build_lineage(repo, tmp_path)

    source = project_services.list_project_model_sources(repo, lineage["project"]["id"])[0]
    conversion = list_conversions(repo, lineage["project"]["id"])[0]

    assert source["label"] == (
        "[Pseudo · people-v1] → [Augment · mirror-v1] → [Split · 80-10-10-v1] "
        "→ [Train · detector-v1] · best.pt"
    )
    assert "MuSGD" not in source["label"]
    assert "640" not in source["label"]
    assert conversion["display_label"].startswith(
        "[Pseudo · people-v1] → [Augment · mirror-v1] → [Split · 80-10-10-v1] "
        "→ [Train · detector-v1] → [Convert · conversion-001]"
    )


def test_history_deletion_keeps_an_output_directory_referenced_by_another_record(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    lineage = build_lineage(repo, tmp_path)
    pseudo = lineage["pseudo"]
    sibling = repo.create_pseudo_label_run_record(
        project_id=lineage["project"]["id"], schema_id=pseudo["schema_id"],
        source_asset_id=None, world_model="world.pt", output_dir=pseudo["output_dir"],
        confidence=0.2, iou=0.6, image_count=1, labeled_count=1,
        run_name="people-v2",
    )

    project_services.delete_history_artifact(
        repo, lineage["project"]["id"], "pseudo", pseudo["id"]
    )

    assert repo.get_pseudo_label_run(sibling["id"]) is not None
    assert Path(pseudo["output_dir"]).is_dir()
