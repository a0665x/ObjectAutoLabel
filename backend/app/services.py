"""Legacy compatibility helpers from the pre-workbench workflow.

This module remains as reference/support for older paths. The active offline
labeling runtime uses `project_services.py`, `world_models.py`, and `main.py`.
"""

from __future__ import annotations

import glob
import os
import shutil
import socket
from pathlib import Path
from typing import Any

import cv2
import yaml


IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIRS = [PROJECT_ROOT / "models", PROJECT_ROOT / "yolo_model"]


def resolve_model_path(model: str) -> str:
    candidate = Path(model)
    if candidate.exists():
        return str(candidate)
    for model_dir in MODEL_DIRS:
        located = model_dir / model
        if located.exists():
            return str(located)
    return model


def list_models() -> dict[str, list[str]]:
    world_models = sorted(path.name for path in (PROJECT_ROOT / "models").glob("*.pt"))
    train_models = sorted(path.name for path in (PROJECT_ROOT / "yolo_model").glob("*.pt"))
    return {"world_models": world_models, "training_models": train_models}


def split_video_into_frames(
    video_path: str,
    output_dir: str,
    frames_per_second: float,
    resize_enabled: bool = False,
    resize_width: int | None = None,
    resize_height: int | None = None,
    *,
    job_id: str,
    job_store: Any,
) -> dict[str, Any]:
    if frames_per_second <= 0:
        raise ValueError("frames_per_second must be greater than 0")

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
                if not resize_width or not resize_height:
                    raise ValueError("resize_width and resize_height are required when resize is enabled")
                frame = cv2.resize(frame, (resize_width, resize_height), interpolation=cv2.INTER_AREA)
            timestamp = frame_index / frame_rate
            output_file = images_dir / f"{video_filename}_{frame_index:06d}_time_{timestamp:.2f}.jpg"
            cv2.imwrite(str(output_file), frame)
            saved += 1
        frame_index += 1
        if total_frames:
            progress = min(99, int(frame_index / total_frames * 100))
            job_store.update(job_id, progress=progress, message=f"Processed {frame_index}/{total_frames} frames")

    cap.release()
    return {"images_dir": str(images_dir), "saved_frames": saved}


def write_autolabel_config(
    input_path: str,
    output_path: str,
    model: str,
    classes: dict[str, list[str]] | None,
    config_path: str,
    *,
    job_id: str,
    job_store: Any,
) -> dict[str, Any]:
    Path(output_path).mkdir(parents=True, exist_ok=True)
    config = {
        "input_path": input_path,
        "output_path": output_path,
        "model": model,
    }
    if classes:
        config["classes"] = classes
    config_file = Path(config_path)
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config_file.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")
    job_store.update(job_id, progress=100, message="Config written")
    return {"config_path": str(config_file), "config": config}


def load_autolabel_config(config_path: str) -> dict[str, Any]:
    with Path(config_path).open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def _class_config(config: dict[str, Any]) -> tuple[list[str], list[str], dict[str, list[str]]]:
    default = {"person": ["person"], "car": ["car", "van", "truck"]}
    classes = config.get("classes") or default
    labels = [label for values in classes.values() for label in values]
    categories = list(classes.keys())
    return labels, categories, classes


def _class_mapping(categories: list[str], classes: dict[str, list[str]]) -> dict[str, int]:
    return {
        sub_label: index
        for index, category in enumerate(categories)
        for sub_label in classes[category]
    }


