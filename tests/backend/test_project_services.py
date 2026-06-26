from pathlib import Path

import cv2
import numpy as np

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.project_services import register_image_folder
from backend.app.repositories import Repository


def test_register_image_folder_creates_image_records(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Images")
    source = repo.create_source_asset(project["id"], "image_folder", str(tmp_path / "images"))
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    image = np.zeros((20, 30, 3), dtype=np.uint8)
    cv2.imwrite(str(image_dir / "a.jpg"), image)

    result = register_image_folder(repo, project["id"], source["id"], str(image_dir))
    images = repo.list_images(project["id"])

    assert result == {"registered_images": 1}
    assert images[0]["width"] == 30
    assert images[0]["height"] == 20
