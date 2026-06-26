# Runtime

## Primary Command

Run from the project root:

```bash
./run.sh --up
```

The WebUI is served at `http://localhost:8501`.

## Lifecycle Commands

```bash
./run.sh --up
./run.sh --down
./run.sh --down_up
./run.sh --logs
./run.sh --status
./run.sh --mode jetson
./run.sh --mode desktop
./run.sh --detect
```

`./run.sh --up` and `./run.sh --down_up` open an interactive keyboard selector when run in a terminal. Use arrow keys to choose `jetson`, `desktop`, or `auto`, then press Enter. The selected mode is saved in `.run-mode`.

`./run.sh --detect` prints the resolved runtime environment: mode, architecture, L4T version, JetPack version, selected Jetson base image, and compose file.

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
- Network: host mode, so the WebUI is still `http://localhost:8501`.
- GPU: `runtime: nvidia`.

Override the Jetson base image when the installed JetPack/L4T version requires another tag:

```bash
JETSON_BASE_IMAGE=nvcr.io/nvidia/l4t-pytorch:<tag> ./run.sh --up
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
- Current `AppPaths` expects model folders named `world_model/`, `input_model/`, and `output_model/` under the project root.
- Current compose files still mount legacy `models/` and `yolo_model/` paths; align compose mounts before relying on model discovery inside Docker.

## Environment Assumptions

- Docker and Docker Compose are installed.
- NVIDIA Container Toolkit is installed when using GPU.
- Source files referenced in the UI are paths visible inside the container, normally under `/app/data`.
- Jetson deployments should use the `jetson` mode; desktop CUDA images are x86_64 and will fail on aarch64 with `exec format error`.

## Local Development

The backend can be run without Docker if dependencies are installed:

```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port 8501
```

Docker is the supported path because the YOLO and CUDA dependency stack is heavy.
