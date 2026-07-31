# Model Convert Packages Design

## Goal

Add a Model Convert workflow between Validate and Export so trained YOLO `.pt` models can be converted into selectable packages containing ONNX and TFLite variants, class schema metadata, and Netron previews. Export then bundles a chosen conversion package instead of performing ad hoc conversion.

## Product Flow

1. Train produces a native YOLO model, normally `best.pt` or `last.pt`.
2. Model Convert lets the operator select a training run, select a class schema, choose target artifacts, and run one conversion job.
3. One conversion job creates one conversion package with:
   - native `.pt` source model reference
   - converted artifact records for ONNX FP32, ONNX FP16, TFLite FP32, TFLite FP16, and TFLite INT8 as selected
   - `classes.json` with stable `id -> name` class mapping
   - `metadata.json` with source run, schema, conversion options, and artifact paths
4. Model Convert shows completed packages and embeds Netron for a selected artifact.
5. Export lets the operator select a conversion package, review its contents, choose whether to include all artifacts or only selected artifacts, and create a package directory or zip-ready bundle record.

## Backend Design

Add package-oriented conversion tables:

- `model_conversion_runs`: package header and source model metadata.
- `model_conversion_artifacts`: one row per converted artifact.
- `model_export_bundles`: final export bundle record.

Add API endpoints:

- `GET /api/projects/{project_id}/model-conversions`
- `POST /api/projects/{project_id}/model-conversions`
- `GET /api/projects/{project_id}/model-conversions/{conversion_id}/netron?artifact_id=...`
- `POST /api/projects/{project_id}/export-bundles`

Keep `POST /api/projects/{project_id}/model-exports` as a compatibility endpoint only if needed by existing callers. New WebUI behavior uses conversion packages.

## Frontend Design

Add `convert` to the main workflow navigation between `validate` and `export`.

Model Convert page:

- Training run selector with visible `best.pt` or `last.pt`.
- Class schema selector with a visible schema table.
- Conversion target matrix:
  - ONNX: FP32, FP16
  - TFLite: FP32, FP16, INT8
- Conversion package list with artifact chips.
- Netron preview panel using an iframe URL returned by the backend.

Export page:

- Conversion package selector.
- Package manifest preview.
- Artifact inclusion checklist, defaulting to all converted artifacts plus native `.pt`, `classes.json`, and `metadata.json`.
- Export action that creates a bundle record tied to the conversion package.

## Metadata Contract

Each package writes:

```json
{
  "project_id": "project-id",
  "training_run_id": "training-run-id",
  "source_model_path": "/app/output_model/project/runs/weights/best.pt",
  "schema_id": "schema-id",
  "schema_name": "production classes",
  "classes": [
    { "id": 0, "name": "class-a" },
    { "id": 1, "name": "class-b" }
  ],
  "artifacts": [
    { "id": "artifact-id", "format": "onnx", "precision": "fp32", "path": "/app/output_model/project/conversions/package/model.onnx" }
  ]
}
```

## Error Handling

- Conversion requires a completed training run with `best_model_path` or `last_model_path`.
- Conversion requires an explicit class schema so class ids remain explainable.
- Export requires an existing conversion package.
- Netron preview returns a clear error if the artifact file is missing or Netron cannot start.

## Testing

- Repository tests cover conversion package, artifacts, manifests, and export bundle records.
- Service tests cover manifest writing and export bundle directory creation without invoking real Ultralytics conversion.
- API tests cover the new endpoints.
- Frontend tests cover the Convert nav item, target matrix, schema mapping display, and Export package selector.
