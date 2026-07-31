# Model Convert Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build package-based model conversion and package-based export for trained YOLO models.

**Architecture:** Extend the existing FastAPI + SQLite + React workflow with a new Model Convert page and package-oriented backend records. Conversion jobs write metadata manifests and artifact records; Export selects a conversion package and creates a bundle record.

**Tech Stack:** FastAPI, SQLite, Pydantic, Ultralytics YOLO export, Netron, React, TypeScript, Vite, Vitest, pytest.

## Global Constraints

- Do not revert unrelated working tree changes.
- Keep backend route handlers thin; repository owns persistence and project services own conversion/export behavior.
- Use TDD for behavior changes: write a failing test, verify failure, implement, verify pass.
- New WebUI flow uses conversion packages; legacy single-format `model-exports` can remain for compatibility.

---

### Task 1: Backend Persistence

**Files:**
- Modify: `backend/app/db.py`
- Modify: `backend/app/repositories.py`
- Test: `tests/backend/test_model_conversion_packages.py`

**Interfaces:**
- Produces: `Repository.create_model_conversion_run(...)`, `Repository.add_model_conversion_artifact(...)`, `Repository.list_model_conversion_runs(project_id)`, `Repository.get_model_conversion_run(conversion_id)`, `Repository.create_model_export_bundle(...)`, `Repository.list_model_export_bundles(project_id)`.

- [ ] Write failing repository tests for conversion packages, artifact rows, and export bundle rows.
- [ ] Run `pytest tests/backend/test_model_conversion_packages.py -v` and verify missing methods/tables fail.
- [ ] Add SQLite tables and repository methods.
- [ ] Run the same pytest command and verify it passes.

### Task 2: Conversion and Bundle Services

**Files:**
- Modify: `backend/app/project_services.py`
- Test: `tests/backend/test_model_conversion_services.py`

**Interfaces:**
- Consumes: repository methods from Task 1.
- Produces: `create_model_conversion_package(...)`, `create_model_export_bundle(...)`, `build_conversion_manifest(...)`.

- [ ] Write failing service tests for manifest content and bundle creation.
- [ ] Run `pytest tests/backend/test_model_conversion_services.py -v` and verify failures are for missing service behavior.
- [ ] Implement package directory creation, schema snapshot writing, metadata writing, artifact record creation, and bundle record creation.
- [ ] Run the service tests and verify they pass.

### Task 3: API Endpoints

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Test: `tests/backend/test_model_conversion_api.py`

**Interfaces:**
- Consumes: service functions from Task 2.
- Produces: `GET/POST /api/projects/{project_id}/model-conversions`, `GET /api/projects/{project_id}/model-conversions/{conversion_id}/netron`, `GET/POST /api/projects/{project_id}/export-bundles`.

- [ ] Write failing API tests for list/create conversion package and create export bundle.
- [ ] Run `pytest tests/backend/test_model_conversion_api.py -v` and verify endpoint failures.
- [ ] Add Pydantic schemas and route handlers using `JobRunner`.
- [ ] Run the API tests and verify they pass.

### Task 4: Frontend Convert Page and Export Rework

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/App.test.tsx`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Consumes: API endpoints from Task 3.
- Produces: `ModelConvertPage` and package-based `ExportPage`.

- [ ] Write failing Vitest coverage for Convert nav/page, schema class mapping, conversion target matrix, and Export package selector.
- [ ] Run `npm --prefix frontend test -- App.test.tsx client.test.ts` and verify expected failures.
- [ ] Implement API client methods, types, Convert page, Netron iframe panel, and package-based Export page.
- [ ] Run the focused frontend tests and verify they pass.

### Task 5: Documentation and Verification

**Files:**
- Modify: `spec/API.md`
- Modify: `spec/UI.md`
- Modify: `spec/DATA_MODEL.md`
- Modify: `spec/OPERATIONS.md`

**Interfaces:**
- Consumes: completed backend and frontend behavior.
- Produces: updated progressive-disclosure docs.

- [ ] Update spec docs for Convert page, conversion package data model, export bundle flow, and Netron preview.
- [ ] Run `pytest -v`.
- [ ] Run `npm --prefix frontend test`.
- [ ] Run `npm --prefix frontend run build`.
- [ ] Run `bash -n run.sh`.
- [ ] Restart with `./run.sh --down_up` or the repository-supported lifecycle command.
