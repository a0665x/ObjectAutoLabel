# Current Status

Last updated: 2026-09-14.

## Runtime State

- The previously active 100-epoch GPU training job completed before deployment. The Open Data versioning, Train configuration retention, explicit folder assignment, multi-image Validate sampling, and probabilistic Mirror stack are deployed in the live container.
- Dockerized WebUI is running from `object-autolabel:jetson` image
  `sha256:96ad331160b7f911773733a228eff84a4324a359e5af8002da727052618464d3`
  with restart count 0. The 2026-09-05 rebuild selected LAN bind
  `192.168.1.105:8501`; container-internal `/api/health` returned
  `{"ok":true,"project_root":"/app"}` and browser smoke succeeded through the
  loopback proxy at `http://127.0.0.1:8501/`. Use the bind host reported by
  `./run.sh --status` rather than assuming a historical address.
- The final offline runtime smoke loaded `yolov8s-worldv2.pt` and
  `yoloe-26n-seg.pt` on Orin with network access blocked. Both the direct
  CLIP cache and Ultralytics `WEIGHTS_DIR/clip` alias resolve to the retained
  `world_model/ViT-B-32.pt`.
- The local AGX Orin host is `aarch64`, L4T `36.4.7`, JetPack `6.2`. The
  container reports PyTorch `2.8.0a0+5228986c39.nv25.06`, CUDA `12.9`,
  `torch.cuda.is_available() == True`, and device `Orin`.
- A bounded one-epoch YOLO11n run completed with `device=0`, about `0.156G`
  GPU memory, and verified `best.pt`/`last.pt`. See
  [Jetson CUDA training acceptance](references/lesson-20260731-jetson-docker-cuda-training.md).
- The retained final-inspection projects are
  `acceptance_0629_worldv2s_20260830_v001` and
  `acceptance_0629_yoloe26n_20260830_v001`; the former was active during the
  final deployed Review inspection. Older project records remain historical
  data, not the current acceptance context.
- Private Tailscale HTTPS uses the dedicated external port `8501`, for example `https://<current-device>.tail9e662c.ts.net:8501/`; the launcher leaves shared HTTPS `443` untouched. Tailscale reachability can vary if the daemon/serve state changes; verify with `./run.sh --tailscale-status`, `tailscale status`, and `/api/health` when exposing to another device.
- With `run.sh`, an unset Jetson bind host is auto-detected from the primary
  LAN IPv4; an explicit `OBJECT_AUTOLABEL_BIND_HOST` overrides it. The server
  safely falls back to loopback when an explicitly configured address is no
  longer bindable. Avoid assuming a stale LAN IP; inspect the launcher output
  or live host addresses instead.

## Recently Fixed / Added

- Model source and Conversion option labels now use compact named lineage instead of embedding classes, hyperparameters, ids, timestamps, status, and image counts. Train keeps one authoritative Submitted training configuration and no longer shows a contradictory hard-coded parameter summary.
- Pseudo, Augment, Split, Training, Conversion, and Export histories now have confirmed downstream-cascade deletion. Active jobs are protected, selectors refresh after deletion, Current Split is re-elected, and cleanup is constrained to unshared project-owned artifact directories.
- Ultralytics Platform Dataset URL entry now links to the official public Explore page for dataset discovery; compatibility inspection still accepts Detect/bbox only.
- Ultralytics Platform image downloads now tolerate transient TCP/storage failures with four-attempt exponential backoff and four concurrent workers. Verified staging survives network failures and resumes only when the refreshed NDJSON export hash matches; expired signed URLs and storage throttling receive distinct errors.

- Sources and Validate now distinguish browser navigation from an assigned path. Both begin with an explicit unassigned state; the simplified browser keeps path shortcuts, hides image-file rows and repetitive per-folder match text, omits the `.. parent` control, and uses compact navigation/confirmation buttons.
- Validate accepts a 1–12 random sample count (default 1), returns unique images in one request, loads the selected model once, and renders all results in a responsive grid.
- Mirror is now a normal Augment stack effect with one direction and a per-generated-image probability (default 50%). Existing saved mirror booleans migrate to an equivalent 100% stack effect.

