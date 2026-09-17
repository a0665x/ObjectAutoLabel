# UI

The WebUI is a React/Vite single-page console served by FastAPI.

When OAuth authentication is enabled, the application opens on a provider chooser for the configured Google, Facebook, and/or LINE adapters. After sign-in, the former `OA` brand mark becomes the signed-in user's profile image with a user-icon fallback and an explicit sign-out action. The language control is labeled `Language` instead of relying on the ambiguous language glyph.

## Screens

- `Projects`: create and list local labeling projects, assign/switch the active project, delete a whole project package, and clean stale DB records after manual folder deletion. The active project includes a Project context panel with counts for sources, schemas, splits, training runs, model sources, conversion packages, and export bundles. Project cards also show storage health; if a DB row points to a missing manually deleted workspace/output index, the card warns `Stale project record` and exposes `Clean stale DB record` to remove only the stale DB/job rows while keeping `data/input` untouched. The Projects view also exposes a processing timeline for the active project.
- `Sources`: register image folders or videos through an Image folder/Video toggle. The assigned-path field starts empty and says `No folder selected`/`No video selected`; the file browser's navigation location is never presented as an assigned source until the operator confirms it. The browser opens on an operator-friendly location, keeps common/recent path shortcuts, lists folders instead of every matching image, and uses compact intrinsic-width navigation/confirmation actions. Image folder mode supports common still-image extensions; Video mode supports mp4/webm/mov/mkv/avi-like source paths and conditionally reveals frame-extraction settings with parameter explanations. `Process & analysis` summarizes counts, dimensions, extensions, and common sizes before downstream labeling.
- `Pseudo`: run YOLO-World, backend-recognized YOLO-World v2 S/M/L/X, or YOLOE-26 pseudo-labeling against a project. The checksum-attested installer supplies v2 Small only; v2 M/L/X are selectable only after an operator manually supplies an approved trusted artifact through a separate hash-controlled workflow. Class schema editing is integrated into this page: operators either assign an existing committed schema from history or edit a draft schema and explicitly `Commit schema to history` before generating labels. The page includes a `Pseudo build name` input; that name is stored on the completed pseudo-label run and used by Augment/Split selectors. Duplicate schema names show warnings and history dropdown entries include id suffixes. The old teaching-style `1 -> 2 -> 3A/3B -> 4` flow and the later current-condition summary columns are intentionally removed; the page should focus on schema history, descriptor editing, model/settings, run feedback, and inline `?` help only. Descriptor prompts remain provenance for world models only; training labels stay canonical class ids/names.
- `Review`: use the offline annotation workbench to filter the queue, inspect filtered/project positions, draw/edit boxes, change classes through the bbox context menu, and save YOLO labels. Its filename-free Image Map sits directly below the Workflow Guide and uses distribution-aware relative risk colors based on mean/min confidence, confidence spread, low-confidence ratio, and bbox count. Operators compose the queue from Pseudo Label, Augment, and Open Sources groups through filled source buttons. A full-width histogram follows the map, aggregates per-class bbox area across the selected groups, adaptively splits overloaded ranges, marks bins represented by the current image, and lets a bin highlight its matching current-image boxes. The right column remains the current-image annotation inspector. Review does not expose checked/not-checked status controls. The workbench supports deterministic Select/Draw/Pan gestures, pointer-adjacent context menu, zoomed-background drag panning, multi-box selection, clipboard, undo/redo, and confirmed project-image removal. See [Review editing and image removal](references/review-editing-and-image-removal.md).
- `Augment`: build an augmentation recipe by starting from an empty stack and adding parameters with `+` actions. Each added effect opens a sampled-photo settings modal where the operator adjusts its settings and can opt into bbox overlay preview with a checkbox. Mirror is a normal stack effect: choose exactly one direction (left/right or top/bottom) and a 0–100% trigger probability. Applied effects stack together before `Create augmented images`. The multiplier row includes `Skip augment`, which creates a project-local source/pass-through build without pixel transforms so downstream Split/Train can still target a concrete dataset build version. Completed augment/source builds show source image count, generated image count, output path, and a random sample preview with a `Show bounding boxes` checkbox.
- `Split`: create train/val/test dataset versions from explicit upstream inputs: a pseudo-label build, optional augment/source build, and an explicit optional named Open Data version. The assembled lineage is displayed as color-coded `[Pseudo] → [Augment] + [Open Data version] → [Split · total images]` resources. Preview per-bucket train/validation/test random sample images with bbox overlays; a dice action rerolls only the preview.
- `Train`: choose any non-outdated saved Split version, then start YOLO training from that exact immutable snapshot and an input model. The page includes a `Training run name` input. Its optimizer choices appear in the exact order SGD, MuSGD, Adam, AdamW. All controls are stable controlled form state and must not reset when job/artifact polling refreshes. After submit, one exact locked `Submitted training configuration` card remains visible and the backend persists the settings with the training run; do not add a second hard-coded parameter summary that can contradict the submitted optimizer or values. MuSGD help describes it as a Muon + SGD hybrid intended for YOLO26 and longer/larger runs without claiming it is always better. The common Ultralytics Detect path supports local YOLOv8, YOLO11, YOLO12, and YOLO26 checkpoints; model-specific heads and NMS-free behavior stay inside Ultralytics. The Split selector and pre-train summary use the same color-coded lineage so operators know exactly which dataset version is being trained. While training runs, show a live loss curve from persisted epoch metrics; after completion, show the actual Ultralytics `save_dir`, `best.pt`, and `last.pt` paths for that run.
- `Validate`: sample images and inspect predictions from trained/exported models. The validation folder starts unassigned instead of silently using a developer-machine path. The model selector prioritizes current-project model sources from completed training runs, including best/last variants and run names, before global fallback models. Beside `Random sample`, an editable sample count defaults to 1 and accepts 1–12; one request returns unique randomly selected images and their bbox predictions in a responsive grid.
- `Model Convert / Export`: convert and export from one tab. Choose any completed `.pt` or `.pth` model source from current-project training outputs, discovered current-project files, other-project output files, or loose root `output_model/` files. The page loads conversion capabilities when opened and offers exactly two conversion choices: `ONNX FP32` and `LiteRT FP32`. When LiteRT is selected, the adjacent input-layout selector offers `NCHW` or `NHWC`; ONNX remains NCHW. On aarch64 both choices and submission are disabled, with the server reason `Copy the .pt checkpoint to an x86_64 host and convert it there.` Existing historical package rows remain readable regardless of their stored format or precision, and artifact rows display the recorded layout.
- Conversion history provides the final ZIP directly. It contains native `.pt`, converted artifacts, `classes.json`, `metadata.json`, and a structured `training/` directory with the persisted run record plus available `args.yaml`, CSV metrics, and result plots.
- `Stream Demo`: after Export, with a Film icon. Select a conversion version then PT/ONNX/TFLite, a host camera capture mode or uploaded video, output bitrate/FPS/resolution, and inference device/image size. Confidence and IoU remain live controls. A GStreamer H.264 viewport displays bbox overlays and measured inference statistics. LiteRT artifacts are checked against their persisted layout and batch-1 input shape before selection; invalid exports remain visible with their actual shape and failure reason but cannot start a stream or generate a verification command. See [Stream Demo](references/stream-demo.md).
- `Settings`: workflow control center. It shows workflow defaults (pseudo model, train input model, augment default, split ratio, train device), active project storage/artifact counts, runtime deployment guidance for Desktop x86_64 and Jetson ARM64, and model inventory for `world_model/`, `input_model/`, and `output_model/`. Settings defaults are operator conveniences; each workflow tab still displays exact build inputs before running.
- The top bar includes a Desktop/Mobile viewport toggle so operators can preview the UI at an iPhone-width layout without resizing the browser.

