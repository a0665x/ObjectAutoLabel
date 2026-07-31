from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import project_services, world_models
from .config import AppPaths, ensure_runtime_dirs
from .db import connect, initialize_schema
from .jobs import JobRunner
from .repositories import Repository
from .schemas import (
    AnnotationSaveRequest,
    AugmentationPreviewRequest,
    AugmentationRunCreate,
    ClassSchemaCreate,
    DatasetSplitCreate,
    FrameRunCreate,
    ModelConversionCreate,
    ModelExportCreate,
    ModelExportBundleCreate,
    ProjectCreate,
    PseudoLabelRunCreate,
    SourceCreate,
    SourceAnalysisRequest,
    TrainingRunCreate,
    ValidationPreviewRequest,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
STATIC_DIR = FRONTEND_DIR / "dist"
ALLOWED_CORS_ORIGINS = [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8501",
    "http://127.0.0.1:8501",
    "http://10.42.0.21:8501",
    "http://100.94.21.85:8501",
]
SAFE_PROJECT_FILE_DIRS = {"augmentations", "conversions", "exports", "frames", "metadata", "pseudo_labels", "reviewed_labels", "sources", "splits"}
TRUSTED_DATA_ROOTS = [Path("/home/a0665x/Desktop/AI_AGX_WS/autolabel").resolve()]


def resolve_frontend_dist(frontend_dir: Path = FRONTEND_DIR) -> Path:
    dist_dir = frontend_dir / "dist"
    index_file = dist_dir / "index.html"
    if not index_file.is_file():
        raise RuntimeError(
            f"Missing built frontend assets at {index_file}. Run `npm --prefix frontend run build` "
            "or use the supported Docker startup path."
        )
    return dist_dir


def is_safe_project_file(file_path: Path) -> bool:
    for project in repo.list_projects():
        project_root = Path(project["root_path"]).resolve()
        try:
            relative = file_path.relative_to(project_root)
        except ValueError:
            continue
        if not relative.parts:
            return False
        return relative.parts[0] in SAFE_PROJECT_FILE_DIRS
    return False


def resolve_served_file(path: str) -> Path:
    file_path = Path(path).expanduser()
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    resolved_path = file_path.resolve()
    image = repo.get_image_by_path(str(file_path)) or repo.get_image_by_path(str(resolved_path))
    if image:
        return resolved_path
    if is_safe_project_file(resolved_path):
        return resolved_path
    for trusted_root in TRUSTED_DATA_ROOTS:
        try:
            resolved_path.relative_to(trusted_root)
            return resolved_path
        except ValueError:
            continue
    raise HTTPException(status_code=404, detail="File not found")

paths = AppPaths()
ensure_runtime_dirs(paths)
db = connect(paths.database_path)
initialize_schema(db)
repo = Repository(db=db, paths=paths)
repo.migrate_project_output_models()
repo.migrate_project_source_copies()
repo.mark_interrupted_jobs()
jobs = JobRunner(repo=repo, max_workers=2)

app = FastAPI(title="ObjectAutoLabel API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "project_root": str(PROJECT_ROOT)}


@app.get("/api/files")
def read_local_file(path: str) -> FileResponse:
    file_path = resolve_served_file(path)
    return FileResponse(file_path)


@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    return repo.list_projects()


@app.post("/api/projects")
def create_project(payload: ProjectCreate) -> dict[str, Any]:
    return repo.create_project(name=payload.name, description=payload.description)


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str) -> dict[str, bool]:
    if not repo.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}


