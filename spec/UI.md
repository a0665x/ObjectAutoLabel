# UI

The WebUI is a React/Vite single-page console served by FastAPI.

## Screens

- `Projects`: create and list local labeling projects, assign/switch the active project, delete a whole project package, and clean stale DB records after manual folder deletion. The active project includes a Project context panel with counts for sources, schemas, splits, training runs, model sources, conversion packages, and export bundles. Project cards also show storage health; if a DB row points to a missing manually deleted workspace/output index, the card warns `Stale project record` and exposes `Clean stale DB record` to remove only the stale DB/job rows while keeping `data/input` untouched. The Projects view also exposes a processing timeline for the active project.
- `Sources`: register image folders or videos through an Image folder/Video toggle. The file manager opens on an operator-friendly default path and shows common shortcuts for 0629 raw data, ObjectAutoLabel data/input, data/projects, Desktop, and Home with matching image/video counts. Image folder mode supports common still-image extensions; Video mode supports mp4/webm/mov/mkv/avi-like source paths and conditionally reveals frame-extraction settings with parameter explanations. `Process & analysis` summarizes counts, dimensions, extensions, and common sizes before downstream labeling.
- `Pseudo`: run YOLO-World pseudo-labeling against a project. Class schema editing is integrated into this page: operators either assign an existing committed schema from history or edit a draft schema and explicitly `Commit schema to history` before generating labels. The page includes a `Pseudo build name` input; that name is stored on the completed pseudo-label run and used by Augment/Split selectors. Duplicate schema names show warnings and history dropdown entries include id suffixes. The old teaching-style `1 -> 2 -> 3A/3B -> 4` flow and the later current-condition summary columns are intentionally removed; the page should focus on schema history, descriptor editing, model/settings, run feedback, and inline `?` help only. Descriptor prompts remain provenance for YOLO-World only; training labels stay canonical class ids/names.
- `Review`: use the offline annotation workbench to filter the queue, inspect review stats, draw/edit boxes, change classes, set checked/not-checked style review state, and save YOLO labels. The workbench supports context-menu editing, multi-box selection, bulk class changes, and bulk delete.
- `Augment`: build an augmentation recipe by starting from an empty stack and adding parameters with `+` actions. Each added effect opens a sampled-photo settings modal where the operator adjusts the ± value range and can opt into bbox overlay preview with a checkbox. Applied effects stack together before `Create augmented images`. The multiplier row includes `Skip augment`, which creates a project-local source/pass-through build without pixel transforms so downstream Split/Train can still target a concrete dataset build version. Completed augment/source builds show source image count, generated image count, output path, and a random sample preview with a `Show bounding boxes` checkbox.
- `Split`: create train/val/test dataset splits from explicit upstream inputs: a pseudo-label build plus an optional augment/source build. Preview per-bucket train/validation/test sample images with bbox overlays before training.
- `Train`: start YOLO training from an explicit split build and input model. The page includes a `Training run name` input. The selected split dropdown and pre-train summary should show pseudo-label and augment/source lineage so operators know which dataset build is being trained. While training runs, show a live loss curve from persisted epoch metrics; after completion, show the actual Ultralytics `save_dir`, `best.pt`, and `last.pt` paths for that run.
- `Validate`: sample images and inspect predictions from trained/exported models. The model selector prioritizes current-project model sources from completed training runs, including best/last variants and run names, before global fallback models. The primary action is labeled `Random sample` and shows the selected model name, class schema, sampled folder/image, and bbox predictions.
- `Model Convert`: choose any completed `.pt` or `.pth` model source from current-project training outputs, discovered current-project files, other-project output files, or loose root `output_model/` files. Then bind a class schema, select ONNX/TFLite precision targets, create a conversion package, and preview converted artifacts in an embedded Netron panel.
- `Export`: select a conversion package and create a final bundle containing native `.pt`, selected artifacts, `classes.json`, and `metadata.json`.
- `Settings`: workflow control center. It shows workflow defaults (pseudo model, train input model, augment default, split ratio, train device), active project storage/artifact counts, runtime deployment guidance for Desktop x86_64 and Jetson ARM64, and model inventory for `world_model/`, `input_model/`, and `output_model/`. Settings defaults are operator conveniences; each workflow tab still displays exact build inputs before running.
- The top bar includes a Desktop/Mobile viewport toggle so operators can preview the UI at an iPhone-width layout without resizing the browser.