def run_autolabel(
    config_path: str,
    draw_bbox: bool = False,
    conf: float = 0.1,
    iou: float = 0.7,
    copy_images: bool = False,
    *,
    job_id: str,
    job_store: Any,
) -> dict[str, Any]:
    import supervision as sv
    from ultralytics import YOLOWorld

    config = load_autolabel_config(config_path)
    input_folder = Path(config.get("input_path", ""))
    output_folder = Path(config.get("output_path", ""))
    model_path = resolve_model_path(config.get("model", "yolov8m-world.pt"))
    labels, categories, classes = _class_config(config)
    mapping = _class_mapping(categories, classes)

    if not input_folder.exists():
        raise FileNotFoundError(f"input_path does not exist: {input_folder}")
    output_folder.mkdir(parents=True, exist_ok=True)
    labels_folder = output_folder / "labels"
    labels_folder.mkdir(exist_ok=True)
    bbox_folder = output_folder / "bbox"
    images_folder = output_folder / "images"
    if draw_bbox:
        bbox_folder.mkdir(exist_ok=True)
    if copy_images:
        images_folder.mkdir(exist_ok=True)

    image_paths = sorted(path for path in input_folder.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS)
    model = YOLOWorld(model_path)
    model.set_classes(labels)
    box_annotator = sv.BoxAnnotator() if draw_bbox else None
    label_annotator = sv.LabelAnnotator() if draw_bbox else None

    labeled = 0
    detections_total = 0
    for index, image_path in enumerate(image_paths, start=1):
        image = cv2.imread(str(image_path))
        if image is None:
            continue
        height, width = image.shape[:2]
        result = model.predict(image, conf=conf, iou=iou, verbose=False)[0]
        detections = sv.Detections.from_ultralytics(result)
        yolo_rows: list[str] = []

        if draw_bbox and len(detections) and box_annotator and label_annotator:
            detection_labels = [labels[int(class_id)] for class_id in detections.class_id]
            image = box_annotator.annotate(scene=image, detections=detections)
            image = label_annotator.annotate(scene=image, detections=detections, labels=detection_labels)

        for xyxy, class_id in zip(detections.xyxy, detections.class_id):
            label = labels[int(class_id)]
            cls_id = mapping[label]
            x1, y1, x2, y2 = map(float, xyxy)
            x_center = (x1 + x2) / 2 / width
            y_center = (y1 + y2) / 2 / height
            bbox_width = (x2 - x1) / width
            bbox_height = (y2 - y1) / height
            yolo_rows.append(f"{cls_id} {x_center:.6f} {y_center:.6f} {bbox_width:.6f} {bbox_height:.6f}")

        if yolo_rows:
            (labels_folder / f"{image_path.stem}.txt").write_text("\n".join(yolo_rows), encoding="utf-8")
            labeled += 1
            detections_total += len(yolo_rows)
        if draw_bbox:
            cv2.imwrite(str(bbox_folder / f"{image_path.stem}.jpg"), image)
        if copy_images:
            shutil.copy2(image_path, images_folder / image_path.name)

        progress = min(99, int(index / max(1, len(image_paths)) * 100))
        job_store.update(job_id, progress=progress, message=f"Labeled {index}/{len(image_paths)} images")

    return {
        "output_path": str(output_folder),
        "labels_path": str(labels_folder),
        "bbox_path": str(bbox_folder) if draw_bbox else None,
        "images": len(image_paths),
        "labeled_images": labeled,
        "detections": detections_total,
    }


def upload_to_roboflow(
    api_key: str,
    workspace: str,
    project_name: str,
    image_folder_path: str,
    annotation_folder_path: str,
    *,
    job_id: str,
    job_store: Any,
) -> dict[str, Any]:
    from roboflow import Roboflow

    rf = Roboflow(api_key=api_key)
    project = rf.workspace(workspace).project(project_name)
    image_files = sorted(
        file for file in os.listdir(image_folder_path) if file.lower().endswith(IMAGE_EXTENSIONS)
    )
    annotation_count = 0
    for index, image_file in enumerate(image_files, start=1):
        image_path = Path(image_folder_path) / image_file
        annotation_path = Path(annotation_folder_path) / f"{image_path.stem}.txt"
        if annotation_path.exists() and annotation_path.stat().st_size > 0:
            project.upload(
                image_path=str(image_path),
                annotation_path=str(annotation_path),
                annotation_format="yolo",
                num_retry_uploads=3,
            )
            annotation_count += 1
        else:
            project.upload(image_path=str(image_path), num_retry_uploads=3)
        job_store.update(job_id, progress=int(index / max(1, len(image_files)) * 100), message=f"Uploaded {index}/{len(image_files)}")
    return {"uploaded_images": len(image_files), "uploaded_annotations": annotation_count}


