from __future__ import annotations

import json
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable

from .job_control import JobCancelled, raise_if_cancelled
from .repositories import Repository
from .logging_config import log_job_event
from .repositories import new_id


class JobRunner:
    def __init__(self, repo: Repository, max_workers: int = 2) -> None:
        self.repo = repo
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._futures: dict[str, Future[Any]] = {}

    def create(
        self,
        name: str,
        fn: Callable[..., Any],
        *args: Any,
        project_id: str | None = None,
        related_type: str | None = None,
        related_id: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        job = self.repo.create_job(
            name=name,
            project_id=project_id,
            related_type=related_type,
            related_id=related_id,
        )
        job_id = job["id"]
        log_job_event("job.queued", job_id=job_id, project_id=project_id, job_name=name, related_type=related_type)

        def run() -> Any:
            try:
                raise_if_cancelled(self.repo, job_id)
                self.repo.update_job(job_id, status="running", message="Running", progress=1)
                log_job_event("job.running", job_id=job_id, project_id=project_id, job_name=name)
                result = fn(*args, job_id=job_id, **kwargs)
                raise_if_cancelled(self.repo, job_id)
                self.repo.update_job(
                    job_id,
                    status="completed",
                    message="Completed",
                    progress=100,
                    result_json=json.dumps(result),
                )
                log_job_event("job.completed", job_id=job_id, project_id=project_id, job_name=name)
                return result
            except JobCancelled:
                self.repo.mark_job_related_cancelled(job_id)
                self.repo.update_job(
                    job_id,
                    status="cancelled",
                    message="Cancelled by user",
                    error=None,
                )
                log_job_event("job.cancelled", job_id=job_id, project_id=project_id, job_name=name)
                return None
            except Exception as exc:  # noqa: BLE001 - background job errors must be visible in UI.
                error_id = new_id()[:12]
                log_job_event("job.failed", job_id=job_id, project_id=project_id, job_name=name, error_id=error_id, error_type=type(exc).__name__, error_message=str(exc), traceback=traceback.format_exc())
                self.repo.update_job(
                    job_id,
                    status="failed",
                    message=f"{str(exc)} · error id {error_id}",
                    error=f"{type(exc).__name__} [error_id={error_id}]: {str(exc)}",
                )
                raise

        future = self._executor.submit(run)
        future.add_done_callback(self._consume_exception)
        self._futures[job_id] = future
        return job

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        job = self.repo.get_job(job_id)
        if not job:
            return None
        if job["status"] in {"completed", "failed", "cancelled"}:
            return job
        future = self._futures.get(job_id)
        if future is not None and future.cancel():
            self.repo.update_job(job_id, status="cancelled", message="Cancelled by user", error=None)
        else:
            self.repo.update_job(job_id, status="cancel_requested", message="Stopping safely…", error=None)
        log_job_event("job.cancel_requested", job_id=job_id, project_id=job.get("project_id"), job_name=job.get("name"))
        return self.repo.get_job(job_id)

    def wait(self, job_id: str, timeout: float | None = None) -> Any:
        try:
            return self._futures[job_id].result(timeout=timeout)
        except Exception:
            return None

    @staticmethod
    def _consume_exception(future: Future[Any]) -> None:
        try:
            future.result()
        except Exception:
            pass
