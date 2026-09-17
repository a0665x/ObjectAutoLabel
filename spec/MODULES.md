# Modules

## Source Tree

- `backend/app/main.py`: FastAPI app, request schemas, route definitions, static frontend mount.
- `backend/app/server.py`: Uvicorn launcher plus optional localhost TCP proxy for LAN/Tailscale coexistence on Jetson host-network deployments.
- `backend/app/config.py`: runtime paths and directory creation.
- `backend/app/db.py`: SQLite connection and schema initialization.
- `backend/app/repositories.py`: persistence layer for projects, sources, schemas, images, annotations, jobs, splits, training runs, exports, project output symlinks, and legacy output migration.
- `backend/app/jobs.py`: thread-pool execution with SQLite-backed job status updates.
- `backend/app/job_control.py`: cooperative cancellation signal shared by job implementations.
- `backend/app/auth.py`: optional Authlib provider registration, OAuth callbacks, profile normalization, and minimal signed-session identity.
- `backend/app/project_services.py`: project-oriented source copying, frame extraction, annotation saving, dataset split, training, model conversion, export bundle, and artifact-context operations.
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
- `frontend/src/components/review/reviewCommands.ts`: shared Edit-menu, toolbar, context-menu, and keyboard command registry.
- `frontend/src/components/review/canvasInteraction.ts`: deterministic effective-tool routing for persistent and temporary pointer gestures.
- `backend/app/conversion_runtime.py`: x86_64-only ONNX/LiteRT FP32 capability and official Ultralytics export boundary.
- `backend/app/runtime_safety.py`: disables Ultralytics runtime package installation.
- `backend/app/model_lineage.py`: labels from saved training and conversion provenance.
- `backend/app/stream_demo.py` and `stream_routes.py`: GStreamer session, engine/device capabilities, uploads, and authenticated WebSocket streaming.
- `frontend/src/pages/StreamDemoPage.tsx`, `streamPlayer.ts`, and `api/streamDemo.ts`: two-stage model selection, controls, uploads, and bounded MediaSource playback.
- `frontend/src/App.test.tsx`: broad Vitest coverage for page-level UX affordances such as workflow navigation, pseudo-label feedback, project stale cleanup, augmentation controls, and validation random sampling.
- `frontend/src/i18n.ts`: UI translations.
- `frontend/src/styles.css`: responsive visual system and interaction styling.
- `frontend/dist/`: built frontend served by FastAPI when present.
- `frontend/index.html`: Vite entry HTML.
- `Dockerfile`: Python/CUDA runtime image definition.
- `docker-compose.yml`: service ports, volumes, GPU settings.
- `run.sh`: lifecycle wrapper for Docker Compose.
- `world_model/`: YOLO-World model files.
- `input_model/`: YOLO training input model files.
- `output_model/`: global index for trained/exported model files. Project entries are symlinks to `data/projects/<slug>/output_model`; loose files and unknown legacy directories may remain here.
- `data/`: mounted runtime data.
- `spec/`: progressive-disclosure project documentation.

## Backend Ownership

- `backend/app/open_data.py`: fixed VisDrone catalog/download adapter, safe extraction, mapping-first sampling, preview, project publication, and safe derived-data cleanup.
- `backend/app/logging_config.py`: Taipei-day structured runtime/job/access logs, redaction, rotation, and retention.

`main.py` should stay thin. Add request validation and route wiring there, but put persistence in `repositories.py` and business logic in `project_services.py`, `world_models.py`, or `label_io.py`.

Netron route wiring lives in `main.py` because it is HTTP proxy behavior. The actual converted artifacts remain project-local under `data/projects/<slug>/output_model/conversions/`.

Long-running functions are designed to be callable by `JobRunner`. They receive `job_id` so they can update the matching SQLite job record through `Repository`.

`jobs.py` uses an in-process `ThreadPoolExecutor`; execution is still process-local, but job records are persisted in SQLite. If multi-process or distributed execution is required, replace the executor with a database-backed queue or Redis/RQ.

## Frontend Ownership

- `frontend/src/pages/OpenDataPage.tsx`: catalog, acknowledgement, mapping board, sampling ratio, visual preview, composition, publish/replace/remove controls.
- `frontend/src/components/review/ImageQueue.tsx`: dynamic project/Open Data source filtering.

The frontend uses React, TypeScript, and Vite. Keep UI changes in `frontend/src` and run the Vite build before relying on `frontend/dist`.

The WebUI should continue to submit plain JSON to FastAPI endpoints and avoid embedding model/runtime logic in the browser.

Page-level workflow affordances currently live mostly in `frontend/src/App.tsx`; when they become larger, extract reusable pieces into `frontend/src/components/` before adding more page-local JSX. Review canvas interactions belong in `frontend/src/components/review/AnnotationCanvas.tsx` and `ReviewPage.tsx`, not in global app state.
- `backend/app/stream_verify.py`: shared model-aware inference helper and standalone OpenCV verification source embedded in copyable commands.