def download_roboflow_dataset(
    api_key: str,
    workspace: str,
    project_name: str,
    version: int,
    dataset_format: str,
    download_path: str,
    *,
    job_id: str,
    job_store: Any,
) -> dict[str, Any]:
    from roboflow import Roboflow

    job_store.update(job_id, progress=10, message="Connecting to Roboflow")
    rf = Roboflow(api_key=api_key)
    version_obj = rf.workspace(workspace).project(project_name).version(version)
    job_store.update(job_id, progress=40, message="Downloading dataset")
    dataset = version_obj.download(model_format=dataset_format, location=download_path, overwrite=True)
    return {"location": dataset.location}


def train_yolo(
    model: str,
    train: str,
    val: str,
    test: str | None,
    classes: list[str],
    epochs: int,
    device: str,
    patience: int,
    warmup_epochs: int,
    optimizer: str,
    lr0: float,
    lrf: float,
    *,
    job_id: str,
    job_store: Any,
) -> dict[str, Any]:
    from ultralytics import YOLO

    dataset_yaml = PROJECT_ROOT / "data" / "dataset.yaml"
    dataset_yaml.parent.mkdir(parents=True, exist_ok=True)
    names = {index: name.strip() for index, name in enumerate(classes)}
    dataset_config: dict[str, Any] = {"train": [train], "val": [val], "names": names}
    if test:
        dataset_config["test"] = [test]
    dataset_yaml.write_text(yaml.safe_dump(dataset_config, sort_keys=False), encoding="utf-8")

    args_yaml = PROJECT_ROOT / "data" / "args.yaml"
    args_yaml.write_text(
        yaml.safe_dump(
            {
                "model": model,
                "epochs": epochs,
                "imgsz": 640,
                "device": device,
                "patience": patience,
                "warmup_epochs": warmup_epochs,
                "optimizer": optimizer,
                "lr0": lr0,
                "lrf": lrf,
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    job_store.update(job_id, progress=5, message="Training started")
    yolo = YOLO(resolve_model_path(model))
    results = yolo.train(
        data=str(dataset_yaml),
        epochs=epochs,
        imgsz=640,
        batch=16,
        device=device,
        patience=patience,
        warmup_epochs=warmup_epochs,
        optimizer=optimizer,
        lr0=lr0,
        lrf=lrf,
        rect=True,
        project=str(PROJECT_ROOT / "runs" / "detect"),
    )
    return {"dataset_yaml": str(dataset_yaml), "args_yaml": str(args_yaml), "save_dir": str(results.save_dir)}


def convert_model(
    model_path: str,
    export_format: str,
    int8: bool = True,
    imgsz: int = 640,
    start_netron: bool = False,
    *,
    job_id: str,
    job_store: Any,
) -> dict[str, Any]:
    from ultralytics import YOLO

    job_store.update(job_id, progress=10, message="Loading model")
    model = YOLO(resolve_model_path(model_path))
    exported = model.export(format=export_format, int8=int8, imgsz=imgsz)
    result = {"exported_path": str(exported)}
    if start_netron:
        import netron

        port = _free_port()
        netron.start(str(exported), address=("0.0.0.0", port), browse=False)
        result["netron_url"] = f"http://localhost:{port}/?file={exported}"
    return result


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("0.0.0.0", 0))
        return int(sock.getsockname()[1])


def preview_images(path: str, limit: int = 40) -> list[str]:
    files = []
    for ext in IMAGE_EXTENSIONS:
        files.extend(glob.glob(str(Path(path) / f"*{ext}")))
    return sorted(files)[:limit]
