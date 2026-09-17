import json
from pathlib import Path

import pytest

from backend.app import project_services
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def make_training_context(tmp_path: Path) -> tuple[Repository, dict, dict, dict]:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Convert Services")
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
        output_dir=str(Path(project["root_path"]) / "output_model" / "runs"),
    )
    source_model = Path(project["root_path"]) / "output_model" / "runs" / "weights" / "best.pt"
    source_model.parent.mkdir(parents=True)
    source_model.write_text("pt", encoding="utf-8")
    repo.update_training_run(training["id"], best_model_path=str(source_model), status="completed")
    schema = repo.create_class_schema(
        project["id"],
        "hardware",
        [
            {"class_id": 0, "class_name": "bolt", "descriptors": ["bolt"]},
            {"class_id": 1, "class_name": "nut", "descriptors": ["nut"]},
        ],
    )
    return repo, project, training, schema


def test_create_model_conversion_package_writes_schema_and_metadata(
    tmp_path: Path, monkeypatch
) -> None:
    repo, project, training, schema = make_training_context(tmp_path)

    def fake_export(source_model: Path, output_dir: Path, target: dict, imgsz: int) -> Path:
        suffix = ".onnx" if target["format"] == "onnx" else ".tflite"
        output = output_dir / f"model-{target['format']}-{target['precision']}{suffix}"
        output.write_text(f"{source_model.name}:{imgsz}", encoding="utf-8")
        return output

    monkeypatch.setattr(project_services, "_export_conversion_artifact", fake_export)
    monkeypatch.setattr(project_services.platform, "machine", lambda: "x86_64")

    conversion = project_services.create_model_conversion_package(
        repo,
        project["id"],
        training["id"],
        schema["id"],
        targets=[{"format": "onnx", "precision": "fp32"}, {"format": "tflite", "precision": "fp32"}],
        imgsz=640,
        job_id="job-1",
    )

    classes = json.loads((Path(conversion["output_dir"]) / "classes.json").read_text(encoding="utf-8"))
    metadata = json.loads((Path(conversion["output_dir"]) / "metadata.json").read_text(encoding="utf-8"))

    assert classes == [{"id": 0, "name": "bolt"}, {"id": 1, "name": "nut"}]
    assert metadata["training_run_id"] == training["id"]
    assert metadata["schema_name"] == "hardware"
    assert metadata["export_settings"] == {
        "imgsz": 640,
        "onnx_opset": 11,
        "layouts": {"onnx/fp32": "NCHW", "tflite/fp32": "NCHW"},
    }
    assert [(item["format"], item["precision"]) for item in metadata["artifacts"]] == [
        ("onnx", "fp32"),
        ("tflite", "fp32"),
    ]
    assert conversion["manifest_path"].endswith("metadata.json")
    assert len(conversion["artifacts"]) == 2
    assert Path(conversion["output_dir"]).is_relative_to(Path(project["root_path"]) / "output_model" / "conversions")


def test_create_model_export_bundle_writes_bundle_manifest(tmp_path: Path, monkeypatch) -> None:
    repo, project, training, schema = make_training_context(tmp_path)

    def fake_export(source_model: Path, output_dir: Path, target: dict, imgsz: int) -> Path:
        output = output_dir / f"model-{target['format']}-{target['precision']}.onnx"
        output.write_text("converted", encoding="utf-8")
        return output

    monkeypatch.setattr(project_services, "_export_conversion_artifact", fake_export)
    monkeypatch.setattr(project_services.platform, "machine", lambda: "x86_64")
    conversion = project_services.create_model_conversion_package(
        repo,
        project["id"],
        training["id"],
        schema["id"],
        targets=[{"format": "onnx", "precision": "fp32"}],
        imgsz=640,
        job_id="job-1",
    )

    bundle = project_services.create_model_export_bundle(
        repo,
        project["id"],
        conversion["id"],
        include_artifact_ids=[conversion["artifacts"][0]["id"]],
        include_native_pt=True,
        job_id="job-2",
    )
    bundle_manifest = json.loads((Path(bundle["output_dir"]) / "bundle.json").read_text(encoding="utf-8"))

    assert bundle["conversion_run_id"] == conversion["id"]
    assert Path(bundle["output_dir"]).is_relative_to(Path(project["root_path"]) / "output_model" / "exports")
    assert "native_pt" in bundle["included_artifacts"]
    assert conversion["artifacts"][0]["id"] in bundle["included_artifacts"]
    assert bundle_manifest["conversion_run_id"] == conversion["id"]
    assert bundle_manifest["files"]["classes_json"].endswith("classes.json")
    assert bundle_manifest["files"]["metadata_json"].endswith("metadata.json")


