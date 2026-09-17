from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock

import pytest

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.job_control import raise_if_cancelled
from backend.app.jobs import JobRunner
from backend.app.repositories import Repository
from backend.app import main
from fastapi import HTTPException


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


def test_running_job_can_be_cancelled_cooperatively(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    runner = JobRunner(repo=repo, max_workers=1)
    started = Event()
    continue_work = Event()

    def work(*, job_id: str) -> dict[str, bool]:
        started.set()
        assert continue_work.wait(timeout=3)
        raise_if_cancelled(repo, job_id)
        return {"completed": True}

    job = runner.create("training", work)
    assert started.wait(timeout=3)

    cancelled = runner.cancel(job["id"])
    continue_work.set()
    runner.wait(job["id"], timeout=5)

    loaded = repo.get_job(job["id"])
    assert cancelled is not None
    assert cancelled["status"] == "cancel_requested"
    assert loaded is not None
    assert loaded["status"] == "cancelled"
    assert loaded["message"] == "Cancelled by user"
    assert loaded["error"] is None


def test_cancel_job_endpoint_returns_updated_job(monkeypatch) -> None:
    expected = {"id": "job-1", "status": "cancel_requested", "message": "Stopping safely…"}

    class FakeJobs:
        def cancel(self, job_id: str):
            assert job_id == "job-1"
            return expected

    monkeypatch.setattr(main, "jobs", FakeJobs())

    assert main.cancel_job("job-1") == expected


def test_cancel_job_endpoint_rejects_unknown_job(monkeypatch) -> None:
    class FakeJobs:
        def cancel(self, _job_id: str):
            return None

    monkeypatch.setattr(main, "jobs", FakeJobs())

    with pytest.raises(HTTPException) as error:
        main.cancel_job("missing")
    assert error.value.status_code == 404


def test_shared_connection_blocks_storage_readers_during_persisted_job_update(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("demo")
    runner = JobRunner(repo=repo, max_workers=1)
    update_completed = Event()
    all_readers_attempted = Event()
    release_writer = Event()
    all_readers_finished = Event()
    attempt_lock = Lock()
    attempt_count = 0
    finished_count = 0

    def work(*, job_id: str) -> dict[str, bool]:
        with db.synchronized():
            repo.update_job(job_id, status="running", progress=50)
            update_completed.set()
            assert all_readers_attempted.wait(timeout=3)
            assert not all_readers_finished.wait(timeout=0.1)
            assert release_writer.wait(timeout=3)
        return {"ok": True}

    job = runner.create("demo", work, project_id=project["id"])
    assert update_completed.wait(timeout=3)

    def poll_storage_status() -> dict[str, object] | None:
        nonlocal attempt_count, finished_count
        with attempt_lock:
            attempt_count += 1
            if attempt_count == 4:
                all_readers_attempted.set()
        status = repo.get_project_storage_status(project["id"])
        with attempt_lock:
            finished_count += 1
            if finished_count == 4:
                all_readers_finished.set()
        return status

    with ThreadPoolExecutor(max_workers=4) as pollers:
        polls = [pollers.submit(poll_storage_status) for _ in range(4)]
        assert all_readers_attempted.wait(timeout=3)
        assert not all_readers_finished.wait(timeout=0.1)
        release_writer.set()
        results = [poll.result(timeout=10) for poll in polls]

    runner.wait(job["id"], timeout=10)
    loaded = repo.get_job(job["id"])

    assert all(status is not None for status in results)
    assert loaded is not None
    assert loaded["status"] == "completed"
    assert loaded["progress"] == 100
    assert loaded["result"] == {"ok": True}


def test_storage_status_endpoint_polls_while_job_state_persists(tmp_path: Path, monkeypatch) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("demo")
    runner = JobRunner(repo=repo, max_workers=1)
    monkeypatch.setattr(main, "repo", repo)
    update_completed = Event()
    handler_attempted = Event()
    handler_finished = Event()
    release_writer = Event()

    def work(*, job_id: str) -> dict[str, bool]:
        with db.synchronized():
            repo.update_job(job_id, status="running", progress=50)
            update_completed.set()
            assert handler_attempted.wait(timeout=3)
            assert not handler_finished.wait(timeout=0.1)
            assert release_writer.wait(timeout=3)
        return {"ok": True}

    job = runner.create("demo", work, project_id=project["id"])
    assert update_completed.wait(timeout=3)

    def poll_storage_status_endpoint() -> dict[str, object]:
        handler_attempted.set()
        status = main.get_project_storage_status(project["id"])
        handler_finished.set()
        return status

    with ThreadPoolExecutor(max_workers=1) as poller:
        poll = poller.submit(poll_storage_status_endpoint)
        assert handler_attempted.wait(timeout=3)
        assert not handler_finished.wait(timeout=0.1)
        release_writer.set()
        status = poll.result(timeout=10)

    runner.wait(job["id"], timeout=10)
    loaded = repo.get_job(job["id"])

    assert status["workspace_exists"] is True
    assert loaded is not None
    assert loaded["status"] == "completed"
    assert loaded["result"] == {"ok": True}


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
