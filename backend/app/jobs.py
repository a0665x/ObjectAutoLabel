from __future__ import annotations

import json
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable

from .repositories import Repository


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

        def run() -> Any:
            self.repo.update_job(job_id, status="running", message="Running", progress=1)
            try:
                result = fn(*args, job_id=job_id, **kwargs)
                self.repo.update_job(
                    job_id,
                    status="completed",
                    message="Completed",
                    progress=100,
                    result_json=json.dumps(result),
                )
                return result
            except Exception as exc:  # noqa: BLE001 - background job errors must be visible in UI.
                self.repo.update_job(
                    job_id,
                    status="failed",
                    message=str(exc),
                    error=traceback.format_exc(),
                )
                raise

        future = self._executor.submit(run)
        future.add_done_callback(self._consume_exception)
        self._futures[job_id] = future
        return job

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
