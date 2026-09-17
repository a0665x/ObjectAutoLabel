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
- Install the official default YOLOE-26 Seg checkpoint: `scripts/install-world-model.sh`.
- Install the checksum-attested YOLO-World v2 Small checkpoint:
  `scripts/install-world-model.sh yolov8s-worldv2.pt`.
  The current installer rejects YOLO-World v2 M/L/X because their artifacts
  have no locally attested catalog hashes. Those filenames are backend-recognized
  only when an operator manually supplies an approved trusted artifact through
  a separate hash-controlled workflow.
- Enable private HTTPS for registered tailnet devices: start the WebUI, then run `./run.sh --tailscale-up`.
- Inspect or disable that exact route with `./run.sh --tailscale-status` and `./run.sh --tailscale-down`.

After a rebuild, verify both the local proxy target and the private HTTPS
route. The public-looking `ts.net` hostname remains tailnet-policy protected;
do not publish or substitute a raw Tailscale `100.x` HTTP URL.

```bash
curl -fsS http://127.0.0.1:8501/api/health
curl -fsS https://<device>.<tailnet>.ts.net:8501/api/health
```

## Typical Workflow

1. Create a project in the WebUI.
2. Use Sources to choose Image folder or Video mode, browse to a mounted input path, and run `Process & analysis` so counts/dimensions/extensions are understood before processing. Image folders are copied into the project workspace under `data/projects/<slug>/sources/<source_asset_id>/images/`; video frames are extracted into that source's `frames/images/` folder.
3. In Pseudo Label, assign a committed historical schema or edit a draft schema and `Commit schema to history`. Descriptors are prompt helpers only; dataset classes remain canonical ids/names.
4. Select YOLO-World, YOLO-World v2, or YOLOE-26 Seg, then name and run pseudo-labeling. YOLOE Seg results are converted to the same bbox-only labels used by the rest of the project. Use page-local progress, merge-rate, and preview feedback to judge prompt quality. That pseudo build name becomes the selectable upstream input for later pages.
5. Review annotations as a spot-check/cleanup stage. Right-click boxes for a pointer-adjacent action menu. At Fit, drag empty space to lasso; after zooming, drag empty space to pan and use Shift+drag to lasso. Use `B`/`D`/`H` for Draw/Select/Pan, hold `Ctrl/Cmd` to swap Draw and Select for one gesture, and use the Edit menu to discover all commands. `Shift+X` removes the current project image after confirmation; Undo can restore it during the session, while affected Augment/Split builds must be regenerated before new training. Save before navigating away when dirty-state confirmation appears.
6. Optionally create Augment outputs with x3/x5/x8/x10 multipliers and inspect live ± previews plus random output checks for bbox alignment.
7. Create a dataset split and inspect train/validation/test sample previews with bbox overlays.
8. Name and train a YOLO model from the selected split build. The Train page should show the live loss curve and, when complete, the exact Ultralytics `save_dir`, `best.pt`, and `last.pt` paths. The same artifacts are discoverable through the global `output_model/<project_slug>` symlink.
9. Validate the trained model with `Random sample` against a selected folder/schema/model when needed. Prefer current-project model sources from completed training runs when choosing a model.
10. On x86_64, convert the trained model to ONNX FP32 and/or LiteRT FP32. On Jetson/aarch64, copy the `.pt` checkpoint to an x86_64 host and convert it there.
11. Export a final bundle from the selected conversion package.

### Controlled one-epoch CUDA acceptance

Use an isolated project package for each lineage. A package that already has a
source, pseudo run, split, or training run is evidence, not a template to
reuse; create another empty project rather than deleting or overwriting it.
For the retained 0629 acceptance, each project owns exactly one 190-image
source and one 15-descriptor `person-car-aerial-v1` schema.

Run GPU pseudo-label and training jobs sequentially. The verified recipe uses
`yolov8s-worldv2.pt` and `yoloe-26n-seg.pt` for pseudo labeling, then a
project-local 152/19/19 split, and trains from
`yolov8n_pretrain_8020.pt` for one epoch at 640, batch 8, CUDA/device 0,
patience 10, SGD, `lr0=0.01`, and `lrf=0.01`. The accepted retry has explicit
`rect=false` and `amp=false`. The API defaults both flags to `true` for normal
requests, so record their actual values from the training run and `args.yaml`.

`diagnostics=true` is intentionally opt-in and adds aggregate, hash-only
optimizer/gradient/EMA evidence to that job's result; it does not change the
selected weights or make a run accepted. When diagnosing skipped optimizer
steps, retain the diagnostic and submit a separately named retry only after
recording the cause. Before accepting any model, verify the job state, exactly
one epoch metric, CUDA logs, project-owned `best.pt`/`last.pt`, hashes, and an
own-`best.pt` validation preview. See
[the retained 0629 report](../docs/verification/2026-08-30-0629-dual-training-acceptance.md).

## Runtime Folders

