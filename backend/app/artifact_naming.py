from __future__ import annotations

import re
from datetime import datetime
from typing import Iterable


def versioned_artifact_name(prefix: str, existing_names: Iterable[str], *, now: datetime | None = None) -> str:
    names = [str(name) for name in existing_names]
    highest_version = 0
    for name in names:
        match = re.search(r"_v(\d+)$", name, re.IGNORECASE)
        if match:
            highest_version = max(highest_version, int(match.group(1)))
    version = max(len(names), highest_version) + 1
    date = now or datetime.now()
    return f"{prefix}_{date.strftime('%m%d')}_v{version:03d}"
