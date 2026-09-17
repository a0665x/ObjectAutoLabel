from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app import main
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app.schemas import ClassDescriptorItem, ClassSchemaCreate, DatasetSplitCreate, FrameRunCreate, ProjectCreate, TrainingRunCreate


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_training_request_amp_is_explicit_and_backward_compatible() -> None:
    default_payload = TrainingRunCreate(dataset_split_id="split", input_model="input.pt")
    disabled_payload = TrainingRunCreate(dataset_split_id="split", input_model="input.pt", amp=False)

    assert default_payload.amp is True
    assert disabled_payload.amp is False


def test_training_schema_accepts_musgd_and_rejects_unknown_optimizer() -> None:
    payload = TrainingRunCreate(dataset_split_id="split", input_model="input.pt", optimizer="MuSGD")

    assert payload.optimizer == "MuSGD"
    with pytest.raises(ValidationError):
        TrainingRunCreate(dataset_split_id="split", input_model="input.pt", optimizer="NotAnOptimizer")


def test_create_training_run_forwards_explicit_musgd_to_runner(monkeypatch) -> None:
    project_id = "project-musgd"
    captured: dict[str, object] = {}

    class FakeRepo:
        def get_dataset_split(self, split_id: str) -> dict[str, str]:
            assert split_id == "split-musgd"
            return {"project_id": project_id}

    class FakeJobs:
        def create(self, name, fn, *args, **kwargs):  # type: ignore[no-untyped-def]
            captured["args"] = args
            return {"id": "job-musgd", "status": "queued"}

    monkeypatch.setattr(main, "repo", FakeRepo())
    monkeypatch.setattr(main, "jobs", FakeJobs())

    main.create_training_run(
        project_id,
        TrainingRunCreate(dataset_split_id="split-musgd", input_model="input.pt", optimizer="MuSGD"),
    )

    # run_training positional contract: optimizer follows patience.
    assert captured["args"][9] == "MuSGD"  # type: ignore[index]


def test_create_training_run_forwards_explicit_amp_to_runner(monkeypatch) -> None:
    project_id = "project-amp"
    captured: dict[str, object] = {}

    class FakeRepo:
        def get_dataset_split(self, split_id: str) -> dict[str, str]:
            assert split_id == "split-amp"
            return {"project_id": project_id}

    class FakeJobs:
        def create(self, name, fn, *args, **kwargs):  # type: ignore[no-untyped-def]
            captured["name"] = name
            captured["fn"] = fn
            captured["args"] = args
            captured["kwargs"] = kwargs
            return {"id": "job-amp", "status": "queued"}

    monkeypatch.setattr(main, "repo", FakeRepo())
    monkeypatch.setattr(main, "jobs", FakeJobs())

    result = main.create_training_run(
        project_id,
        TrainingRunCreate(dataset_split_id="split-amp", input_model="input.pt", amp=False),
    )

    assert result["id"] == "job-amp"
    assert captured["name"] == "training"
    assert captured["fn"] is main.project_services.run_training
    assert captured["args"][-1] is False
    assert captured["kwargs"] == {"project_id": project_id, "related_type": "training_run"}


