# ObjectAutoLabel

ObjectAutoLabel is a local-first object-detection dataset and model workflow. It runs a FastAPI backend, SQLite state, and a React/Vite WebUI for source registration, YOLO-World pseudo labeling, review, augmentation, split creation, YOLO training, validation, model conversion, and export packaging.

Open the WebUI at:

```bash
http://127.0.0.1:8501/
```

## Start

### First installation

Use the launcher from the project root:

```bash
./run.sh
```

Choose `x86_64 / amd64` or `Jetson / aarch64` with the arrow keys and press
Enter. If the selected image is not installed, the launcher builds it with the
normal Docker layer cache, starts the service, and verifies API/CUDA access.

If the image already exists, bare `./run.sh` does not rebuild or start
anything. It prints the image id/creation time and points to the safe startup
and rebuild commands below.

### Normal startup after a reboot

```bash
./run.sh --up
```

`--up` uses the existing image and never rebuilds it. If the image is missing,
the command stops and asks you to run `./run.sh` for first installation.

### Rebuild after source or dependency changes

```bash
./run.sh --rebuild
```

`--rebuild` keeps Docker layer cache enabled, rebuilds the selected platform
image, starts it, and verifies API/CUDA access. It does not use `--no-cache` and
does not prune images, volumes, datasets, or models.

Useful commands:

```bash
./run.sh --status
./run.sh --logs
./run.sh --down
./run.sh --down_up
./run.sh --rebuild
./run.sh --detect
./run.sh --plan desktop
./run.sh --plan jetson
```

`--down_up` recreates the service from the existing image without rebuilding
the image.

`--plan` is a dry-run check. It prints the resolved runtime mode, architecture, compose file, and bind host without starting Docker.

## Runtime Modes

Desktop/x86_64:

```bash
./run.sh --mode desktop
./run.sh
```

Desktop mode uses `docker-compose.yml`, `Dockerfile`, and the x86 CUDA PyTorch base image.

Jetson/ARM64:

```bash
./run.sh --mode jetson
./run.sh
```

Jetson mode uses `docker-compose.jetson.yml`, `Dockerfile.jetson`, host networking, and NVIDIA ARM64 iGPU/L4T PyTorch images. The default Jetson base is `nvcr.io/nvidia/pytorch:25.06-py3-igpu`. Override when needed:

```bash
JETSON_BASE_IMAGE=nvcr.io/nvidia/l4t-pytorch:<tag> ./run.sh --rebuild
```

On Jetson, the app binds `127.0.0.1:8501` by default to avoid conflicts with Tailscale listeners on `100.x.x.x:8501`. Set `OBJECT_AUTOLABEL_BIND_HOST=<ip>` only when you intentionally want LAN binding.

## Data Layout

- `data/projects/<slug>/`: project-owned workspace, copied sources, labels, splits, augmentations, models, conversions, and exports.
- `data/input/`: reusable raw input media. Project deletion does not remove these files.
- `world_model/`: YOLO-World `.pt`/`.pth` weights for Pseudo.
- `input_model/`: YOLO `.pt`/`.pth` weights for Train.
- `output_model/`: global compatibility/index surface. Project entries are symlinks to `data/projects/<slug>/output_model/`.

Deleting a project package removes its DB rows, jobs, project workspace, and project model-index entry. It does not delete raw `data/input/`.

## Workflow

1. Create or select a project.
2. Sources: choose image folder or video, then run `Process & analysis`.
3. Pseudo: commit a class schema, name the pseudo build, and run YOLO-World.
4. Review: spot-check/edit boxes. Reviewed status is quality tracking; labeled data remains trainable.
5. Augment: choose `Skip augment` for a source/pass-through build, or create x3/x5/x8/x10 augmented builds.
6. Split: choose the exact pseudo and augment/source build inputs, then create train/valid/test data.
7. Train: name the training run, choose a split and input model, and watch box/class/DFL loss charts.
8. Validate: choose a current-project model source and run random-sample inference.
9. Model Convert: create ONNX/TFLite conversion packages with schema metadata and Netron preview.
10. Export: bundle native PT, selected converted artifacts, `classes.json`, and `metadata.json`.

Every producing step creates a named build/run. Downstream pages expose selectors for previous builds so the pipeline is explicit and repeatable.

## Settings

The Settings page is the workflow control center:

- Workflow defaults: pseudo model, train input model, augment default, split ratio, train device.
- Project storage: active project folder and artifact counts.
- Runtime deployment: Desktop x86_64 vs Jetson ARM64 guidance.
- Model inventory: world, input, and output model lists.

Settings defaults are UI conveniences. Each workflow tab still shows the exact build input before running.

## Verification

Common local checks:

```bash
bash -n run.sh scripts/detect-runtime.sh scripts/verify-runtime.sh
pytest -q
npm --prefix frontend test
npm --prefix frontend run build
```

Verify the running service and CUDA:

```bash
scripts/verify-runtime.sh --quick jetson
```

Run a bounded one-epoch YOLO CUDA training smoke test:

```bash
scripts/verify-runtime.sh --train jetson
```

The training smoke test uses the smallest local `.pt` file in `input_model/`;
it never downloads weights or falls back to CPU.