- `world_model/`: YOLO-World `.pt`/`.pth` or YOLOE-26 Seg `.pt` weights offered on the pseudo-label screen and through `GET /api/models/world`. Supported backend filenames include official YOLO-World v2 S/M/L/X and YOLOE-26 N/S/M/L/X. The checksum-verified installer catalog intentionally contains only its locally attested default (`yoloe-26n-seg.pt` plus both encoders) and `yolov8s-worldv2.pt`; it rejects v2 M/L/X rather than accept an unattested download. Operators may use v2 M/L/X only after manually placing an approved trusted artifact through a separate hash-controlled workflow. The installer verifies SHA-256 before accepting an existing/downloaded catalog file and requires an explicit expected hash for a custom URL. Pseudo labeling refuses missing encoders and unsupported filenames before it enqueues a job, so it never downloads during inference. Docker build does not populate this directory. Because the host directory is bind-mounted into the container, adding a weight does not require an image rebuild.
- `input_model/`: training input `.pt` or `.pth` weights offered on the train screen and through `GET /api/models/input`.
- `data/input/`: raw user-provided images and videos. Project deletion does not remove these files.
- `data/projects/<slug>/sources/`: copied project image sources and extracted video frames.
- `data/projects/<slug>/output_model/`: project-owned trained models, conversion packages, and export bundles.
- `output_model/`: global model index. Project entries are relative symlinks named by project slug and point to each project `output_model` directory. Loose manually copied files and unknown legacy directories may also remain here.
- `data/projects/<slug>/output_model/conversions/`: conversion packages with ONNX/TFLite artifacts, `classes.json`, and `metadata.json`.
- `data/projects/<slug>/output_model/exports/`: final export bundles created from conversion packages.
- `data/projects/<slug>/reviewed_labels/`: YOLO label files written by annotation saves.

## Dependency and Platform Discipline

- Keep `requirements.txt` with the desktop/x86_64 Dockerfile. It pins the
  ONNX and LiteRT FP32 conversion stack used by that image.
- Keep `requirements-jetson.txt` with `Dockerfile.jetson`. NVIDIA PyTorch
  `nv25.06` requires NumPy 1.x, so its `numpy>=1.26,<2`, bounded OpenCV,
  and lack of converter packages are deliberate.
- Do not copy desktop dependency pins to Jetson or vice versa. Update a file
  only when the corresponding image's resolved dependency state changes, then
  rebuild that same platform and repeat runtime/CUDA verification.
- Ultralytics package auto-install is disabled in both images. Converter
  dependencies must be present from the x86_64 image build; conversion jobs
  never install or repair packages at runtime.
- MuSGD remains available as a training optimizer on supported training
  runtimes; the x86_64-only rule applies to Model Convert, not Train.

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
- No model is offered on Pseudo after a fresh build: Docker does not download weights. Run `scripts/install-world-model.sh` for `yoloe-26n-seg.pt`, or `scripts/install-world-model.sh yolov8s-worldv2.pt` for the attested v2 Small checkpoint. The installer rejects v2 M/L/X; supply those backend-recognized filenames manually only through an approved trusted artifact/hash workflow. Then refresh the page; an image rebuild is not required.
- Model not found: ensure the selected `.pt` or `.pth` file still exists in `world_model/`, `input_model/`, or `output_model/`, depending on the screen.
- Video path not found: the browser path must be a container-visible path such as `/app/data/input/file.mp4`.
- LAN URL mismatch: `run.sh` auto-detects the primary LAN IPv4. If a specific wired address is required, run `OBJECT_AUTOLABEL_BIND_HOST=<ip> ./run.sh --down_up`. Check current host addresses with `ip -4 addr show`.
- Jetson container cannot bind `0.0.0.0:8501`: another interface-specific listener, often Tailscale serve on `100.x.x.x:8501`, can make wildcard bind fail. Use the Jetson compose default `OBJECT_AUTOLABEL_BIND_HOST=127.0.0.1` for the local WebUI at `http://127.0.0.1:8501/`.
- Tailscale URL works through HTTPS serve. Do not assume `http://100.94.21.85:8501` is the public URL; use the `tailscale serve status` hostname/port.
- Tailscale Serve conflict: ObjectAutoLabel owns HTTPS `8501` only. The launcher leaves `443` and every other project port untouched, and refuses an unrelated route already occupying `8501`. Inspect `tailscale serve status --json` before changing shared host routing.
- Netron "Please update to the newest version": the proxy rewrites Netron's 180-day packaged-age gate. If the message returns, verify `/api/netron/browser.js` contains `days > 36500`, not `days > 180`.
- Annotation save rejected: bbox coordinates must remain normalized and inside image bounds; invalid rectangles return HTTP 422 and do not update the label file.
- Desktop build fails importing LiteRT with `Parameter shape has an unsupported default value`: the former PyTorch 2.4.1 base is incompatible with LiteRT Torch 0.9.0. Use the updated desktop Dockerfile (PyTorch 2.11.0 / CUDA 12.8) and run `OBJECT_AUTOLABEL_MODE=desktop ./run.sh --rebuild`. Normal layer caching is supported; deleting Docker caches or disabling the import check is unnecessary.
- ONNX/LiteRT export errors on x86_64: verify the converter dependencies from `requirements.txt` were installed when the image was built. Do not enable runtime package installation; rebuild the desktop image after an intentional dependency change.
- Model Convert is unavailable on Jetson/aarch64: copy the `.pt` checkpoint to an x86_64 host and convert it there. Do not add converter packages to the Jetson runtime as a workaround.
- Project appears in UI after manual folder deletion: this means the SQLite project row still exists. The Projects page should auto-detect the missing workspace/index as `Stale project record`; use `Clean stale DB record` to remove DB/job rows while preserving `data/input`. Use `Delete project package` for healthy projects when you want the app to remove DB rows plus project workspace/model index together.
