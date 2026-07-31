from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

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


def _annotation_xyxy(annotation: dict[str, Any]) -> tuple[float, float, float, float]:
    half_width = float(annotation["width"]) / 2
    half_height = float(annotation["height"]) / 2
    x_center = float(annotation["x_center"])
    y_center = float(annotation["y_center"])
    return (
        x_center - half_width,
        y_center - half_height,
        x_center + half_width,
        y_center + half_height,
    )


def _annotation_iou(first: dict[str, Any], second: dict[str, Any]) -> float:
    ax1, ay1, ax2, ay2 = _annotation_xyxy(first)
    bx1, by1, bx2, by2 = _annotation_xyxy(second)
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    inter_width = max(0.0, ix2 - ix1)
    inter_height = max(0.0, iy2 - iy1)
    intersection = inter_width * inter_height
    first_area = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    second_area = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = first_area + second_area - intersection
    return 0.0 if union <= 0 else intersection / union


def _merge_annotation_group(group: list[dict[str, Any]]) -> dict[str, Any]:
    best = max(group, key=lambda item: float(item.get("confidence") or 0.0)).copy()
    descriptors: list[str] = []
    for item in group:
        descriptor = item.get("source_descriptor")
        if descriptor and descriptor not in descriptors:
            descriptors.append(str(descriptor))
    if descriptors:
        best["source_descriptor"] = " | ".join(descriptors)
    if len(group) > 1:
        best["source_type"] = "pseudo_merged"
    return best


def _merge_same_class_annotations(annotations: list[dict[str, Any]], iou_threshold: float) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    used: set[int] = set()
    for index, annotation in enumerate(annotations):
        if index in used:
            continue
        group = [annotation]
        used.add(index)
        for other_index in range(index + 1, len(annotations)):
            if other_index in used:
                continue
            candidate = annotations[other_index]
            if int(candidate["class_id"]) != int(annotation["class_id"]):
                continue
            if _annotation_iou(annotation, candidate) >= iou_threshold:
                group.append(candidate)
                used.add(other_index)
        merged.append(_merge_annotation_group(group))
    return merged


def _draw_preview(frame: Any, annotations: list[dict[str, Any]], output_path: Path) -> None:
    import cv2

    height, width = frame.shape[:2]
    colors = [(10, 132, 255), (48, 209, 88), (255, 159, 10), (255, 55, 95)]
    preview = frame.copy()
    for item in annotations:
        color = colors[int(item["class_id"]) % len(colors)]
        x_center = float(item["x_center"]) * width
        y_center = float(item["y_center"]) * height
        box_width = float(item["width"]) * width
        box_height = float(item["height"]) * height
        x1 = max(0, int(x_center - box_width / 2))
        y1 = max(0, int(y_center - box_height / 2))
        x2 = min(width - 1, int(x_center + box_width / 2))
        y2 = min(height - 1, int(y_center + box_height / 2))
        label = f'{item["class_name"]} {float(item.get("confidence") or 0):.2f}'
        cv2.rectangle(preview, (x1, y1), (x2, y2), color, 2)
        cv2.putText(preview, label, (x1, max(16, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), preview)


def run_yolo_world_pseudo_label(
    repo: Repository,
    project_id: str,
    schema_id: str,
    source_asset_id: str | None,
    world_model: str,
    confidence: float,
    iou: float,
    merge_boxes: bool = False,
    merge_iou: float = 0.75,
    run_name: str | None = None,
    *,
    job_id: str,
) -> dict[str, Any]:
    import cv2
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
    raw_detection_count = 0
    merged_detection_count = 0
    last_image_preview: str | None = None
    processed_image_ids: list[str] = []

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
        raw_count = len(annotations)
        raw_detection_count += raw_count
        if merge_boxes:
            annotations = _merge_same_class_annotations(annotations, merge_iou)
        merged_count = len(annotations)
        merged_detection_count += max(0, raw_count - merged_count)
        if annotations:
            labeled_count += 1
            detection_count += len(annotations)
        repo.replace_image_annotations(image["id"], annotations, review_status="pending_review")
        processed_image_ids.append(image["id"])
        preview_path = output_dir / "preview" / f"{image_path.stem}_preview.jpg"
        _draw_preview(frame, annotations, preview_path)
        last_image_preview = str(preview_path)
        progress = min(99, int(index / max(1, len(images)) * 100))
        merge_rate = 0.0 if raw_detection_count == 0 else merged_detection_count / raw_detection_count * 100
        repo.update_job(
            job_id,
            progress=progress,
            message=(
                f"Processing {index}/{len(images)}: {image_path.name} · "
                f"boxes={detection_count} · merged={merged_detection_count}/{raw_detection_count} ({merge_rate:.1f}%) · "
                f"preview={last_image_preview}"
            ),
        )

    run_name = (run_name or "").strip() or f"Pseudo_{datetime.now().strftime('%Y%m%d_%H%M%S')}_v{len(repo.list_pseudo_label_runs(project_id)) + 1:03d}"
    run = repo.create_pseudo_label_run_record(
        project_id=project_id,
        schema_id=schema_id,
        source_asset_id=source_asset_id,
        world_model=world_model,
        output_dir=str(output_dir),
        confidence=confidence,
        iou=iou,
        image_count=len(images),
        labeled_count=labeled_count,
        raw_detection_count=raw_detection_count,
        merged_detection_count=merged_detection_count,
        merge_rate=0.0 if raw_detection_count == 0 else merged_detection_count / raw_detection_count,
        last_image_path=last_image_preview,
        job_id=job_id,
        run_name=run_name,
    ) | {
        "detections": detection_count,
        "raw_detections": raw_detection_count,
        "merged_detections": merged_detection_count,
        "merge_rate": 0.0 if raw_detection_count == 0 else merged_detection_count / raw_detection_count,
        "last_image_path": last_image_preview,
    }
    repo.assign_pseudo_label_run_to_images(run["id"], processed_image_ids)
    return run
