# ObjectAutoLabel Redesign Design

Date: 2026-06-18

## Goal

Redesign ObjectAutoLabel from a collection of YOLO/Roboflow workflow forms into a local-first dataset project hub for pseudo-label generation, visual correction, training, and model export.

The product must remove Roboflow from the primary workflow. All core operations run locally:

- create or open a dataset project
- extract frames from video or use an existing image folder
- select a world model for pseudo-label generation
- define final training class ids and prompt descriptors
- generate pseudo labels locally
- review and edit bounding boxes locally
- split reviewed data into train/valid/test
- train with an input model
- export deployable models such as TFLite

The UI should feel immediate. Long operations must expose status and progress; interactive editing must avoid perceptible latency.

## Product Direction

Use the Dataset Project Hub direction.

The application manages multiple local projects. Each project owns its sources, class schema, pseudo-label runs, reviewed labels, dataset splits, training runs, and export outputs. This replaces the old Roboflow upload/download cycle with a persistent local project lifecycle.

The implementation direction is a full product rewrite:

- Keep FastAPI as the backend.
- Replace the static vanilla frontend with a React/Vite SPA.
- Add SQLite for project and run metadata.
- Add project-based APIs.
- Add a full local bbox review/editor.
- Remove Roboflow from the main UI and workflow.

Roboflow-specific backend code can be removed from the primary product surface. If retained temporarily for migration, it must be hidden from the main workflow and not shape the new data model.

## Design Authority

The user has delegated detailed UI and interaction decisions to the implementation agent as long as the following product constraints are preserved:

- Roboflow is decoupled from the workflow.
- The workflow runs locally.
- The UI uses an Apple/iOS-inspired professional aesthetic.
- The editor and navigation should feel immediate.
- The application preserves class id, prompt descriptor, pseudo-label, review, training, and export traceability.

For detailed UI behavior, use Roboflow's online annotation/editing experience as useful prior art, but do not copy it wholesale. Prefer a purpose-built local tool optimized for the workflows in this project.

## Data And Folders

Use a clear local folder model:

```text
ObjectAutoLabel/
  data/
    projects/
      <project_slug>/
        sources/
        frames/
        pseudo_labels/
        reviewed_labels/
        splits/
        metadata/
  world_model/
    *.pt
  input_model/
    *.pt
  output_model/
    <project_slug>/
      <train_run_id>/
        best.pt
        last.pt
        exports/
          model.tflite
          model.onnx
  runs/
    detect/
  object_autolabel.db
```

Folder renames:

- `models/` becomes `world_model/`.
- `yolo_model/` becomes `input_model/`.
- User-facing training/export outputs live under `output_model/<project_slug>/<train_run_id>/`.

`world_model/` stores models used to generate pseudo labels. YOLO-World is the first supported implementation, but the name must not imply that only YOLO-World can ever be used.

`input_model/` stores the starting weights used for training the final detector.

`runs/` can remain as the raw Ultralytics output location, but the UI should orient users around `output_model/`.

## SQLite Metadata

Use SQLite for project and workflow metadata. Images and label files stay on disk; the database stores paths, status, relationships, and editable annotation metadata.

Core tables:

- `projects`
- `source_assets`
- `frame_extraction_runs`
- `class_schemas`
- `class_descriptors`
- `pseudo_label_runs`
- `images`
- `annotations`
- `review_sessions`
- `dataset_splits`
- `training_runs`
- `model_exports`
- `jobs`

`class_schemas` defines the final training class id order, such as:

```text
0 = person
1 = car
```

`class_descriptors` stores the prompt/sub-descriptor terms for each top-level class, such as:

```text
car:
  - Sedan car
  - SUV car
  - Aerial vehicle
```

`annotations` stores bbox coordinates, class id, class name, source descriptor, confidence, source type, review status, and edit flags. Saving annotations writes both SQLite metadata and YOLO `.txt` labels so the UI state and training files remain aligned.

## UX Structure

Default language is English. A top-right language selector supports English, Traditional Chinese, Japanese, and Korean for primary UI only.

First version i18n covers:

- navigation labels
- page titles
- primary actions
- major status strings

First version i18n does not translate:

- class names
- prompt descriptors
- detailed helper text
- detailed backend error text

Use an Apple/iOS-inspired professional interface:

