# API

Stream Demo endpoints and its WebSocket message protocol are documented in
[Stream Demo and model provenance](references/stream-demo.md).

Most long-running endpoints return a job record. Poll `GET /api/jobs` for recent status or `GET /api/jobs/{job_id}` for one job.

## Job Shape

```json
{
  "id": "hex",
  "name": "autolabel",
  "status": "queued|running|cancel_requested|cancelled|completed|failed",
  "progress": 0,
  "message": "Running",
  "result": null,
  "error": null
}
```

## Endpoints

- `GET /`: serves the React app shell.
- `GET /api/health`: lightweight liveness response with `ok` and `project_root`.
- `GET /api/auth/status`: public authentication/configuration state plus the current minimal user profile when signed in.
- `GET /api/auth/login/{provider}`: begin Google, Facebook, or LINE OAuth for a configured provider.
- `GET /api/auth/callback/{provider}`: complete the authorization-code flow and create the signed application session.
- `POST /api/auth/logout`: clear the application session.
- `GET /api/files?path=<file>`: serves a registered image or a file under a safe project output directory.
- `GET /api/projects`: list projects.
- `POST /api/projects`: create a project.
- `DELETE /api/projects/{project_id}`: delete a project record, its project workspace under `data/projects/<slug>/`, its project-scoped job history, and global `output_model/<project_slug>` / legacy `output_model/<project_id>` index entries. It must not delete raw `data/input/` files.
- `GET /api/projects/{project_id}/storage-status`: report whether the DB project row still has a project workspace and output model index. Missing storage marks the row as stale so the UI can offer cleanup instead of showing it as a healthy project.
- `POST /api/projects/{project_id}/cleanup-stale`: remove a stale DB project record/job history and any broken output index after the operator manually deleted its workspace. Refuses healthy projects with HTTP 409; use the regular delete endpoint for healthy project packages.
- `GET /api/projects/{project_id}`: get one project.
- `GET /api/projects/{project_id}/class-schemas`: list class schemas.
- `POST /api/projects/{project_id}/class-schemas`: create a class schema.
- `GET /api/models/world`: lists local weight filenames in backward-compatible `world_models` and adds `world_model_details` entries with `family`, source `task`, `annotation_output`, support state, and reason. YOLOE-26 Seg entries explicitly report `annotation_output: "bbox"`.
- `GET /api/models/input`: lists `.pt` and `.pth` weights from `input_model/`.
- `GET /api/models/output`: lists trained and exported artifacts from `output_model/`.
- `GET /api/jobs`: recent jobs.
- `GET /api/jobs/{job_id}`: one job.
- `POST /api/jobs/{job_id}/cancel`: request cooperative cancellation. Running jobs transition through `cancel_requested` to `cancelled`; completed/failed jobs remain terminal.
- `DELETE /api/projects/{project_id}/history/{artifact_type}/{artifact_id}`: delete one `open_data|pseudo|augmentation|split|training|conversion|export` history item and its downstream dependency cascade. Deleting an Open Data import removes its project-owned mapped image/annotation records but preserves the shared download cache. Active related jobs return HTTP 409. Only project-owned artifact directories are removed; shared Open Data caches, raw `data/input`, source assets, and class schemas are preserved. Deleting Current Split promotes the newest remaining Split.
- `GET /api/file-browser?mode=image_folder|video&path=<optional>`: browse local mounted folders/files for Sources and Validate. When `path` is omitted, the backend chooses an operator-friendly navigation location. That location is browser state only; the frontend does not assign it to a workflow form until the operator confirms `Use this folder` or selects a video. The response still carries matching counts for validation, while the simplified folder UI lists directories without repeating per-row image counts or image filenames.
- `GET /api/projects/{project_id}/sources`: list source assets.
- `POST /api/projects/{project_id}/sources`: add a video or image-folder source. Image-folder files are copied into `data/projects/<slug>/sources/<source_asset_id>/images/` before image records are created.
- `GET /api/projects/{project_id}/images`: list registered project images. Supports `review_status`, `has_low_confidence`, `source_asset_id`, `limit`, and `offset` query params for the review queue.
- `GET /api/projects/{project_id}/image-position?image_id=...`: return stable `position`/`total` for one active image, with the same optional Review filters as the queue. Removed images are excluded.
- `DELETE /api/projects/{project_id}/images/{image_id}`: recoverably remove one active image from the project and return `operation_id`, removed `image_id`, and the backend-selected `next_image_id`. Project-owned image/reviewed-label files move to hidden project trash; external/raw input is untouched.
- `POST /api/projects/{project_id}/image-removals/{operation_id}/restore`: restore a still-recoverable image removal and return the image plus annotations. Recomputes downstream lineage staleness.
- `GET /api/projects/{project_id}/review-stats`: aggregate review queue counts for statuses plus `edited` and `low_confidence`.
- `POST /api/projects/{project_id}/frame-runs`: extract frames from a video source into `data/projects/<slug>/sources/<source_asset_id>/frames/images/`.
- `POST /api/projects/{project_id}/pseudo-label-runs`: run prompted YOLO-World detection or YOLOE-26 Seg inference. Unsupported, missing, or symlink-escaped world-model/encoder files are rejected synchronously before a job is created; both resolved paths must remain inside `world_model/`. YOLOE masks/segments are intentionally discarded and only normalized bbox annotations enter the existing dataset contract. Payload may include `run_name`; the stored `pseudo_label_runs.run_name` becomes the downstream pseudo build label.
- `GET /api/images/{image_id}/annotations`: list annotations for one image.
- `PUT /api/images/{image_id}/annotations`: replace annotations, validate normalized bbox bounds, set review status, and write the corresponding YOLO label file into the project `reviewed_labels/` folder.
- `POST /api/projects/{project_id}/augmentation-preview`: render labeled image samples with requested augmentation recipe and bbox overlays for live Augment-page QA. Supported preview controls include brightness/exposure, hue, noise, blur, camera gain, bbox motion blur, random rotation, one horizontal/vertical mirror direction, `mirror_probability` (0–1), sample limit, and `polarity`. Rotation and triggered mirrors return transformed annotations, not only transformed pixels.
- `POST /api/projects/{project_id}/augmentation-runs`: create augmented images and copied/adjusted annotations from the selected recipe. Current UI maps `x3/x5/x8/x10` to augmented copies/output count rather than exposing low-level copy/sample controls to operators. Payloads may set `skip_augment=true` to create a source/pass-through build: source images are copied once, annotations are preserved, and generated count equals source count. Non-skip outputs sample each configured effect per generated image; signed effects are uniformly sampled within the configured `[-value,+value]` range, while noise/blur magnitudes are sampled from `[0,value]`.
- `GET /api/projects/{project_id}/augmentation-runs/{run_id}/samples?limit=3`: return random generated/pass-through image samples for one augmentation build with normalized bbox annotations. The frontend decides whether to draw bbox overlays.
- `POST /api/projects/{project_id}/dataset-splits`: create a train/val/test split.
- `GET /api/projects/{project_id}/dataset-splits`: list dataset splits.
- `GET /api/projects/{project_id}/dataset-splits/{split_id}/samples?limit_per_bucket=6&sample_seed=...`: return seeded-random train/valid/test sample images for a split with normalized YOLO bbox annotations. Changing the sample seed changes only visual QA, never split membership.
- `GET /api/projects/{project_id}/training-runs`: list training runs, including `run_name`, actual Ultralytics `save_dir`, `best_model_path`, `last_model_path`, `metrics_json` epoch/loss history, and the persisted `rect` and `amp` audit flags.
- `POST /api/projects/{project_id}/training-runs`: train a YOLO model. `optimizer` is explicit and limited to `SGD` (default), `MuSGD`, `Adam`, or `AdamW`; the selected value is forwarded unchanged to Ultralytics and never rewritten to `auto`. Payload may also include `run_name`, `rect` (default `true`), and `amp` (default `true`); both chosen flags are persisted on and returned with the training record, and are forwarded to Ultralytics. `diagnostics` defaults to `false`; when explicitly enabled it leaves training behavior unchanged and adds aggregate/hash-only optimizer, gradient, EMA, and artifact evidence to that job's result (not to the persisted training record). Callbacks persist one post-validation metric entry per epoch so the UI can draw a live loss curve. Completion stores model paths from the actual returned `results.save_dir`, not by guessing the newest `train*` folder.
- `POST /api/projects/{project_id}/validation-preview`: run random inference from a selected model path/schema/folder. `sample_count` defaults to 1 and is limited to 1–12. The response is a list of unique sampled images with predicted bbox overlays; the model is loaded once for the request.
- `GET /api/projects/{project_id}/model-sources`: list completed `.pt` and `.pth` model sources available to the active project. Includes current-project training runs, discovered current-project outputs, discovered other-project outputs, and loose root files in `output_model/`. Tracked training sources use the compact named lineage `[Pseudo] → [Augment] + [Open Data] → [Split] → [Train] · best|last.pt`; classes, hyperparameters, ids, timestamps, status, and image counts stay in detail panels instead of the option label.
- `GET /api/projects/{project_id}/artifact-context`: summarize the active project portfolio counts and downstream-selectable artifacts.
- `POST /api/projects/{project_id}/model-exports`: legacy single-format export for a trained model.
- `GET /api/model-conversion-capabilities`: return the ONNX FP32 and TFLite/LiteRT FP32 capability records for the current architecture. On aarch64 both are unavailable and the reason tells operators to copy the `.pt` checkpoint to an x86_64 host.
- `GET /api/projects/{project_id}/model-conversions`: list conversion packages.
- `POST /api/projects/{project_id}/model-conversions`: create one conversion package from a selected source model path or training run and class schema. New targets are restricted to `{"format":"onnx","precision":"fp32","layout":"NCHW"}` and `{"format":"tflite","precision":"fp32","layout":"NCHW|NHWC"}` on x86_64; duplicate targets are rejected. aarch64 requests return HTTP 409 with the checkpoint-handoff reason.
- `GET /api/projects/{project_id}/model-conversions/{conversion_id}/netron?artifact_id=<artifact_id>`: start/return a same-origin Netron URL for one converted artifact.
- `GET /api/netron/{asset_path:path}`: same-origin proxy to the internal Netron server on port `8081`. This endpoint rewrites Netron frontend assets to avoid stale packaged-version prompts and direct browser access to `localhost:8081`.
- `POST /api/projects/{project_id}/model-conversions/{conversion_id}/export-download`: create and download a ZIP for a completed conversion package. For tracked training sources it also includes `training/run.json` and allowlisted `args.yaml`, CSV metrics, and result plots from the project-owned training directory.
- `GET /api/projects/{project_id}/export-bundles`: list final export bundles.
- `POST /api/projects/{project_id}/export-bundles`: create a bundle from a selected conversion package.

