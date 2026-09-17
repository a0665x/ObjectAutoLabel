from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, SecretStr, model_validator


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


class SourceAnalysisRequest(BaseModel):
    source_asset_id: str | None = None


class ValidationPreviewRequest(BaseModel):
    model_name: str
    schema_id: str | None = None
    image_path: str | None = None
    folder_path: str | None = None
    sample_count: int = Field(1, ge=1, le=12)
    confidence: float = Field(0.25, ge=0, le=1)
    iou: float = Field(0.7, ge=0, le=1)


class FrameRunCreate(BaseModel):
    source_asset_id: str
    frames_per_second: float = Field(2.0, gt=0)
    resize_enabled: bool = False
    resize_width: int | None = Field(None, gt=0)
    resize_height: int | None = Field(None, gt=0)


class PseudoLabelRunCreate(BaseModel):
    run_name: str | None = None
    schema_id: str
    source_asset_id: str | None = None
    world_model: str
    confidence: float = Field(0.1, ge=0, le=1)
    iou: float = Field(0.7, ge=0, le=1)
    merge_boxes: bool = False
    merge_iou: float = Field(0.75, ge=0, le=1)


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


ReviewStatus = Literal["unreviewed", "pending_review", "needs_fix", "reviewed", "skipped"]


class AnnotationSaveRequest(BaseModel):
    annotations: list[AnnotationUpdateItem]
    review_status: ReviewStatus = "reviewed"


class ImageRemovalResult(BaseModel):
    operation_id: str
    image_id: str
    next_image_id: str | None


class ImageRestoreResult(BaseModel):
    image: dict[str, Any]
    annotations: list[dict[str, Any]]


class DatasetSplitCreate(BaseModel):
    name: str = "default"
    train_ratio: float = Field(0.8, gt=0, lt=1)
    val_ratio: float = Field(0.1, ge=0, lt=1)
    test_ratio: float = Field(0.1, ge=0, lt=1)
    pseudo_label_run_id: str | None = None
    augmentation_run_id: str | None = None
    open_data_import_id: str | None = None


class OpenDataRequest(BaseModel):
    dataset_key: str = Field(default="visdrone2019-det", min_length=1, max_length=300)
    schema_id: str
    mapping: dict[str, int | None]
    sample_percentage: int = Field(50, ge=1, le=100)
    seed: int = 42
    preview_seed: int | None = None
    version_name: str | None = Field(None, max_length=120)


class OpenDataDownloadRequest(BaseModel):
    dataset_key: str = Field(default="visdrone2019-det", min_length=1, max_length=300)
    license_accepted: bool = False
    api_key: SecretStr | None = Field(default=None, repr=False)


class OpenDataInspectRequest(BaseModel):
    dataset_url: str = Field(min_length=1, max_length=500)


class AugmentationRunCreate(BaseModel):
    name: str = "augmented"
    pseudo_label_run_id: str | None = None
    brightness: float = Field(0, ge=-100, le=100)
    hue: float = Field(0, ge=0, le=45)
    exposure: float = Field(0, ge=0, le=80)
    noise: float = Field(0, ge=0, le=100)
    blur: float = Field(0, ge=0, le=10)
    gain: float = Field(0, ge=0, le=60)
    box_motion_blur: float = Field(0, ge=0, le=15)
    rotation: float = Field(0, ge=0, le=30)
    horizontal_flip: bool = False
    vertical_flip: bool = False
    mirror_probability: float = Field(1.0, ge=0, le=1)
    copies: int = Field(3, ge=1, le=10)
    skip_augment: bool = False


class AugmentationPreviewRequest(BaseModel):
    brightness: float = Field(0, ge=-100, le=100)
    hue: float = Field(0, ge=0, le=45)
    exposure: float = Field(0, ge=0, le=80)
    noise: float = Field(0, ge=0, le=100)
    blur: float = Field(0, ge=0, le=10)
    gain: float = Field(0, ge=0, le=60)
    box_motion_blur: float = Field(0, ge=0, le=15)
    rotation: float = Field(0, ge=0, le=30)
    horizontal_flip: bool = False
    vertical_flip: bool = False
    mirror_probability: float = Field(1.0, ge=0, le=1)
    polarity: int = Field(1, ge=-1, le=1)
    limit: int = Field(3, ge=1, le=12)


class TrainingRunCreate(BaseModel):
    run_name: str | None = None
    dataset_split_id: str
    input_model: str
    epochs: int = Field(100, gt=0)
    imgsz: int = Field(640, gt=0)
    batch: int = Field(16, gt=0)
    device: str = "cuda"
    patience: int = Field(10, gt=0)
    optimizer: Literal["SGD", "MuSGD", "Adam", "AdamW"] = "SGD"
    lr0: float = Field(0.01, gt=0)
    lrf: float = Field(0.01, gt=0)
    rect: bool = True
    amp: bool = True
    diagnostics: bool = False


class ModelExportCreate(BaseModel):
    training_run_id: str
    export_format: str = "tflite"
    imgsz: int = Field(640, gt=0)
    int8: bool = True


class ModelConversionTarget(BaseModel):
    format: Literal["onnx", "tflite"]
    precision: Literal["fp32"] = "fp32"
    layout: Literal["NCHW", "NHWC"] = "NCHW"

    @model_validator(mode="after")
    def validate_layout(self) -> "ModelConversionTarget":
        if self.format == "onnx" and self.layout != "NCHW":
            raise ValueError("ONNX conversion uses NCHW layout")
        return self


class ModelConversionCreate(BaseModel):
    training_run_id: str | None = None
    source_model_path: str | None = None
    schema_id: str
    targets: list[ModelConversionTarget] = Field(min_length=1)
    imgsz: int = Field(640, gt=0)
    opset: int = Field(11, ge=11, le=20)

    @model_validator(mode="after")
    def reject_duplicate_targets(self) -> "ModelConversionCreate":
        target_keys = [(target.format, target.precision) for target in self.targets]
        if len(target_keys) != len(set(target_keys)):
            raise ValueError("Duplicate conversion target")
        return self


class ModelExportBundleCreate(BaseModel):
    conversion_run_id: str
    include_artifact_ids: list[str] = Field(default_factory=list)
    include_native_pt: bool = True
