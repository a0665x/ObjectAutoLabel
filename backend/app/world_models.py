from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2

from .repositories import Repository


def resolve_world_model(repo: Repository, model_name: str) -> Path:
    model_path = Path(model_name)
    if model_path.is_absolute():
        return model_path
    return repo.paths.world_model_dir / model_name


def _schema_prompts(schema: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
    prompts: list[str] = []
    mappings: list[dict[str, Any]] = []
    for class_item in schema["classes"]:
        descriptors = class_item.get("descriptors") or [class_item["class_name"]]
        for descriptor in descriptors:
            prompts.append(descriptor)
            mappings.append(
                {
                    "class_id": int(class_item["class_id"]),
                    "class_name": class_item["class_name"],
                    "source_descriptor": descriptor,
                }
            )
    return prompts, mappings


def _xyxy_to_yolo(xyxy: Any, width: int, height: int) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = map(float, xyxy)
    x_center = ((x1 + x2) / 2) / width
    y_center = ((y1 + y2) / 2) / height
    box_width = (x2 - x1) / width
    box_height = (y2 - y1) / height
    return x_center, y_center, box_width, box_height


def run_yolo_world_pseudo_label(
    repo: Repository,
    project_id: str,
    schema_id: str,
    source_asset_id: str | None,
    world_model: str,
    confidence: float,
    iou: float,
    *,
    job_id: str,
) -> dict[str, Any]:
    import supervision as sv
    from ultralytics import YOLOWorld

    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    schema = repo.get_class_schema(schema_id)
    if not schema or schema["project_id"] != project_id:
        raise FileNotFoundError(f"Class schema not found: {schema_id}")
    model_path = resolve_world_model(repo, world_model)
    if not model_path.exists():
        raise FileNotFoundError(f"World model not found: {model_path}")

    prompts, mappings = _schema_prompts(schema)
    if not prompts:
        raise ValueError("Class schema must include at least one class name or descriptor")

    images = repo.list_images(project_id, limit=100000, offset=0)
    if source_asset_id:
        images = [image for image in images if image["source_asset_id"] == source_asset_id]

    output_dir = Path(project["root_path"]) / "pseudo_labels" / Path(world_model).stem
    output_dir.mkdir(parents=True, exist_ok=True)
    model = YOLOWorld(str(model_path))
    model.set_classes(prompts)
    labeled_count = 0
    detection_count = 0

    for index, image in enumerate(images, start=1):
        image_path = Path(image["path"])
        frame = cv2.imread(str(image_path))
        if frame is None:
            continue
        height, width = frame.shape[:2]
        result = model.predict(frame, conf=confidence, iou=iou, verbose=False)[0]
        detections = sv.Detections.from_ultralytics(result)
        annotations: list[dict[str, Any]] = []
        for xyxy, prompt_class_id, conf_score in zip(
            detections.xyxy,
            detections.class_id,
            detections.confidence,
        ):
            mapping = mappings[int(prompt_class_id)]
            x_center, y_center, box_width, box_height = _xyxy_to_yolo(xyxy, width, height)
            annotations.append(
                {
                    "class_id": mapping["class_id"],
                    "class_name": mapping["class_name"],
                    "x_center": x_center,
                    "y_center": y_center,
                    "width": box_width,
                    "height": box_height,
                    "confidence": float(conf_score),
                    "source_descriptor": mapping["source_descriptor"],
                    "source_type": "pseudo",
                    "edited": False,
                }
            )
        if annotations:
            labeled_count += 1
            detection_count += len(annotations)
        repo.replace_image_annotations(image["id"], annotations, review_status="pending_review")
        progress = min(99, int(index / max(1, len(images)) * 100))
        repo.update_job(job_id, progress=progress, message=f"Labeled {index}/{len(images)} images")

    return repo.create_pseudo_label_run_record(
        project_id=project_id,
        schema_id=schema_id,
        source_asset_id=source_asset_id,
        world_model=world_model,
        output_dir=str(output_dir),
        confidence=confidence,
        iou=iou,
        image_count=len(images),
        labeled_count=labeled_count,
        job_id=job_id,
    ) | {"detections": detection_count}
