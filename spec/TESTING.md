# Testing

## Current Validation

This project currently has smoke-test and focused unit/integration validation:

- Shell syntax check for `run.sh`.
- Runtime launcher tests cover first-install image detection, English platform
  labels, non-building `--up`/`--down_up`, cached `--rebuild`, architecture
  mismatch rejection, cross-platform planning, and detector-output injection.
- Runtime verification tests cover health, running-image identity, mandatory
  PyTorch CUDA, local-only model selection, `device=0`, and output-weight
  checks.
- Docker Compose config validation when Docker is available.
- Backend pytest coverage for repositories, jobs, DB schema, annotations API, model listing, project services, label IO, and YOLO-World helpers.
- Backend pytest coverage for model conversion package records, conversion manifests, export bundles, and conversion API endpoints.
- Backend pytest coverage for project-local source copies, frame extraction output path selection, project `output_model` symlink creation/deletion, legacy project-id output migration, and Netron proxy asset rewrites.
- Backend pytest coverage for stale project storage detection/cleanup and project-local data lifecycle safeguards.
- Frontend TypeScript/Vite build and Vitest coverage for review-state, annotation reducer, geometry helpers, canvas affordance behavior, model conversion UI helpers, stale project cleanup UI, pseudo-label generate feedback, augmentation controls, workflow navigation, and validation random-sample UI.

## Verification Commands

```bash
pytest -v
npm --prefix frontend test
npm --prefix frontend run build
bash -n run.sh scripts/detect-runtime.sh scripts/verify-runtime.sh
python3 -m py_compile backend/app/main.py backend/app/repositories.py backend/app/project_services.py backend/app/server.py
docker compose -f docker-compose.yml config
docker compose -f docker-compose.jetson.yml config
```

Running-container acceptance:

```bash
scripts/verify-runtime.sh --quick jetson
scripts/verify-runtime.sh --train jetson
```

The training acceptance requires a local `.pt` weight in `input_model/`. It
runs one bounded CUDA epoch and verifies `best.pt`/`last.pt`; it does not
download weights or accept a CPU fallback. On Jetson, interpret memory through
`/proc/meminfo` `MemAvailable`, not discrete-GPU `nvidia-smi` VRAM fields.

`npm --prefix frontend run build` writes `frontend/dist/`; that build output remains ignored by git.

Latest verified counts from the 2026-07-06 UI/UX iteration:

- backend repository tests in Docker: 11 passed.
- frontend full Vitest suite: 54 passed.
- `npm --prefix frontend run build`: passed.
- Docker Jetson build/recreate and local runtime health passed. See [Current Status](STATUS.md) for URL caveats.

## Gaps

- No automated integration test covers YOLO-World inference yet.
- No browser-level end-to-end automation covers the review workbench interactions.
- Frontend coverage remains focused on review utilities rather than full-screen interaction flows.
- Netron is verified through backend proxy responses and endpoint checks, not through full browser canvas automation.