## Review Status Vocabulary

- `unreviewed`
- `pending_review`
- `needs_fix`
- `reviewed`
- `skipped`

## Model Folder Contract

- `GET /api/models/world` reads `.pt` and `.pth` files from `world_model/`. Backend-recognized prompted filenames are legacy `yolov8*-world.pt|pth`, YOLO-World v2 `yolov8[smlx]-worldv2.pt`, and `yoloe-26[nslmx]-seg.pt`; unknown files remain visible but are marked unsupported. This backend recognition is intentionally broader than the checksum installer catalog: the installer offers only its attested default YOLOE bundle and `yolov8s-worldv2.pt`, while v2 M/L/X must be locally supplied through an approved trusted artifact/hash workflow. The endpoint only lists local files and does not download weights.
- `GET /api/models/input` reads `.pt` and `.pth` files from `input_model/`.
- `GET /api/models/output` reads exported artifacts from `output_model/`, including project symlinks, nested legacy directories, and `.pt`, `.pth`, `.onnx`, `.torchscript`, and `.tflite` outputs.

## Open Data and Current Split

- `GET /api/open-data/catalog` reports the built-in VisDrone adapter plus verified Ultralytics Platform Detect datasets already present in the shared cache.
- `POST /api/open-data/inspect` accepts one `platform.ultralytics.com/<owner>/datasets/<slug>` URL (or `ul://` URI), reads public metadata, and returns task/class/split/license compatibility without downloading pixels.
- `POST /api/projects/{project_id}/open-data/download` requires usage acknowledgement and a dataset key. Built-in VisDrone uses the resumable fixed-source archives; Platform datasets use an optional request-only API key or host `ULTRALYTICS_API_KEY`, download the current NDJSON export, validate Detect boxes/images, and never persist the key. Platform image transfer uses four workers and up to four attempts per image with exponential backoff. A failed network transfer retains only verified staged image/label pairs and reuses them when the next export has the same SHA-256; a changed export invalidates the staging set. HTTP 401/403, 429, timeout, and other storage failures are reported distinctly.
- `POST /api/projects/{project_id}/open-data/preview` validates a complete source-to-schema mapping and returns deterministic sampled counts plus `preview_seed`-controlled random bbox previews.
- `GET /api/projects/{project_id}/open-data/import` reads the newest Review-active import; `GET /api/projects/{project_id}/open-data/imports` lists all retained named versions.
- `POST /api/projects/{project_id}/open-data/import` publishes a new named version and demotes the previous Review-active version to saved; `DELETE` removes only the active derived import.
- Split creation accepts optional `open_data_import_id` and includes only that explicit version.
- `GET /api/projects/{project_id}/image-source-summary` reports active image and class counts without sending the full Review queue.
- `GET /api/projects/{project_id}/review-source-counts` returns Pseudo Label, Augment, and active Open Sources image counts. `GET /api/projects/{project_id}/bbox-histogram?source_groups=...` aggregates per-class bbox-area bins across the chosen groups and returns explicit `lower`, `upper`, and `count` values; an overloaded range is recursively split into five narrower bins, with bounded depth and minimum width. Image list and position queries accept the same comma-separated `source_groups`.
- Image list and position queries accept `source_origin=project|open_data`.
- Creating a split promotes it to Current Split and demotes prior records to saved immutable versions. Train accepts any non-outdated Split version and defaults to Current Split in the UI.

