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

- `GET /`: serves the React app shell. Use `GET /api/projects` as the lightweight API liveness check; there is no `/health` route.
- `GET /api/files?path=<file>`: serves a registered image or a file under a safe project output directory.
- `GET /api/projects`: list projects.
- `POST /api/projects`: create a project.
- `DELETE /api/projects/{project_id}`: delete a project record, its project workspace under `data/projects/<slug>/`, its project-scoped job history, and global `output_model/<project_slug>` / legacy `output_model/<project_id>` index entries. It must not delete raw `data/input/` files.
- `GET /api/projects/{project_id}/storage-status`: report whether the DB project row still has a project workspace and output model index. Missing storage marks the row as stale so the UI can offer cleanup instead of showing it as a healthy project.
- `POST /api/projects/{project_id}/cleanup-stale`: remove a stale DB project record/job history and any broken output index after the operator manually deleted its workspace. Refuses healthy projects with HTTP 409; use the regular delete endpoint for healthy project packages.
- `GET /api/projects/{project_id}`: get one project.
- `GET /api/projects/{project_id}/class-schemas`: list class schemas.
- `POST /api/projects/{project_id}/class-schemas`: create a class schema.
- `GET /api/models/world`: lists `.pt` and `.pth` weights from `world_model/`.
- `GET /api/models/input`: lists `.pt` and `.pth` weights from `input_model/`.
- `GET /api/models/output`: lists trained and exported artifacts from `output_model/`.
- `GET /api/jobs`: recent jobs.
- `GET /api/jobs/{job_id}`: one job.
- `GET /api/file-browser?mode=image_folder|video&path=<optional>`: browse local mounted folders/files for the Sources page. When `path` is omitted, the backend chooses the best existing operator default, preferring the current 0629 image data folder. The response includes `shortcuts` such as 0629 raw data, Project input/0629, Autolabel workspace, ObjectAutoLabel project, data/input, data/projects, Desktop, and Home, each with existence and direct matching file counts.
- `GET /api/projects/{project_id}/sources`: list source assets.
- `POST /api/projects/{project_id}/sources`: add a video or image-folder source. Image-folder files are copied into `data/projects/<slug>/sources/<source_asset_id>/images/` before image records are created.
- `GET /api/projects/{project_id}/images`: list registered project images. Supports `review_status`, `has_low_confidence`, `source_asset_id`, `limit`, and `offset` query params for the review queue.
- `GET /api/projects/{project_id}/review-stats`: aggregate review queue counts for statuses plus `edited` and `low_confidence`.
- `POST /api/projects/{project_id}/frame-runs`: extract frames from a video source into `data/projects/<slug>/sources/<source_asset_id>/frames/images/`.
- `POST /api/projects/{project_id}/pseudo-label-runs`: run YOLO-World pseudo-labeling. Payload may include `run_name`; the stored `pseudo_label_runs.run_name` becomes the downstream pseudo build label.
- `GET /api/images/{image_id}/annotations`: list annotations for one image.
- `PUT /api/images/{image_id}/annotations`: replace annotations, validate normalized bbox bounds, set review status, and write the corresponding YOLO label file into the project `reviewed_labels/` folder.
- `POST /api/projects/{project_id}/augmentation-preview`: render labeled image samples with requested augmentation recipe and bbox overlays for live Augment-page QA. Supported preview controls include brightness/exposure, hue, noise, blur, camera gain, bbox motion blur, random rotation, horizontal flip, sample limit, and `polarity` so the UI can show negative/positive direction previews side by side. Rotation and flip return transformed annotations, not only transformed pixels.
- `POST /api/projects/{project_id}/augmentation-runs`: create augmented images and copied/adjusted annotations from the selected recipe. Current UI maps `x3/x5/x8/x10` to augmented copies/output count rather than exposing low-level copy/sample controls to operators. Payloads may set `skip_augment=true` to create a source/pass-through build: source images are copied once, annotations are preserved, and generated count equals source count. Non-skip outputs sample each configured effect per generated image; signed effects are uniformly sampled within the configured `[-value,+value]` range, while noise/blur magnitudes are sampled from `[0,value]`.
- `GET /api/projects/{project_id}/augmentation-runs/{run_id}/samples?limit=3`: return random generated/pass-through image samples for one augmentation build with normalized bbox annotations. The frontend decides whether to draw bbox overlays.
- `POST /api/projects/{project_id}/dataset-splits`: create a train/val/test split.
- `GET /api/projects/{project_id}/dataset-splits`: list dataset splits.
- `GET /api/projects/{project_id}/dataset-splits/{split_id}/samples?limit_per_bucket=6`: return train/valid/test sample images for a split with normalized YOLO bbox annotations, for Split-page visual QA.
- `GET /api/projects/{project_id}/training-runs`: list training runs, including `run_name`, actual Ultralytics `save_dir`, `best_model_path`, `last_model_path`, and `metrics_json` epoch/loss history when available.
- `POST /api/projects/{project_id}/training-runs`: train a YOLO model. Payload may include `run_name`; callbacks persist epoch loss metrics so the UI can draw a live loss curve. Completion stores model paths from the actual returned `results.save_dir`, not by guessing the newest `train*` folder.
- `POST /api/projects/{project_id}/validation-preview`: run one random-sample inference from a selected model path/schema/folder and return the sampled image plus predicted bbox overlays for the Validate page.
- `GET /api/projects/{project_id}/model-sources`: list completed `.pt` and `.pth` model sources available to the active project. Includes current-project training runs, discovered current-project outputs, discovered other-project outputs, and loose root files in `output_model/`.
- `GET /api/projects/{project_id}/artifact-context`: summarize the active project portfolio counts and downstream-selectable artifacts.
- `POST /api/projects/{project_id}/model-exports`: legacy single-format export for a trained model.
- `GET /api/projects/{project_id}/model-conversions`: list conversion packages.
- `POST /api/projects/{project_id}/model-conversions`: create one conversion package from a selected source model path or training run, class schema, and selected ONNX/TFLite precision targets.
- `GET /api/projects/{project_id}/model-conversions/{conversion_id}/netron?artifact_id=<artifact_id>`: start/return a same-origin Netron URL for one converted artifact.
- `GET /api/netron/{asset_path:path}`: same-origin proxy to the internal Netron server on port `8081`. This endpoint rewrites Netron frontend assets to avoid stale packaged-version prompts and direct browser access to `localhost:8081`.
- `POST /api/projects/{project_id}/model-conversions/{conversion_id}/export-download`: create and download a ZIP for a completed conversion package.
- `GET /api/projects/{project_id}/export-bundles`: list final export bundles.
- `POST /api/projects/{project_id}/export-bundles`: create a bundle from a selected conversion package.

## Review Status Vocabulary

- `unreviewed`
- `pending_review`
- `needs_fix`
- `reviewed`
- `skipped`

## Model Folder Contract

- `GET /api/models/world` reads `.pt` and `.pth` files from `world_model/`.
- `GET /api/models/input` reads `.pt` and `.pth` files from `input_model/`.
- `GET /api/models/output` reads exported artifacts from `output_model/`, including project symlinks, nested legacy directories, and `.pt`, `.pth`, `.onnx`, `.torchscript`, and `.tflite` outputs.

## API Safety Notes

- Paths are local/container paths. There is no per-user sandboxing inside the app.
- `GET /api/files` only serves known image paths or files under project `augmentations`, `conversions`, `exports`, `frames`, `metadata`, `pseudo_labels`, `reviewed_labels`, `sources`, and `splits` directories, plus trusted local workspace roots configured in the backend. Treat the app as trusted local tooling, not a public multi-user service.
- Job records are persisted in SQLite, but active job execution is process-local; restarting the container stops in-flight work.
- Conversion packages require a class schema so model ids can always be mapped back to class names in `classes.json` and `metadata.json`.
