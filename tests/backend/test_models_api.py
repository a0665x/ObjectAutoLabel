from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app import main


def test_model_endpoints_return_lists(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir()
    paths.input_model_dir.mkdir()
    paths.output_model_dir.mkdir()
    (paths.world_model_dir / "yolov8s-world.pt").write_text("", encoding="utf-8")
    (paths.input_model_dir / "yolov8n.pt").write_text("", encoding="utf-8")
    (paths.output_model_dir / "best.pt").write_text("", encoding="utf-8")
    (paths.output_model_dir / "best.pth").write_text("", encoding="utf-8")
    with connect(tmp_path / "test.db") as db:
        initialize_schema(db)
        models = Repository(db=db, paths=paths).list_models()

    assert models["world_models"] == ["yolov8s-world.pt"]
    assert models["input_models"] == ["yolov8n.pt"]
    assert models["output_models"] == ["best.pt", "best.pth"]


def test_model_endpoints_include_nested_output_model_paths(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir()
    paths.input_model_dir.mkdir()
    (paths.output_model_dir / "project-a").mkdir(parents=True)
    (paths.world_model_dir / "yolov8s-world.pt").write_text("", encoding="utf-8")
    (paths.input_model_dir / "yolov8n.pt").write_text("", encoding="utf-8")
    (paths.output_model_dir / "project-a" / "best.pt").write_text("", encoding="utf-8")
    (paths.output_model_dir / "project-a" / "best.onnx").write_text("", encoding="utf-8")

    with connect(tmp_path / "test.db") as db:
        initialize_schema(db)
        models = Repository(db=db, paths=paths).list_models()

    assert models["world_models"] == ["yolov8s-world.pt"]
    assert models["input_models"] == ["yolov8n.pt"]
    assert models["output_models"] == ["project-a/best.pt", "project-a/best.onnx"]


def test_world_model_endpoint_includes_capability_metadata(tmp_path: Path, monkeypatch) -> None:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir()
    (paths.world_model_dir / "yoloe-26n-seg.pt").write_bytes(b"weights")
    (paths.world_model_dir / "yolov8m-world.pt").write_bytes(b"weights")
    (paths.world_model_dir / "ViT-B-32.pt").write_bytes(b"encoder")
    with connect(tmp_path / "test.db") as db:
        initialize_schema(db)
        monkeypatch.setattr(main, "repo", Repository(db=db, paths=paths))
        response = main.list_world_models()

    assert response["world_models"] == ["yoloe-26n-seg.pt", "yolov8m-world.pt"]
    assert response["world_model_details"][0]["family"] == "yoloe-26"
    assert response["world_model_details"][0]["annotation_output"] == "bbox"


def test_pseudo_label_endpoint_rejects_unsupported_model_before_creating_job(tmp_path: Path, monkeypatch) -> None:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir()
    (paths.world_model_dir / "mystery.pt").write_bytes(b"weights")
    with connect(tmp_path / "test.db") as db:
        initialize_schema(db)
        repo = Repository(db=db, paths=paths)
        project = repo.create_project("Unsupported model")
        schema = repo.create_class_schema(project["id"], "parts", [{"class_id": 0, "class_name": "bolt"}])
        monkeypatch.setattr(main, "repo", repo)
        monkeypatch.setattr(main.jobs, "create", lambda *args, **kwargs: pytest.fail("job must not be created"))

        with pytest.raises(HTTPException, match="Unsupported world model"):
            main.create_pseudo_label_run(
                project["id"],
                main.PseudoLabelRunCreate(schema_id=schema["id"], world_model="mystery.pt"),
            )


def test_pseudo_label_endpoint_rejects_missing_encoder_before_creating_job(tmp_path: Path, monkeypatch) -> None:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir()
    (paths.world_model_dir / "yoloe-26n-seg.pt").write_bytes(b"weights")
    with connect(tmp_path / "test.db") as db:
        initialize_schema(db)
        repo = Repository(db=db, paths=paths)
        project = repo.create_project("Missing encoder")
        schema = repo.create_class_schema(project["id"], "parts", [{"class_id": 0, "class_name": "bolt"}])
        monkeypatch.setattr(main, "repo", repo)
        monkeypatch.setattr(main.jobs, "create", lambda *args, **kwargs: pytest.fail("job must not be created"))

        with pytest.raises(HTTPException, match="Prompt encoder mobileclip2_b.ts is not installed"):
            main.create_pseudo_label_run(
                project["id"],
                main.PseudoLabelRunCreate(schema_id=schema["id"], world_model="yoloe-26n-seg.pt"),
            )


def test_pseudo_label_endpoint_rejects_model_paths_outside_world_model_dir(tmp_path: Path, monkeypatch) -> None:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir()
    paths.input_model_dir.mkdir()
    (paths.input_model_dir / "yolov8s-world.pt").write_bytes(b"weights")
    with connect(tmp_path / "test.db") as db:
        initialize_schema(db)
        repo = Repository(db=db, paths=paths)
        project = repo.create_project("Escaped model")
        schema = repo.create_class_schema(project["id"], "parts", [{"class_id": 0, "class_name": "bolt"}])
        monkeypatch.setattr(main, "repo", repo)
        monkeypatch.setattr(main.jobs, "create", lambda *args, **kwargs: pytest.fail("job must not be created"))

        with pytest.raises(HTTPException, match="World model must be a filename"):
            main.create_pseudo_label_run(
                project["id"],
                main.PseudoLabelRunCreate(schema_id=schema["id"], world_model="../input_model/yolov8s-world.pt"),
            )


def test_pseudo_label_endpoint_rejects_checkpoint_symlink_escape_before_creating_job(tmp_path: Path, monkeypatch) -> None:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir()
    escaped_checkpoint = tmp_path / "outside-yolov8s-world.pt"
    escaped_checkpoint.write_bytes(b"weights")
    (paths.world_model_dir / "yolov8s-world.pt").symlink_to(escaped_checkpoint)
    (paths.world_model_dir / "ViT-B-32.pt").write_bytes(b"encoder")
    with connect(tmp_path / "test.db") as db:
        initialize_schema(db)
        repo = Repository(db=db, paths=paths)
        project = repo.create_project("Checkpoint escape")
        schema = repo.create_class_schema(project["id"], "parts", [{"class_id": 0, "class_name": "bolt"}])
        monkeypatch.setattr(main, "repo", repo)
        monkeypatch.setattr(main.jobs, "create", lambda *args, **kwargs: pytest.fail("job must not be created"))

        with pytest.raises(HTTPException, match="must stay within world_model"):
            main.create_pseudo_label_run(project["id"], main.PseudoLabelRunCreate(schema_id=schema["id"], world_model="yolov8s-world.pt"))


def test_pseudo_label_endpoint_rejects_encoder_symlink_escape_before_creating_job(tmp_path: Path, monkeypatch) -> None:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir()
    (paths.world_model_dir / "yolov8s-world.pt").write_bytes(b"weights")
    escaped_encoder = tmp_path / "outside-ViT-B-32.pt"
    escaped_encoder.write_bytes(b"encoder")
    (paths.world_model_dir / "ViT-B-32.pt").symlink_to(escaped_encoder)
    with connect(tmp_path / "test.db") as db:
        initialize_schema(db)
        repo = Repository(db=db, paths=paths)
        project = repo.create_project("Encoder escape")
        schema = repo.create_class_schema(project["id"], "parts", [{"class_id": 0, "class_name": "bolt"}])
        monkeypatch.setattr(main, "repo", repo)
        monkeypatch.setattr(main.jobs, "create", lambda *args, **kwargs: pytest.fail("job must not be created"))

        with pytest.raises(HTTPException, match="must stay within world_model"):
            main.create_pseudo_label_run(project["id"], main.PseudoLabelRunCreate(schema_id=schema["id"], world_model="yolov8s-world.pt"))
