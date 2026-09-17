from pathlib import Path

from backend.app import project_services
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    paths = AppPaths(project_root=tmp_path)
    paths.output_model_dir.mkdir(parents=True, exist_ok=True)
    return Repository(db=db, paths=paths)


def test_model_sources_include_training_runs_discovered_project_models_and_loose_outputs(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Main")
    other_project = repo.create_project("Other")
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
        output_dir=str(repo.paths.output_model_dir / project["id"]),
        run_name="Train_augx3_v002",
    )
    trained_best = repo.paths.output_model_dir / project["id"] / "train" / "weights" / "best.pt"
    discovered_same_project = repo.paths.output_model_dir / project["id"] / "train2" / "weights" / "best.pt"
    discovered_other_project = repo.paths.output_model_dir / other_project["id"] / "train" / "weights" / "best.pt"
    loose_model = repo.paths.output_model_dir / "best_202507141626.pt"
    for path in (trained_best, discovered_same_project, discovered_other_project, loose_model):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("pt", encoding="utf-8")
    repo.update_training_run(training["id"], best_model_path=str(trained_best), status="completed")

    sources = project_services.list_project_model_sources(repo, project["id"])
    by_relative = {source["relative_path"]: source for source in sources}

    assert by_relative[f"{project['id']}/train/weights/best.pt"]["source_type"] == "training_run"
    assert "Train_augx3_v002" in by_relative[f"{project['id']}/train/weights/best.pt"]["label"]
    assert by_relative[f"{project['id']}/train2/weights/best.pt"]["scope"] == "current_project"
    assert by_relative[f"{other_project['id']}/train/weights/best.pt"]["scope"] == "other_project"
    assert by_relative["best_202507141626.pt"]["scope"] == "loose_output"


def test_artifact_context_summarizes_project_portfolio(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Context")
    repo.create_class_schema(project["id"], "schema", [{"class_id": 0, "class_name": "bolt", "descriptors": ["bolt"]}])
    model_path = repo.paths.output_model_dir / project["id"] / "train" / "weights" / "best.pt"
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.write_text("pt", encoding="utf-8")

    context = project_services.get_project_artifact_context(repo, project["id"])

    assert context["project"]["id"] == project["id"]
    assert context["counts"]["class_schemas"] == 1
    assert context["counts"]["model_sources"] == 1
    assert context["model_sources"][0]["relative_path"] == f"{project['id']}/train/weights/best.pt"


def test_conversion_package_accepts_direct_source_model_path(tmp_path: Path, monkeypatch) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Direct Convert")
    schema = repo.create_class_schema(project["id"], "schema", [{"class_id": 0, "class_name": "bolt", "descriptors": ["bolt"]}])
    model_path = repo.paths.output_model_dir / "loose.pt"
    model_path.write_text("pt", encoding="utf-8")

    def fake_export(source_model: Path, output_dir: Path, target: dict, imgsz: int) -> Path:
        output = output_dir / "model-onnx-fp32.onnx"
        output.write_text(source_model.name, encoding="utf-8")
        return output

    monkeypatch.setattr(project_services, "_export_conversion_artifact", fake_export)
    monkeypatch.setattr(project_services.platform, "machine", lambda: "x86_64")

    conversion = project_services.create_model_conversion_package(
        repo,
        project["id"],
        training_run_id=None,
        schema_id=schema["id"],
        targets=[{"format": "onnx", "precision": "fp32"}],
        imgsz=640,
        source_model_path=str(model_path),
        job_id="job-1",
    )

    assert conversion["source_model_path"] == str(model_path)
    assert conversion["training_run_id"] is None