## Interaction Model

Most workflow forms submit one job and receive immediate feedback. The UI polls job status and shows process feedback in two layers: a bottom-right Task Center for active/latest jobs and a top Workflow Guide for missing/done/current/failed step guidance. Project, source, schema, annotation, and model-list interactions are regular request/response calls.

Artifact-producing jobs bump a project-wide artifact revision when they complete. Downstream pages use that signal to refresh pseudo/augment/split/train/model selectors immediately instead of waiting for a slow page-local poll. Pages must show a spinner/inline feedback while syncing upstream builds so clicks never feel ignored.

The top Workflow Guide is clickable. Clicking a step switches to that page when safe. If the current page has dirty client-side edits, such as unsaved Review annotations or schema edits, navigation asks for confirmation before leaving. Backend jobs such as pseudo-labeling or training continue running in the background when the operator changes pages; page-local panels and the Task Center remain responsible for showing their state. On narrow/mobile viewports the guide must scroll or wrap without overlapping content.

Model Convert is the boundary between training and deployment packaging. It is intentionally separate from Export so operators can inspect converted artifacts and class metadata before creating the final package.

Each downstream workflow page should expose explicit selectors for upstream artifacts instead of relying on hidden latest-state assumptions. Convert uses `model-sources`; Export uses conversion packages.

Every workflow page that creates a downstream artifact should expose a human-readable name before submit. Pseudo, Augment/source, Split, and Train may run multiple times in the same project, and the next page must make those previous builds distinguishable by name plus lineage.

The review workbench is not job-driven. It loads sources, class schemas, queue entries, and review stats directly, keeps in-progress edits in client state, and persists the full annotation set only when the user saves.

## Review Workbench

- The canvas is an SVG overlay on top of the source image, with `select`, `draw`, and `pan` modes.
- Queue filters support `review_status`, `source_asset_id`, and `has_low_confidence`.
- Queue stats surface review/check progress plus `edited` and `low_confidence` counts from the backend. Current UX treats review as a spot-check/quality-control phase instead of a hard training gate; labeled data can still be split/trained even if not every image was inspected.
- Navigation between images is guarded by dirty-state confirmation.
- Review prefetches nearby image files and annotations so next/previous image navigation can reuse cached boxes when possible. While prefetching, the queue shows explicit preloading feedback.
- Saving replaces the image annotation set, updates the image review status, and writes a YOLO label file under the project `reviewed_labels/` folder.
- Right-clicking a box opens a context menu for class changes and deletion. Select mode also supports multi-box selection by lasso/drag selection; bulk context-menu changes apply to the selected set. `Delete` removes the selected box(es), `Ctrl+D` toggles draw/select, and mode switches should provide visible feedback.

## Pseudo Label UX Contract

- Schema history is explicit: editing a schema creates a draft, and only `Commit schema to history` creates a stored history item. Generate is blocked/disabled until the active draft is committed or an existing committed schema is selected.
- Pseudo Label Generate must use the visible `Pseudo build name` as the stored run/build name.
- Existing schemas can be assigned from history. Choosing a history item immediately switches the visible schema name, class ids/names, and descriptor tree.
- Duplicate schema names are allowed for compatibility but must show a warning; dropdown labels should include a short id suffix so same-name schemas can be distinguished.
- Inline `?` help replaces long always-visible teaching copy. Use tooltips for model, confidence, NMS IoU, merge boxes, merge IoU, schema history, and generated-run history.
- Do not render pseudo-label flowchart/summary columns such as `Prompt descriptors`, `Inference model`, or `Training labels stay canonical`; users found those columns read like unnecessary process teaching. Keep descriptor/class mapping visible in the editable schema tree and run status panel instead.

## Augment UX Contract