## Interaction Model

Most workflow forms submit one job and receive immediate feedback. The UI polls job status and shows process feedback in two layers: a bottom-right Task Center for active/latest jobs and a top Workflow Guide for missing/done/current/failed step guidance. Project, source, schema, annotation, and model-list interactions are regular request/response calls.

Every active backend job in the Task Center has a `Stop safely` action. Job-backed processing buttons also become stop actions after a job id is available. Cancellation is cooperative: training stops at a batch boundary and file/build jobs stop at their next safe loop or artifact boundary.

Artifact-producing jobs bump a project-wide artifact revision when they complete. Downstream pages use that signal to refresh pseudo/augment/split/train/model selectors immediately instead of waiting for a slow page-local poll. Pages must show a spinner/inline feedback while syncing upstream builds so clicks never feel ignored.

The top Workflow Guide is clickable. Clicking a step switches to that page when safe. If the current page has dirty client-side edits, such as unsaved Review annotations or schema edits, navigation asks for confirmation before leaving. Backend jobs such as pseudo-labeling or training continue running in the background when the operator changes pages; page-local panels and the Task Center remain responsible for showing their state. On narrow/mobile viewports the guide must scroll or wrap without overlapping content.

Model Convert / Export is the boundary between training and deployment packaging. Operators inspect converted artifacts and class metadata and download the complete package from the same screen.

