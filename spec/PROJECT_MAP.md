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

## Major Concepts

- `Project`: the main workspace record. Project files live under `data/projects/<slug>/` and state is stored in `object_autolabel.db`.
- `Job`: long-running operations return a job id immediately, then the UI polls status from `/api/jobs`.
- `Class schema`: per-project class ids, class names, and YOLO-World descriptors.
- `YOLO-World model`: `.pt` or `.pth` weights in `world_model/` used for open-vocabulary pseudo-labeling.
- `YOLO training model`: `.pt` or `.pth` weights in `input_model/` used by Ultralytics training; trained/exported outputs are listed from `output_model/`.
- `Offline review workbench`: the review screen is a local-first SVG annotation console with queue filters, review-status tracking, and YOLO label persistence under each project.
- `Dataset lifecycle`: project -> source assets -> frame extraction or image registration -> class schema -> pseudo-labels -> review annotations -> dataset split -> YOLO training -> export.

## Change Guide

- For backend behavior changes, read [Architecture](ARCHITECTURE.md), [API](API.md), and [Modules](MODULES.md).
- For UI changes, read [UI](UI.md) first, then verify API payloads in [API](API.md).
- For Docker or startup changes, read [Runtime](RUNTIME.md) and [Operations](OPERATIONS.md).
- For data path or label-format changes, read [Data Model](DATA_MODEL.md).

## Known Gaps

- The current WebUI uses local paths typed by the user; a browser-side file manager is not implemented yet.
- Training progress is coarse because Ultralytics training is invoked synchronously inside a job.
- The older Roboflow upload/download flow is not exposed by the current project-centric API.
- The workbench is intentionally offline and trusted-user oriented; `/api/files` is limited to registered images or safe project output directories, not general filesystem browsing.
