from __future__ import annotations

from pathlib import Path
from typing import Any, TypedDict

from .world_model_catalog import describe_world_model


class BoxPrediction(TypedDict):
    xyxy: list[float]
    prompt_class_id: int
    confidence: float


def _load_ultralytics_classes() -> tuple[type[Any], type[Any]]:
    try:
        from ultralytics import YOLOE, YOLOWorld
    except (ImportError, AttributeError) as exc:
        raise RuntimeError("Ultralytics with YOLOE support is required") from exc
    return YOLOWorld, YOLOE


def _as_array(value: Any) -> Any:
    detached = value.cpu() if hasattr(value, "cpu") else value
    return detached.numpy() if hasattr(detached, "numpy") else detached


class PromptedWorldModel:
    def __init__(self, checkpoint: Path, prompts: list[str]) -> None:
        info = describe_world_model(checkpoint.name)
        if not info["supported"]:
            raise ValueError(f"Unsupported world model {checkpoint.name}: {info['reason']}")

        encoder_name = "mobileclip2_b.ts" if info["family"] == "yoloe-26" else "ViT-B-32.pt"
        encoder_path = checkpoint.parent / encoder_name
        if not encoder_path.is_file():
            raise FileNotFoundError(
                f"Prompt encoder {encoder_name} is not installed beside {checkpoint.name}; "
                "run scripts/install-world-model.sh before pseudo labeling"
            )

        yolo_world, yoloe = _load_ultralytics_classes()
        model_class = yoloe if info["family"] == "yoloe-26" else yolo_world
        self.family = info["family"]
        self.model = model_class(str(checkpoint))
        self.model.set_classes(prompts)

    def predict(self, frame: Any, confidence: float, iou: float) -> list[BoxPrediction]:
        result = self.model.predict(
            frame,
            conf=confidence,
            iou=iou,
            device=0,
            verbose=False,
        )[0]
        if result.boxes is None:
            return []

        coordinates = _as_array(result.boxes.xyxy)
        class_ids = _as_array(result.boxes.cls)
        scores = _as_array(result.boxes.conf)
        return [
            {
                "xyxy": [float(value) for value in xyxy],
                "prompt_class_id": int(class_id),
                "confidence": float(score),
            }
            for xyxy, class_id, score in zip(coordinates, class_ids, scores)
        ]
