# Task 2 Report

## Status

Completed.

## Changes

- Updated `docker-compose.yml` and `docker-compose.jetson.yml` to mount `world_model`, `input_model`, and `output_model` instead of the legacy model paths.
- Added API coverage in `tests/backend/test_models_api.py` for nested output model discovery across the three active model folders.
- Updated `spec/RUNTIME.md` and `spec/DATA_MODEL.md` so runtime documentation matches the backend `AppPaths` model folder names.

## Verification

- `pytest tests/backend/test_models_api.py tests/backend/test_world_models.py -v`
- `docker compose -f docker-compose.yml config`
- `docker compose -f docker-compose.jetson.yml config`

## Concerns

- `Repository.list_models()` sorts `output_models` lexicographically, so nested outputs currently enumerate as `project-a/best.onnx` before `project-a/best.pt`. The new test documents the present backend behavior.

## Fix: Review Finding 1

- Updated `backend/app/repositories.py` so `output_models` sort by relative stem first and by explicit suffix priority second, with `.pt` ordered before `.onnx` for the same path.
- Updated `tests/backend/test_models_api.py` to assert the Task 2 brief contract: `["project-a/best.pt", "project-a/best.onnx"]`.

### Commands and Results

- `pytest tests/backend/test_models_api.py -v`
  - Initial red step: failed in `test_model_endpoints_include_nested_output_model_paths` because `project-a/best.onnx` sorted before `project-a/best.pt`.
  - After the repository fix: `2 passed`.
- `pytest tests/backend/test_models_api.py tests/backend/test_world_models.py -v`
  - Result: `4 passed in 0.23s`.
- `docker compose -f docker-compose.yml config`
  - Not re-run for this fix because compose files were not touched; validation already recorded in the previous Task 2 report.
- `docker compose -f docker-compose.jetson.yml config`
  - Not re-run for this fix because compose files were not touched; validation already recorded in the previous Task 2 report.

### Commit

- `7fd4b09` - `fix: enforce task 2 output model order`
