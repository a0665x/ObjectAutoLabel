from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import json
import shutil
import yaml

from .label_io import AnnotationRow, write_yolo_labels
from .repositories import Repository


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def register_image_folder(repo: Repository, project_id: str, source_asset_id: str, folder: str) -> dict[str, Any]:
    folder_path = Path(folder)
    if not folder_path.exists():
        raise FileNotFoundError(f"Image folder does not exist: {folder}")
    image_paths = sorted(path for path in folder_path.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS)
    created = 0
    for image_path in image_paths:
        image = cv2.imread(str(image_path))
        height = width = None
        if image is not None:
            height, width = image.shape[:2]
        repo.create_image(
            project_id=project_id,
            source_asset_id=source_asset_id,
            path=str(image_path),
            width=width,
            height=height,
        )
        created += 1
    return {"registered_images": created}


def split_video_into_frames(
    repo: Repository,
    project_id: str,
    source_asset_id: str,
    video_path: str,
    output_dir: str,
    frames_per_second: float,
    resize_enabled: bool = False,
    resize_width: int | None = None,
    resize_height: int | None = None,
    *,
    job_id: str,
) -> dict[str, Any]:
    if frames_per_second <= 0:
        raise ValueError("frames_per_second must be greater than 0")
    if resize_enabled and (not resize_width or not resize_height):
        raise ValueError("resize_width and resize_height are required when resize is enabled")

    images_dir = Path(output_dir) / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Unable to read video: {video_path}")

    frame_rate = cap.get(cv2.CAP_PROP_FPS) or frames_per_second
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_interval = max(1, int(frame_rate / frames_per_second))
    video_filename = Path(video_path).stem
    saved = 0
    frame_index = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index % frame_interval == 0:
            if resize_enabled:
                frame = cv2.resize(frame, (resize_width, resize_height), interpolation=cv2.INTER_AREA)
            timestamp = frame_index / frame_rate
            output_file = images_dir / f"{video_filename}_{frame_index:06d}_time_{timestamp:.2f}.jpg"
            cv2.imwrite(str(output_file), frame)
            height, width = frame.shape[:2]
            repo.create_image(
                project_id=project_id,
                source_asset_id=source_asset_id,
                path=str(output_file),
                width=width,
                height=height,
            )
            saved += 1
        frame_index += 1
        if total_frames:
            progress = min(99, int(frame_index / total_frames * 100))
            repo.update_job(job_id, progress=progress, message=f"Processed {frame_index}/{total_frames} frames")

    cap.release()
    return {"images_dir": str(images_dir), "saved_frames": saved}


def save_image_annotations(
    repo: Repository,
    image_id: str,
    annotations: list[dict[str, Any]],
    review_status: str,
) -> dict[str, Any]:
    image = repo.get_image(image_id)
    if not image:
        raise FileNotFoundError(f"Image not found: {image_id}")
    saved = repo.replace_image_annotations(image_id, annotations, review_status)
    image_path = Path(image["path"])
    project = repo.get_project(image["project_id"])
    assert project is not None
    labels_dir = Path(project["root_path"]) / "reviewed_labels"
    label_path = labels_dir / f"{image_path.stem}.txt"
    write_yolo_labels(
        label_path,
        [
            AnnotationRow(
                class_id=int(item["class_id"]),
                x_center=float(item["x_center"]),
                y_center=float(item["y_center"]),
                width=float(item["width"]),
                height=float(item["height"]),
            )
            for item in saved
        ],
    )
    return {"annotations": saved, "label_path": str(label_path)}