## API Safety Notes

Model conversion targets accept `format`, `precision`, and `layout`. Active FP32
targets are ONNX/NCHW and LiteRT/NCHW or LiteRT/NHWC. The backend persists the
layout on each conversion artifact and in `metadata.json`; existing artifacts
without a stored layout are treated as NCHW. PT is the native source checkpoint
for the package and is not re-laid out by this selector.

- Paths are local/container paths. There is no per-user sandboxing inside the app.
- `GET /api/files` only serves known image paths or files under project `augmentations`, `conversions`, `exports`, `frames`, `metadata`, `pseudo_labels`, `reviewed_labels`, `sources`, and `splits` directories, plus trusted local workspace roots configured in the backend. Treat the app as trusted local tooling, not a public multi-user service.
- Job records are persisted in SQLite, but active job execution is process-local; restarting the container stops in-flight work.
- Conversion packages require a class schema so model ids can always be mapped back to class names in `classes.json` and `metadata.json`.
- Conversion dependencies are image-build dependencies on x86_64. Ultralytics auto-install is disabled, so API requests never install converter packages at runtime. Jetson/aarch64 does not carry the converter stack; copy the `.pt` checkpoint to x86_64 for conversion.
- MuSGD remains a supported training optimizer and is unrelated to the conversion architecture restriction.
