# Offline Label Workbench Design

## Purpose

ObjectAutoLabel should become a local, offline tool for reviewing and correcting YOLO-World auto-label output. The goal is not to clone Roboflow's online workflow. The goal is to make local YOLO-World correction fast enough that a user can generate pseudo-labels, fix mistakes, export reviewed YOLO labels, retrain an Ultralytics model, and export trained artifacts without leaving the project.

## Current Context

The project already has a FastAPI backend, SQLite persistence, a React/Vite frontend, and a project-centric workflow:

1. Create project.
2. Add image folder or video source.
3. Extract frames when needed.
4. Create class schema with YOLO-World descriptors.
5. Run YOLO-World pseudo-labeling.
6. Review annotations.
7. Create dataset split.
8. Train YOLO model.
9. Export model.

The current `ReviewPage` can display bounding boxes and save edited annotation lists, but it is not yet a real annotation editor. It does not support drawing boxes, dragging boxes, resizing boxes, fast quality filtering, or a LabelImg-like correction flow.

The model-folder concept is now explicit: `world_model/`, `input_model/`, and `output_model/` are the only runtime model roots.

## Model Asset Rules

The project should use three explicit model folders:

- `world_model/`: YOLO-World prompt/open-vocabulary models used only for pseudo-labeling.
- `input_model/`: user-selected Ultralytics YOLO starting models used for retraining or fine-tuning, including `.pt` and `.pth` weights.
- `output_model/`: trained model outputs and exports, including `best.pt`, `best.pth`, `last.pt`, ONNX, TFLite, and TorchScript artifacts.

Migration rules:

- Put YOLO-World files such as `yolov8s-world.pt`, `yolov8m-world.pt`, `yolov8l-world.pt`, and `yolov8x-world.pt` in `world_model/`.
- Move base YOLO files such as `yolov8n.pt`, `yolo11n.pt`, `yolov5nu.pt`, and similar starting checkpoints into `input_model/`.
- Put trained `best*.pt`, `best*.pth`, `last*.pt`, exported `.onnx`, `.tflite`, and `.torchscript` artifacts into `output_model/` when they are known outputs.
- Docker compose files must mount the three active folders so model discovery works inside the container.

## First-Phase Scope

The first implementation phase should deliver two things together:

1. Model-folder cleanup and Docker/runtime alignment.
2. Offline annotation workbench MVP.

This phase should not include Roboflow online workflows, Netron previews, or a training dashboard. Those belong to a later phase.

## Offline Workbench UX

The Review screen should become a three-column local annotation workbench:

- Left: image queue and filters.
- Center: image canvas with editable bounding boxes.
- Right: annotation inspector, class palette, and review actions.

The primary workflow is:

1. Open project review.
2. Filter to pending or low-confidence images.
3. Select an image.
4. Correct YOLO-World boxes.
5. Mark image reviewed, needs fix, or skipped.
6. Save and advance.

The editor should support:

- Select an existing box.
- Draw a new box.
- Drag a selected box.
- Resize a selected box from handles.
- Delete a selected box.
- Change selected box class.
- Mark image as reviewed.
- Mark image as needs fix.
- Mark image as skipped.
- Save and go to next image.

Keyboard shortcuts should be designed for speed:

- Previous and next image.
- Delete selected box.
- Draw/select mode toggle.
- Save and next.
- Number keys for class selection where practical.

The first version should support rectangular YOLO detection boxes only. It should not support polygon segmentation, collaborative editing, or active-learning recommendations.

## Coordinate Model

The frontend editor may operate in rendered pixel coordinates, but all persisted annotations must remain YOLO normalized coordinates:

- `x_center`
- `y_center`
- `width`
- `height`

Coordinate conversion must be isolated inside the annotation canvas layer. Other UI components should not duplicate image-fit, zoom, pan, or normalization math.

The SVG overlay should account for:

- Natural image dimensions.
- Rendered image dimensions.
- Letterboxing or containment offsets.
- Zoom and pan state if implemented in phase one.

The backend should validate normalized coordinates before saving:

- All coordinate values must be numeric.
- Centers should be clamped or rejected outside `0..1`.
- Width and height should be greater than zero and no greater than one.
- Boxes should not produce invalid negative extents.

## Review Status Model

Reuse `images.review_status`, expanding its expected values to:

- `unreviewed`
- `pending_review`
- `needs_fix`
- `reviewed`
- `skipped`

Dataset split generation should continue to include only `reviewed` images. Empty annotation files are valid for reviewed images, because background or no-object images may be intentional training data.

Annotations should preserve:

- `source_type`: `pseudo` or `manual`.
- `source_descriptor`: original YOLO-World prompt when available.
- `confidence`: original YOLO-World confidence when available.
- `edited`: `true` after a user changes geometry or class.

## Frontend Component Boundaries

Avoid growing `frontend/src/App.tsx` further. The workbench should be split into focused components:

- `ReviewPage`: loads image queue, active image, filters, annotations, classes, and review stats.
- `AnnotationCanvas`: renders image and SVG overlay; handles select, draw, drag, resize, zoom, pan, and coordinate conversion.
- `AnnotationToolbar`: controls editor mode, zoom/pan, save, previous, next, and shortcuts.
- `AnnotationInspector`: edits selected box class and shows confidence, source descriptor, source type, and edited status.
- `ImageQueue`: shows image thumbnails or rows and supports filters.
- `ClassPalette`: shows class schema, selected class, and shortcut mappings.
- `modelAssets` UI: explains world/input/output model folder purpose and lists files without guessing model category in the browser.

State transitions for annotations should be handled through a small reducer or equivalent pure update functions so draw/move/resize/delete/change-class behavior is testable.

## Backend API Changes

Existing APIs can remain, but should be expanded:

- `GET /api/projects/{project_id}/images`
  Add filters for `review_status`, low-confidence images, `source_asset_id`, `limit`, and `offset`.

- `PUT /api/images/{image_id}/annotations`
  Keep the current endpoint, but tighten validation and explicitly accept the expanded review status values.

- `GET /api/projects/{project_id}/review-stats`
  Return counts for pending, reviewed, needs fix, skipped, edited, and low-confidence images.

- Model list endpoints
  Keep the three existing endpoints or add a combined endpoint, but make the UI and runtime consistently use `world_model/`, `input_model/`, and `output_model/`.

No Roboflow API should be part of phase one.

## Data Flow

The first-phase data flow should be:

1. Source image or video frames are registered as project images.
2. YOLO-World pseudo-labeling writes annotations with `source_type = pseudo` and `review_status = pending_review`.
3. The offline workbench loads images and annotations.
4. User edits boxes locally in the browser.
5. Save sends normalized YOLO boxes to the backend.
6. Backend replaces annotations, updates review status, and writes `reviewed_labels/<image-stem>.txt`.
7. Dataset split uses reviewed images and reviewed labels.
8. Training uses `input_model/` as the starting model and writes outputs under `output_model/`.

## Later-Phase Scope

After phase one, consider:

- Roboflow import/export as optional interoperability.
- Netron model preview for exported artifacts.
- Training results dashboard for `results.csv`, curves, confusion matrices, and best/last model links.
- Model asset metadata, rename, archive, and provenance tracking.
- Bulk review operations.
- More advanced keyboard customization.
- Virtualized queues for very large datasets.

## Testing Strategy

Backend tests:

- Model folder listing uses `world_model/`, `input_model/`, and `output_model/`.
- Annotation save validates normalized bbox values.
- Annotation save writes reviewed YOLO label files.
- Review status filters return expected images.
- Review stats counts pending, reviewed, needs fix, skipped, edited, and low-confidence images.
- Dataset split includes only reviewed images.
- Empty reviewed annotations produce valid empty label files.

Frontend tests:

- Pixel-to-YOLO and YOLO-to-pixel coordinate conversion.
- Annotation reducer actions for draw, move, resize, delete, and class change.
- Review status transitions.
- Low-confidence filtering logic.
- API client calls for image filters, review stats, and annotation save.

Manual QA:

- Create project.
- Add image folder or video source.
- Run YOLO-World pseudo-label.
- Correct one image with existing boxes.
- Add a manual box to one image.
- Save an empty reviewed image.
- Filter low-confidence and pending images.
- Create dataset split.
- Start a training job using an `input_model/` model.
- Confirm output artifacts are discoverable from `output_model/`.
- Confirm Docker container sees the same model folders as the backend expects.

## Risks

- SVG overlay geometry can drift if image fit, zoom, pan, and normalization math are scattered across components. Keep that logic centralized.
- `App.tsx` is already large. Adding the workbench there directly will make future UI work brittle.
- Compose model mounts currently disagree with backend path expectations. Fix runtime alignment before relying on Docker model discovery.
- Large image sets can overload the UI if loaded all at once. Keep `limit` and `offset` in the API from the beginning.
- Trained output classification can be ambiguous for old files. The migration should avoid deleting files and should use explicit naming rules.

## Acceptance Criteria

Phase one is complete when:

- The app consistently uses `world_model/`, `input_model/`, and `output_model/` in backend, frontend, and Docker runtime.
- YOLO-World models are listed from `world_model/`.
- Training input models are listed from `input_model/`.
- Training/export outputs are discoverable from `output_model/`.
- A user can draw, select, drag, resize, delete, and reclassify bounding boxes in the offline review workbench.
- A user can mark images reviewed, needs fix, or skipped.
- Reviewed annotations are saved to SQLite and exported to YOLO label txt files.
- Dataset split generation uses only reviewed images.
- Tests cover coordinate conversion, annotation state updates, backend validation, review filters, and split inclusion rules.
