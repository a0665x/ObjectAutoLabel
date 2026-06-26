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

## Migrated Behavior

The original Streamlit pages were mapped as follows:

- `1_video_to_frames.py` -> `services.split_video_into_frames`.
- `2_generate_yaml.py` -> `services.write_autolabel_config`.
- `3_auto_label.py` -> `services.run_autolabel`.
- `4_upload_roboflow.py` -> `services.upload_to_roboflow`.
- `5_download_dataset.py` -> `services.download_roboflow_dataset`.
- `6_train_model.py` -> `services.train_yolo`.
- `7_convert_model.py` -> `services.convert_model`.

## Design Decisions

- Streamlit session state was replaced with explicit JSON payloads and persisted project records.
- Tkinter file dialogs were removed because they do not fit containerized browser workflows.
- Job polling was introduced so slow operations do not block the browser request.
- Models are separated into `world_model/` for YOLO-World, `input_model/` for training inputs, and `output_model/` for trained/exported artifacts.
- Dataset preparation is project-centric: sources, images, annotations, splits, training runs, exports, and jobs are all stored in SQLite.

## External Dependencies

- Ultralytics `YOLOWorld` and `YOLO`.
- OpenCV for frame extraction and image loading.
- Supervision for bbox annotation.
- Netron for optional model visualization.
