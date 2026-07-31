# Project Artifact Context Design

## Goal

Make each project behave like a workflow portfolio: every page can see what previous pages produced, and every downstream page can explicitly choose the upstream artifact it should process.

## Problem

Model Convert currently lists only database-backed `training_runs`. The filesystem already contains more completed `.pt` and `.pth` models under `output_model/`, and `GET /api/models/output` can see them, but Convert does not use that inventory. This hides valid models and breaks the expected workflow dependency chain.

## Design

Add two project-scoped APIs:

- `GET /api/projects/{project_id}/model-sources`
- `GET /api/projects/{project_id}/artifact-context`

`model-sources` returns all convertible source models:

- completed current-project training artifacts from `training_runs`
- discovered current-project `.pt`/`.pth` files under `output_model/<project_id>/`
- discovered other-project `.pt`/`.pth` files under `output_model/<other_project>/`
- loose root `.pt`/`.pth` files directly under `output_model/`

Each item includes:

- `id`
- `label`
- `path`
- `relative_path`
- `scope`: `current_project`, `other_project`, or `loose_output`
- `source_type`: `training_run` or `discovered_output`
- optional `training_run_id`
- optional `project_id`
- `status`

`artifact-context` summarizes the project portfolio:

- source count
- schema count
- split count
- training run count
- completed model sources
- conversion package count
- export bundle count

## UI

Create Project / Projects page shows a Project context panel for the active project: counts plus completed model sources. This makes it possible to inspect what the project has already produced.

Model Convert replaces the training-run-only selector with a Model source selector grouped by scope. It can convert any `.pt` or `.pth` source model while still requiring an explicit class schema.

## Backend

`ModelConversionCreate` accepts `source_model_path` and optional `training_run_id`. The conversion service resolves source model path directly when provided, while preserving `training_run_id` when the source came from a known training run.

For database compatibility, `model_conversion_runs.training_run_id` remains populated. If a loose/discovered model has no real training run, the service creates an import-style training run record with `dataset_split_id = null` and `input_model = source_model_path` so existing foreign keys continue to hold.

## Tests

- Repository/service test for model source inventory from training runs and filesystem.
- API test for `model-sources` and `artifact-context`.
- Service test for direct `source_model_path` conversion.
- Frontend test for grouped model source selector and Project context panel.
