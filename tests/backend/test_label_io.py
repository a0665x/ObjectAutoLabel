from pathlib import Path

from backend.app.label_io import AnnotationRow, read_yolo_labels, write_yolo_labels


def test_write_and_read_yolo_labels(tmp_path: Path) -> None:
    path = tmp_path / "labels" / "image.txt"
    rows = [
        AnnotationRow(class_id=1, x_center=0.5, y_center=0.25, width=0.2, height=0.1),
        AnnotationRow(class_id=0, x_center=0.1, y_center=0.2, width=0.3, height=0.4),
    ]

    write_yolo_labels(path, rows)
    loaded = read_yolo_labels(path)

    assert loaded == rows
    assert path.read_text(encoding="utf-8").splitlines()[0] == "1 0.500000 0.250000 0.200000 0.100000"


def test_read_missing_yolo_label_returns_empty(tmp_path: Path) -> None:
    assert read_yolo_labels(tmp_path / "missing.txt") == []
