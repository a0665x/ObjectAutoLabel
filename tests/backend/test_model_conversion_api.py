from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.app import main
from backend.app.conversion_runtime import detect_conversion_capabilities
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app.schemas import ModelConversionCreate, ModelExportBundleCreate


class FakeJobs:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def create(self, name: str, fn: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        self.calls.append({"name": name, "fn": fn, "args": args, "kwargs": kwargs})
        return {"id": "job-1", "name": name, "status": "queued", "progress": 0, "message": "Queued"}


def test_model_conversion_request_rejects_non_fp32_precision() -> None:
    with pytest.raises(ValidationError):
        ModelConversionCreate(
            schema_id="schema",
            source_model_path="model.pt",
            targets=[{"format": "tflite", "precision": "int8"}],
        )


def test_model_conversion_request_rejects_duplicate_targets() -> None:
    with pytest.raises(ValidationError, match="Duplicate conversion target"):
        ModelConversionCreate(
            schema_id="schema",
            source_model_path="model.pt",
            targets=[
                {"format": "onnx", "precision": "fp32"},
                {"format": "onnx", "precision": "fp32"},
            ],
        )


def test_model_conversion_request_accepts_litert_nhwc_but_not_onnx_nhwc() -> None:
    request = ModelConversionCreate(
        schema_id="schema",
        source_model_path="model.pt",
        targets=[{"format": "tflite", "precision": "fp32", "layout": "NHWC"}],
    )
    assert request.targets[0].layout == "NHWC"
    with pytest.raises(ValidationError, match="ONNX conversion uses NCHW layout"):
        ModelConversionCreate(
            schema_id="schema",
            source_model_path="model.pt",
            targets=[{"format": "onnx", "precision": "fp32", "layout": "NHWC"}],
        )


def make_repo(tmp_path: Path) -> tuple[Repository, dict, dict, dict]:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("API Convert")
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
    return repo, project, training, schema


def test_create_model_conversion_endpoint_starts_conversion_job(tmp_path: Path, monkeypatch) -> None:
    repo, project, training, schema = make_repo(tmp_path)
    fake_jobs = FakeJobs()
    monkeypatch.setattr(main, "repo", repo)
    monkeypatch.setattr(main, "jobs", fake_jobs)
    monkeypatch.setattr(
        main,
        "detect_conversion_capabilities",
        lambda: detect_conversion_capabilities("x86_64"),
    )

    response = main.create_model_conversion(
        project["id"],
        ModelConversionCreate(
            training_run_id=training["id"],
            schema_id=schema["id"],
            targets=[{"format": "onnx", "precision": "fp32"}],
            imgsz=640,
        ),
    )

    assert response["name"] == "model_conversion"
    assert fake_jobs.calls[0]["name"] == "model_conversion"
    assert fake_jobs.calls[0]["kwargs"]["related_type"] == "model_conversion"
    assert fake_jobs.calls[0]["kwargs"]["opset"] == 11


@pytest.mark.parametrize("opset", [0, 10, 21])
def test_opset_request_rejects_unsupported_range(opset):
    with pytest.raises(ValidationError):
        ModelConversionCreate(schema_id="schema", source_model_path="model.pt", targets=[{"format": "onnx"}], opset=opset)


def test_opset_request_preserves_explicit_version():
    assert ModelConversionCreate(schema_id="schema", source_model_path="model.pt", targets=[{"format": "onnx"}], opset=17).opset == 17


def test_conversion_capabilities_endpoint_reports_runtime_architecture(monkeypatch) -> None:
    expected = detect_conversion_capabilities("aarch64")
    monkeypatch.setattr(main, "detect_conversion_capabilities", lambda: expected)

    response = main.list_model_conversion_capabilities()

    assert response == expected


def test_aarch64_conversion_request_fails_before_job_creation(tmp_path: Path, monkeypatch) -> None:
    repo, project, training, schema = make_repo(tmp_path)
    fake_jobs = FakeJobs()
    monkeypatch.setattr(main, "repo", repo)
    monkeypatch.setattr(main, "jobs", fake_jobs)
    monkeypatch.setattr(
        main,
        "detect_conversion_capabilities",
        lambda: detect_conversion_capabilities("aarch64"),
    )

    with pytest.raises(HTTPException, match="Copy the .pt checkpoint to an x86_64 host") as exc_info:
        main.create_model_conversion(
            project["id"],
            ModelConversionCreate(
                training_run_id=training["id"],
                schema_id=schema["id"],
                targets=[{"format": "onnx", "precision": "fp32"}],
            ),
        )

    assert exc_info.value.status_code in {409, 422}
    assert fake_jobs.calls == []


def test_conversion_api_exposes_no_calibration_or_retry_routes() -> None:
    route_paths = {route.path for route in main.app.routes}

    assert all("calibration" not in path for path in route_paths)
    assert all("retry" not in path for path in route_paths)


def test_model_sources_endpoint_returns_discovered_output_models(tmp_path: Path, monkeypatch) -> None:
    repo, project, _training, _schema = make_repo(tmp_path)
    model_path = repo.paths.output_model_dir / "loose.pt"
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.write_text("pt", encoding="utf-8")
    monkeypatch.setattr(main, "repo", repo)

    response = main.list_model_sources(project["id"])

    assert response[0]["relative_path"] == "loose.pt"
    assert response[0]["scope"] == "loose_output"


def test_artifact_context_endpoint_returns_project_counts(tmp_path: Path, monkeypatch) -> None:
    repo, project, _training, _schema = make_repo(tmp_path)
    monkeypatch.setattr(main, "repo", repo)

    response = main.get_artifact_context(project["id"])

    assert response["project"]["id"] == project["id"]
    assert response["counts"]["class_schemas"] == 1


def test_create_model_conversion_endpoint_accepts_direct_source_model_path(tmp_path: Path, monkeypatch) -> None:
    repo, project, _training, schema = make_repo(tmp_path)
    fake_jobs = FakeJobs()
    model_path = repo.paths.output_model_dir / "loose.pt"
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.write_text("pt", encoding="utf-8")
    monkeypatch.setattr(main, "repo", repo)
    monkeypatch.setattr(main, "jobs", fake_jobs)
    monkeypatch.setattr(
        main,
        "detect_conversion_capabilities",
        lambda: detect_conversion_capabilities("x86_64"),
    )

    response = main.create_model_conversion(
        project["id"],
        ModelConversionCreate(
            source_model_path=str(model_path),
            schema_id=schema["id"],
            targets=[{"format": "onnx", "precision": "fp32"}],
            imgsz=640,
        ),
    )

    assert response["name"] == "model_conversion"
    assert fake_jobs.calls[0]["args"][2] is None
    assert fake_jobs.calls[0]["kwargs"]["source_model_path"] == str(model_path)


def test_list_model_conversions_endpoint_returns_packages(tmp_path: Path, monkeypatch) -> None:
    repo, project, training, schema = make_repo(tmp_path)
    conversion = repo.create_model_conversion_run(
        project_id=project["id"],
        training_run_id=training["id"],
        source_model_path=str(tmp_path / "best.pt"),
        package_name="conversion-001",
        output_dir=str(tmp_path / "conversion"),
        schema_id=schema["id"],
        schema_name="hardware",
        schema_snapshot=[{"id": 0, "name": "bolt"}],
        status="completed",
    )
    monkeypatch.setattr(main, "repo", repo)

    response = main.list_model_conversions(project["id"])

    assert response[0]["id"] == conversion["id"]
    assert response[0]["schema_snapshot"] == [{"id": 0, "name": "bolt"}]


def test_model_conversion_netron_returns_same_origin_proxy_url(tmp_path: Path, monkeypatch) -> None:
    repo, project, training, schema = make_repo(tmp_path)
    artifact_path = tmp_path / "model.onnx"
    artifact_path.write_text("onnx", encoding="utf-8")
    conversion = repo.create_model_conversion_run(
        project_id=project["id"],
        training_run_id=training["id"],
        source_model_path=str(tmp_path / "best.pt"),
        package_name="conversion-001",
        output_dir=str(tmp_path / "conversion"),
        schema_id=schema["id"],
        schema_name="hardware",
        schema_snapshot=[{"id": 0, "name": "bolt"}],
        status="completed",
    )
    artifact = repo.add_model_conversion_artifact(
        conversion_id=conversion["id"],
        project_id=project["id"],
        format="onnx",
        precision="fp32",
        output_path=str(artifact_path),
        status="completed",
    )

    class FakeNetron:
        @staticmethod
        def start(*_args: Any, **_kwargs: Any) -> None:
            return None

    monkeypatch.setattr(main, "repo", repo)
    monkeypatch.setitem(__import__("sys").modules, "netron", FakeNetron)

    response = main.get_model_conversion_netron(project["id"], conversion["id"], artifact["id"])

    assert response["url"].startswith("/api/netron/?file=")
    assert "localhost:8081" not in response["url"]


def test_netron_proxy_disables_cache_and_relaxes_firefox_gate(monkeypatch) -> None:
    class FakeUpstream:
        headers = {"content-type": "text/javascript"}

        def __enter__(self) -> "FakeUpstream":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def read(self) -> bytes:
            return b"(Array.isArray(firefox) && parseInt(firefox[1], 10) < 114)"

    monkeypatch.setattr(main, "urlopen", lambda *_args, **_kwargs: FakeUpstream())

    response = main.proxy_netron(SimpleNamespace(url=SimpleNamespace(query="")), "index.js")

    assert response.headers["cache-control"] == "no-store"
    assert b"parseInt(firefox[1], 10) < 102" in response.body


def test_netron_proxy_disables_packaged_age_update_prompt(monkeypatch) -> None:
    class FakeUpstream:
        headers = {"content-type": "text/javascript"}

        def __enter__(self) -> "FakeUpstream":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def read(self) -> bytes:
            return b"if (days > 180) { await this.message('Please update to the newest version.', null, 'Update'); }"

    monkeypatch.setattr(main, "urlopen", lambda *_args, **_kwargs: FakeUpstream())

    response = main.proxy_netron(SimpleNamespace(url=SimpleNamespace(query="")), "browser.js")

    assert b"days > 180" not in response.body
    assert b"days > 36500" in response.body


def test_create_export_bundle_endpoint_starts_bundle_job(tmp_path: Path, monkeypatch) -> None:
    repo, project, training, schema = make_repo(tmp_path)
    fake_jobs = FakeJobs()
    conversion = repo.create_model_conversion_run(
        project_id=project["id"],
        training_run_id=training["id"],
        source_model_path=str(tmp_path / "best.pt"),
        package_name="conversion-001",
        output_dir=str(tmp_path / "conversion"),
        schema_id=schema["id"],
        schema_name="hardware",
        schema_snapshot=[{"id": 0, "name": "bolt"}],
        status="completed",
    )
    monkeypatch.setattr(main, "repo", repo)
    monkeypatch.setattr(main, "jobs", fake_jobs)

    response = main.create_export_bundle(
        project["id"],
        ModelExportBundleCreate(
            conversion_run_id=conversion["id"],
            include_artifact_ids=[],
            include_native_pt=True,
        ),
    )

    assert response["name"] == "model_export_bundle"
    assert fake_jobs.calls[0]["kwargs"]["related_type"] == "model_export_bundle"