New conversion requests are x86_64 FP32-only. Do not expose FP16, INT8, calibration-folder, retry, partial-success, or validation-metric controls in the active conversion form. Converter packages are image-build dependencies and are never installed during a conversion request. This restriction does not remove MuSGD from Train.

Each downstream workflow page should expose explicit selectors for upstream artifacts instead of relying on hidden latest-state assumptions. Convert / Export uses `model-sources` and conversion packages on the same page.

Tracked Model source and Conversion selectors use compact names only: `[Pseudo · name] → [Augment · name] + [Open Data · name] → [Split · name] → [Train · name] · best.pt`, followed by `[Convert · name]` where applicable. Dates, ids, image counts, statuses, classes, and hyperparameters belong in adjacent detail cards rather than the option text.

Pseudo, Augment, Split, Training, Conversion, and Export history rows expose a confirmed Delete action. Deletion cascades only downstream, refreshes every affected selector, and is unavailable while a related job is active. Shared Open Data caches, raw inputs, Source assets, and Class schemas are never part of this history action.

Every workflow page that creates a downstream artifact should expose a human-readable name before submit. Pseudo, Augment/source, Split, and Train may run multiple times in the same project, and the next page must make those previous builds distinguishable by name plus lineage.

Default artifact names use `<Type>_MMDD_vNNN` in local time, such as `Pseudo_0914_v001` and `Train_0914_v003`. Do not include a year or clock time. The version is zero-padded and advances from retained project history; operator-edited names remain unchanged.

The review workbench is not job-driven. It loads sources, class schemas, queue entries, and review stats directly, keeps in-progress edits in client state, and persists the full annotation set only when the user saves.

## Review Workbench

- The canvas is an SVG overlay on top of the source image, with `select`, `draw`, and `pan` modes.
- Queue composition supports Pseudo Label, Augment, and Open Sources groups. Legacy status/source query parameters remain compatible at the API boundary but are not exposed as Review controls.
- Review is a spot-check/quality-control phase rather than a hard training gate; labeled data can be split/trained without checked/not-checked distinctions.
- Navigation between images is guarded by dirty-state confirmation.
- Review prefetches nearby image files and annotations so next/previous image navigation can reuse cached boxes when possible. While prefetching, the queue shows explicit preloading feedback.
- Saving replaces the image annotation set and writes a YOLO label file under the project `reviewed_labels/` folder. Legacy review status remains an internal compatibility field and is not part of the Review UI or dirty-state calculation.
- Select mode supports direct left-drag move/resize. At Fit zoom, empty-background drag creates a multi-box lasso; after zooming beyond Fit, empty-background drag pans and Shift+drag creates the lasso. Selected boxes move together and remain clamped to the natural image bounds.
- Pan mode uses left-drag. Middle-drag and `Space`+left-drag temporarily pan from any mode without changing the active annotation tool.
- `Ctrl`+mouse-wheel zooms around the pointer while ordinary wheel input remains available for page scrolling. Zoom is clamped to 25%-800%; the toolbar exposes zoom out, current-percent/100%, zoom in, and Fit controls.
- Right-clicking any part of a box, including its label, opens a body-portaled, viewport-clamped context menu beside the pointer. It shows source/confidence metadata when available and offers bulk class change, duplicate, zoom-to-selection, and delete actions for the selected set.
- `D`, `B`, and `H` select the persistent Select/Draw/Pan tools. Holding `Ctrl/Cmd` temporarily swaps Draw and Select for one drag; it is the gesture gate, not a persistent mode shortcut.
- `Ctrl/Cmd+C`, `Ctrl/Cmd+V`, and `Ctrl/Cmd+D` copy, paste, and duplicate boxes. `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` undo/redo session commands. `Delete` removes selected boxes. Arrow keys move selected boxes by one natural-image pixel and `Shift`+arrow moves by ten; when nothing is selected, left/right arrows navigate the queue.
- `Escape` first aborts an active gesture, then closes a menu, then clears selection. `Shift+X` confirms removal of the current image from the project; session Undo restores it when backend trash is still available. Affected Augment/Split builds become outdated and cannot silently feed a new training run.
- The toolbar shows both filtered-queue and whole-project `current / total` positions. The Edit menu exposes the same command registry and shortcut text as keyboard dispatch and visible controls.
- The Edit menu is rendered in the document overlay layer and positioned beside its trigger, so the toolbar's translucent stacking context and the later image stage cannot cover or clip it.

