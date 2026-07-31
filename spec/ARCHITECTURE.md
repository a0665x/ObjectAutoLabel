# Architecture

ObjectAutoLabel has three runtime layers:

- React/Vite WebUI in `frontend/src`, built to `frontend/dist`.
- FastAPI backend in `backend/app/`.
- SQLite database at `data/object_autolabel.db`.
- Docker Compose service that packages Python, CUDA-capable PyTorch, YOLO dependencies, models, and persistent volumes.

## Request Flow

1. The browser loads `/` from FastAPI static files. FastAPI serves `frontend/dist` when present and falls back to `frontend/`.
2. React forms submit JSON payloads to project-centric `/api/*` endpoints.
3. Route handlers validate payloads with Pydantic schemas and delegate state changes to `Repository`.
4. Long-running endpoints create a SQLite-backed job record and execute the service function in a background thread through `JobRunner`.
5. The UI polls `/api/jobs` and refreshes project resources.
6. Project-owned output files are written under `data/projects/<slug>/`, including copied sources, labels, splits, training outputs, conversion packages, and export bundles. Global `output_model/<project_slug>` entries are index symlinks to project-local model outputs.

## Current Service Flow

The current project-centric workflow is implemented in these primary modules:

- Source registration and frame extraction: `project_services.register_image_folder` and `project_services.split_video_into_frames`.
- Source browsing and analysis: local file-browser endpoints expose only container-visible paths and source analysis summarizes image counts, dimensions, extensions, and common sizes before registration/downstream use.
- YOLO-World pseudo-labeling: `world_models.run_yolo_world_pseudo_label`.
- Annotation persistence and YOLO label writing: `project_services.save_image_annotations` and `label_io.py`.
- Dataset split generation: `project_services.create_dataset_split`.
- Augmentation previews/runs: `project_services` applies pixel transforms and keeps bbox geometry aligned for flip/rotation outputs.
- Training, validation preview, conversion, and export bundles: `project_services.run_training`, validation preview helpers, `project_services.create_model_conversion_package`, and `project_services.create_model_export_bundle`.
- Runtime launcher and LAN/Tailscale compatibility: `backend.app.server` starts Uvicorn on the selected bind IP and can start a localhost TCP proxy to preserve Tailscale serve forwarding.
- Netron visualization: `main.get_model_conversion_netron` starts Netron for one selected artifact; `main.proxy_netron` exposes it through same-origin `/api/netron/...` and rewrites upstream Netron frontend assets for local embedded use.

`backend/app/services.py` still exists as a legacy compatibility/reference module, but new route behavior should use `project_services.py`, `world_models.py`, `repositories.py`, and `label_io.py`.

## Design Decisions

- Streamlit session state was replaced with explicit JSON payloads and persisted project records.
- Tkinter file dialogs were removed because they do not fit containerized browser workflows.
- Job polling was introduced so slow operations do not block the browser request.
- Models are separated into `world_model/` for YOLO-World weights, `input_model/` for training input weights, project-local `data/projects/<slug>/output_model/` for trained/exported artifacts, and global `output_model/` as a compatibility/index surface.
- Model conversion is package-oriented: one conversion run can produce multiple ONNX/TFLite precision artifacts and writes class/schema metadata beside them.
- Dataset preparation is project-centric: sources, images, annotations, splits, training runs, exports, and jobs are all stored in SQLite.
- Source registration is project-local: image-folder sources are copied into the project workspace, and video frame extraction writes under that source's project `sources` directory.
- Startup migration preserves older project-id output folders by moving current-project legacy outputs into project-local storage and updating stored DB paths.
- UI workflow state is artifact-aware, not only job-history-aware. The Workflow Guide should consider current source/split/train/export artifacts when deciding whether a step is done, and it treats Review/Validate as spot-check stages rather than required blocking gates.

## External Dependencies

- Ultralytics `YOLOWorld` and `YOLO`.
- OpenCV for frame extraction and image loading.
- Supervision for bbox annotation.
- Netron for optional model visualization.