- light mode first
- clean surfaces
- restrained glass or blur only where it improves hierarchy
- soft shadows
- system-style typography using Inter or system font stack
- 44px minimum touch targets
- visible focus rings
- no emoji as structural icons
- minimal animation with 150-300ms interaction timing

Primary layout:

```text
Top bar:
  ObjectAutoLabel | Project switcher | Job status | Language EN/ZH/JA/KO

Sidebar:
  Projects
  Sources
  Class Schema
  Pseudo Label
  Review
  Split Dataset
  Train
  Models / Export
  Settings
```

Primary pages:

- `Projects`: project cards with source count, pseudo-label runs, review progress, latest training/export status.
- `Sources`: video input or image folder input. Video-to-frames has progress.
- `Class Schema`: final class id table with descriptor editing and YAML preview.
- `Pseudo Label`: select `world_model`, source, class schema, confidence, IoU, and run local pseudo-label generation.
- `Review`: bbox editor with image queue, large canvas, selected-box inspector, Save/Reset/Prev/Next.
- `Split Dataset`: create train/valid/test splits from reviewed labels.
- `Train`: choose split, `input_model`, device, epochs, optimizer, learning-rate settings, and start training.
- `Models / Export`: inspect `output_model`, choose trained weights, export to TFLite/ONNX/TorchScript.
- `Settings`: runtime paths and advanced configuration.

## API And Jobs

Keep FastAPI, but move from form-style endpoints to project-based APIs.

Representative API:

```text
GET/POST /api/projects
GET/PATCH/DELETE /api/projects/{project_id}

GET/POST /api/projects/{project_id}/sources
POST /api/projects/{project_id}/frame-runs

GET/POST /api/projects/{project_id}/class-schemas
PATCH /api/class-schemas/{schema_id}

POST /api/projects/{project_id}/pseudo-label-runs
GET /api/pseudo-label-runs/{run_id}

GET /api/projects/{project_id}/images
GET /api/images/{image_id}/annotations
PUT /api/images/{image_id}/annotations

POST /api/projects/{project_id}/dataset-splits
POST /api/projects/{project_id}/training-runs
POST /api/training-runs/{run_id}/exports

GET /api/models/world
GET /api/models/input
GET /api/models/output

GET /api/jobs
GET /api/jobs/{job_id}
```

Persist job records in SQLite. The first version can still use a `ThreadPoolExecutor`, but job state must survive as database state rather than only in memory.

Job progress rules:

- frame extraction: exact or near-exact progress based on frame count
- pseudo-label generation: progress by processed image count
- dataset split: progress by image count
- training: first version can be stage-based if epoch progress is not straightforward
- export: stage-based or simple percentage

Each job links to the relevant project and run record. Example: a pseudo-label job links to `pseudo_label_run_id`; a training job links to `training_run_id`.

Errors:

- UI shows a concise message and recovery action.
- DB preserves detailed traceback or log path.
- Common actions include Retry, Open Project, and View Log.

## BBox Review Editor

Build a custom React bbox editor. Use a canvas or image layer for rendering the image and an overlay for editable boxes. The exact technical implementation can be selected during implementation, but it must support accurate normalized YOLO coordinate conversion and smooth interaction.

Layout:

```text
Left: image queue and filters
Center: image canvas with bbox overlay
Right: selected bbox inspector
Top/Bottom controls: image index, review status, Save, Reset, Prev, Next
```

Required behavior:

- Left/right keyboard arrows navigate previous/next image.
- Click bbox to select it.
- Inspector shows class id, class name, source descriptor, confidence, source type, and edit state.
- Delete/Backspace removes selected bbox from local draft.
- Class selector reassigns selected bbox to another class id/name.
- Add Box mode allows drawing a new bbox.
- Bboxes can be dragged.
- Bboxes can be resized.
- Save writes the current image annotations to SQLite and YOLO `.txt`.
- Reset discards local draft and reloads DB state.
- Navigating away with unsaved changes prompts the user.

Manual save is required. Do not auto-overwrite labels on drag, delete, or class change.

Annotation metadata:

- pseudo-label boxes store source descriptor and confidence.
- manually added boxes use `source=manual`, `source_descriptor=null`, `confidence=null`.
- class reassignment preserves original descriptor and sets `edited=true`.

Performance:

