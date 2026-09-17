import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from backend.app.config import AppPaths
from backend.app.logging_config import configure_logging, log_access_event, log_runtime_event


def test_runtime_log_uses_taipei_date_and_redacts_secrets(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    now = datetime(2026, 9, 4, 8, 30, tzinfo=ZoneInfo("Asia/Taipei"))
    configure_logging(paths, now=now)

    log_runtime_event("open_data.preview_failed", project_id="p1", authorization="Bearer secret", path="/app/data/projects/p1/image.jpg")

    line = (paths.logs_dir / "2026-09-04" / "runtime.jsonl").read_text(encoding="utf-8").splitlines()[-1]
    event = json.loads(line)
    assert event["event"] == "open_data.preview_failed"
    assert event["project_id"] == "p1"
    assert event["authorization"] == "[REDACTED]"
    assert event["path"] == "image.jpg"

    log_access_event("http.request", route="/api/projects/p1", status_code=200)
    access = json.loads((paths.logs_dir / "2026-09-04" / "access.log").read_text(encoding="utf-8").splitlines()[-1])
    assert access["route"] == "/api/projects/p1"
