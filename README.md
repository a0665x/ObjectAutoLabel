# ObjectAutoLabel

ObjectAutoLabel is a Streamlit-free migration of the original `yoloworld/streamlit` workflow. It provides a FastAPI backend and a professional single-page WebUI for video frame extraction, YOLO-World auto-labeling, Roboflow dataset iteration, YOLO training, and model export.

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

## Data Layout

- `data/input`: put source videos or image folders here.
- `data/output`: generated frames, labels, and bbox preview images.
- `data/datasets`: Roboflow downloads or prepared YOLO datasets.
- `models`: YOLO-World `.pt` models used by auto-labeling.
- `yolo_model`: standard YOLO `.pt` models used for training and conversion.
- `runs`: Ultralytics training outputs.

## API Shape

The WebUI calls long-running FastAPI jobs and polls `/api/jobs/{id}`. Core endpoints are:

- `POST /api/video/frames`
- `POST /api/config/autolabel`
- `POST /api/autolabel/run`
- `POST /api/roboflow/upload`
- `POST /api/roboflow/download`
- `POST /api/train`
- `POST /api/convert`