- Do not call the API during drag/resize.
- Update frontend state locally during editing.
- Use requestAnimationFrame or equivalent throttling for visual updates.
- Save uses a single PUT for the current image.
- Queue uses pagination or virtualization.
- Preload the previous and next 1-2 images.
- Always convert coordinates against natural image dimensions, not displayed CSS size.

## Dataset Split

Reviewed labels are the training source.

The split page creates train/valid/test folders from reviewed images and labels. Default should support a ratio such as 80/10/10, with user-adjustable values.

`dataset_splits` records:

- project id
- source pseudo-label run or review set
- ratio
- image ids included in each split
- output paths
- created timestamp

The split output should be Ultralytics-compatible.

## Training

Training uses Ultralytics.

The Train page selects:

- dataset split
- `input_model/*.pt`
- epochs
- device
- patience
- warmup epochs
- optimizer
- learning-rate settings

Training may write raw outputs under `runs/detect`, but on completion the application copies relevant model artifacts into:

```text
output_model/<project_slug>/<train_run_id>/
```

Expected files include:

- `best.pt`
- `last.pt`
- training args/config metadata

The database tracks the path to each artifact and the source split.

## Export

Export starts from a training run and a selected model artifact, usually `best.pt`.

Supported first-version formats:

- TFLite
- ONNX
- TorchScript

Export outputs are written under:

```text
output_model/<project_slug>/<train_run_id>/exports/
```

The UI must show the export status and final paths.

## Frontend Implementation Direction

Use React + Vite.

Avoid a heavy UI framework in the first version. Build a small internal component system:

- app shell
- top bar
- sidebar
- project cards
- forms
- tables
- segmented controls
- progress bars
- toast/status messages
- modal/confirm dialogs
- bbox editor components

Use icons from a consistent vector icon set such as Lucide. Do not use emoji as UI icons.

The SPA should remain fast with a small bundle and route-level organization. State should be local where possible, with project/job/review state fetched from API.

## Responsiveness And Accessibility

Target desktop/tablet-first because bbox review is a precision workflow, but keep the UI usable on mobile for monitoring and light management.

Requirements:

- no horizontal page overflow
- 44px minimum interactive targets
- visible focus states
- keyboard access to main actions
- correct tab order
- reduced-motion support
- contrast of primary text at least WCAG AA
- tables collapse or scroll safely on narrow screens

Review editing can be optimized for desktop pointer/keyboard. If full bbox editing is not practical on small mobile screens, show a clear limited-mode message and keep project/job monitoring available.

## Performance Requirements

Initial project scale: hundreds to thousands of images.

Performance strategies:

- paginate or virtualize image queues
- lazy-load thumbnails
- preload adjacent review images
- avoid API calls during bbox drag/resize
- batch save annotations per image
- keep long-running work in background jobs
- show progress for long tasks
- avoid expensive blur effects in dense/editor surfaces
- keep React renders bounded with focused component state

Perceived latency matters more than decorative animation.

## Validation Plan

Backend:

- Python syntax checks
- FastAPI route smoke tests
- SQLite repository tests
- YOLO label read/write tests
- class schema to descriptor mapping tests
- job state persistence tests

Frontend:

- bbox coordinate conversion unit tests
- annotation edit state tests
- i18n dictionary smoke test for primary UI
- Playwright smoke tests for Project Hub, Class Schema, Pseudo Label, Review, Train, and Export paths

Manual happy path:

1. Create project.
2. Add video source.
3. Extract frames and observe progress.
4. Define class schema and descriptors.
5. Run pseudo-label generation and observe progress.
6. Review a labeled image.
7. Delete, resize, add, and reclassify bboxes.
8. Save annotations.
9. Split dataset.
10. Train from `input_model`.
11. Export TFLite.
12. Confirm outputs under `output_model/<project_slug>/<train_run_id>/`.

## Explicit Non-Goals For First Version

- Multi-user auth.
- Remote storage.
- Roboflow upload/download as a primary workflow.
- Translating prompt descriptors or class data.
- Pixel-perfect mobile bbox editing.
- Distributed job queues such as Celery/RQ unless needed later.
- Full epoch-level training progress if Ultralytics integration becomes too invasive for first version.

## Open Implementation Notes

- The implementation may keep temporary migration compatibility for existing `models/` and `yolo_model/` files, but the new product model and docs should use `world_model/` and `input_model/`.
- If existing model folders contain files, provide a migration step rather than silently deleting or moving data.
- The new code should update `./spec` once implementation details settle.
