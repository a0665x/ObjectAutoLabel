# API

Most long-running endpoints return a job record. Poll `GET /api/jobs` for recent status or `GET /api/jobs/{job_id}` for one job.

## Job Shape

```json
{
  "id": "hex",
  "name": "autolabel",
  "status": "queued|running|completed|failed",
  "progress": 0,
  "message": "Running",
  "result": null,
  "error": null
}
```

## Endpoints

- `GET /api/health`: backend liveness and project root.
- `GET /api/files?path=<file>`: serves a local file path when it exists.
- `GET /api/projects`: list projects.
- `POST /api/projects`: create a project.
- `GET /api/projects/{project_id}`: get one project.
- `GET /api/projects/{project_id}/class-schemas`: list class schemas.
- `POST /api/projects/{project_id}/class-schemas`: create a class schema.
- `GET /api/models/world`: lists `world_model/*.pt`.
- `GET /api/models/input`: lists `input_model/*.pt`.
- `GET /api/models/output`: lists trained and exported artifacts from `output_model/`.
- `GET /api/jobs`: recent jobs.
- `GET /api/jobs/{job_id}`: one job.
- `GET /api/projects/{project_id}/sources`: list source assets.
- `POST /api/projects/{project_id}/sources`: add a video or image-folder source.
- `GET /api/projects/{project_id}/images`: list registered project images. Supports `review_status`, `has_low_confidence`, `source_asset_id`, `limit`, and `offset` query params for the review queue.
- `GET /api/projects/{project_id}/review-stats`: aggregate review queue counts for statuses plus `edited` and `low_confidence`.
- `POST /api/projects/{project_id}/frame-runs`: extract frames from a video source.
- `POST /api/projects/{project_id}/pseudo-label-runs`: run YOLO-World pseudo-labeling.
- `GET /api/images/{image_id}/annotations`: list annotations for one image.
- `PUT /api/images/{image_id}/annotations`: replace annotations, validate normalized bbox bounds, set review status, and write the corresponding YOLO label file into the project `reviewed_labels/` folder.
- `POST /api/projects/{project_id}/dataset-splits`: create a train/val/test split.
- `GET /api/projects/{project_id}/dataset-splits`: list dataset splits.
- `GET /api/projects/{project_id}/training-runs`: list training runs.
- `POST /api/projects/{project_id}/training-runs`: train a YOLO model.
- `POST /api/projects/{project_id}/model-exports`: export a trained model.

## Review Status Vocabulary

- `unreviewed`
- `pending_review`
- `needs_fix`
- `reviewed`
- `skipped`

## Model Folder Contract

- `GET /api/models/world` reads `.pt` files from `world_model/`.
- `GET /api/models/input` reads `.pt` files from `input_model/`.
- `GET /api/models/output` reads exported artifacts from `output_model/`, including nested project subdirectories and `.pt`, `.onnx`, `.torchscript`, and `.tflite` outputs.

## API Safety Notes

- Paths are local/container paths. There is no sandboxing by user inside the app.
- `GET /api/files` can serve arbitrary readable local files by path and should not be exposed beyond trusted local use without path restrictions.
- Job records are persisted in SQLite, but active job execution is process-local; restarting the container stops in-flight work.
