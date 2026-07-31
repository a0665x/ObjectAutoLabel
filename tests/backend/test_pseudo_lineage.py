from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.project_services import create_dataset_split
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def add_labeled_image(repo: Repository, project_id: str, tmp_path: Path, name: str) -> str:
    image_path = tmp_path / f"{name}.jpg"
    image_path.write_bytes(b"fake image content")
    image = repo.create_image(project_id, str(image_path), width=30, height=20)
    repo.replace_image_annotations(
        image["id"],
        [
            {
                "class_id": 0,
                "class_name": "person",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.2,
                "height": 0.2,
                "confidence": 0.8,
                "source_descriptor": "walking person",
                "source_type": "pseudo",
                "edited": False,
            }
        ],
        review_status="pending_review",
    )
    return image["id"]


def test_pseudo_run_history_and_split_can_target_one_run(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Lineage")
    schema = repo.create_class_schema(
        project_id=project["id"],
        name="person-car-v1",
        classes=[{"class_id": 0, "class_name": "person", "descriptors": ["walking person"]}],
    )
    first_image_id = add_labeled_image(repo, project["id"], tmp_path, "first")
    second_image_id = add_labeled_image(repo, project["id"], tmp_path, "second")
    first_run = repo.create_pseudo_label_run_record(
        project_id=project["id"],
        schema_id=schema["id"],
        source_asset_id=None,
        world_model="yolov8s-world.pt",
        output_dir=str(tmp_path / "pseudo1"),
        confidence=0.1,
        iou=0.7,
        image_count=1,
        labeled_count=1,
        raw_detection_count=4,
        merged_detection_count=1,
        merge_rate=0.25,
        job_id="job-1",
    )
    second_run = repo.create_pseudo_label_run_record(
        project_id=project["id"],
        schema_id=schema["id"],
        source_asset_id=None,
        world_model="yolov8s-world.pt",
        output_dir=str(tmp_path / "pseudo2"),
        confidence=0.2,
        iou=0.6,
        image_count=1,
        labeled_count=1,
        raw_detection_count=2,
        merged_detection_count=0,
        merge_rate=0.0,
        job_id="job-2",
    )
    repo.assign_pseudo_label_run_to_images(first_run["id"], [first_image_id])
    repo.assign_pseudo_label_run_to_images(second_run["id"], [second_image_id])

    history = repo.list_pseudo_label_runs(project["id"])
    assert [item["id"] for item in history] == [second_run["id"], first_run["id"]]
    assert history[0]["schema_name"] == "person-car-v1"
    assert history[1]["merge_rate"] == 0.25

    split = create_dataset_split(
        repo,
        project["id"],
        "first-run-only",
        0.8,
        0.1,
        0.1,
        pseudo_label_run_id=first_run["id"],
        job_id="job-3",
    )

    label_files = sorted(Path(split["output_dir"]).glob("**/labels/*.txt"))
    assert len(label_files) == 1
    assert "first.jpg" in sorted(Path(split["output_dir"]).glob("**/images/*.jpg"))[0].name
    assert split["pseudo_label_run_id"] == first_run["id"]
