# UI

The WebUI is a React/Vite single-page console served by FastAPI.

## Screens

- `Projects`: create and list local labeling projects.
- `Sources`: register image folders or videos and extract frames from video sources.
- `Schema`: define class ids, class names, and YOLO-World descriptors.
- `Pseudo`: run YOLO-World pseudo-labeling against a project.
- `Review`: inspect images and save corrected annotations.
- `Split`: create train/val/test dataset splits.
- `Train`: start YOLO training from a split and input model.
- `Export`: export trained models.
- `Settings`: inspect available model folders.

## Interaction Model

Most workflow forms submit one job and receive immediate feedback. The UI polls job status and shows progress in the status strip. Project, source, schema, annotation, and model-list interactions are regular request/response calls.

## Design Rules

- Keep the UI responsive and mobile-safe.
- Keep touch targets at least 44px high.
- Use visible labels, not placeholder-only inputs.
- Use one primary action per form.
- Avoid Streamlit-like repeated full-page control blocks; group each workflow by user intent.
- Keep API calls in `frontend/src/api/client.ts` and shared types in `frontend/src/types.ts`.
