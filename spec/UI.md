# UI

The WebUI is a React/Vite single-page console served by FastAPI.

## Screens

- `Projects`: create and list local labeling projects.
- `Sources`: register image folders or videos and extract frames from video sources.
- `Schema`: define class ids, class names, and YOLO-World descriptors.
- `Pseudo`: run YOLO-World pseudo-labeling against a project.
- `Review`: use the offline annotation workbench to filter the queue, inspect review stats, draw and edit boxes, change classes, set review status, and save YOLO labels.
- `Split`: create train/val/test dataset splits.
- `Train`: start YOLO training from a split and input model.
- `Export`: export trained models.
- `Settings`: inspect active `world_model/`, `input_model/`, and `output_model/` contents.

## Interaction Model

Most workflow forms submit one job and receive immediate feedback. The UI polls job status and shows progress in the status strip. Project, source, schema, annotation, and model-list interactions are regular request/response calls.

The review workbench is not job-driven. It loads sources, class schemas, queue entries, and review stats directly, keeps in-progress edits in client state, and persists the full annotation set only when the user saves.

## Review Workbench

- The canvas is an SVG overlay on top of the source image, with `select`, `draw`, and `pan` modes.
- Queue filters support `review_status`, `source_asset_id`, and `has_low_confidence`.
- Queue stats surface `unreviewed`, `pending_review`, `needs_fix`, `reviewed`, `skipped`, `edited`, and `low_confidence` counts from the backend.
- Navigation between images is guarded by dirty-state confirmation.
- Saving replaces the image annotation set, updates the image review status, and writes a YOLO label file under the project `reviewed_labels/` folder.

## Design Rules

- Keep the UI responsive and mobile-safe.
- Keep touch targets at least 44px high.
- Use visible labels, not placeholder-only inputs.
- Use one primary action per form.
- Avoid Streamlit-like repeated full-page control blocks; group each workflow by user intent.
- Keep API calls in `frontend/src/api/client.ts` and shared types in `frontend/src/types.ts`.
- Keep review interaction logic in `frontend/src/pages/ReviewPage.tsx`, `frontend/src/components/review/`, and `frontend/src/annotation/`.
