from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi import HTTPException

from backend.app import main
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_resolve_frontend_dist_requires_built_assets(tmp_path: Path) -> None:
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir()

    with pytest.raises(RuntimeError, match="frontend/dist"):
        main.resolve_frontend_dist(frontend_dir)


def test_resolve_frontend_dist_prefers_built_index(tmp_path: Path) -> None:
    frontend_dir = tmp_path / "frontend"
    dist_dir = frontend_dir / "dist"
    dist_dir.mkdir(parents=True)
    (dist_dir / "index.html").write_text("<!doctype html>", encoding="utf-8")

    assert main.resolve_frontend_dist(frontend_dir) == dist_dir


def test_read_local_file_allows_registered_image_paths(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Files API")
    source = repo.create_source_asset(project["id"], "image_folder", str(tmp_path / "source"))
    image_path = Path(project["root_path"]) / "sources" / "frame.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(image_path), np.zeros((16, 24, 3), dtype=np.uint8))
    repo.create_image(project["id"], str(image_path), source_asset_id=source["id"], width=24, height=16)

    original_repo = main.repo
    main.repo = repo
    try:
        response = main.read_local_file(str(image_path))
    finally:
        main.repo = original_repo

    assert Path(response.path) == image_path


def test_read_local_file_allows_safe_project_runtime_files(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Project Files")
    label_path = Path(project["root_path"]) / "reviewed_labels" / "frame.txt"
    label_path.write_text("0 0.5 0.5 0.2 0.2", encoding="utf-8")

    original_repo = main.repo
    main.repo = repo
    try:
        response = main.read_local_file(str(label_path))
    finally:
        main.repo = original_repo

    assert Path(response.path) == label_path


def test_read_local_file_rejects_unregistered_project_paths(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Unsafe Files")
    unsafe_path = Path(project["root_path"]) / "notes.txt"
    unsafe_path.write_text("secret", encoding="utf-8")

    original_repo = main.repo
    main.repo = repo
    try:
        with pytest.raises(HTTPException, match="File not found"):
            main.read_local_file(str(unsafe_path))
    finally:
        main.repo = original_repo


def test_allowed_cors_origins_are_local_only() -> None:
    assert "*" not in main.ALLOWED_CORS_ORIGINS
    assert "http://localhost:5173" in main.ALLOWED_CORS_ORIGINS
    assert "http://127.0.0.1:8501" in main.ALLOWED_CORS_ORIGINS
