# Data Model

## SQLite State

The current application initializes `data/object_autolabel.db` on startup. Core tables are:

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
- `model_conversion_runs`
- `model_conversion_artifacts`
- `model_export_bundles`
- `jobs`

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
- `training_runs.run_name`: human-readable training run name.
- `training_runs.save_dir`: actual Ultralytics result directory returned by the training call.
- `training_runs.best_model_path` / `last_model_path`: exact weight paths from that `save_dir`.
- `training_runs.metrics_json`: persisted epoch/loss metric list used by the Train page loss chart.

## Runtime Folders

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

Each conversion package stores a schema snapshot as JSON so model ids remain explainable after deployment. The source model may come from a known `training_runs` record or from a discovered `.pt`/`.pth` file under `output_model/`.

```json
[
  { "id": 0, "name": "class-a" },
  { "id": 1, "name": "class-b" }
]
```

The package also writes `metadata.json` with source training run, source `.pt`, schema id/name, and converted artifact records.

## Augmentation Label Contract

Augmentation outputs are project-owned. Pixel transforms that move geometry must update annotations at the same time:

- Horizontal flip mirrors normalized `x_center`.
- Random rotation rotates bbox corner coordinates around the image center and rewraps the result as a normalized YOLO bbox.
- Hue, exposure/brightness, blur, random noise, and camera gain change pixels only and keep bbox geometry unchanged.
- Bounding Box Motion Blur applies localized blur inside target boxes; it should keep bbox geometry unchanged.

The Augment UI uses live previews and post-create random output checks to make annotation/pixel alignment visible before training.

For non-skip augmentation builds, each generated output samples the configured effect stack independently. Effects that support direction are uniformly sampled within `[-value,+value]`; non-negative effects such as noise and blur sample magnitudes from `[0,value]`. `x3/x5/x8/x10` means that many composite outputs per source image. `Skip augment` creates one copied source/pass-through output per source image.
