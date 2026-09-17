# Testing

## Current Validation

- Stream Demo coverage verifies conversion/format selection, lineage, camera mode parsing, upload limits, path and WebSocket origin guards, live thresholds, and cleanup. See [Stream Demo acceptance](references/stream-demo.md#api-and-verification) for offline PT/ONNX/TFLite video checks.
- On 2026-09-09, the complete backend suite passed 311 tests and the frontend suite passed 229 tests. The desktop Stream Demo played real models through GStreamer and browser MSE; physical camera and Jetson hardware acceptance remain pending. The offline postprocessing smoke covers renamed YOLOv8/YOLO26 PT, ONNX, and TFLite models; its optional Xvfb mode executes the standalone OpenCV commands.
- `tests/backend/test_open_data.py` uses tiny local provider fixtures to verify mapping-before-sampling, empty-image exclusion, official split preservation, project-local review labels, Augment exclusion, source summaries, Current Split invalidation, transient Platform image retry, matching-export staging resume, and expired signed-URL reporting.
- `tests/backend/test_logging_config.py` verifies Taipei date routing, secret/path redaction, and access-log separation.
- `frontend/src/pages/OpenDataPage.test.tsx` verifies the required forward/back mapping-card loop and the empty-left-lane gate.
- Review panel tests verify Open Sources remains disabled until a project import exists.

This project currently has smoke-test and focused unit/integration validation:

- Shell syntax check for `run.sh`.
- Runtime launcher tests cover first-install image detection, English platform
  labels, non-building `--up`/`--down_up`, cached `--rebuild`, architecture
  mismatch rejection, cross-platform planning, and detector-output injection.
- Runtime verification tests cover health, running-image identity, mandatory
  PyTorch CUDA, local-only model selection, `device=0`, and output-weight
  checks.
- Docker Compose config validation when Docker is available.
- Backend pytest coverage for repositories, jobs, DB schema, annotations API, structured model listing (including official YOLO-World v2 S/M/L/X), synchronous unsupported-model/encoder/symlink-escape rejection, project services, label IO, YOLO-World/YOLOE adapters, desktop/Jetson offline encoder-path mapping, catalog YOLO-World v2 + YOLOE smoke selection, bbox-only pseudo integration, and SHA-256-verified atomic model installation.
- Backend pytest coverage for model conversion package records, conversion manifests, export bundles, and conversion API endpoints.
- Backend pytest coverage for project-local source copies, frame extraction output path selection, project `output_model` symlink creation/deletion, legacy project-id output migration, and Netron proxy asset rewrites.
- Backend pytest coverage for stale project storage detection/cleanup and project-local data lifecycle safeguards.
- Frontend TypeScript/Vite build and Vitest coverage for review-state, annotation reducer, geometry helpers, body-portaled context-menu positioning, zoomed direct-pan/lasso/box-drag routing, canvas affordance behavior, model conversion UI helpers, stale project cleanup UI, pseudo-label generate feedback, augmentation controls, workflow navigation, and validation random-sample UI.
- Folder/validation regression coverage verifies an explicit unassigned path state, a simplified folder browser presentation, editable Validate sample counts, unique multi-image inference with one model load, and responsive result cards.
- Augmentation regression coverage verifies Mirror is a stack effect with a single direction and probability, 0% leaves pixels/labels unflipped, and legacy 100% mirror behavior remains valid.
- Review regression coverage also includes draw-inside-box routing, solid previews, pointer-cancel/no-`(0,0)` commits, Edit command parity, Copy/Paste/Duplicate, session undo/redo, Shift+X confirmation/removal/restore, filtered/project position reconciliation, and stale lineage blocking.
- Conversion regression coverage asserts the two-target FP32 matrix, x86 Ultralytics calls, aarch64 rejection, runtime auto-install suppression, failure cleanup, and historical package readability. See [current conversion boundary](references/model-conversion-current.md).
- History deletion regression coverage asserts downstream DB/file cascades from both pipeline builds and Open Data imports, Open Data cache preservation, active-job rejection through persisted `job_id`, Current Split promotion, shared output-directory preservation, compact Model source lineage, confirmation UI, and selector refresh behavior.

## Verification Commands

```bash
pytest -v
npm --prefix frontend test
npm --prefix frontend run build
bash -n run.sh scripts/*.sh
python3 -m py_compile backend/app/main.py backend/app/repositories.py backend/app/project_services.py backend/app/server.py
docker compose -f docker-compose.yml config
docker compose -f docker-compose.jetson.yml config
```

## Responsive Browser QA

After a UI rebuild, exercise Projects, Sources, Pseudo Label, Split, Train,
Validate, and Review at exactly 375, 768, 851, 1024, and 1440 CSS pixels.
Allow each route to settle before measuring `document.documentElement.scrollWidth`
against `window.innerWidth`; page-level horizontal overflow is a failure.

At every width, verify that ordinary controls are at least 44px high, fields
and panels may fill their available column, and ordinary action buttons keep
their intrinsic width (except a deliberately full-width small-screen primary
panel action). For same-row peer cards, compare computed widths and reject a
difference above 2px. On Review, verify option-C toolbar behavior: tool and
save groups stack below 900px and remain horizontal groups at 1024/1440px.
Also smoke Select/Draw/Pan/Fit/Save/Save & next, zoomed drag panning, box
movement, and the right-click context menu when a source image is available.

Record the browser URL, rebuild identity, health response, measurements, and
whether the viewport override was reset in the task report. Do not mark the
Review smoke complete until a real image has been loaded and the three pointer
gestures have recorded observable pan, box-coordinate, and context-menu
results.

Running-container acceptance:

```bash
scripts/verify-runtime.sh --quick jetson
scripts/verify-runtime.sh --train jetson
docker exec object-autolabel python /app/scripts/smoke-world-models.py
```

Desktop dependency acceptance runs without project mounts or network access:

```bash
docker build -t object-autolabel:desktop-check .
docker run --rm --runtime=nvidia --gpus all --network none object-autolabel:desktop-check python /app/scripts/smoke-desktop-runtime.py
```

This checks the pinned PyTorch/TorchVision/CUDA versions, CUDA forward/backward
and NMS, API health, and both official FP32 export paths using a temporary
randomly initialized YOLOv8n checkpoint. ONNX checker and LiteRT tensor
allocation verify the resulting files are loadable. It requires no downloaded
weights and is not a model-accuracy or full training acceptance test. The
Dockerfile's LiteRT import smoke remains the direct regression gate for the
former PyTorch 2.4.1 `shape=""` schema-inference failure.

Verified on 2026-09-08 on x86_64 with an RTX 2080 Ti and driver 590.48.01:
the desktop image built successfully, the offline smoke passed both FP32
exports, and `OBJECT_AUTOLABEL_MODE=desktop ./run.sh --rebuild` passed API
health and CUDA acceptance. The focused runtime/conversion suite passed all
56 tests. Jetson dependencies were unchanged; this was not a Jetson hardware
retest. TorchAO emitted optional extension-load warnings, but the supported
FP32 LiteRT export and tensor allocation completed successfully.

The training acceptance requires a local `.pt` weight in `input_model/`. It
runs one bounded CUDA epoch and verifies `best.pt`/`last.pt`; it does not
download weights or accept a CPU fallback. On Jetson, interpret memory through
`/proc/meminfo` `MemAvailable`, not discrete-GPU `nvidia-smi` VRAM fields.

`npm --prefix frontend run build` writes `frontend/dist/`; that build output remains ignored by git.

## Retained 0629 Production Acceptance

The two-project CUDA acceptance is recorded in
[2026-08-30 0629 dual training acceptance](../docs/verification/2026-08-30-0629-dual-training-acceptance.md).
It is a production-path check, not a replacement for the synthetic runtime
smoke. Run it only with a deliberate GPU window and preserve every resulting
project package and prior run record.

1. Verify `data/input/0629` contains exactly 190 PNG files, the selected
   world-model weights/encoders exist, the container is `running` with restart
   count 0, and `torch.cuda.is_available()` is true.
2. Create two otherwise empty projects. Register `/app/data/input/0629` once
   in each; require exactly one ready source, 190 project images, one copied
   `person-car-aerial-v1` schema, and 15 descriptors per project. Never reuse
   a package with a source, pseudo run, split, or training record.
3. Run pseudo-label jobs sequentially: `yolov8s-worldv2.pt` for one lineage
   and `yoloe-26n-seg.pt` for the other, both at confidence `0.10`, IoU
   `0.70`, and merge disabled. Require 190 processed/labeled images and a
   positive detection count.
4. Create a project-local 0.80/0.10/0.10 split for each run; require
   152/19/19 ids, images, labels, and a `dataset.yaml` with classes 0 person
   and 1 car.
5. Train sequentially from `yolov8n_pretrain_8020.pt`: one epoch, 640 image
   size, batch 8, CUDA/device 0, patience 10, SGD, `lr0=0.01`, `lrf=0.01`,
   with explicit `rect=false` and `amp=false`. Require one persisted epoch-1
   metric, `best.pt`, `last.pt`, and their SHA-256/size. Do not accept CPU
   fallback, CUDA OOM, restart, missing artifacts, or AMP runs that skipped
   optimizer steps.
6. Validate each lineage with its own `best.pt` and copied schema against a
   0629 image. Preserve the model path, selected filename, overlay URL, and
   detection summary. `diagnostics=true` is an opt-in API-only investigation
   flag: it does not change the model configuration but records aggregate
   optimizer/gradient/EMA evidence in that job result.

For the final regression gate, run:

```bash
pytest -q
npm --prefix frontend test -- --run
npm --prefix frontend run build
bash -n run.sh scripts/*.sh
git diff --check
curl -fsS http://127.0.0.1:8501/api/health
curl -fsS https://<device>.<tailnet>.ts.net:8501/api/health
```

The required browser widths remain 375, 768, 851, 1024, and 1440 CSS pixels.
At a 375px external viewport test the normal desktop-mode header with a long
active-project name as well as the Mobile preview mode; `scrollWidth` must not
exceed `innerWidth`. The top-bar name must wrap, not rely on the workflow
strip's intentionally contained horizontal scroller.

Latest verified counts from the 2026-07-06 UI/UX iteration:

- backend repository tests in Docker: 11 passed.
- frontend full Vitest suite: 54 passed.
- `npm --prefix frontend run build`: passed.
- Docker Jetson build/recreate and local runtime health passed. See [Current Status](STATUS.md) for URL caveats.

## Gaps

- Fake-model integration covers prompted inference-to-bbox persistence. The
  retained real YOLO-World/YOLOE CUDA acceptance is complete; the bounded
  container smoke remains separate ongoing automated/runtime coverage rather
  than an unmet acceptance prerequisite.
- No browser-level end-to-end automation covers the review workbench interactions.
- Frontend coverage remains focused on review utilities rather than full-screen interaction flows.
- Netron is verified through backend proxy responses and endpoint checks, not through full browser canvas automation.