- Added the optional VisDrone2019-DET Open Data workflow: one verified shared download, complete visual class mapping, mapping-first deterministic sampling, bbox preview/composition, retained named project import versions, Review-active filtering, explicit Split version selection, and official train/val preservation.
- Open Data now also accepts one Ultralytics Platform public Dataset URL at a time. Metadata inspection gates the workflow to Detect/bbox, NDJSON exports normalize into the existing mapping/Review/Split/Train contract, and Detect sources without Val use a deterministic 90/10 fallback. Non-Detect datasets such as VSAI OBB are stopped before download with a clear explanation.
- Open Data source selection is split into `Official datasets` and `Ultralytics Platform`. Official sources are curated, tested adapters with no arbitrary URL or API key; Platform URL inspection and request-only authentication are shown only in Platform mode. Both modes converge on the same mapping, preview, version, Review, and Split workflow.
- Open Data is excluded from Augment. Its project-derived data and Review edits are removable with the project, while `data/opendata/visdrone2019-det/` remains reusable.
- Split promotes each new immutable snapshot to Current Split while retaining earlier saved versions. Train defaults to Current Split and can select any non-outdated saved version; invalidated versions remain visible only in Split history. New builds use `Split_YYYYMMDD_HHMMSS` names and color-coded Pseudo/Augment/Open Data lineage with total image counts.
- Split and Open Data previews now begin with random samples and expose a dice reroll. Preview seeds never alter saved split membership or the deterministic Open Data selection.
- Train parameters no longer reset during job/artifact refresh. A locked submitted-configuration card remains on screen, and exact hyperparameters are persisted in `training_runs.settings_json` for later reload.
- The pinned Ultralytics `8.4.130` runtime resolves YOLO11, YOLO12, and YOLO26 Detect architectures through the same `YOLO(...).train(...)` path. NMS-free/model-head differences remain owned by Ultralytics; local pretrained checkpoints must still be placed in `input_model/`.
- Added daily structured runtime/job/access logs plus launcher capture under `logs/YYYY-MM-DD/`, with secret/path redaction, size rotation, and 30-day retention.
- When POSIX ACL support is available, the launcher gives only the current host account inherited write access to `logs/`; this lets launcher capture coexist with container-created date folders without making logs writable by every local account.

- Review now has deterministic pointer capture and frame-coalesced previews:
  Draw can start inside an existing bbox, previews are solid, cancellation does
  not commit, invalid coordinates never fall back to `(0,0)`, and zoomed empty
  background drag pans without changing the persistent tool.
- Review uses one discoverable Edit command registry. `D`/`B`/`H` choose tools;
  `Ctrl/Cmd` gates Draw/Select for one gesture; Copy/Paste/Duplicate,
  Undo/Redo, Save, Delete, Escape, queue navigation, and nudge shortcuts share
  handlers with visible controls. `Ctrl/Cmd+D` duplicates; it does not switch
  annotation modes.
- `Shift+X` removes the current image from the project after confirmation and
  session Undo restores it while recoverable. Removed images leave normal
  queues, raw input remains untouched, affected Augment/Split builds become
  outdated, and new training from an outdated split is blocked.
- Train exposes explicit optimizer order SGD, MuSGD, Adam, AdamW and forwards
  MuSGD unchanged to the pinned Ultralytics trainer.
- Model Convert is intentionally simplified: x86_64 offers only official
  Ultralytics ONNX FP32 and LiteRT FP32; Jetson/aarch64 offers neither and tells
  the operator to copy the `.pt` checkpoint to x86_64. FP16, INT8, calibration,
  custom onnx2tf, retry, and partial-validation controls are not active.

- The retained 0629 two-lineage CUDA acceptance is complete in dedicated
  project packages. The accepted models are the explicit `rect=false`,
  `amp=false` FP32 retries, not the historical AMP attempts; exact jobs,
  artifacts, hashes, validation previews, and final checks are in
  [the 0629 dual-training acceptance report](../docs/verification/2026-08-30-0629-dual-training-acceptance.md).
- Training API records now persist `rect` and `amp`; `diagnostics=true` is
  opt-in aggregate troubleshooting evidence and does not change a routine
  model request. Operators must inspect persisted flags and `args.yaml` before
  accepting a CUDA model.
- Responsive Review keeps its option-C toolbar and 44px controls. Long active
  project names now wrap at narrow external viewport widths rather than
  widening the document.
- Review's Edit menu is portaled to the document layer so image/stage stacking
  contexts cannot cover it. The language selector is explicitly labeled
  `Language`.
- Long-running jobs expose cooperative cancellation in both their action button
  and Task Center. Running work enters `cancel_requested` and stops at the next
  safe checkpoint; training checks between batches.
- Augment supports a stackable Mirror effect with left/right or top/bottom
  direction and an explicit trigger probability. Preview and generated YOLO
  boxes follow the same transform as their pixels whenever it triggers.
