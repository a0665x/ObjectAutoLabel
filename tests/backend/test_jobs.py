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
