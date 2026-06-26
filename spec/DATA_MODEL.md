# Data Model

## SQLite State

The current application initializes `object_autolabel.db` on startup. Core tables are:

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

## Class Schema

Class schemas map stable YOLO `class_id` values to class names and one or more YOLO-World descriptors. Descriptor order is stored in `class_descriptors.sort_order`.

## YOLO Label Output

Labels are written as standard YOLO text rows:

```text
class_id x_center y_center width height
```

All coordinates are normalized to the source image width and height.

## Runtime Folders

- `data/input`: user-provided videos and images.
- `data/projects/<slug>/sources`: project source data.
- `data/projects/<slug>/frames`: extracted frame images.
- `data/projects/<slug>/pseudo_labels`: generated labels from YOLO-World.
- `data/projects/<slug>/reviewed_labels`: corrected labels saved from the review UI.
- `data/projects/<slug>/splits`: generated train/val/test splits and dataset YAML.
- `data/projects/<slug>/metadata`: project metadata outputs.
- `world_model`: YOLO-World models.
- `input_model`: standard YOLO input models.
- `output_model`: trained/exported `.pt`, `.tflite`, `.onnx`, and `.torchscript` models.
- `runs/detect`: training outputs.
