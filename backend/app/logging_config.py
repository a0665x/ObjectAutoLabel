from __future__ import annotations

import json
import logging
import re
import shutil
from datetime import timedelta
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import Any
from zoneinfo import ZoneInfo

from .config import AppPaths


TAIPEI = ZoneInfo("Asia/Taipei")
SENSITIVE_KEYS = {"authorization", "cookie", "password", "secret", "token", "oauth_code", "oauth_state", "api_key"}
_paths = AppPaths()
_now_override: datetime | None = None


def _clean(key: str, value: Any) -> Any:
    if any(part in key.lower() for part in SENSITIVE_KEYS):
        return "[REDACTED]"
    if key.lower().endswith("path") and isinstance(value, str):
        return Path(value).name
    if isinstance(value, str):
        value = re.sub(r"(?i)(bearer|token|secret|password|api[_-]?key)[=: ]+[^\s,;]+", r"\1=[REDACTED]", value)
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)


class DailyJsonHandler(logging.Handler):
    def __init__(self, paths: AppPaths, filename: str) -> None:
        super().__init__()
        self.paths = paths
        self.filename = filename
        self._lock = RLock()

    def emit(self, record: logging.LogRecord) -> None:
        moment = _now_override or datetime.now(TAIPEI)
        folder = self.paths.logs_dir / moment.astimezone(TAIPEI).date().isoformat()
        folder.mkdir(parents=True, exist_ok=True)
        payload = {
            "timestamp": moment.astimezone(TAIPEI).isoformat(),
            "level": record.levelname,
            "event": getattr(record, "event", record.getMessage()),
        }
        fields = getattr(record, "fields", {})
        payload.update({key: _clean(key, value) for key, value in fields.items()})
        line = json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n"
        with self._lock:
            target = folder / self.filename
            if target.exists() and target.stat().st_size >= 10 * 1024 * 1024:
                for index in range(9, 0, -1):
                    source = folder / f"{self.filename}.{index}"
                    destination = folder / f"{self.filename}.{index + 1}"
                    if source.exists():
                        source.replace(destination)
                target.replace(folder / f"{self.filename}.1")
            with target.open("a", encoding="utf-8") as stream:
                stream.write(line)


def configure_logging(paths: AppPaths, *, now: datetime | None = None) -> None:
    global _paths, _now_override
    _paths, _now_override = paths, now
    cutoff = (_now_override or datetime.now(TAIPEI)).date() - timedelta(days=30)
    if paths.logs_dir.is_dir():
        for folder in paths.logs_dir.iterdir():
            try:
                expired = datetime.strptime(folder.name, "%Y-%m-%d").date() < cutoff
            except ValueError:
                expired = False
            if expired and folder.is_dir():
                shutil.rmtree(folder, ignore_errors=True)
    for name, filename in (("object_autolabel.runtime", "runtime.jsonl"), ("object_autolabel.jobs", "jobs.jsonl"), ("object_autolabel.access", "access.log")):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.setLevel(logging.INFO)
        logger.propagate = False
        logger.addHandler(DailyJsonHandler(paths, filename))


def _event(logger_name: str, event: str, *, level: int = logging.INFO, **fields: Any) -> None:
    logging.getLogger(logger_name).log(level, event, extra={"event": event, "fields": fields})


def log_runtime_event(event: str, **fields: Any) -> None:
    _event("object_autolabel.runtime", event, **fields)


def log_job_event(event: str, **fields: Any) -> None:
    _event("object_autolabel.jobs", event, **fields)


def log_access_event(event: str, **fields: Any) -> None:
    _event("object_autolabel.access", event, **fields)
