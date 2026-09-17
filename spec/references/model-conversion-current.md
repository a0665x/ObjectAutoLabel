# Current Model Conversion Boundary

This file describes the active conversion path. Historical documents may
describe FP16, INT8, calibration, custom onnx2tf, retry, or partial validation;
those features were retired from the current UI and API.

## Supported Matrix

| Host architecture | ONNX FP32 | LiteRT FP32 | FP16 / INT8 |
| --- | --- | --- | --- |
| `x86_64` / `amd64` | Available, NCHW | Available, NCHW or NHWC | Not exposed or accepted |
| `aarch64` / `arm64` | Unavailable | Unavailable | Not exposed or accepted |

On ARM64 the capability API and UI use: `Copy the .pt checkpoint to an x86_64
host and convert it there.` Existing historical conversion rows remain readable.

## Active Flow

1. The user selects a `.pt`/`.pth` model source and class schema.
2. `GET /api/model-conversion-capabilities` gates the two FP32 choices.
3. On x86_64, a job calls the pinned Ultralytics `YOLO.export()` path.
4. ONNX uses `format="onnx"`, `half=false`, `simplify=false`, and a user-selected
   opset (default 11, accepted range 11 through 20).
5. LiteRT uses the pinned official `format="litert"` exporter and `quantize=null`.
   NCHW uses the native trace. NHWC wraps the prepared model with an explicit
   NHWC-to-NCHW input transpose before the same `litert_torch` trace; it is not
   a metadata-only relabel. The selected layout is stored on the artifact and
   in `metadata.json`.
6. The Convert and Export screens are merged. Each completed conversion exposes a direct ZIP download; tracked training sources add a structured `training/` directory with the persisted run record and available allowlisted arguments, metrics, and plots.
7. Artifacts, `classes.json`, and `metadata.json` remain project-local under
   `data/projects/<slug>/output_model/conversions/<package>/`.

Ultralytics package auto-install is disabled. Export dependencies must already
exist in the x86 Docker image; a conversion request never installs or repairs
packages and never alters the source checkpoint.

## ONNX Opset Validation

Before publishing, `validate_onnx_export` verifies the actual main-domain opset
matches the request, runs `onnx.checker.check_model`, and loads the artifact with
ONNX Runtime CPU. Export, schema or runtime-load errors fail the conversion run
and job; the UI shows the original error, requested opset and detected raw/NMS
or end-to-end/NMS-free mode. No automatic higher-opset retry is performed.
`metadata.json` records `export_settings.imgsz` and `export_settings.onnx_opset`.

On 2026-09-09, offline temporary YOLOv8n and YOLO26n checkpoints both exported
and executed at opsets 11, 12, 13, 14 and 17 using the pinned x86 stack:
Ultralytics 8.4.130, PyTorch 2.11.0, ONNX 1.16.1, ONNX Runtime 1.21.0.
Do not assert that all YOLO26 models require opset 13. Actual artifact validation
is authoritative; custom operators may still fail. These probes test execution,
not trained accuracy. Reproduce with `scripts/smoke-onnx-opsets.py` mounted into
the image under `/src` (no network or pretrained weights required).

## Source Routing

- `backend/app/conversion_runtime.py`: architecture capability detection and
  official FP32 export calls.
- `backend/app/runtime_safety.py`: disables Ultralytics runtime auto-install.
- `backend/app/project_services.py`: package staging, metadata, artifact records,
  and cleanup on failure.
- `backend/app/main.py`: capability and conversion endpoints.
- `backend/app/schemas.py`: accepted conversion target schema.
- `frontend/src/App.tsx`: Model Convert screen and capability gating.
- `frontend/src/api/client.ts` and `frontend/src/types.ts`: client-side target
  validation and API types.
- `requirements.txt` / `Dockerfile`: x86 export dependencies.
- `requirements-jetson.txt` / `Dockerfile.jetson`: deliberately omit the
  conversion stack.

## Scope Guard

Do not add calibration-folder controls, FP16/INT8 targets, aarch64 conversion,
runtime dependency installation, custom ONNX-to-TFLite pipelines, artifact
retry, or numerical-parity gates unless the user explicitly reopens that scope.
MuSGD belongs to Train and is independent of conversion architecture.

## Verification Focus

- `tests/backend/test_conversion_runtime.py`
- `tests/backend/test_model_conversion_api.py`
- `tests/backend/test_model_conversion_services.py`
- `tests/backend/test_runtime_safety.py`
- `frontend/src/App.test.tsx`
- `frontend/src/api/client.test.ts`

On a live Jetson, the capability response must contain exactly ONNX FP32 and
TFLite/LiteRT FP32 records, both unavailable with the x86 handoff reason.
