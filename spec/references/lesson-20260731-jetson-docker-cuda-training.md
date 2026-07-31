# Jetson Docker CUDA and YOLO Training Acceptance

## Summary

The ObjectAutoLabel Jetson image was rebuilt and verified on a Jetson AGX
Orin through API health, container lineage, PyTorch CUDA, and a real one-epoch
Ultralytics training run. Container startup alone was not treated as proof:
the acceptance required CUDA device 0, generated `best.pt`/`last.pt`, stable
container state, and Jetson unified-memory observations.

The first smoke run also exposed an Ultralytics side effect: its default AMP
check downloaded a second reference `yolo11n.pt` into `/app`. Setting
`amp=False` for this bounded verification removed that network/model side
effect while preserving CUDA training.

## Context

- Project: ObjectAutoLabel
- Date: 2026-07-31
- Area: Jetson Docker build/runtime, PyTorch CUDA, Ultralytics YOLO training
- Host: Jetson AGX Orin, `aarch64`
- Trigger: prove that the platform-specific Docker architecture can actually
  train a YOLO model with GPU/shared memory, not merely start the WebUI
- Related source lesson:
  `/home/a0665x/Desktop/AI_AGX_WS/Agnet_speak/spec/references/lesson-20260730-jetson-docker-cuda-troubleshooting.md`

## Expected Behavior

The Jetson launcher must select the NVIDIA Jetson PyTorch image, require the
NVIDIA Docker runtime, start a healthy ObjectAutoLabel service, expose CUDA to
PyTorch, and complete a bounded YOLO training run with `device=0`. The smoke
test must use a mounted local weight and must not download a substitute model
or silently fall back to CPU.

## Host and Image Evidence

Host:

```text
aarch64
# R36 (release), REVISION: 4.7, GCID: 42132812, BOARD: generic, EABI: aarch64, DATE: Thu Sep 18 22:54:44 UTC 2025
```

Runtime selection:

```text
OBJECT_AUTOLABEL_MODE=jetson
OBJECT_AUTOLABEL_ARCH=arm64
OBJECT_AUTOLABEL_L4T=36.4.7
OBJECT_AUTOLABEL_JETPACK=6.2
JETSON_BASE_IMAGE=nvcr.io/nvidia/pytorch:25.06-py3-igpu
COMPOSE_FILE=/home/a0665x/Desktop/AI_AGX_WS/autolabel/ObjectAutoLabel/docker-compose.jetson.yml
```

Docker reported an `nvidia` runtime. Both desktop and Jetson Compose
definitions passed `docker compose ... config`.

Fresh Jetson image:

```text
sha256:53aa405e858fcf0debadf63e1630085fe0dc5bac4201db2152505d9cc5a72a0c
Created: 2026-07-31T15:54:31.439155468+08:00
Image: object-autolabel:jetson
Container: object-autolabel
State: running
RestartCount: 0
```

The build used `nvcr.io/nvidia/pytorch:25.06-py3-igpu`. The image completed
the ARM64 dependency installation, including the locally built
`tflite-support-0.1.0a1` wheel, and started the custom backend server.

## CUDA and API Evidence

API:

```json
{"ok":true,"project_root":"/app"}
```

Direct container probe:

```text
PyTorch: 2.8.0a0+5228986c39.nv25.06
CUDA: 12.9
torch.cuda.is_available(): True
Device: Orin
```

The container log showed NVIDIA Release `25.06`, successful application
startup, Uvicorn on `10.42.0.21:8501`, and the localhost forwarder from
`127.0.0.1:8501`. Recent logs contained no CUDA, ABI, OOM, dependency, or
restart-loop error.

## YOLO Training Evidence

Command:

```bash
scripts/verify-runtime.sh --train jetson
```

Inputs and bounds:

```text
Model: /app/input_model/yolo11n.pt
Ultralytics: 8.3.78
Device: CUDA:0 (Orin, 30697MiB)
Epochs: 1
Image size: 64
Batch: 1
Workers: 0
AMP: False
Synthetic dataset: one train image and one validation image
```

Verified training output:

```text
GPU_mem: 0.156G
save_dir=/tmp/object-autolabel-yolo-cuda-smoke/runs/cuda-smoke
best.pt: OK
last.pt: OK
```

