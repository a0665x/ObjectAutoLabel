# Data Model

## SQLite State

### Open Data lineage

- `open_data_imports` stores named project versions with mapping, sample percentage, fixed selection seed, counts, derived directory, active/saved status, and job lineage. One newest version is Review-active; saved versions remain available to Split.
- `images.source_origin`, `source_split`, `source_key`, and `open_data_import_id` distinguish project images from imported records.
- `dataset_splits.open_data_import_id` captures the imported selection; `is_current` identifies the default newest Split, while any non-outdated saved Split remains eligible for new training.
- Annotation edits only stale Current Split when bbox/class content changes; review-status-only saves do not.

The current application initializes `data/object_autolabel.db` on startup. Core tables are:

- `projects`
- `source_assets`
- `frame_extraction_runs`
- `class_schemas`
- `class_descriptors`
- `pseudo_label_runs`
- `open_data_imports`
- `images`
- `image_removal_operations`
- `annotations`
- `review_sessions`
- `dataset_splits`
- `training_runs`
- `model_exports`
- `model_conversion_runs`
- `model_conversion_artifacts`
- `model_export_bundles`
- `jobs`

Active-image queries require `images.removed_at is null`. A removal operation
sets `images.removed_at` and `removal_operation_id`; the corresponding
`image_removal_operations` row records original/trash paths and `restored_at`.
Affected `augmentation_runs` and `dataset_splits` use `outdated` plus a
structured `outdated_reason` to prevent removed inputs from silently entering
new training. See [Review editing and image removal](references/review-editing-and-image-removal.md).

## Class Schema

Class schemas map stable YOLO `class_id` values to class names and one or more YOLO-World descriptors. Descriptor order is stored in `class_descriptors.sort_order`.

Operationally, schema editing is treated as draft-first in the Pseudo Label UI: descriptor/class edits do not become a reusable history item until the operator commits the schema. A selected historical schema immediately supplies the current canonical class ids/names and descriptors. Duplicate schema names may exist, so UI history labels must include a short id suffix when names collide.

YOLO-World descriptors are only prompt/provenance metadata. Detections produced from descriptors are mapped back to the parent canonical `class_id` and `class_name`; generated `dataset.yaml` files must contain only canonical classes such as `0: person` and `1: car`, not every descriptor phrase.

## YOLO Label Output

Labels are written as standard YOLO text rows:

```text
class_id x_center y_center width height
```

All coordinates are normalized to the source image width and height.

## Versioned Build Records

Pseudo-label, augmentation/source, split, and training records are treated as versioned build outputs. UI selectors should show the user-provided build/run name plus enough upstream lineage to identify which earlier build was used.

- `pseudo_label_runs.run_name`: human-readable pseudo-label build name submitted from the Pseudo page.
- `augmentation_runs.name`: human-readable augment or source/pass-through build name.
- `dataset_splits.name`: human-readable split build name.
- Automatic Pseudo, Augment, Open Data, Split, and Train names use `<Type>_MMDD_vNNN`, for example `Train_0914_v003`. The month/day is local time, the zero-padded version advances from retained history, and an explicitly entered operator name is preserved unchanged. UI identity is the richer `[Pseudo] → [Augment] + [Open Data] → [Split · total images]` lineage assembled from the stored foreign keys and immutable `image_ids_json` snapshot.
- `training_runs.run_name`: human-readable training run name.
- `training_runs.save_dir`: actual Ultralytics result directory returned by the training call.
- `training_runs.best_model_path` / `last_model_path`: exact weight paths from that `save_dir`.
- `training_runs.metrics_json`: persisted epoch/loss metric list used by the Train page loss chart.
- `training_runs.settings_json`: exact submitted epochs, image size, batch, device, patience, optimizer, learning rates, rect, and amp settings used to reconstruct the run configuration after refresh.

## Runtime Folders