- The compact multiplier control `x3/x5/x8/x10` represents target augmented dataset size. It replaces separate `copies per labeled image` and preview-sample count controls for normal operation. The selected multiplier must be visibly active.
- `Skip augment` sits beside `x3/x5/x8/x10` and creates a selectable source/pass-through build. This is the correct path when operators want no pixel augmentation but still need a versioned dataset input for Split.
- Augmentation starts as an empty recipe. Operators add effects with `+ Hue Adjustment`, `+ Blur Filter`, etc.; each effect is configured in a modal with a sampled photo, a ± range slider, and an optional `Preview bounding boxes` checkbox. Avoid visible long effect descriptions in this modal/stack when the UI language is English; the preview image and effect name should carry the interaction, with bbox overlay as an explicit opt-in.
- Applied effects are shown as a stacked recipe with Edit/Remove actions. The stack is the source of truth for the backend augmentation payload.
- Generated augmentation copies stack all configured effects into one composite output image. Signed effects are sampled uniformly inside the configured ± range per output copy; noise/blur-like magnitudes are sampled within their non-negative range.
- Augment completion must show `Source images`, `Generated images`, the build name, and the project-local output directory. The random output check samples actual generated/pass-through build images and lets the operator toggle bbox overlays.
- Supported controls include Hue Adjustment, Exposure Simulation, Blur Filter, Random Noise, Camera Gain Variance, Bounding Box: Motion Blur, and Random Rotation.
- Rotation and horizontal flip must transform labels as well as pixels. Bbox transforms should be visually checked through the modal bbox overlay option and the post-create random output check.

## Design Rules

- Keep the UI responsive and mobile-safe.
- Keep touch targets at least 44px high.
- Use visible labels, not placeholder-only inputs.
- Use one primary action per form.
- Avoid Streamlit-like repeated full-page control blocks; group each workflow by user intent.
- Keep API calls in `frontend/src/api/client.ts` and shared types in `frontend/src/types.ts`.
- Keep review interaction logic in `frontend/src/pages/ReviewPage.tsx`, `frontend/src/components/review/`, and `frontend/src/annotation/`.

## 2026-07-01 interaction feedback update
- Long-running action buttons use an immediate touch-feedback state: spinner, disabled repeat-click protection, inline copy that explains what is being processed, and an embedded percent/meter when either a backend job or local multi-step request has progress available.
- Pseudo Label Generate has a page-local feedback panel in addition to the button: it immediately shows the submitted schema/model/merge settings, progress/message once a job exists, failed-job errors, and a restart affordance when a pseudo-label job is already running.
- A fixed bottom-right Task Center mirrors active backend jobs and local multi-step requests as toast-style cards. It shows running/latest task count, status, percent, current message, and a larger progress meter; users can collapse/expand it without losing button-level feedback.
- Pseudo Label shows the node-link dependency graph only as a current-state summary once a schema/run/job exists; before that it stays in a compact "not started" state.
- Pseudo Label class schema editing uses a visual tree: colored canonical class id/class chips at the parent level and green descriptor chips indented under each class. `+ disc` is scoped under its parent class; `+ class` remains at the tree root.
- Review clears stale boxes while loading a new image, forces the annotation canvas to remount per image, and shows a loading overlay instead of silently waiting. This avoids old boxes appearing as if they belong to the next image.
- Buttons use semantic action colors consistently across pages: blue for process/run/analyze, purple for create/add/draw, teal for browse/assign/navigation/select, green for save/export, orange for merge/remove/pan, and red for destructive delete actions.
- The top workflow area is not a raw progress-bar strip. It uses explicit step states (`Done`, `running`, `You are here`, `Not done yet`, `Needs attention`) plus a short next-step hint so operators know what is missing and what to do next.
- Split ratios avoid browser `step` validation traps: train and validation accept 0.01 increments, test is computed automatically, and the visual stack always sums to 1.00.
- Train loss visualization is split into three compact charts: Box loss, Class loss, and DFL loss. Each chart includes y-axis loss ticks, x-axis epoch ticks, data points, and a regression/trend line.