- Optional Authlib-backed Google, Facebook, and LINE sign-in is available via
  `.env`; it is disabled by default. The sidebar shows the signed-in profile
  image/user fallback and sign-out control instead of the historical OA mark.

## Planned / Not Implemented

- Keep Ultralytics Platform authentication as the active flexible Open Data route. Additional hand-written Official adapters are deferred.
- A future `Import other dataset` workflow will use bounded LLM profiling and declarative conversion planning, followed by deterministic sample execution, validation, visual approval, and normalized bbox cache publication. The LLM will not execute code or directly mutate project data. Prompt drafts, safety boundaries, phases, and acceptance criteria are recorded in [the LLM-assisted Open Data roadmap](references/llm-assisted-open-data-and-auth-roadmap.md).
- Google, Facebook, and LINE sign-in already exist as an optional authentication gate; live provider callbacks still require operator credentials and exact HTTPS callback registration. Per-user project ownership/authorization is not implemented and remains a separate future decision.

- Project lifecycle is project-package oriented: healthy `Delete project package` removes the DB row, job history, project workspace, and project model-index entry while preserving raw `data/input`.
- Manual deletion of `data/projects/<slug>/` is detected as stale storage. Projects page auto-refreshes storage status and offers `Clean stale DB record` for missing workspace/output-index rows.
- Sources page has Image folder/Video toggle, an explicit unassigned path state, simplified local folder navigation/shortcuts, `Use this folder`, source analysis, and conditional video frame-extraction settings.
- Pseudo Label integrates class schema editing/history. Operators assign an existing committed schema or edit a draft and `Commit schema to history`; duplicate schema names warn and use id suffixes in dropdowns. Teaching-style flow/summary columns are removed; the page keeps focused schema, model/settings, run feedback, and inline `?` help.
- Pseudo Label Generate has page-local immediate feedback, duplicate/restart affordance, schema/model/merge condition display, progress/message, latest preview, and merge-rate style run context.
- Review workbench includes loading overlay when switching images, stale-box prevention, right-click context menu, multi-box selection, bulk class edit/delete, `Delete` shortcut, and dirty-state navigation confirmation.
- Augment page uses x3/x5/x8/x10 dataset multiplier, Hue/Exposure/Blur/Noise/Camera Gain/BBox Motion Blur/Random Rotation/Mirror stack effects, live previews with bbox overlays, label-aware transforms, and random generated-output checks.
- Split page can preview train/validation/test sampled images with bbox overlays.
- Train page has explicit parameter explanations and training progress feedback from job messages/callbacks where available.
- Validate page has an editable random sample count beside `Random sample` and shows the selected model/schema/folder plus multiple prediction overlays.
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

The 2026-09-05 branch regression reported all host backend tests passing when
the Authlib-only module is excluded, frontend Vitest `222/222` passing, shell
syntax and Python compile checks passing, and a successful production build.
The host-only full backend command still has the expected single Authlib
failure because Authlib is installed in the pinned container rather than the
host Python. Browser smoke verified the deployed explicit unassigned folder
state, simplified folder browser, Validate sample-count control, a real
two-image inference returning two result cards, and the Mirror
direction/probability modal. The rebuilt live API/catalog, Review source
filter, Current Split, equal-width mapping layout, zero horizontal overflow,
and CUDA availability were previously checked. The live Jetson capability
endpoint returns exactly two unavailable FP32 records with the x86
checkpoint-handoff reason.

## Caveats For Next Agent

- Always read `spec/PROJECT_MAP.md`, then `spec/UI.md`, `spec/DATA_MODEL.md`, `spec/API.md`, and this status file before changing UI/data lifecycle behavior.
- Do not treat Review completion as a hard prerequisite for training; current UX treats it as spot-check/quality control unless requirements change.
- If a project appears in UI after manual folder deletion, use storage-status / cleanup-stale behavior rather than manually editing SQLite.
- In-progress backend jobs continue when switching pages; navigation prompts are for unsaved client edits, not job cancellation.
- Tailscale URL smoke can fail because of Tailscale daemon/serve state even when local app health is OK. Verify local health first, then network exposure.
- During an active long GPU training run on 2026-09-02, health requests were
  observed to alternate between success and connection refusal while Docker
  still reported the container `Up`. This observation is not yet a diagnosed
  server defect; check the live job/container state before restarting anything.
- Netron is served by an internal server on port `8081`, but browsers should only use `/api/netron/...`.
- Use [Review editing and image removal](references/review-editing-and-image-removal.md) for current Review semantics and [Current conversion boundary](references/model-conversion-current.md) for Convert. Historical plans are Git archaeology, not implementation contracts.