## Pseudo Label UX Contract

- Schema history is explicit: editing a schema creates a draft, and only `Commit schema to history` creates a stored history item. Generate is blocked/disabled until the active draft is committed or an existing committed schema is selected.
- Pseudo Label Generate must use the visible `Pseudo build name` as the stored run/build name.
- Existing schemas can be assigned from history. Choosing a history item immediately switches the visible schema name, class ids/names, and descriptor tree.
- Duplicate schema names are allowed for compatibility but must show a warning; dropdown labels should include a short id suffix so same-name schemas can be distinguished.
- Inline `?` help replaces long always-visible teaching copy. Use tooltips for model, confidence, NMS IoU, merge boxes, merge IoU, schema history, and generated-run history.
- Do not render pseudo-label flowchart/summary columns such as `Prompt descriptors`, `Inference model`, or `Training labels stay canonical`; users found those columns read like unnecessary process teaching. Keep descriptor/class mapping visible in the editable schema tree and run status panel instead.

## Open Data UX Contract

- Open Data is an optional page between Augment and Split with two explicit source modes. `Official datasets` lists only curated adapters such as VisDrone2019-DET and never accepts an arbitrary URL; `Ultralytics Platform` accepts one Platform Dataset URL for inspection. Switching sources does not create a second workflow: both continue through the same mapping, sampling, preview, version, Review, and Split stages.
- An Official adapter owns its fixed trusted source URLs, archive/parser rules, annotation normalization, class list, license notice, integrity checks, and official split behavior. Adding another Official dataset is an engineering change with tests, not a generic user URL import. Official adapters require no API key.
- The catalog shows owner, task, source labels, official counts, usage warning, shared-cache state, and download progress. Platform inspection automatically blocks Segment, OBB, Pose, Classify, missing-class, and duplicate-class datasets before download; only Detect/bbox continues into mapping.
- Platform download authentication is either the host `ULTRALYTICS_API_KEY` or a password field shown only for a selected, uncached Platform dataset. A field-entered key is request-only and must never enter the database, manifest, browser storage, or logs.
- Beside `Dataset URL`, link to the official Ultralytics Platform Explore page so operators can browse public datasets. The imported URL must still identify a compatible Detect/bbox dataset and pass metadata inspection.
- Mapping is a three-lane board: unassigned source cards, center forward/back arrows, and pastel Project schema/Ignore targets. Preview stays disabled until the left lane is empty.
- Multiple source labels may map to one target. Suggested people/car mappings are convenience only and never change the Class schema.
- The percentage slider samples the selected eligible Open Data itself (default 50%) and shows project/Open Data image share; preview adds bbox totals and per-target-class composition. Sources without an official validation set receive a deterministic 90/10 train/validation fallback after mapping and sampling.
- Publish adds the derived selection to Review. Review composes Pseudo Label, Augment, and Open Sources groups; Open Sources is disabled until an import exists.
- Each publication has a user-visible version name. The newest is active in Review and older versions remain selectable in Split. Removing active derived data requires confirmation; the shared cache is untouched.
- Open Data preview includes a dice reroll; it changes only the displayed six images, not the fixed formal selection.
- Train exposes every non-outdated materialized Split version. It defaults to Current Split, while saved historical snapshots remain selectable because their image/label folders are immutable. Outdated versions remain visible in Split history but are excluded from Train.
- Near-term catalog expansion remains deferred: Ultralytics Platform plus its request-only/host API key is the active flexible-source path, while Official remains limited to implemented adapters. A future `Import other dataset` flow may use an LLM to propose a structured conversion plan, but deterministic validation and operator approval must precede cache publication; see [the future roadmap](references/llm-assisted-open-data-and-auth-roadmap.md). Do not expose this planned mode as implemented.

## Augment UX Contract