def create_dataset_split(
    repo: Repository,
    project_id: str,
    name: str,
    train_ratio: float,
    val_ratio: float,
    test_ratio: float,
    *,
    job_id: str,
) -> dict[str, Any]:
    if round(train_ratio + val_ratio + test_ratio, 6) != 1.0:
        raise ValueError("Split ratios must add up to 1.0")
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    images = [
        image
        for image in repo.list_images(project_id, limit=100000, offset=0)
        if image["review_status"] == "reviewed"
    ]
    output_dir = Path(project["root_path"]) / "splits" / name
    buckets = {"train": [], "valid": [], "test": []}
    train_cut = int(len(images) * train_ratio)
    val_cut = train_cut + int(len(images) * val_ratio)
    for index, image in enumerate(images):
        bucket = "train" if index < train_cut else "valid" if index < val_cut else "test"
        buckets[bucket].append(image["id"])
        image_path = Path(image["path"])
        target_image = output_dir / bucket / "images" / image_path.name
        target_label = output_dir / bucket / "labels" / f"{image_path.stem}.txt"
        target_image.parent.mkdir(parents=True, exist_ok=True)
        target_label.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image_path, target_image)
        reviewed_label = Path(project["root_path"]) / "reviewed_labels" / f"{image_path.stem}.txt"
        if reviewed_label.exists():
            shutil.copy2(reviewed_label, target_label)
        else:
            target_label.write_text("", encoding="utf-8")
        progress = int((index + 1) / max(1, len(images)) * 100)
        repo.update_job(job_id, progress=min(99, progress), message=f"Split {index + 1}/{len(images)} images")
    schema_rows = repo.db.execute(
        """
        select distinct class_id, class_name
        from class_descriptors
        where schema_id in (select id from class_schemas where project_id = ?)
        order by class_id asc
        """,
        (project_id,),
    ).fetchall()
    names = {int(row["class_id"]): row["class_name"] for row in schema_rows}
    dataset_yaml = output_dir / "dataset.yaml"
    dataset_yaml.write_text(
        yaml.safe_dump(
            {
                "train": str(output_dir / "train" / "images"),
                "val": str(output_dir / "valid" / "images"),
                "test": str(output_dir / "test" / "images"),
                "names": names,
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return repo.create_dataset_split_record(
        project_id=project_id,
        name=name,
        train_ratio=train_ratio,
        val_ratio=val_ratio,
        test_ratio=test_ratio,
        output_dir=str(output_dir),
        dataset_yaml_path=str(dataset_yaml),
        image_ids_json=json.dumps(buckets),
        job_id=job_id,
    )


def _resolve_input_model(repo: Repository, model_name: str) -> Path:
    model_path = Path(model_name)
    if model_path.is_absolute():
        return model_path
    return repo.paths.input_model_dir / model_name


def run_training(
    repo: Repository,
    project_id: str,
    dataset_split_id: str,
    input_model: str,
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    patience: int,
    optimizer: str,
    lr0: float,
    lrf: float,
    *,
    job_id: str,
) -> dict[str, Any]:
    from ultralytics import YOLO

    split = repo.get_dataset_split(dataset_split_id)
    if not split or split["project_id"] != project_id:
        raise FileNotFoundError(f"Dataset split not found: {dataset_split_id}")
    model_path = _resolve_input_model(repo, input_model)
    if not model_path.exists():
        raise FileNotFoundError(f"Input model not found: {model_path}")

    output_dir = repo.paths.output_model_dir / project_id
    output_dir.mkdir(parents=True, exist_ok=True)
    training_run = repo.create_training_run_record(
        project_id=project_id,
        dataset_split_id=dataset_split_id,
        input_model=str(model_path),
        output_dir=str(output_dir),
        job_id=job_id,
    )
    repo.update_job(job_id, progress=5, message="Training started")
    try:
        yolo = YOLO(str(model_path))
        results = yolo.train(
            data=split["dataset_yaml_path"],
            epochs=epochs,
            imgsz=imgsz,
            batch=batch,
            device=device,
            patience=patience,
            optimizer=optimizer,
            lr0=lr0,
            lrf=lrf,
            rect=True,
            project=str(output_dir),
        )
        save_dir = Path(results.save_dir)
        best_model = save_dir / "weights" / "best.pt"
        last_model = save_dir / "weights" / "last.pt"
        repo.update_training_run(
            training_run["id"],
            best_model_path=str(best_model) if best_model.exists() else None,
            last_model_path=str(last_model) if last_model.exists() else None,
            status="completed",
        )
        return repo.get_training_run(training_run["id"]) or training_run
    except Exception:
        repo.update_training_run(training_run["id"], status="failed")
        raise


def export_training_model(
    repo: Repository,
    project_id: str,
    training_run_id: str,
    export_format: str,
    imgsz: int,
    int8: bool,
    *,
    job_id: str,
) -> dict[str, Any]:
    from ultralytics import YOLO

    training_run = repo.get_training_run(training_run_id)
    if not training_run or training_run["project_id"] != project_id:
        raise FileNotFoundError(f"Training run not found: {training_run_id}")
    source_model = training_run.get("best_model_path") or training_run.get("last_model_path")
    if not source_model:
        raise FileNotFoundError("Training run does not have a model artifact yet")
    repo.update_job(job_id, progress=10, message=f"Exporting {export_format}")
    model = YOLO(source_model)
    exported = model.export(format=export_format, imgsz=imgsz, int8=int8)
    return repo.create_model_export_record(
        project_id=project_id,
        training_run_id=training_run_id,
        source_model_path=source_model,
        export_format=export_format,
        output_path=str(exported),
        status="completed",
        job_id=job_id,
    )
