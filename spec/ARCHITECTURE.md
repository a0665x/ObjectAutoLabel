# Architecture

ObjectAutoLabel has three runtime layers:

- React/Vite WebUI in `frontend/src`, built to `frontend/dist`.
- FastAPI backend in `backend/app/`.
- SQLite database at `object_autolabel.db`.
- Docker Compose service that packages Python, CUDA-capable PyTorch, YOLO dependencies, models, and persistent volumes.

## Request Flow

1. The browser loads `/` from FastAPI static files. FastAPI serves `frontend/dist` when present and falls back to `frontend/`.
2. React forms submit JSON payloads to project-centric `/api/*` endpoints.
3. Route handlers validate payloads with Pydantic schemas and delegate state changes to `Repository`.
4. Long-running endpoints create a SQLite-backed job record and execute the service function in a background thread through `JobRunner`.
5. The UI polls `/api/jobs` and refreshes project resources.
6. Output files are written under `data/projects/<slug>/`, `runs/`, and model folders.

## Current Service Flow

The current project-centric workflow is implemented in these primary modules:

- Source registration and frame extraction: `project_services.register_image_folder` and `project_services.split_video_into_frames`.
- YOLO-World pseudo-labeling: `world_models.run_yolo_world_pseudo_label`.
- Annotation persistence and YOLO label writing: `project_services.save_image_annotations` and `label_io.py`.
- Dataset split generation: `project_services.create_dataset_split`.
- Training and export: `project_services.run_training` and `project_services.export_training_model`.

`backend/app/services.py` still exists as a legacy compatibility/reference module, but new route behavior should use `project_services.py`, `world_models.py`, `repositories.py`, and `label_io.py`.

## Design Decisions

- Streamlit session state was replaced with explicit JSON payloads and persisted project records.
- Tkinter file dialogs were removed because they do not fit containerized browser workflows.
- Job polling was introduced so slow operations do not block the browser request.
- Models are separated into `world_model/` for YOLO-World weights, `input_model/` for training input weights, and `output_model/` for trained/exported artifacts.
- Dataset preparation is project-centric: sources, images, annotations, splits, training runs, exports, and jobs are all stored in SQLite.

## External Dependencies

- Ultralytics `YOLOWorld` and `YOLO`.
- OpenCV for frame extraction and image loading.
- Supervision for bbox annotation.
- Netron for optional model visualization.
