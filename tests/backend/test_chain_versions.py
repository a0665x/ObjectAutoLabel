from pathlib import Path
import sys
import types

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_artifact_context_counts_images_pseudo_and_augmentation_versions(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Chain Versions", description="")
    image_path = Path(project["root_path"]) / "sources" / "sample.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"image")
    image = repo.create_image(project["id"], str(image_path), width=10, height=10)
    schema = repo.create_class_schema(project["id"], "person-car", [{"class_id": 0, "class_name": "person", "descriptors": ["person"]}])
    pseudo = repo.create_pseudo_label_run_record(
        project_id=project["id"],
        schema_id=schema["id"],
        source_asset_id=None,
        world_model="yolov8s-world.pt",
        output_dir=str(Path(project["root_path"]) / "pseudo_labels" / "run"),
        confidence=0.1,
        iou=0.7,
        image_count=1,
        labeled_count=1,
        run_name="Pseudo_0706_v1_abcd1234",
    )
    repo.replace_image_annotations(image["id"], [{"class_id": 0, "class_name": "person", "x_center": 0.5, "y_center": 0.5, "width": 0.2, "height": 0.2}], "pending_review")
    repo.assign_pseudo_label_run_to_images(pseudo["id"], [image["id"]])
    augment = repo.create_augmentation_run_record(
        project_id=project["id"],
        pseudo_label_run_id=pseudo["id"],
        name="Augment_0706_v1",
        output_dir=str(Path(project["root_path"]) / "augmentations" / "Augment_0706_v1"),
        settings_json='{"blur":3}',
        source_image_count=1,
        created_image_count=3,
        source_image_ids=[image["id"]],
    )

    sys.modules.setdefault("cv2", types.ModuleType("cv2"))
    context = __import__("backend.app.project_services", fromlist=["get_project_artifact_context"]).get_project_artifact_context(repo, project["id"])

    assert context["counts"]["source_images"] == 1
    assert context["counts"]["pseudo_label_runs"] == 1
    assert context["counts"]["augmentation_runs"] == 1
    assert context["pseudo_label_runs"][0]["run_name"] == "Pseudo_0706_v1_abcd1234"
    assert context["augmentation_runs"][0]["pseudo_label_run_id"] == pseudo["id"]


def test_active_job_guard_detects_running_job_per_project_and_name(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="No Queue", description="")
    job = repo.create_job("pseudo_label", project_id=project["id"])
    repo.update_job(job["id"], status="running")

    active = repo.find_active_job(project["id"], "pseudo_label")

    assert active is not None
    assert active["id"] == job["id"]


def test_dataset_split_records_selected_augmentation_version(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Split Chain", description="")
    schema = repo.create_class_schema(project["id"], "schema", [{"class_id": 0, "class_name": "person", "descriptors": ["person"]}])
    pseudo = repo.create_pseudo_label_run_record(project["id"], schema["id"], None, "world.pt", str(tmp_path / "pseudo"), 0.1, 0.7, 1, 1, run_name="Pseudo_0706_v1_hash")
    augment = repo.create_augmentation_run_record(
        project["id"],
        pseudo["id"],
        "Augment_0706_v1",
        str(tmp_path / "aug"),
        "{}",
        1,
        2,
        source_image_ids=["image-1"],
    )

    split = repo.create_dataset_split_record(
        project_id=project["id"],
        name="Split_0706_v1",
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        output_dir=str(tmp_path / "split"),
        dataset_yaml_path=str(tmp_path / "split" / "dataset.yaml"),
        image_ids_json="{}",
        pseudo_label_run_id=pseudo["id"],
        augmentation_run_id=augment["id"],
    )

    loaded = repo.get_dataset_split(split["id"])
    assert loaded is not None
    assert loaded["augmentation_run_id"] == augment["id"]