@app.get("/api/projects/{project_id}/storage-status")
def get_project_storage_status(project_id: str) -> dict[str, Any]:
    status = repo.get_project_storage_status(project_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return status


@app.post("/api/projects/{project_id}/cleanup-stale")
def cleanup_stale_project(project_id: str) -> dict[str, bool]:
    status = repo.get_project_storage_status(project_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not status["is_stale"]:
        raise HTTPException(status_code=409, detail="Project storage is healthy; use Delete project package instead.")
    if not repo.cleanup_stale_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.get("/api/projects/{project_id}/class-schemas")
def list_class_schemas(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_class_schemas(project_id)


@app.post("/api/projects/{project_id}/class-schemas")
def create_class_schema(project_id: str, payload: ClassSchemaCreate) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.create_class_schema(
        project_id=project_id,
        name=payload.name,
        classes=[item.model_dump() for item in payload.classes],
    )


@app.get("/api/models/world")
def list_world_models() -> dict[str, list[str]]:
    return {"world_models": repo.list_models()["world_models"]}


@app.get("/api/models/input")
def list_input_models() -> dict[str, list[str]]:
    return {"input_models": repo.list_models()["input_models"]}


@app.get("/api/models/output")
def list_output_models() -> dict[str, list[str]]:
    return {"output_models": repo.list_models()["output_models"]}


@app.get("/api/jobs")
def list_jobs(project_id: str | None = None) -> list[dict[str, Any]]:
    return repo.list_jobs(project_id=project_id)


@app.get("/api/file-browser")
def browse_files(path: str | None = None, mode: str = "image_folder") -> dict[str, Any]:
    return project_services.browse_local_files(path, mode)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = repo.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/projects/{project_id}/sources")
def list_sources(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_source_assets(project_id)


@app.post("/api/projects/{project_id}/sources")
def create_source(project_id: str, payload: SourceCreate) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.kind not in {"video", "image_folder"}:
        raise HTTPException(status_code=422, detail="kind must be video or image_folder")
    source = repo.create_source_asset(project_id=project_id, kind=payload.kind, path=payload.path)
    if payload.kind == "image_folder":
        project_services.register_image_folder(repo, project_id, source["id"], payload.path)
    return source


@app.post("/api/projects/{project_id}/source-analysis")
def analyze_source(project_id: str, payload: SourceAnalysisRequest) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return project_services.analyze_project_sources(repo, project_id, payload.source_asset_id)


@app.get("/api/projects/{project_id}/images")
def list_project_images(
    project_id: str,
    review_status: str | None = None,
    has_low_confidence: bool | None = None,
    source_asset_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_images(
        project_id,
        review_status=review_status,
        has_low_confidence=has_low_confidence,
        source_asset_id=source_asset_id,
        limit=limit,
        offset=offset,
    )


@app.get("/api/projects/{project_id}/review-stats")
def get_review_stats(project_id: str) -> dict[str, int]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.get_review_stats(project_id)


@app.post("/api/projects/{project_id}/frame-runs")
def create_frame_run(project_id: str, payload: FrameRunCreate) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    source = repo.get_source_asset(payload.source_asset_id)
    if not source or source["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Source not found")
    if source["kind"] != "video":
        raise HTTPException(status_code=422, detail="Frame extraction requires a video source")
    output_dir = str(Path(project["root_path"]) / "sources" / source["id"] / "frames")
    return jobs.create(
        "frame_extraction",
        project_services.split_video_into_frames,
        repo,
        project_id,
        source["id"],
        source["path"],
        output_dir,
        payload.frames_per_second,
        payload.resize_enabled,
        payload.resize_width,
        payload.resize_height,
        project_id=project_id,
        related_type="frame_extraction_run",
    )


@app.post("/api/projects/{project_id}/pseudo-label-runs")
def create_pseudo_label_run(project_id: str, payload: PseudoLabelRunCreate) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    if not repo.get_class_schema(payload.schema_id):
        raise HTTPException(status_code=404, detail="Class schema not found")
    if payload.source_asset_id:
        source = repo.get_source_asset(payload.source_asset_id)
        if not source or source["project_id"] != project_id:
            raise HTTPException(status_code=404, detail="Source not found")
    active = repo.find_active_job(project_id, "pseudo_label")
    if active:
        raise HTTPException(status_code=409, detail="Pseudo-label generation is already running for this project. Wait for it to finish before starting another run.")
    return jobs.create(
        "pseudo_label",
        world_models.run_yolo_world_pseudo_label,
        repo,
        project_id,
        payload.schema_id,
        payload.source_asset_id,
        payload.world_model,
        payload.confidence,
        payload.iou,
        payload.merge_boxes,
        payload.merge_iou,
        payload.run_name,
        project_id=project_id,
        related_type="pseudo_label_run",
    )


@app.get("/api/images/{image_id}/annotations")
def list_annotations(image_id: str) -> dict[str, Any]:
    image = repo.get_image(image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return {"image": image, "annotations": repo.list_annotations(image_id)}


@app.put("/api/images/{image_id}/annotations")
def save_annotations(image_id: str, payload: AnnotationSaveRequest) -> dict[str, Any]:
    try:
        return project_services.save_image_annotations(
            repo,
            image_id=image_id,
            annotations=[item.model_dump() for item in payload.annotations],
            review_status=payload.review_status,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/projects/{project_id}/augmentation-preview")
def preview_augmentation(project_id: str, payload: AugmentationPreviewRequest) -> list[dict[str, Any]]:
    try:
        return project_services.list_augmentation_preview_samples(
            repo,
            project_id,
            brightness=payload.brightness,
            hue=payload.hue,
            exposure=payload.exposure,
            noise=payload.noise,
            blur=payload.blur,
            gain=payload.gain,
            box_motion_blur=payload.box_motion_blur,
            rotation=payload.rotation,
            horizontal_flip=payload.horizontal_flip,
            polarity=payload.polarity,
            limit=payload.limit,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/projects/{project_id}/augmentation-runs")
def create_augmentation_run(project_id: str, payload: AugmentationRunCreate) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return jobs.create(
        "augmentation",
        project_services.create_image_augmentation_run,
        repo,
        project_id,
        payload.name,
        payload.pseudo_label_run_id,
        payload.brightness,
        payload.hue,
        payload.exposure,
        payload.noise,
        payload.blur,
        payload.gain,
        payload.box_motion_blur,
        payload.rotation,
        payload.horizontal_flip,
        payload.copies,
        payload.skip_augment,
        project_id=project_id,
        related_type="augmentation_run",
    )


@app.get("/api/projects/{project_id}/augmentation-runs")
def list_augmentation_runs(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_augmentation_runs(project_id)


@app.get("/api/projects/{project_id}/augmentation-runs/{run_id}/samples")
def list_augmentation_samples(project_id: str, run_id: str, limit: int = 3) -> list[dict[str, Any]]:
    try:
        return project_services.list_augmentation_run_samples(repo, project_id, run_id, limit)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}/pseudo-label-runs")
def list_pseudo_label_runs(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_pseudo_label_runs(project_id)


@app.post("/api/projects/{project_id}/dataset-splits")
def create_dataset_split(project_id: str, payload: DatasetSplitCreate) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return jobs.create(
        "dataset_split",
        project_services.create_dataset_split,
        repo,
        project_id,
        payload.name,
        payload.train_ratio,
        payload.val_ratio,
        payload.test_ratio,
        payload.pseudo_label_run_id,
        payload.augmentation_run_id,
        project_id=project_id,
        related_type="dataset_split",
    )


@app.get("/api/projects/{project_id}/dataset-splits")
def list_dataset_splits(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_dataset_splits(project_id)


@app.get("/api/projects/{project_id}/dataset-splits/{split_id}/samples")
def list_dataset_split_samples(project_id: str, split_id: str, limit_per_bucket: int = 6) -> dict[str, list[dict[str, Any]]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return project_services.list_dataset_split_samples(repo, project_id, split_id, limit_per_bucket)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/projects/{project_id}/training-runs")
def list_training_runs(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_training_runs(project_id)


@app.post("/api/projects/{project_id}/validation-preview")
def create_validation_preview(project_id: str, payload: ValidationPreviewRequest) -> dict[str, Any]:
    try:
        return project_services.run_validation_preview(
            repo,
            project_id,
            model_name=payload.model_name,
            schema_id=payload.schema_id,
            image_path=payload.image_path,
            folder_path=payload.folder_path,
            confidence=payload.confidence,
            iou=payload.iou,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/projects/{project_id}/training-runs")
def create_training_run(project_id: str, payload: TrainingRunCreate) -> dict[str, Any]:
    split = repo.get_dataset_split(payload.dataset_split_id)
    if not split or split["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Dataset split not found")
    return jobs.create(
        "training",
        project_services.run_training,
        repo,
        project_id,
        payload.dataset_split_id,
        payload.input_model,
        payload.epochs,
        payload.imgsz,
        payload.batch,
        payload.device,
        payload.patience,
        payload.optimizer,
        payload.lr0,
        payload.lrf,
        payload.run_name,
        project_id=project_id,
        related_type="training_run",
    )


@app.post("/api/projects/{project_id}/model-exports")
def create_model_export(project_id: str, payload: ModelExportCreate) -> dict[str, Any]:
    training_run = repo.get_training_run(payload.training_run_id)
    if not training_run or training_run["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Training run not found")
    return jobs.create(
        "model_export",
        project_services.export_training_model,
        repo,
        project_id,
        payload.training_run_id,
        payload.export_format,
        payload.imgsz,
        payload.int8,
        project_id=project_id,
        related_type="model_export",
    )


@app.get("/api/projects/{project_id}/model-conversions")
def list_model_conversions(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_model_conversion_runs(project_id)


@app.get("/api/projects/{project_id}/model-sources")
def list_model_sources(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return project_services.list_project_model_sources(repo, project_id)


@app.get("/api/projects/{project_id}/artifact-context")
def get_artifact_context(project_id: str) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return project_services.get_project_artifact_context(repo, project_id)


@app.post("/api/projects/{project_id}/model-conversions")
def create_model_conversion(project_id: str, payload: ModelConversionCreate) -> dict[str, Any]:
    if not payload.training_run_id and not payload.source_model_path:
        raise HTTPException(status_code=422, detail="training_run_id or source_model_path is required")
    if payload.training_run_id:
        training_run = repo.get_training_run(payload.training_run_id)
        if not training_run or training_run["project_id"] != project_id:
            raise HTTPException(status_code=404, detail="Training run not found")
    if payload.source_model_path:
        source_model = Path(payload.source_model_path)
        if not source_model.exists():
            raise HTTPException(status_code=404, detail="Source model not found")
    schema = repo.get_class_schema(payload.schema_id)
    if not schema or schema["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Class schema not found")
    return jobs.create(
        "model_conversion",
        project_services.create_model_conversion_package,
        repo,
        project_id,
        payload.training_run_id,
        payload.schema_id,
        [target.model_dump() for target in payload.targets],
        payload.imgsz,
        source_model_path=payload.source_model_path,
        project_id=project_id,
        related_type="model_conversion",
    )


@app.get("/api/projects/{project_id}/model-conversions/{conversion_id}/netron")
def get_model_conversion_netron(project_id: str, conversion_id: str, artifact_id: str) -> dict[str, str]:
    conversion = repo.get_model_conversion_run(conversion_id)
    if not conversion or conversion["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Conversion package not found")
    artifact = next((item for item in conversion.get("artifacts", []) if item["id"] == artifact_id), None)
    if not artifact:
        raise HTTPException(status_code=404, detail="Conversion artifact not found")
    output_path = Path(str(artifact.get("output_path") or ""))
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Conversion artifact file not found")
    try:
        import netron

        netron.start(str(output_path), address=("0.0.0.0", 8081), browse=False)
    except OSError:
        pass
    return {"url": f"/api/netron/?file={output_path}"}


@app.get("/api/netron/{asset_path:path}")
def proxy_netron(request: Request, asset_path: str = "") -> Response:
    target = f"http://127.0.0.1:8081/{asset_path}"
    if request.url.query:
        target += f"?{request.url.query}"
    try:
        with urlopen(UrlRequest(target), timeout=10) as upstream:
            body = upstream.read()
            content_type = upstream.headers.get("content-type", "application/octet-stream")
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Netron is not ready: {exc}") from exc
    if asset_path == "index.js":
        script = body.decode("utf-8")
        script = script.replace(
            "(Array.isArray(firefox) && parseInt(firefox[1], 10) < 114)",
            "(Array.isArray(firefox) && parseInt(firefox[1], 10) < 102)",
        )
        body = script.encode("utf-8")
    elif asset_path == "browser.js":
        script = body.decode("utf-8")
        script = script.replace("days > 180", "days > 36500")
        body = script.encode("utf-8")
    return Response(content=body, media_type=content_type, headers={"Cache-Control": "no-store"})


@app.post("/api/projects/{project_id}/model-conversions/{conversion_id}/export-download")
def download_model_conversion_export(project_id: str, conversion_id: str) -> FileResponse:
    try:
        bundle, zip_path = project_services.create_model_export_bundle_zip(repo, project_id, conversion_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Export bundle ZIP not found")
    return FileResponse(
        zip_path,
        filename=f"{bundle['bundle_name']}-{conversion_id[:8]}.zip",
        media_type="application/zip",
    )


@app.get("/api/projects/{project_id}/export-bundles")
def list_export_bundles(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_model_export_bundles(project_id)


@app.post("/api/projects/{project_id}/export-bundles")
def create_export_bundle(project_id: str, payload: ModelExportBundleCreate) -> dict[str, Any]:
    conversion = repo.get_model_conversion_run(payload.conversion_run_id)
    if not conversion or conversion["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Conversion package not found")
    return jobs.create(
        "model_export_bundle",
        project_services.create_model_export_bundle,
        repo,
        project_id,
        payload.conversion_run_id,
        payload.include_artifact_ids,
        payload.include_native_pt,
        project_id=project_id,
        related_type="model_export_bundle",
    )


try:
    app.mount("/", StaticFiles(directory=resolve_frontend_dist(), html=True), name="frontend")
except RuntimeError as frontend_error:
    frontend_error_message = str(frontend_error)

    @app.get("/", include_in_schema=False)
    @app.get("/{frontend_path:path}", include_in_schema=False)
    def frontend_not_built(frontend_path: str = "") -> dict[str, str]:
        if frontend_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        raise HTTPException(status_code=503, detail=frontend_error_message)
