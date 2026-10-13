# ObjectAutoLabel

[繁體中文](README.md) · English

A local-first workspace for object-detection datasets and models. Prepare images or video, generate pseudo labels, review boxes, augment and split data, train YOLO models, and export results in one WebUI.

![Interface preview](demo_imgs/interface_preview.gif)

## Quick start

Requires Linux, Docker Compose, and an NVIDIA GPU runtime (driver and NVIDIA Container Toolkit). Supports x86_64 desktops and Jetson ARM64; the Jetson image must match the host's JetPack/L4T version.

```bash
git clone https://github.com/a0665x/ObjectAutoLabel.git
cd ObjectAutoLabel

# Install the pseudo-label model and prompt encoders; first download needs internet
scripts/install-world-model.sh

# Install YOLO11n starting weights
scripts/install-input-model.sh

# First installation: select the platform, build the image, and start
./run.sh
```

Open [http://127.0.0.1:8501/](http://127.0.0.1:8501/). On Jetson, use the LAN address printed by the launcher.

Bare `./run.sh` builds and starts only when the image is missing. With an existing image:

| Action | Command |
| --- | --- |
| Start, including after reboot; no rebuild | `./run.sh --up` |
| Rebuild and start after code updates | `./run.sh --rebuild` |
| Status / logs | `./run.sh --status` / `./run.sh --logs` |
| Stop | `./run.sh --down` |
| Select platform | `./run.sh --mode desktop` / `./run.sh --mode jetson` |

Rebuilding interrupts running jobs; wait for training and other tasks to finish. It does not clear datasets or models.

## Data and models

Place image folders or videos in `data/input/`, then select them in Sources. The corresponding container path is `/app/data/input/`.

```text
data/input/        Original images and videos
data/projects/     Project images, labels, splits, and model outputs
data/opendata/     Shared public-dataset cache
world_model/       Pseudo-label models and prompt encoders
input_model/       Training starting weights
output_model/      Project model index
```

Optional models:

```bash
# Use YOLO-World v2 Small for pseudo labeling
scripts/install-world-model.sh yolov8s-worldv2.pt

# Add YOLO26n training weights
scripts/install-input-model.sh yolo26n.pt
```

Installers verify SHA-256 checksums. Model folders are bind-mounted: refresh the browser after adding weights; no rebuild is needed. Datasets, weights, secrets, and runtime logs are excluded from Git.

## Workflow

1. **Projects**: create or select a project.
2. **Sources**: select an image folder or video, run Process & analysis, then assign a version in Source history. Videos support frame extraction; processing the same path again requires confirmation.
3. **Pseudo Label**: commit classes and prompts, confirm the assigned Source, select a model, and generate labels. Merge boxes from same-class prompts and optionally exclude oversized boxes using the area histogram's draggable range. Auto computes the range from each new inference run.
4. **Review**: inspect and edit the assigned Pseudo/Augment versions. Reuse copies the most recently saved compatible label group within the same Source/version, whether the destination is blank or already labeled. Same-class IoU > 0.8 keeps the destination's existing box; Reuse follows the last Review Merge threshold. Check and save the result.
5. **Augment**: select the Pseudo version and configure effects and multiplier, or use Skip augment.
6. **Open Data (optional)**: import VisDrone or an Ultralytics Platform Detect dataset, then map classes and sample. Platform requires an API key. Open Data bypasses Pseudo/Augment.
7. **Split**: add one or more parallel Pseudo → Augment groups in Dataset sources, optionally with one Open Data version. Check counts and ratios, save and assign the composition, then build a Split version. Existing Open Data train/validation groups are preserved.
8. **Train**: choose a valid Split, starting model, and parameters. Monitor or cancel jobs in Task Center.
9. **Validate → Convert / Export**: check random samples, convert, and download a model package. x86_64 supports ONNX/LiteRT FP32; move Jetson PT weights to an x86_64 host for conversion.
10. **Stream Demo**: run PT, ONNX, or LiteRT inference on a camera or uploaded video.

**Assign & history** persists version choices. Review's Pseudo and Augment views use their respective assignments. Upstream annotation changes may invalidate affected Splits; rebuild before starting new training.

## Review shortcuts

| Action | Shortcut |
| --- | --- |
| Select / Draw / Pan | `D` / `B` / `H` |
| Save and next | `N` or `Shift+S` |
| Save | `Ctrl/Cmd+S` |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` |
| Copy / Paste / Duplicate selected boxes | `Ctrl/Cmd+C` / `Ctrl/Cmd+V` / `Ctrl/Cmd+D` |
| Delete selected boxes | `Delete` / `Backspace` |
| Multi-select / Zoom | `Shift+drag` / `Ctrl+wheel` |
| Remove a project image (confirmation required) | `Shift+X` |

Reuse supports Undo, and repeated clicks do not add identical boxes. Right-click a box for editing actions.

## Important notes

- Deleting a project or Source history preserves originals in `data/input/`. Deleting upstream history also deletes dependent downstream outputs; read the confirmation carefully.
- Intended for trusted local/private-network use. The CLI is a real shell with mounted-data access: protect its token and do not expose the service directly to the public internet.
- For private remote access, use `./run.sh --tailscale-up`. Optional sign-in settings are in [.env.example](.env.example); sign-in does not currently isolate projects between users.

## Development and documentation

FastAPI + SQLite + React/TypeScript + Vite. See [project structure](spec/PROJECT_MAP.md), [deployment and troubleshooting](spec/OPERATIONS.md), and [CLI usage](cli_workspace/README.md).

```bash
# Install the appropriate test dependencies first; use the project Docker environment for backend tests
pytest -q
npm --prefix frontend test -- --run --maxWorkers=1
npm --prefix frontend run build
```

## License

[AGPL-3.0](LICENSE). Network-hosted modified versions must provide corresponding source as required by the license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