The verification script checked both files before removing only its own
`/tmp/object-autolabel-yolo-cuda-smoke` directory.

Jetson unified-memory observations for the final accepted run:

```text
MemAvailable before: 14780928 kB
MemAvailable after:  14745600 kB
Difference:          -35328 kB (about -34.5 MiB)
```

This single bounded difference is diagnostic evidence, not a leak verdict.
Jetson CPU and GPU share system memory, so use `/proc/meminfo`
`MemAvailable`. Do not use discrete-VRAM fields from `nvidia-smi` as the
acceptance criterion. Repeated identical cycles are required before diagnosing
continued memory loss.

## Download Side Effect and Root Cause

The first run used Ultralytics' default `amp=True`. Before training,
Ultralytics ran its AMP compatibility check and downloaded:

```text
/app/yolo11n.pt                         5,613,764 bytes
/tmp/ultralytics/Arial.ttf               773,236 bytes
```

The training model itself was already the mounted
`/app/input_model/yolo11n.pt`; the extra `/app/yolo11n.pt` came from the AMP
reference check, not from missing user weights or CUDA incompatibility.

A regression assertion requiring `amp=False` failed before the fix. The smoke
configuration was then changed to `amp=False`, the generated reference model
was removed from the disposable container, and the full one-epoch smoke was
rerun. The rerun completed on CUDA, created both weights, and did not recreate
`/app/yolo11n.pt`. The font remains a harmless `/tmp` cache.

## Verification Commands

```bash
uname -m
head -1 /etc/nv_tegra_release
docker info --format '{{json .Runtimes}}'
./run.sh --detect jetson
docker compose -f docker-compose.yml config
docker compose -f docker-compose.jetson.yml config
OBJECT_AUTOLABEL_MODE=jetson ./run.sh --rebuild
curl -fsS http://127.0.0.1:8501/api/health
docker inspect --format '{{.Config.Image}} {{.State.Status}} {{.RestartCount}}' object-autolabel
docker exec object-autolabel python3 -c \
  "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
scripts/verify-runtime.sh --train jetson
docker logs --tail 200 object-autolabel
```

Focused regression verification after the AMP fix:

```text
16 passed
```

from:

```bash
pytest -q tests/backend/test_verify_runtime_script.py tests/backend/test_runtime_scripts.py
```

## Deployment Notes

- A Jetson rebuild is required after Dockerfile, requirements, frontend, or
  backend changes: `./run.sh --rebuild`.
- Normal reboot startup is `./run.sh --up` and does not build.
- The mounted training-model path is `/app/input_model`.
- The training smoke requires at least one local `.pt`; it does not download a
  missing training model.
- Docker/NVIDIA probes must run outside restricted sandboxes when the sandbox
  hides `/var/run/docker.sock`.
- The amd64 Compose definition and dry-run plan were validated on this host,
  but amd64 CUDA hardware startup/training was not verified on an amd64 NVIDIA
  machine.

## Future Guardrails

1. Confirm host architecture, L4T, NVIDIA runtime, selected Compose file, and
   actual running image before changing Python dependencies.
2. Do not claim GPU training works from container health or
   `torch.cuda.is_available()` alone; run the bounded training smoke.
3. Preserve `device=0` and `amp=False` in the local-only smoke test. Never
   convert Jetson acceptance to a CPU fallback.
4. Treat `MemAvailable` as a sample. Compare repeated steady-state cycles
   before calling a change a unified-memory leak.
5. If a model is reported missing, inspect `/app/input_model` and the mount
   before downloading another copy.
6. An `IncompleteRead` during a dependency download is a network/cache failure,
   not proof of CUDA incompatibility.

## Links

- Launcher: `run.sh`
- Runtime detector: `scripts/detect-runtime.sh`
- Runtime acceptance: `scripts/verify-runtime.sh`
- Runtime spec: `spec/RUNTIME.md`
- Testing spec: `spec/TESTING.md`
- Design: `docs/superpowers/specs/2026-07-31-platform-launcher-jetson-cuda-design.md`
- Plan: `docs/superpowers/plans/2026-07-31-platform-launcher-jetson-cuda.md`
