from __future__ import annotations

from typing import Protocol


class JobCancelled(Exception):
    """Raised at a cooperative cancellation checkpoint."""


class JobReader(Protocol):
    def get_job(self, job_id: str) -> dict[str, object] | None: ...


def raise_if_cancelled(repo: JobReader, job_id: str) -> None:
    job = repo.get_job(job_id)
    if job and job.get("status") in {"cancel_requested", "cancelled"}:
        raise JobCancelled("Cancelled by user")
