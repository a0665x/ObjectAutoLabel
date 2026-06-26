from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""


class ClassDescriptorItem(BaseModel):
    class_id: int = Field(ge=0)
    class_name: str = Field(min_length=1)
    descriptors: list[str] = Field(default_factory=list)


class ClassSchemaCreate(BaseModel):
    name: str = Field(min_length=1)
    classes: list[ClassDescriptorItem]


class ApiJob(BaseModel):
    id: str
    name: str
    status: str
    progress: int
    message: str
    result: Any | None = None
    error: str | None = None


class SourceCreate(BaseModel):
    kind: str
    path: str = Field(min_length=1)


class FrameRunCreate(BaseModel):
    source_asset_id: str
    frames_per_second: float = Field(2.0, gt=0)
    resize_enabled: bool = False
    resize_width: int | None = Field(None, gt=0)
    resize_height: int | None = Field(None, gt=0)


class PseudoLabelRunCreate(BaseModel):
    schema_id: str
    source_asset_id: str | None = None
    world_model: str
    confidence: float = Field(0.1, ge=0, le=1)
    iou: float = Field(0.7, ge=0, le=1)


class AnnotationUpdateItem(BaseModel):
    id: str | None = None
    class_id: int = Field(ge=0)
    class_name: str
    x_center: float = Field(ge=0, le=1)
    y_center: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)
    confidence: float | None = None
    source_descriptor: str | None = None
    source_type: str = "manual"
    edited: bool = False


class AnnotationSaveRequest(BaseModel):
    annotations: list[AnnotationUpdateItem]
    review_status: str = "reviewed"


class DatasetSplitCreate(BaseModel):
    name: str = "default"
    train_ratio: float = Field(0.8, gt=0, lt=1)
    val_ratio: float = Field(0.1, ge=0, lt=1)
    test_ratio: float = Field(0.1, ge=0, lt=1)


class TrainingRunCreate(BaseModel):
    dataset_split_id: str
    input_model: str
    epochs: int = Field(100, gt=0)
    imgsz: int = Field(640, gt=0)
    batch: int = Field(16, gt=0)
    device: str = "cuda"
    patience: int = Field(10, gt=0)
    optimizer: str = "SGD"
    lr0: float = Field(0.01, gt=0)
    lrf: float = Field(0.01, gt=0)


class ModelExportCreate(BaseModel):
    training_run_id: str
    export_format: str = "tflite"
    imgsz: int = Field(640, gt=0)
    int8: bool = True
