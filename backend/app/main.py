from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import project_services, world_models
from .config import AppPaths, ensure_runtime_dirs
from .db import connect, initialize_schema
from .jobs import JobRunner
from .repositories import Repository
from .schemas import (
    AnnotationSaveRequest,
    ClassSchemaCreate,
    DatasetSplitCreate,
    FrameRunCreate,
    ModelExportCreate,
    ProjectCreate,
    PseudoLabelRunCreate,
    SourceCreate,
    TrainingRunCreate,
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
]
SAFE_PROJECT_FILE_DIRS = {"frames", "metadata", "pseudo_labels", "reviewed_labels", "sources", "splits"}


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
    raise HTTPException(status_code=404, detail="File not found")

paths = AppPaths(project_root=PROJECT_ROOT)
ensure_runtime_dirs(paths)
db = connect(paths.database_path)
initialize_schema(db)
repo = Repository(db=db, paths=paths)
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
def list_jobs() -> list[dict[str, Any]]:
    return repo.list_jobs()


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
    output_dir = str(Path(project["root_path"]) / "frames")
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
        project_id=project_id,
        related_type="dataset_split",
    )


@app.get("/api/projects/{project_id}/dataset-splits")
def list_dataset_splits(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_dataset_splits(project_id)


@app.get("/api/projects/{project_id}/training-runs")
def list_training_runs(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_training_runs(project_id)


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