- `data/opendata/visdrone2019-det/`: verified shared raw cache; never project-owned.
- `data/opendata/ultralytics/<owner>/<dataset>/`: verified shared Ultralytics Platform Detect cache containing normalized source-class YOLO labels, train/val images, and a manifest with owner/slug/task/classes/export version and NDJSON checksum. API keys and signed URLs are not retained.
- `data/projects/<slug>/opendata/visdrone2019-det`: relative link to the shared cache.
- `data/projects/<slug>/opendata/imports/<id>/`: disposable mapped/sample image links, normalized labels, review labels, and manifest.
- `logs/YYYY-MM-DD/`: `runtime.jsonl`, `jobs.jsonl`, `access.log`, and launcher logs with rotation/redaction.
- `data/input`: user-provided videos and images.
- `data/projects/<slug>`: one project workspace. Deleting a project deletes this directory, project-owned DB rows, project job history, and the global model-index entries for that project, but never deletes `data/input`.
- `data/projects/<slug>/sources/<source_asset_id>/images`: project-owned copies of image-folder sources. `source_assets.path` keeps the original operator-selected raw input path for traceability, but registered project `images.path` values point to this copied folder after registration/migration.
- `data/projects/<slug>/sources/<source_asset_id>/frames/images`: project-owned extracted video frames.
- `data/projects/<slug>/pseudo_labels`: generated labels and preview images from YOLO-World.
- `data/projects/<slug>/reviewed_labels`: corrected labels saved from the review UI.
- `data/projects/<slug>/splits`: generated train/val/test splits and dataset YAML.
- `data/projects/<slug>/metadata`: project metadata outputs.
- `data/projects/<slug>/augmentations`: augmented project images and adjusted annotations.
- `data/projects/<slug>/output_model`: project-owned trained models, conversion packages, export bundles, and model manifests. Trained weights live under `output_model/runs/`; conversion packages under `output_model/conversions/`; final bundles under `output_model/exports/`.
- `world_model`: YOLO-World `.pt` and `.pth` weights.
- `input_model`: standard YOLO `.pt` and `.pth` input weights.
- `output_model`: global model index. `output_model/<project_slug>` is a symlink to `data/projects/<slug>/output_model`; loose manually copied model files may still live at the root for backward compatibility.
- `data/projects/<slug>/output_model/conversions/<package_name>`: conversion package metadata and ONNX/TFLite artifacts.
- `data/projects/<slug>/output_model/exports/<bundle_name>`: final export bundle content and `bundle.json`.

## Project Output Migration

On startup, the repository layer calls `migrate_project_output_models()`:

- Ensures every current project has `data/projects/<slug>/output_model`.
- Ensures every current project has a relative global index symlink at `output_model/<project_slug>`.
- Moves matching legacy folders from `output_model/<project_id>` into the project-local output folder when `<project_id>` is a current project id.
- Updates DB path columns for training runs, model exports, conversion runs, conversion artifacts, and export bundles from the old legacy prefix to the new project-local prefix.
- Leaves unknown global directories and loose model files untouched. These are treated as legacy or manually copied loose output model sources.

## Model Conversion Package

Each conversion artifact records its input layout. ONNX and native PT use the
standard NCHW contract. LiteRT FP32 may be traced as NCHW or NHWC; the selected
layout is persisted in the artifact row and conversion manifest so downstream
consumers can prepare input tensors correctly.

Each conversion package stores a schema snapshot as JSON so model ids remain explainable after deployment. The source model may come from a known `training_runs` record or from a discovered `.pt`/`.pth` file under `output_model/`.

```json
[
  { "id": 0, "name": "class-a" },
  { "id": 1, "name": "class-b" }
]
```

The package also writes `metadata.json` with source training run, source `.pt`, schema id/name, and converted artifact records. A downloaded export ZIP adds `training/run.json` and, when available, `training/args.yaml` plus CSV/image result evidence without copying arbitrary files or symlinks from the run directory.

## Augmentation Label Contract

Augmentation outputs are project-owned. Pixel transforms that move geometry must update annotations at the same time:

- Horizontal mirror maps normalized `x_center` to `1 - x_center`.
- Vertical mirror maps normalized `y_center` to `1 - y_center`.
- Random rotation rotates bbox corner coordinates around the image center and rewraps the result as a normalized YOLO bbox.
- Hue, exposure/brightness, blur, random noise, and camera gain change pixels only and keep bbox geometry unchanged.
- Bounding Box Motion Blur applies localized blur inside target boxes; it should keep bbox geometry unchanged.

The Augment UI uses live previews and post-create random output checks to make annotation/pixel alignment visible before training.

`augmentation_runs.settings_json` records `mirror_probability` in addition to the chosen horizontal/vertical direction. New UI drafts store Mirror inside the ordered `effects` array; legacy browser drafts with old `horizontalFlip`/`verticalFlip` flags are migrated to a 100%-probability Mirror effect when loaded.

For non-skip augmentation builds, each generated output samples the configured effect stack independently. Effects that support direction are uniformly sampled within `[-value,+value]`; non-negative effects such as noise and blur sample magnitudes from `[0,value]`. `x3/x5/x8/x10` means that many composite outputs per source image. `Skip augment` creates one copied source/pass-through output per source image.

## History Deletion Contract

Deletion follows stored lineage from upstream to downstream:

`Pseudo → Augment → Split → Training → Conversion → Export`

`Open Data import → Split → Training → Conversion → Export`

The selected record and every dependent downstream record are removed in one database transaction. Associated completed jobs are removed, Current Split falls back to the newest remaining Split, and generated Augment or imported Open Data image rows are deleted with their annotations. The Open Data import's shared `project_dir` download cache is retained. Filesystem cleanup is restricted to unshared child directories beneath project-owned `pseudo_labels/`, `augmentations/`, `splits/`, and `output_model/{runs,conversions,exports}/`. Training cleanup removes the run-specific Ultralytics `save_dir`, never the shared `output_model/runs` parent. A path still referenced by another record is retained.
