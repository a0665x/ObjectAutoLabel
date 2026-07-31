# Current Status

Last updated: 2026-07-31.

## Runtime State

- Dockerized WebUI is running from `object-autolabel:jetson` image
  `sha256:53aa405e858f...` with restart count 0. Local health is verified at
  `http://127.0.0.1:8501/api/health` with
  `{"ok":true,"project_root":"/app"}`.
- The local AGX Orin host is `aarch64`, L4T `36.4.7`, JetPack `6.2`. The
  container reports PyTorch `2.8.0a0+5228986c39.nv25.06`, CUDA `12.9`,
  `torch.cuda.is_available() == True`, and device `Orin`.
- A bounded one-epoch YOLO11n run completed with `device=0`, about `0.156G`
  GPU memory, and verified `best.pt`/`last.pt`. See
  [Jetson CUDA training acceptance](references/lesson-20260731-jetson-docker-cuda-training.md).
- The currently visible DB project is `0706_retrain[opendata_pretrain_model]` with slug `0706-retrain-opendata-pretrain-model` and id `a5ed751e799b47f09f8be5f242c680c3`.
- Tailscale hostname used during recent smoke tests: `http://agx-monitor.tail9e662c.ts.net:8501/`. Tailscale reachability can vary if the daemon/serve state changes; verify with `tailscale status`, `ss -ltnp | grep 8501`, and `/api/health` when exposing to another device.
- `docker-compose.jetson.yml` binds the app for external access when needed; avoid assuming a stale LAN IP. Prefer checking live host addresses with `ip -4 addr show`.

## Recently Fixed / Added

- Project lifecycle is project-package oriented: healthy `Delete project package` removes the DB row, job history, project workspace, and project model-index entry while preserving raw `data/input`.
- Manual deletion of `data/projects/<slug>/` is detected as stale storage. Projects page auto-refreshes storage status and offers `Clean stale DB record` for missing workspace/output-index rows.
- Sources page has Image folder/Video toggle, local file manager defaults/shortcuts, `Use this folder`, source analysis, and conditional video frame-extraction settings.
- Pseudo Label integrates class schema editing/history. Operators assign an existing committed schema or edit a draft and `Commit schema to history`; duplicate schema names warn and use id suffixes in dropdowns. The old teaching-style `1 -> 2 -> 3A/3B -> 4` graph has been replaced by current-condition summary plus `?` tooltips.
- Pseudo Label Generate has page-local immediate feedback, duplicate/restart affordance, schema/model/merge condition display, progress/message, latest preview, and merge-rate style run context.
- Review workbench includes loading overlay when switching images, stale-box prevention, right-click context menu, multi-box selection, bulk class edit/delete, `Delete` shortcut, and dirty-state navigation confirmation.
- Augment page uses x3/x5/x8/x10 dataset multiplier, Hue/Exposure/Blur/Noise/Camera Gain/BBox Motion Blur/Random Rotation controls, live ± previews with bbox overlays, label-aware flip/rotation, and random generated-output checks.
- Split page can preview train/validation/test sampled images with bbox overlays.
- Train page has explicit parameter explanations and training progress feedback from job messages/callbacks where available.
- Validate page has a `Random sample` action instead of Chinese dice text and shows selected model/schema/folder plus prediction overlays.
- Workflow Guide is clickable, artifact-aware, mobile-safe via horizontal scrolling/wrapping, and treats Review/Validate as spot-check stages rather than hard blocking gates.
- Desktop/Mobile top-bar toggle remains available for iPhone-width layout preview.
- Netron preview is same-origin through `/api/netron/...`; packaged-age/version gate rewrites remain part of the proxy behavior.

## Data Path State

- Raw user media should live under `data/input/`. Project deletion and stale cleanup must not remove this directory.
- Image-folder sources are copied into `data/projects/<slug>/sources/<source_asset_id>/images/` before images are registered.
- Video frame extraction writes into `data/projects/<slug>/sources/<source_asset_id>/frames/images/`.
- Pseudo labels, reviewed labels, splits, augmentations, training output, conversion output, and export bundles are project-local under `data/projects/<slug>/`.
- Project-owned models live under `data/projects/<slug>/output_model/`.
- Global `output_model/<project_slug>` entries are relative symlinks pointing to `../data/projects/<slug>/output_model`.
- Existing legacy paths under `output_model/<project_id>` are migrated on app startup when they match a current project id. Unknown loose global `output_model/` files/directories should be treated as legacy/manual model sources and not deleted without explicit user instruction.

## Verification Commands

Fresh 2026-07-31 runtime acceptance:

```bash
OBJECT_AUTOLABEL_MODE=jetson ./run.sh --rebuild
scripts/verify-runtime.sh --quick jetson
scripts/verify-runtime.sh --train jetson
```

The final accepted training run sampled `MemAvailable` at `14780928 kB` before
and `14745600 kB` after. This bounded single-run difference is not a memory-leak
claim. The amd64 Compose/config path passed static validation but was not run on
amd64 NVIDIA hardware.

The following were reported passing during the latest UI/UX iteration:

```bash
npm --prefix frontend test -- --run
npm --prefix frontend run build
python3 -m py_compile backend/app/main.py backend/app/project_services.py backend/app/schemas.py
docker compose -f docker-compose.jetson.yml build object-autolabel
docker compose -f docker-compose.jetson.yml up -d --force-recreate object-autolabel
curl -fsS http://127.0.0.1:8501/api/health
```

Focused backend repository tests in Docker reported 11 passed; frontend full Vitest suite reported 54 passed.

## Caveats For Next Agent

- Always read `spec/PROJECT_MAP.md`, then `spec/UI.md`, `spec/DATA_MODEL.md`, `spec/API.md`, and this status file before changing UI/data lifecycle behavior.
- Do not treat Review completion as a hard prerequisite for training; current UX treats it as spot-check/quality control unless requirements change.
- If a project appears in UI after manual folder deletion, use storage-status / cleanup-stale behavior rather than manually editing SQLite.
- In-progress backend jobs continue when switching pages; navigation prompts are for unsaved client edits, not job cancellation.
- Tailscale URL smoke can fail because of Tailscale daemon/serve state even when local app health is OK. Verify local health first, then network exposure.
- Netron is served by an internal server on port `8081`, but browsers should only use `/api/netron/...`.
