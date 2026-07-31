# Runtime

## Primary Command

For first installation, run from the project root:

```bash
./run.sh
```

The WebUI is served at `http://localhost:8501`.

The launcher shows the public platform choices `x86_64 / amd64` and
`Jetson / aarch64`. If the selected local image is absent, it builds with
Docker layer cache, starts the service, and runs the quick runtime check. If
the image already exists, it does not change Docker state and instead prints
the image id/time plus `--up` and `--rebuild` guidance.

## Lifecycle Commands

```bash
./run.sh
./run.sh --up
./run.sh --rebuild
./run.sh --down
./run.sh --down_up
./run.sh --logs
./run.sh --status
./run.sh --mode jetson
./run.sh --mode desktop
./run.sh --detect
./run.sh --plan desktop
./run.sh --plan jetson
```

`./run.sh` and `./run.sh --rebuild` open an interactive keyboard selector when
run in a terminal. Use the arrow keys to choose `x86_64 / amd64` or
`Jetson / aarch64`, then press Enter. The selected internal mode (`desktop` or
`jetson`) is saved in `.run-mode`.

`./run.sh --up` is the normal command after a reboot. It uses
`docker compose up -d --no-build` and fails with first-install guidance if the
selected image is absent. `./run.sh --down_up` likewise recreates the container
without building. Only `./run.sh --rebuild` explicitly rebuilds, with normal
Docker layer cache enabled.

`./run.sh --detect` prints the resolved runtime environment: mode, architecture, L4T version, JetPack version, selected Jetson base image, and compose file.

`./run.sh --plan [desktop|jetson|auto]` prints the runtime mode, architecture, compose file, image/bind details, and exits without invoking Docker Compose. Use it to sanity-check x86/Jetson behavior from any machine when the other architecture is not available.

## Docker Service

Desktop mode uses `docker-compose.yml`:

- Container name: `object-autolabel`.
- Image: `object-autolabel:latest`.
- Web/API port: `8501`.
- Optional Netron port: `8081`.
- GPU: `gpus: all`.
- Shared memory: `2gb`.

Jetson mode uses `docker-compose.jetson.yml`:

- Container name: `object-autolabel`.
- Image: `object-autolabel:jetson`.
- Base image: `nvcr.io/nvidia/pytorch:25.06-py3-igpu` by default.
- Network: host mode. On Jetson, `run.sh` auto-detects the primary LAN IPv4 and passes it as `OBJECT_AUTOLABEL_BIND_HOST`; this allows LAN access such as `http://10.42.0.21:8501` without colliding with an existing Tailscale listener on `100.94.21.85:8501`. If detection fails, it falls back to `127.0.0.1`.
- To force a specific LAN interface, set `OBJECT_AUTOLABEL_BIND_HOST` before startup, for example `OBJECT_AUTOLABEL_BIND_HOST=10.42.0.21 ./run.sh --down_up`.
- The launcher starts one Uvicorn app on `OBJECT_AUTOLABEL_BIND_HOST:8501` and, when binding to a non-localhost IP, starts a localhost TCP proxy from `127.0.0.1:8501` to the bound LAN IP. This preserves Tailscale serve configs that proxy to localhost without binding the app to `0.0.0.0`.
- Netron previews are exposed through the WebUI origin at `/api/netron/...`; browsers should not connect directly to `localhost:8081`.
- The Netron proxy disables static-asset caching and rewrites Netron's packaged-age check so embedded previews do not get blocked by the upstream "Please update to the newest version" prompt.
- GPU: `runtime: nvidia`.

Override the Jetson base image when the installed JetPack/L4T version requires another tag:

```bash
JETSON_BASE_IMAGE=nvcr.io/nvidia/l4t-pytorch:<tag> ./run.sh --rebuild
```

## Adaptive Runtime Selection

`scripts/detect-runtime.sh` controls mode and image selection.

- `aarch64` or `arm64` resolves to `jetson`.
- `x86_64` or `amd64` resolves to `desktop`.
- Jetson L4T is read from `/etc/nv_tegra_release` or `nvidia-l4t-core`.
- L4T `36.4*` maps to JetPack `6.2`.
- L4T `36.3*` and `36.2*` map to JetPack `6.0`.
- L4T `35.*` maps to JetPack `5.x`.
- JetPack `6.x` uses NVIDIA PyTorch `*-py3-igpu` images.
- JetPack `5.x` uses legacy `nvcr.io/nvidia/l4t-pytorch:*` candidates.

When Docker can inspect manifests, the script selects the first candidate tag that exists. If manifest verification is unavailable because of network or registry constraints, it falls back to the first version-matched candidate and prints a warning. Use strict mode to fail instead:

```bash
STRICT_RUNTIME_CHECK=1 ./run.sh --detect
```

## Mounted Paths

- `./data:/app/data`
- `./runs:/app/runs`
- `./world_model:/app/world_model:ro`
- `./input_model:/app/input_model:ro`
- `./output_model:/app/output_model`
- `/home/a0665x/Desktop/AI_AGX_WS/autolabel:/home/a0665x/Desktop/AI_AGX_WS/autolabel:rw` in Jetson mode, so selected workspace data outside the ObjectAutoLabel root can still be accessed.

## Environment Assumptions

- Docker and Docker Compose are installed.
- NVIDIA Container Toolkit is installed when using GPU.
- Source files referenced in the UI are paths visible inside the container, normally under `/app/data`.
- Project-owned source copies and model artifacts should be under `/app/data/projects/<slug>/`; global `/app/output_model/<project_slug>` entries are index symlinks to each project output directory.
- Jetson deployments should use the `jetson` mode; desktop CUDA images are x86_64 and will fail on aarch64 with `exec format error`.
- x86_64 deployments should use `desktop` mode; `./run.sh --plan desktop` should resolve to `docker-compose.yml` and must not reference `docker-compose.jetson.yml` or `JETSON_BASE_IMAGE`.
- Real install/start/rebuild commands reject a selected platform that does not
  match the host architecture. `--plan` intentionally remains cross-platform.
- Jetson startup requires detected L4T plus an NVIDIA Docker runtime and does
  not silently fall back to CPU.

## Runtime Acceptance

The launcher runs quick acceptance after a successful start. Run it explicitly
with:

```bash
scripts/verify-runtime.sh --quick jetson
```

Quick acceptance checks `/api/health`, the running image/state, PyTorch/CUDA
versions, `torch.cuda.is_available()`, and the CUDA device name.

Prove that the container can actually train with CUDA using:

```bash
scripts/verify-runtime.sh --train jetson
```

The bounded smoke creates a temporary two-image dataset inside the container,
uses the smallest local `/app/input_model/*.pt`, runs one epoch with `device=0`,
checks `best.pt` and `last.pt`, and removes only its own successful temporary
run. It never downloads a model or falls back to CPU. On Jetson it reports
`/proc/meminfo` `MemAvailable` before and after because CPU and GPU share system
memory.

The 2026-07-31 AGX Orin hardware evidence, exact image/CUDA versions, training
output, and AMP reference-download fix are preserved in
[Jetson Docker CUDA and YOLO training acceptance](references/lesson-20260731-jetson-docker-cuda-training.md).

## Local Development

The backend can be run without Docker if dependencies are installed:

```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port 8501
```

Docker is the supported path because the YOLO and CUDA dependency stack is heavy.

Jetson images include the ARM-specific TensorFlow/TFLite export stack (`tensorflow-aarch64`, `onnx2tf`, `tf-keras`, `tflite-support`, `onnx-graphsurgeon`, and `sng4onnx`) so Model Convert does not block on runtime dependency installation.
