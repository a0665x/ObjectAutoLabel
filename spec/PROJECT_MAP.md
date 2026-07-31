# Project Map

## Name

ObjectAutoLabel

## Description

ObjectAutoLabel is a Dockerized WebUI for object-detection dataset preparation and YOLO model operations. It migrates useful behavior from the original `yoloworld/streamlit` project while removing Streamlit, Tkinter file dialogs, and page-local state. The runtime is `FastAPI + SQLite + React/Vite frontend + Docker Compose`, with long-running YOLO operations tracked as backend jobs.

## Read First

- [Architecture](ARCHITECTURE.md): service boundaries, request flow, and migration choices.
- [Modules](MODULES.md): source tree and responsibility map.
- [Runtime](RUNTIME.md): Docker, `run.sh`, ports, volumes, and environment assumptions.
- [API](API.md): backend endpoints and job model.
- [UI](UI.md): frontend structure and UX rules.
- [Data Model](DATA_MODEL.md): folders, YAML configs, labels, and model files.
- [Operations](OPERATIONS.md): common tasks and failure modes.
- [Testing](TESTING.md): current validation approach and gaps.
- [Current Status](STATUS.md): recently fixed bugs, active runtime URLs, data-path migration state, and known caveats for the next agent.

## Major Concepts

- `Project`: the main workspace record. Project files live under `data/projects/<slug>/` and state is stored in `object_autolabel.db`.
- `Job`: long-running operations return a job id immediately, then the UI polls status from `/api/jobs`.
- `Class schema`: per-project class ids, class names, and YOLO-World descriptors.
- `YOLO-World model`: `.pt` or `.pth` weights in `world_model/` used for open-vocabulary pseudo-labeling.
- `YOLO training model`: `.pt` or `.pth` weights in `input_model/` used by Ultralytics training. Project-owned trained/exported outputs live under `data/projects/<slug>/output_model/` and are indexed through `output_model/<project_slug>` symlinks.
- `Offline review workbench`: the review screen is a local-first SVG annotation console with queue filters, review-status tracking, and YOLO label persistence under each project.
- `Model conversion package`: a trained native `.pt` plus selected ONNX/TFLite artifacts, `classes.json`, and `metadata.json`.
- `Artifact context`: project-level portfolio view that exposes upstream outputs for downstream page selectors.
- `Build lineage`: Pseudo, Augment/source, Split, and Train create named build/run records. Downstream pages should refresh and expose explicit selectors for these records instead of assuming "latest" state.
- `Settings workflow center`: the Settings page surfaces workflow defaults, project storage counts, model inventory, and runtime deployment guidance. Defaults speed setup but do not hide per-page input selectors.
- `Dataset lifecycle`: project -> source analysis/registration -> frame extraction or image-folder copy -> committed class schema -> pseudo-labels -> optional review cleanup -> optional augmentation -> dataset split with sample preview -> YOLO training -> validation random sample -> model conversion -> package export.
- `Project package`: all project-owned working images, annotations, YAML splits, augmentations, trained models, conversions, exports, and jobs live under the project DB row plus `data/projects/<slug>/`. Raw `data/input` media remains reusable and is not deleted with a project.
- `Stale project record`: a DB project row whose workspace or global model-index entry was manually deleted. The UI detects this and offers safe stale cleanup instead of pretending the project is healthy.
- `Operator feedback`: long-running actions must show immediate page-local feedback and task-center status so users are not left guessing whether a click registered.

## Change Guide

- For backend behavior changes, read [Architecture](ARCHITECTURE.md), [API](API.md), and [Modules](MODULES.md).
- For UI changes, read [UI](UI.md) first, then verify API payloads in [API](API.md).
- For Docker, first-install/reboot/rebuild behavior, CUDA checks, or startup
  changes, read [Runtime](RUNTIME.md), [Operations](OPERATIONS.md), and
  [Testing](TESTING.md).
- For data path or label-format changes, read [Data Model](DATA_MODEL.md).

## Runtime Lessons

- [Jetson Docker CUDA and YOLO training acceptance](references/lesson-20260731-jetson-docker-cuda-training.md):
  verified L4T/image lineage, PyTorch CUDA, bounded YOLO training,
  `MemAvailable`, and the Ultralytics AMP reference-download pitfall.

## Known Gaps

- The WebUI has a local file browser for mounted paths, but it is still trusted-local tooling, not a browser upload workflow.
- Training progress is coarse because Ultralytics training is invoked synchronously inside a job.
- The older Roboflow upload/download flow is not exposed by the current project-centric API.
- The workbench is intentionally offline and trusted-user oriented; `/api/files` is limited to registered images or safe project output directories, not general filesystem browsing.
- Review context-menu and multi-select interactions have TypeScript/build coverage, but should still receive manual browser smoke when refined because canvas interactions are hard to fully unit-test.
