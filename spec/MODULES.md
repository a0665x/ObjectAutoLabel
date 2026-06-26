# Modules

## Source Tree

- `backend/app/main.py`: FastAPI app, request schemas, route definitions, static frontend mount.
- `backend/app/config.py`: runtime paths and directory creation.
- `backend/app/db.py`: SQLite connection and schema initialization.
- `backend/app/repositories.py`: persistence layer for projects, sources, schemas, images, annotations, jobs, splits, training runs, and exports.
- `backend/app/jobs.py`: thread-pool execution with SQLite-backed job status updates.
- `backend/app/project_services.py`: project-oriented frame extraction, annotation saving, dataset split, training, and export operations.
- `backend/app/world_models.py`: YOLO-World pseudo-labeling.
- `backend/app/label_io.py`: YOLO label read/write helpers.
- `backend/app/schemas.py`: Pydantic request schemas.
- `backend/app/services.py`: older migrated service functions retained for compatibility or reference.
- `frontend/src/App.tsx`: React single-page UI and workflow screens.
- `frontend/src/api/client.ts`: frontend API wrapper.
- `frontend/src/annotation/`: normalized bbox geometry and annotation reducer logic.
- `frontend/src/pages/ReviewPage.tsx`: offline review workbench state orchestration.
- `frontend/src/pages/reviewConfig.ts`: review status and queue filter options.
- `frontend/src/pages/reviewState.ts`: review-page helper state functions.
- `frontend/src/components/review/`: SVG canvas, toolbar, class palette, inspector, and image queue components.
- `frontend/src/i18n.ts`: UI translations.
- `frontend/src/styles.css`: responsive visual system and interaction styling.
- `frontend/dist/`: built frontend served by FastAPI when present.
- `frontend/index.html`: Vite entry HTML.
- `Dockerfile`: Python/CUDA runtime image definition.
- `docker-compose.yml`: service ports, volumes, GPU settings.
- `run.sh`: lifecycle wrapper for Docker Compose.
- `world_model/`: YOLO-World model files.
- `input_model/`: YOLO training input model files.
- `output_model/`: trained and exported model files.
- `data/`: mounted runtime data.
- `spec/`: progressive-disclosure project documentation.

## Backend Ownership

`main.py` should stay thin. Add request validation and route wiring there, but put persistence in `repositories.py` and business logic in `project_services.py`, `world_models.py`, or `label_io.py`.

Long-running functions are designed to be callable by `JobRunner`. They receive `job_id` so they can update the matching SQLite job record through `Repository`.

`jobs.py` uses an in-process `ThreadPoolExecutor`; execution is still process-local, but job records are persisted in SQLite. If multi-process or distributed execution is required, replace the executor with a database-backed queue or Redis/RQ.

## Frontend Ownership

The frontend uses React, TypeScript, and Vite. Keep UI changes in `frontend/src` and run the Vite build before relying on `frontend/dist`.

The WebUI should continue to submit plain JSON to FastAPI endpoints and avoid embedding model/runtime logic in the browser.
