# ObjectAutoLabel

ObjectAutoLabel is a local-first offline labeling workbench. It runs a FastAPI backend and React/Vite frontend for frame extraction, YOLO-World pseudo-labeling, review and cleanup, dataset split generation, YOLO training, and model export without depending on an online labeling service.

## Run

```bash
./run.sh --up
```

Open `http://localhost:8501`.

On Jetson Orin AGX, `./run.sh --up` opens an interactive mode selector. Choose `jetson`. To set it without the selector:

```bash
./run.sh --mode jetson
./run.sh --up
```

Supported lifecycle commands:

```bash
./run.sh --up
./run.sh --down
./run.sh --down_up
./run.sh --logs
./run.sh --status
./run.sh --detect
```

`./run.sh --detect` reports the detected architecture, L4T/JetPack version, compose file, and selected Jetson base image.

Jetson mode defaults to `nvcr.io/nvidia/pytorch:25.06-py3-igpu`, which is an ARM64 iGPU PyTorch image for JetPack 6.2. If your JetPack/L4T version needs a different NVIDIA base image, override it before starting:

```bash
JETSON_BASE_IMAGE=nvcr.io/nvidia/l4t-pytorch:<tag> ./run.sh --up
```

The supported production path is Docker. Image builds compile the frontend into `frontend/dist` inside the container, and FastAPI serves those built assets on port `8501`.

For local frontend development, run Vite separately and let its dev proxy talk to `http://127.0.0.1:8501`.

## Data Layout

- `data/projects/`: local project state, registered sources, reviewed labels, and dataset splits.
- `world_model/`: YOLO-World `.pt` weights used for pseudo-labeling.
- `input_model/`: YOLO `.pt` weights used as training inputs.
- `output_model/`: trained and exported model artifacts produced by this app.
- `runs`: Ultralytics training outputs.

The model folders are gitignored and may be absent on a clean clone. Docker Compose mounts them into the container at runtime.

## Workflow

1. Create a local project.
2. Register an image folder or video source.
3. Extract frames from videos when needed.
4. Define class schema descriptors.
5. Run YOLO-World pseudo-labeling into the review queue.
6. Review, edit, relabel, and save annotations to `reviewed_labels/`.
7. Create reviewed-only dataset splits.
8. Train from `input_model/` and export into `output_model/`.

## API Shape

The WebUI calls long-running FastAPI jobs and polls `/api/jobs/{id}`. Current core endpoints are:

- `POST /api/projects/{project_id}/frame-runs`
- `POST /api/projects/{project_id}/pseudo-label-runs`
- `GET /api/projects/{project_id}/images`
- `PUT /api/images/{image_id}/annotations`
- `POST /api/projects/{project_id}/dataset-splits`
- `POST /api/projects/{project_id}/training-runs`
- `POST /api/projects/{project_id}/model-exports`
