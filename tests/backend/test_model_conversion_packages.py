import json
from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_repository_stores_conversion_package_with_artifacts_and_schema_snapshot(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Convert Project")
    split = repo.create_dataset_split_record(
        project_id=project["id"],
        name="main",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(tmp_path / "split"),
        dataset_yaml_path=str(tmp_path / "split" / "dataset.yaml"),
        image_ids_json="[]",
    )
    training = repo.create_training_run_record(
        project_id=project["id"],
        dataset_split_id=split["id"],
        input_model="yolov8n.pt",
        output_dir=str(tmp_path / "output_model" / project["id"]),
    )
    schema = repo.create_class_schema(
        project["id"],
        "hardware",
        [
            {"class_id": 0, "class_name": "bolt", "descriptors": ["bolt"]},
            {"class_id": 1, "class_name": "nut", "descriptors": ["nut"]},
        ],
    )
    schema_snapshot = [{"id": 0, "name": "bolt"}, {"id": 1, "name": "nut"}]

    conversion = repo.create_model_conversion_run(
        project_id=project["id"],
        training_run_id=training["id"],
        source_model_path=str(tmp_path / "best.pt"),
        package_name="convert-main",
        output_dir=str(tmp_path / "output_model" / project["id"] / "conversions" / "convert-main"),
        schema_id=schema["id"],
        schema_name="hardware",
        schema_snapshot=schema_snapshot,
        status="completed",
        job_id="job-1",
    )
    artifact = repo.add_model_conversion_artifact(
        conversion_id=conversion["id"],
        project_id=project["id"],
        format="onnx",
        precision="fp32",
        output_path=str(tmp_path / "model.onnx"),
        status="completed",
    )

    listed = repo.list_model_conversion_runs(project["id"])
    loaded = repo.get_model_conversion_run(conversion["id"])

    assert listed[0]["id"] == conversion["id"]
    assert listed[0]["artifacts"][0]["id"] == artifact["id"]
    assert loaded is not None
    assert json.loads(loaded["schema_snapshot_json"]) == schema_snapshot
    assert loaded["schema_snapshot"] == schema_snapshot
    assert loaded["artifacts"][0]["format"] == "onnx"
    assert loaded["artifacts"][0]["precision"] == "fp32"


def test_repository_stores_export_bundle_for_conversion_package(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Bundle Project")
    split = repo.create_dataset_split_record(
        project_id=project["id"],
        name="main",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(tmp_path / "split"),
        dataset_yaml_path=str(tmp_path / "split" / "dataset.yaml"),
        image_ids_json="[]",
    )
    training = repo.create_training_run_record(
        project_id=project["id"],
        dataset_split_id=split["id"],
        input_model="yolov8n.pt",
        output_dir=str(tmp_path / "output_model" / project["id"]),
    )
    schema = repo.create_class_schema(
        project["id"],
        "hardware",
        [{"class_id": 0, "class_name": "bolt", "descriptors": ["bolt"]}],
    )
    conversion = repo.create_model_conversion_run(
        project_id=project["id"],
        training_run_id=training["id"],
        source_model_path=str(tmp_path / "best.pt"),
        package_name="convert-main",
        output_dir=str(tmp_path / "conversion"),
        schema_id=schema["id"],
        schema_name="hardware",
        schema_snapshot=[{"id": 0, "name": "bolt"}],
        status="completed",
    )

    bundle = repo.create_model_export_bundle(
        project_id=project["id"],
        conversion_run_id=conversion["id"],
        bundle_name="deploy-main",
        output_dir=str(tmp_path / "bundle"),
        included_artifacts_json=json.dumps(["native_pt", "classes_json", "metadata_json"]),
        status="completed",
        job_id="job-2",
    )

    bundles = repo.list_model_export_bundles(project["id"])

    assert bundles[0]["id"] == bundle["id"]
    assert bundles[0]["conversion_run_id"] == conversion["id"]
    assert bundles[0]["included_artifacts"] == ["native_pt", "classes_json", "metadata_json"]
