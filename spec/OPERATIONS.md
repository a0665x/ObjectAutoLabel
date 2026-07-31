# Operations

## Common Tasks

- First install: `./run.sh`; select `x86_64 / amd64` or
  `Jetson / aarch64`.
- Normal start after reboot: `./run.sh --up` (never builds).
- Rebuild after code/dependency changes: `./run.sh --rebuild` (uses cache).
- Stop: `./run.sh --down`.
- Recreate container from the existing image: `./run.sh --down_up`.
- Logs: `./run.sh --logs`.
- Status: `./run.sh --status`.
- Set Jetson mode: `./run.sh --mode jetson`.
- Set desktop mode: `./run.sh --mode desktop`.
- Inspect auto-detection: `./run.sh --detect`.
- Dry-run runtime plan without Docker: `./run.sh --plan desktop` or `./run.sh --plan jetson`.
- Verify health/CUDA: `scripts/verify-runtime.sh --quick jetson`.
- Verify bounded YOLO CUDA training:
  `scripts/verify-runtime.sh --train jetson`.

## Typical Workflow

1. Create a project in the WebUI.
2. Use Sources to choose Image folder or Video mode, browse to a mounted input path, and run `Process & analysis` so counts/dimensions/extensions are understood before processing. Image folders are copied into the project workspace under `data/projects/<slug>/sources/<source_asset_id>/images/`; video frames are extracted into that source's `frames/images/` folder.
3. In Pseudo Label, assign a committed historical schema or edit a draft schema and `Commit schema to history`. Descriptors are prompt helpers only; dataset classes remain canonical ids/names.
4. Name and run YOLO-World pseudo-labeling. Use page-local progress, merge-rate, and preview feedback to judge prompt quality. That pseudo build name becomes the selectable upstream input for later pages.
5. Review annotations as a spot-check/cleanup stage. Right-click boxes to change class/delete, drag-select multiple boxes for bulk edits, and save before navigating away when dirty-state confirmation appears.
6. Optionally create Augment outputs with x3/x5/x8/x10 multipliers and inspect live ± previews plus random output checks for bbox alignment.
7. Create a dataset split and inspect train/validation/test sample previews with bbox overlays.
8. Name and train a YOLO model from the selected split build. The Train page should show the live loss curve and, when complete, the exact Ultralytics `save_dir`, `best.pt`, and `last.pt` paths. The same artifacts are discoverable through the global `output_model/<project_slug>` symlink.
9. Validate the trained model with `Random sample` against a selected folder/schema/model when needed. Prefer current-project model sources from completed training runs when choosing a model.
10. Convert the trained model into a conversion package with selected ONNX/TFLite precision targets.
11. Export a final bundle from the selected conversion package.

## Runtime Folders

- `world_model/`: YOLO-World `.pt` or `.pth` weights offered on the pseudo-label screen and through `GET /api/models/world`.
- `input_model/`: training input `.pt` or `.pth` weights offered on the train screen and through `GET /api/models/input`.
- `data/input/`: raw user-provided images and videos. Project deletion does not remove these files.
- `data/projects/<slug>/sources/`: copied project image sources and extracted video frames.
- `data/projects/<slug>/output_model/`: project-owned trained models, conversion packages, and export bundles.
- `output_model/`: global model index. Project entries are relative symlinks named by project slug and point to each project `output_model` directory. Loose manually copied files and unknown legacy directories may also remain here.
- `data/projects/<slug>/output_model/conversions/`: conversion packages with ONNX/TFLite artifacts, `classes.json`, and `metadata.json`.
- `data/projects/<slug>/output_model/exports/`: final export bundles created from conversion packages.
- `data/projects/<slug>/reviewed_labels/`: YOLO label files written by annotation saves.

## Failure Modes

- `exec /bin/sh: exec format error`: wrong Docker base image architecture. On Jetson, run `./run.sh --mode jetson`, then `./run.sh --down_up`.
- `Selected platform ... does not match host ...`: choose the platform matching
  the current CPU. Cross-platform inspection is available through `--plan`;
  actual build/start is intentionally blocked.
- `The selected platform image is not installed`: run bare `./run.sh` for
  first installation. Do not turn routine `--up` into an implicit rebuild.
- `Jetson startup requires the NVIDIA Docker runtime`: check `docker info` on
  the host outside restricted sandboxes; a sandbox may hide the Docker socket.
- `l4t-pytorch:* not found`: JetPack 6+ uses NVIDIA PyTorch `*-py3-igpu` containers instead of newer `l4t-pytorch` tags. The Jetson default is `nvcr.io/nvidia/pytorch:25.06-py3-igpu`.
- Wrong image selected: run `./run.sh --detect` and verify architecture, L4T, JetPack, and `JETSON_BASE_IMAGE`. Override with `JETSON_BASE_IMAGE=... ./run.sh --rebuild` if needed.
- x86/Jetson uncertainty: run `./run.sh --plan desktop` and `./run.sh --plan jetson`. Desktop should resolve to `docker-compose.yml`; Jetson should resolve to `docker-compose.jetson.yml` plus a Jetson base image and bind host.
- `gpus: all` fails: NVIDIA Container Toolkit is missing or Docker cannot access GPU.
- Container is healthy but training is uncertain: run
  `scripts/verify-runtime.sh --train jetson`. Container startup and
  `torch.cuda.is_available()` alone do not prove Ultralytics can complete a
  CUDA training run.
- Model not found: ensure the `.pt` or `.pth` file exists in `world_model/`, `input_model/`, or `output_model/`, depending on the screen.
- Video path not found: the browser path must be a container-visible path such as `/app/data/input/file.mp4`.
- LAN URL mismatch: `run.sh` auto-detects the primary LAN IPv4. If a specific wired address is required, run `OBJECT_AUTOLABEL_BIND_HOST=<ip> ./run.sh --down_up`. Check current host addresses with `ip -4 addr show`.
- Jetson container cannot bind `0.0.0.0:8501`: another interface-specific listener, often Tailscale serve on `100.x.x.x:8501`, can make wildcard bind fail. Use the Jetson compose default `OBJECT_AUTOLABEL_BIND_HOST=127.0.0.1` for the local WebUI at `http://127.0.0.1:8501/`.
- Tailscale URL works through HTTPS serve. Do not assume `http://100.94.21.85:8501` is the public URL; use the `tailscale serve status` hostname/port.
- Netron "Please update to the newest version": the proxy rewrites Netron's 180-day packaged-age gate. If the message returns, verify `/api/netron/browser.js` contains `days > 36500`, not `days > 180`.
- Annotation save rejected: bbox coordinates must remain normalized and inside image bounds; invalid rectangles return HTTP 422 and do not update the label file.
- TFLite export errors: TensorFlow/ONNX conversion dependencies are sensitive to model type and installed versions.
- Jetson TFLite export dependencies are preinstalled in the image through `requirements-jetson.txt`; if they are missing, conversion fails fast instead of letting Ultralytics run a long runtime `pip install`.
- Project appears in UI after manual folder deletion: this means the SQLite project row still exists. The Projects page should auto-detect the missing workspace/index as `Stale project record`; use `Clean stale DB record` to remove DB/job rows while preserving `data/input`. Use `Delete project package` for healthy projects when you want the app to remove DB rows plus project workspace/model index together.
