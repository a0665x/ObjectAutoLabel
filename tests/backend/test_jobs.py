from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.jobs import JobRunner
from backend.app.repositories import Repository


def test_job_runner_persists_completed_result(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    runner = JobRunner(repo=repo, max_workers=1)

    def work(*, job_id: str) -> dict[str, str]:
        repo.update_job(job_id, progress=50, message="halfway")
        return {"ok": "yes"}

    job = runner.create("demo", work)
    runner.wait(job["id"], timeout=5)
    loaded = repo.get_job(job["id"])

    assert loaded is not None
    assert loaded["status"] == "completed"
    assert loaded["progress"] == 100
    assert loaded["result"] == {"ok": "yes"}


def test_job_runner_persists_failure(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    runner = JobRunner(repo=repo, max_workers=1)

    def work(*, job_id: str) -> dict[str, str]:
        raise RuntimeError("boom")

    job = runner.create("demo", work)
    runner.wait(job["id"], timeout=5)
    loaded = repo.get_job(job["id"])

    assert loaded is not None
    assert loaded["status"] == "failed"
    assert "boom" in loaded["message"]
    assert "RuntimeError" in loaded["error"]


def test_repository_marks_interrupted_jobs_and_conversions(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("demo")
    job = repo.create_job("model_conversion", project_id=project["id"], related_type="model_conversion")
    repo.update_job(job["id"], status="running", progress=36, message="Converting tflite int8")
    conversion = repo.create_model_conversion_run(
        project_id=project["id"],
        training_run_id=None,
        source_model_path="/tmp/model.pt",
        package_name="conversion-001",
        output_dir="/tmp/conversion-001",
        schema_id=None,
        schema_name="schema",
        schema_snapshot={"classes": []},
        status="running",
        job_id=job["id"],
    )
    artifact = repo.add_model_conversion_artifact(
        conversion_id=conversion["id"],
        project_id=project["id"],
        format="tflite",
        precision="int8",
        output_path=None,
        status="running",
    )

    interrupted_count = repo.mark_interrupted_jobs()

    loaded_job = repo.get_job(job["id"])
    loaded_conversion = repo.get_model_conversion_run(conversion["id"])
    loaded_artifact = next(item for item in loaded_conversion["artifacts"] if item["id"] == artifact["id"])
    assert interrupted_count == 1
    assert loaded_job is not None
    assert loaded_job["status"] == "failed"
    assert loaded_job["message"] == "Interrupted by service restart"
    assert loaded_conversion["status"] == "failed"
    assert loaded_artifact["status"] == "failed"


def test_repository_marks_active_conversion_failed_when_job_already_failed(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("demo")
    job = repo.create_job("model_conversion", project_id=project["id"], related_type="model_conversion")
    repo.update_job(job["id"], status="failed", progress=10, message="export failed")
    conversion = repo.create_model_conversion_run(
        project_id=project["id"],
        training_run_id=None,
        source_model_path="/tmp/model.pt",
        package_name="conversion-001",
        output_dir="/tmp/conversion-001",
        schema_id=None,
        schema_name="schema",
        schema_snapshot={"classes": []},
        status="running",
        job_id=job["id"],
    )
    artifact = repo.add_model_conversion_artifact(
        conversion_id=conversion["id"],
        project_id=project["id"],
        format="onnx",
        precision="fp32",
        output_path=None,
        status="running",
    )

    interrupted_count = repo.mark_interrupted_jobs()

    loaded_conversion = repo.get_model_conversion_run(conversion["id"])
    loaded_artifact = next(item for item in loaded_conversion["artifacts"] if item["id"] == artifact["id"])
    assert interrupted_count == 0
    assert loaded_conversion["status"] == "failed"
    assert loaded_artifact["status"] == "failed"