def test_create_training_run_rejects_an_outdated_dataset_split_before_job_creation(monkeypatch) -> None:
    project_id = "project-stale-split"

    class FakeRepo:
        def get_dataset_split(self, split_id: str) -> dict[str, object]:
            assert split_id == "split-stale"
            return {"project_id": project_id, "outdated": True}

    class FailIfCalledJobs:
        def create(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise AssertionError("stale split must not create a training job")

    monkeypatch.setattr(main, "repo", FakeRepo())
    monkeypatch.setattr(main, "jobs", FailIfCalledJobs())

    with pytest.raises(main.HTTPException) as error:
        main.create_training_run(
            project_id,
            TrainingRunCreate(dataset_split_id="split-stale", input_model="input.pt"),
        )

    assert error.value.status_code == 409
    assert error.value.detail == "Dataset split is outdated; rebuild Augment/Split before training."


def test_create_training_run_accepts_a_saved_historical_dataset_split(monkeypatch) -> None:
    project_id = "project-historical-split"

    class FakeRepo:
        def get_dataset_split(self, split_id: str) -> dict[str, object]:
            assert split_id == "split-old"
            return {"project_id": project_id, "outdated": False, "is_current": False}

    class CaptureJobs:
        def create(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return {"id": "job-historical", "name": args[0], "status": "queued", "progress": 0, "message": "queued"}

    monkeypatch.setattr(main, "repo", FakeRepo())
    monkeypatch.setattr(main, "jobs", CaptureJobs())

    result = main.create_training_run(
        project_id,
        TrainingRunCreate(dataset_split_id="split-old", input_model="input.pt"),
    )
    assert result["id"] == "job-historical"


def test_delete_history_route_returns_the_downstream_cascade(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def delete_history(repo, project_id, artifact_type, artifact_id):  # type: ignore[no-untyped-def]
        captured.update(
            repo=repo,
            project_id=project_id,
            artifact_type=artifact_type,
            artifact_id=artifact_id,
        )
        return {"deleted": {"training": 1, "conversion": 1, "export": 1}, "removed_paths": []}

    fake_repo = object()
    monkeypatch.setattr(main, "repo", fake_repo)
    monkeypatch.setattr(main.project_services, "delete_history_artifact", delete_history)

    result = main.delete_project_history("project-1", "training", "train-1")

    assert result["deleted"] == {"training": 1, "conversion": 1, "export": 1}
    assert captured == {
        "repo": fake_repo,
        "project_id": "project-1",
        "artifact_type": "training",
        "artifact_id": "train-1",
    }


def test_create_dataset_split_rejects_an_outdated_augmentation_before_job_creation(monkeypatch) -> None:
    project_id = "project-stale-augment"

    class FakeRepo:
        def get_project(self, requested_project_id: str) -> dict[str, str]:
            assert requested_project_id == project_id
            return {"id": project_id}

        def get_augmentation_run(self, run_id: str) -> dict[str, object]:
            assert run_id == "augment-stale"
            return {"id": run_id, "project_id": project_id, "outdated": True}

    class FailIfCalledJobs:
        def create(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise AssertionError("stale augmentation must not create a dataset-split job")

    monkeypatch.setattr(main, "repo", FakeRepo())
    monkeypatch.setattr(main, "jobs", FailIfCalledJobs())

    with pytest.raises(main.HTTPException) as error:
        main.create_dataset_split(
            project_id,
            DatasetSplitCreate(augmentation_run_id="augment-stale"),
        )

    assert error.value.status_code == 409
    assert error.value.detail == "Augmentation run is outdated; rebuild Augment before creating a split."


def test_create_dataset_split_forwards_explicit_open_data_version(monkeypatch) -> None:
    project_id = "project-versioned-open-data"
    captured: dict[str, object] = {}

    class FakeRepo:
        def get_project(self, requested_project_id: str) -> dict[str, str]:
            assert requested_project_id == project_id
            return {"id": project_id}

    class CaptureJobs:
        def create(self, name, fn, *args, **kwargs):  # type: ignore[no-untyped-def]
            captured["args"] = args
            return {"id": "job-split", "status": "queued"}

    monkeypatch.setattr(main, "repo", FakeRepo())
    monkeypatch.setattr(main, "jobs", CaptureJobs())
    main.create_dataset_split(project_id, DatasetSplitCreate(open_data_import_id="open-v2"))

    assert captured["args"][8] == "open-v2"  # type: ignore[index]


def test_create_and_list_project(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    payload = ProjectCreate(name="API Demo", description="demo")
    project = repo.create_project(payload.name, payload.description)

    assert project["name"] == "API Demo"
    assert project["slug"].startswith("api-demo")
    assert any(item["id"] == project["id"] for item in repo.list_projects())


def test_project_storage_status_and_stale_cleanup_api(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(ProjectCreate(name="Stale API").name)
    import shutil
    shutil.rmtree(Path(project["root_path"]))
    original_repo = main.repo
    main.repo = repo
    try:
        status = main.get_project_storage_status(project["id"])
        cleanup = main.cleanup_stale_project(project["id"])
    finally:
        main.repo = original_repo

    assert status["is_stale"] is True
    assert "project workspace" in status["missing"]
    assert cleanup == {"ok": True}
    assert repo.get_project(project["id"]) is None


def test_cleanup_stale_project_api_refuses_healthy_project(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(ProjectCreate(name="Healthy API").name)
    original_repo = main.repo
    main.repo = repo
    try:
        try:
            main.cleanup_stale_project(project["id"])
        except main.HTTPException as exc:
            error = exc
        else:
            error = None
    finally:
        main.repo = original_repo

    assert error is not None
    assert error.status_code == 409
    assert repo.get_project(project["id"]) is not None


def test_create_class_schema_via_api(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(ProjectCreate(name="Schema API").name)
    payload = ClassSchemaCreate(
        name="Default",
        classes=[
            ClassDescriptorItem(class_id=0, class_name="person", descriptors=["person"]),
            ClassDescriptorItem(class_id=1, class_name="car", descriptors=["car", "van"]),
        ],
    )

    schema = repo.create_class_schema(
        project_id=project["id"],
        name=payload.name,
        classes=[item.model_dump() for item in payload.classes],
    )

    assert schema["classes"][1]["descriptors"] == ["car", "van"]


def test_images_can_be_filtered_by_review_status(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(ProjectCreate(name="Filter API").name)
    source_a = repo.create_source_asset(project["id"], "image_folder", str(tmp_path / "source-a"))
    source_b = repo.create_source_asset(project["id"], "image_folder", str(tmp_path / "source-b"))
    reviewed = repo.create_image(project["id"], str(tmp_path / "reviewed.jpg"), source_asset_id=source_a["id"])
    pending = repo.create_image(project["id"], str(tmp_path / "pending.jpg"), source_asset_id=source_b["id"])
    repo.replace_image_annotations(reviewed["id"], [], review_status="reviewed")
    repo.replace_image_annotations(
        pending["id"],
        [
            {
                "class_id": 0,
                "class_name": "object",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.3,
                "height": 0.3,
                "confidence": 0.4,
                "source_type": "pseudo",
                "edited": False,
            }
        ],
        review_status="pending_review",
    )

    original_repo = main.repo
    main.repo = repo
    try:
        payload = main.list_project_images(
            project["id"],
            review_status="pending_review",
            has_low_confidence=True,
            source_asset_id=source_b["id"],
        )
    finally:
        main.repo = original_repo

    assert all(item["review_status"] == "pending_review" for item in payload)
    assert all(item["source_asset_id"] == source_b["id"] for item in payload)
    assert [item["id"] for item in payload] == [pending["id"]]


def test_review_stats_counts_statuses_and_low_confidence(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(ProjectCreate(name="Stats API").name)
    pending = repo.create_image(project["id"], str(tmp_path / "pending.jpg"))
    reviewed = repo.create_image(project["id"], str(tmp_path / "reviewed.jpg"))
    repo.replace_image_annotations(
        pending["id"],
        [
            {
                "class_id": 0,
                "class_name": "object",
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.3,
                "height": 0.3,
                "confidence": 0.4,
                "source_type": "pseudo",
                "edited": False,
            }
        ],
        review_status="pending_review",
    )
    repo.replace_image_annotations(
        reviewed["id"],
        [
            {
                "class_id": 1,
                "class_name": "object",
                "x_center": 0.4,
                "y_center": 0.4,
                "width": 0.2,
                "height": 0.2,
                "confidence": 0.95,
                "source_type": "manual",
                "edited": True,
            }
        ],
        review_status="reviewed",
    )

    original_repo = main.repo
    main.repo = repo
    try:
        payload = main.get_review_stats(project["id"])
    finally:
        main.repo = original_repo

    assert payload["pending_review"] == 1
    assert payload["reviewed"] == 1
    assert payload["edited"] == 1
    assert payload["low_confidence"] == 1


def test_frame_extraction_uses_project_sources_directory(tmp_path: Path, monkeypatch) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project("Video Project")
    video_path = tmp_path / "data" / "input" / "video.mp4"
    video_path.parent.mkdir(parents=True)
    video_path.write_text("video", encoding="utf-8")
    source = repo.create_source_asset(project["id"], "video", str(video_path))
    captured: dict[str, object] = {}

    class FakeJobs:
        def create(self, name, fn, *args, **kwargs):  # type: ignore[no-untyped-def]
            captured["args"] = args
            captured["kwargs"] = kwargs
            return {"id": "job-1", "name": name, "status": "queued", "progress": 0, "message": "Queued"}

    monkeypatch.setattr(main, "repo", repo)
    monkeypatch.setattr(main, "jobs", FakeJobs())

    main.create_frame_run(project["id"], FrameRunCreate(source_asset_id=source["id"]))

    assert captured["args"][4] == str(Path(project["root_path"]) / "sources" / source["id"] / "frames")