def test_failed_opset_export_marks_conversion_failed(tmp_path, monkeypatch):
    repo, project, training, schema = make_training_context(tmp_path)
    def fail(source, output, target, imgsz):
        assert target["opset"] == 17
        raise RuntimeError("ONNX opset 17 conversion failed: unsupported operator")
    monkeypatch.setattr(project_services, "_export_conversion_artifact", fail)
    monkeypatch.setattr(project_services.platform, "machine", lambda: "x86_64")
    with pytest.raises(RuntimeError, match="ONNX opset 17 conversion failed"):
        project_services.create_model_conversion_package(repo, project["id"], training["id"], schema["id"],
            targets=[{"format": "onnx", "precision": "fp32"}], imgsz=64, opset=17, job_id="failed-job")
    runs = repo.list_model_conversion_runs(project["id"])
    assert len(runs) == 1 and runs[0]["status"] == "failed"
    assert not runs[0]["artifacts"]


def test_create_model_export_bundle_zip_includes_native_schema_and_completed_artifacts(tmp_path: Path, monkeypatch) -> None:
    repo, project, training, schema = make_training_context(tmp_path)

    def fake_export(source_model: Path, output_dir: Path, target: dict, imgsz: int) -> Path:
        suffix = ".onnx" if target["format"] == "onnx" else ".tflite"
        output = output_dir / f"model-{target['format']}-{target['precision']}{suffix}"
        output.write_text(f"{source_model.name}:{imgsz}", encoding="utf-8")
        return output

    monkeypatch.setattr(project_services, "_export_conversion_artifact", fake_export)
    monkeypatch.setattr(project_services.platform, "machine", lambda: "x86_64")
    conversion = project_services.create_model_conversion_package(
        repo,
        project["id"],
        training["id"],
        schema["id"],
        targets=[{"format": "onnx", "precision": "fp32"}, {"format": "tflite", "precision": "fp32"}],
        imgsz=640,
        job_id="job-1",
    )

    run_dir = Path(training["output_dir"])
    (run_dir / "args.yaml").write_text("epochs: 1\n", encoding="utf-8")
    (run_dir / "results.csv").write_text("epoch,loss\n1,0.1\n", encoding="utf-8")
    (run_dir / "results.png").write_bytes(b"plot")
    (run_dir / "secret.env").write_text("private", encoding="utf-8")
    external = tmp_path / "external.csv"
    external.write_text("external", encoding="utf-8")
    (run_dir / "escaped.csv").symlink_to(external)
    bundle, zip_path = project_services.create_model_export_bundle_zip(repo, project["id"], conversion["id"])

    import zipfile

    assert bundle["status"] == "completed"
    assert zip_path.exists()
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
    assert {"training/args.yaml", "training/results/results.csv", "training/results/results.png", "training/run.json"}.issubset(names)
    assert "training/results/escaped.csv" not in names
    assert "training/secret.env" not in names
    assert {"best.pt", "classes.json", "metadata.json", "bundle.json", "model-onnx-fp32.onnx", "model-tflite-fp32.tflite"}.issubset(names)


def test_create_model_conversion_rejects_aarch64_before_storage_or_database_side_effects(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo, project, training, schema = make_training_context(tmp_path)
    conversion_root = Path(project["root_path"]) / "output_model" / "conversions"
    monkeypatch.setattr(project_services.platform, "machine", lambda: "aarch64")

    with pytest.raises(RuntimeError, match="Copy the .pt checkpoint to an x86_64 host"):
        project_services.create_model_conversion_package(
            repo,
            project["id"],
            training["id"],
            schema["id"],
            targets=[{"format": "onnx", "precision": "fp32"}],
            imgsz=640,
            job_id="job-1",
        )

    assert repo.list_model_conversion_runs(project["id"]) == []
    assert list(conversion_root.glob("conversion-*")) == []


def test_create_model_conversion_rejects_non_fp32_before_storage_side_effects(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo, project, training, schema = make_training_context(tmp_path)
    conversion_root = Path(project["root_path"]) / "output_model" / "conversions"
    monkeypatch.setattr(project_services.platform, "machine", lambda: "x86_64")

    with pytest.raises(ValueError, match="Unsupported conversion target"):
        project_services.create_model_conversion_package(
            repo,
            project["id"],
            training["id"],
            schema["id"],
            targets=[{"format": "tflite", "precision": "int8"}],
            imgsz=640,
            job_id="job-1",
        )

    assert repo.list_model_conversion_runs(project["id"]) == []
    assert list(conversion_root.glob("conversion-*")) == []
