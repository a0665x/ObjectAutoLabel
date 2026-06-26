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
- `GET /api/models/output`: lists exported files from `output_model/`.
- `GET /api/jobs`: recent jobs.
- `GET /api/jobs/{job_id}`: one job.
- `GET /api/projects/{project_id}/sources`: list source assets.
- `POST /api/projects/{project_id}/sources`: add a video or image-folder source.
- `GET /api/projects/{project_id}/images`: list registered project images.
- `POST /api/projects/{project_id}/frame-runs`: extract frames from a video source.
- `POST /api/projects/{project_id}/pseudo-label-runs`: run YOLO-World pseudo-labeling.
- `GET /api/images/{image_id}/annotations`: list annotations for one image.
- `PUT /api/images/{image_id}/annotations`: replace annotations and set review status.
- `POST /api/projects/{project_id}/dataset-splits`: create a train/val/test split.
- `GET /api/projects/{project_id}/dataset-splits`: list dataset splits.
- `GET /api/projects/{project_id}/training-runs`: list training runs.
- `POST /api/projects/{project_id}/training-runs`: train a YOLO model.
- `POST /api/projects/{project_id}/model-exports`: export a trained model.

## API Safety Notes

- Paths are local/container paths. There is no sandboxing by user inside the app.
- `GET /api/files` can serve arbitrary readable local files by path and should not be exposed beyond trusted local use without path restrictions.
- Job records are persisted in SQLite, but active job execution is process-local; restarting the container stops in-flight work.
