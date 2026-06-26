from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AnnotationRow:
    class_id: int
    x_center: float
    y_center: float
    width: float
    height: float


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def write_yolo_labels(path: Path, rows: list[AnnotationRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(
        (
            f"{row.class_id} "
            f"{_clamp01(row.x_center):.6f} "
            f"{_clamp01(row.y_center):.6f} "
            f"{_clamp01(row.width):.6f} "
            f"{_clamp01(row.height):.6f}"
        )
        for row in rows
    )
    path.write_text(content, encoding="utf-8")


def read_yolo_labels(path: Path) -> list[AnnotationRow]:
    if not path.exists():
        return []
    rows: list[AnnotationRow] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        class_id, x_center, y_center, width, height = stripped.split()
        rows.append(
            AnnotationRow(
                class_id=int(class_id),
                x_center=float(x_center),
                y_center=float(y_center),
                width=float(width),
                height=float(height),
            )
        )
    return rows
