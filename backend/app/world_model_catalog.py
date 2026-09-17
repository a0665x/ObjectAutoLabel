from __future__ import annotations

import re
from typing import Literal, TypedDict


class WorldModelInfo(TypedDict):
    name: str
    family: Literal["yolo-world", "yolo-world-v2", "yoloe-26", "unknown"]
    task: Literal["detect", "segment", "unknown"]
    annotation_output: Literal["bbox"]
    supported: bool
    reason: str | None


YOLOE26_PATTERN = re.compile(r"^yoloe-26[nslmx]-seg\.pt$", re.IGNORECASE)
YOLO_WORLD_V2_PATTERN = re.compile(r"^yolov8[smlx]-worldv2\.pt$", re.IGNORECASE)
YOLO_WORLD_PATTERN = re.compile(r"^yolov8[a-z0-9._-]*-world\.(?:pt|pth)$", re.IGNORECASE)
PROMPT_ENCODER_FILENAMES = {"ViT-B-32.pt", "mobileclip2_b.ts"}


def describe_world_model(name: str) -> WorldModelInfo:
    if YOLOE26_PATTERN.fullmatch(name):
        return {
            "name": name,
            "family": "yoloe-26",
            "task": "segment",
            "annotation_output": "bbox",
            "supported": True,
            "reason": None,
        }
    if YOLO_WORLD_V2_PATTERN.fullmatch(name):
        return {
            "name": name,
            "family": "yolo-world-v2",
            "task": "detect",
            "annotation_output": "bbox",
            "supported": True,
            "reason": None,
        }
    if YOLO_WORLD_PATTERN.fullmatch(name):
        return {
            "name": name,
            "family": "yolo-world",
            "task": "detect",
            "annotation_output": "bbox",
            "supported": True,
            "reason": None,
        }
    return {
        "name": name,
        "family": "unknown",
        "task": "unknown",
        "annotation_output": "bbox",
        "supported": False,
        "reason": "Unsupported world model filename",
    }


def list_world_model_details(names: list[str]) -> list[WorldModelInfo]:
    return [describe_world_model(name) for name in sorted(names)]
