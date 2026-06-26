# Operations

## Common Tasks

- Start: `./run.sh --up`.
- Stop: `./run.sh --down`.
- Rebuild clean container: `./run.sh --down_up`.
- Logs: `./run.sh --logs`.
- Status: `./run.sh --status`.
- Set Jetson mode: `./run.sh --mode jetson`.
- Set desktop mode: `./run.sh --mode desktop`.
- Inspect auto-detection: `./run.sh --detect`.

## Typical Workflow

1. Create a project in the WebUI.
2. Register an image folder or video path visible to the container.
3. Extract frames when the source is a video.
4. Create a class schema with YOLO class ids, names, and descriptors.
5. Run YOLO-World pseudo-labeling.
6. Review and save annotations.
7. Create a dataset split.
8. Train a YOLO model and collect outputs from `runs/detect` and `output_model`.
9. Export the trained model if deployment needs ONNX, TFLite, or TorchScript.

## Failure Modes

- `exec /bin/sh: exec format error`: wrong Docker base image architecture. On Jetson, run `./run.sh --mode jetson`, then `./run.sh --down_up`.
- `l4t-pytorch:* not found`: JetPack 6+ uses NVIDIA PyTorch `*-py3-igpu` containers instead of newer `l4t-pytorch` tags. The Jetson default is `nvcr.io/nvidia/pytorch:25.06-py3-igpu`.
- Wrong image selected: run `./run.sh --detect` and verify architecture, L4T, JetPack, and `JETSON_BASE_IMAGE`. Override with `JETSON_BASE_IMAGE=... ./run.sh --up` if needed.
- `gpus: all` fails: NVIDIA Container Toolkit is missing or Docker cannot access GPU.
- Model not found: ensure the `.pt` file exists in `world_model/`, `input_model/`, or `output_model/`, depending on the screen.
- Video path not found: the browser path must be a container-visible path such as `/app/data/input/file.mp4`.
- TFLite export errors: TensorFlow/ONNX conversion dependencies are sensitive to model type and installed versions.