- The compact multiplier control `x3/x5/x8/x10` represents target augmented dataset size. It replaces separate `copies per labeled image` and preview-sample count controls for normal operation. The selected multiplier must be visibly active.
- `Skip augment` sits beside `x3/x5/x8/x10` and creates a selectable source/pass-through build. This is the correct path when operators want no pixel augmentation but still need a versioned dataset input for Split.
- Augmentation starts as an empty recipe. Operators add effects with `+ Hue Adjustment`, `+ Blur Filter`, etc.; each effect is configured in a modal with a sampled photo, a ± range slider, and an optional `Preview bounding boxes` checkbox. Avoid visible long effect descriptions in this modal/stack when the UI language is English; the preview image and effect name should carry the interaction, with bbox overlay as an explicit opt-in.
- Applied effects are shown as a stacked recipe with Edit/Remove actions. The stack is the source of truth for the backend augmentation payload.
- Generated augmentation copies stack all configured effects into one composite output image. Signed effects are sampled uniformly inside the configured ± range per output copy; noise/blur-like magnitudes are sampled within their non-negative range.
- Augment completion must show `Source images`, `Generated images`, the build name, and the project-local output directory. The random output check samples actual generated/pass-through build images and lets the operator toggle bbox overlays.
- Supported controls include Hue Adjustment, Exposure Simulation, Blur Filter, Random Noise, Camera Gain Variance, Bounding Box: Motion Blur, and Random Rotation.
- Mirror is added from the same effect picker as Hue/Blur/Rotation. One Mirror effect selects either Left ↔ Right or Top ↔ Bottom and a trigger probability (default 50%). The probability is evaluated independently for each generated image; when triggered, `x_center` or `y_center` is transformed in the same order as its pixels. Legacy saved drafts with the old mirror booleans migrate to a 100%-probability Mirror stack effect.

## Design Rules

- Keep the UI responsive and mobile-safe.
- Keep touch targets at least 44px high.
- Keep every content grid shrink-safe: grid children and cards that contain
  long paths or toolbar controls must be allowed to use `minmax(0, 1fr)`/a
  zero minimum width so they cannot widen the document on small screens.
- Keep paired workflow columns visually balanced. Peer cards in the same grid
  row should resolve to equal widths (within normal sub-pixel rounding) rather
  than allowing one control-heavy card to force the other narrow.
- Form panels and wide fields may use the available width; normal action
  buttons remain intrinsically sized. The small-screen exception is a
  full-width primary panel action when it improves a one-column form.
- The Review toolbar follows option C: its tool and save groups stay compact
  horizontal rows at desktop widths, while each semantic group stacks below
  900px. Tooltips must not participate in document width until visible.
- Use visible labels, not placeholder-only inputs.
- Use one primary action per form.
- Avoid Streamlit-like repeated full-page control blocks; group each workflow by user intent.
- Keep API calls in `frontend/src/api/client.ts` and shared types in `frontend/src/types.ts`.
- Keep review interaction logic in `frontend/src/pages/ReviewPage.tsx`, `frontend/src/components/review/`, and `frontend/src/annotation/`.

## 2026-07-01 interaction feedback update
- Long-running action buttons use an immediate touch-feedback state: spinner, disabled repeat-click protection, inline copy that explains what is being processed, and an embedded percent/meter when either a backend job or local multi-step request has progress available.
- Pseudo Label Generate has a page-local feedback panel in addition to the button: it immediately shows the submitted schema/model/merge settings, progress/message once a job exists, failed-job errors, and a restart affordance when a pseudo-label job is already running.
- A fixed bottom-right Task Center mirrors active backend jobs and local multi-step requests as toast-style cards. It shows running/latest task count, status, percent, current message, and a larger progress meter; users can collapse/expand it without losing button-level feedback.
- The Task Center header is also a pointer drag handle in both expanded and collapsed states. Movement is viewport-clamped and remembered locally; a drag never toggles expansion, while click still expands/collapses and `Alt`+arrow keys provide a keyboard movement alternative.
- The earlier Pseudo Label dependency graph/current-state summary was later removed. Current UI keeps schema history, editable descriptors, model/settings, run feedback, and inline help without a teaching flowchart.
- Pseudo Label class schema editing uses a visual tree: colored canonical class id/class chips at the parent level and green descriptor chips indented under each class. `+ disc` is scoped under its parent class; `+ class` remains at the tree root.
- Review clears stale boxes while loading a new image, forces the annotation canvas to remount per image, and shows a loading overlay instead of silently waiting. This avoids old boxes appearing as if they belong to the next image.
- Buttons use semantic action colors consistently across pages: blue for process/run/analyze, purple for create/add/draw, teal for browse/assign/navigation/select, green for save/export, orange for merge/remove/pan, and red for destructive delete actions.
- The top workflow area is not a raw progress-bar strip. It uses explicit step states (`Done`, `running`, `You are here`, `Not done yet`, `Needs attention`) plus a short next-step hint so operators know what is missing and what to do next.
- Split ratios avoid browser `step` validation traps: train and validation accept 0.01 increments, test is computed automatically, and the visual stack always sums to 1.00.
- Train loss visualization is split into three compact charts: Box loss, Class loss, and DFL loss. Each chart includes y-axis loss ticks, x-axis epoch ticks, data points, and a regression/trend line.
