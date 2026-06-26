# Offline Label Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local offline YOLO-World review workbench and align model asset folders so ObjectAutoLabel can pseudo-label, correct labels, retrain, and export fully offline.

**Architecture:** Keep FastAPI and SQLite as the backend source of truth. Split the React review UI into focused editor components with a custom SVG annotation layer. Align model discovery and Docker mounts around `world_model/`, `input_model/`, and `output_model/`.

**Tech Stack:** FastAPI, SQLite, Pydantic, pytest, React 19, TypeScript, Vite, Vitest, SVG overlay editing, Docker Compose.

## Global Constraints

- Do not implement Roboflow online workflow in phase one.
- Do not support polygon segmentation in phase one; rectangular YOLO detection boxes only.
- Persist annotations as YOLO normalized `x_center`, `y_center`, `width`, `height`.
- Dataset split generation must include only `review_status == "reviewed"` images.
- Model folders must be `world_model/`, `input_model/`, and `output_model/`.
- Do not delete legacy model folders automatically.
- Keep coordinate conversion centralized in the annotation canvas layer or pure utilities.
- Avoid growing `frontend/src/App.tsx`; add focused components and helpers.

---

## File Structure

- Create `.gitignore`: protects local data, model files, runtime DBs, build outputs, caches, Codex/agent state, and brainstorm artifacts.
- Modify `docker-compose.yml` and `docker-compose.jetson.yml`: mount `world_model`, `input_model`, and `output_model`.
- Modify `spec/RUNTIME.md` and `spec/DATA_MODEL.md`: remove the compose mismatch warning after runtime alignment.
- Modify `backend/app/schemas.py`: add review status validation and image filter schema if useful.
- Modify `backend/app/repositories.py`: add image filters and review stats queries.
- Modify `backend/app/main.py`: expose filtered image list and review stats endpoint.
- Modify `backend/app/project_services.py`: validate annotations before replacing labels.
- Create or modify backend tests under `tests/backend/`.
- Create `frontend/src/annotation/geometry.ts`: coordinate conversion and bbox helpers.
- Create `frontend/src/annotation/reducer.ts`: annotation state transitions.
- Create `frontend/src/components/review/AnnotationCanvas.tsx`.
- Create `frontend/src/components/review/AnnotationToolbar.tsx`.
- Create `frontend/src/components/review/AnnotationInspector.tsx`.
- Create `frontend/src/components/review/ImageQueue.tsx`.
- Create `frontend/src/components/review/ClassPalette.tsx`.
- Create `frontend/src/pages/ReviewPage.tsx`.
- Modify `frontend/src/App.tsx`: import and render the extracted review page.
- Modify `frontend/src/api/client.ts` and `frontend/src/types.ts`: add filtered image/review-stats types.
- Create frontend tests under `frontend/src/annotation/*.test.ts`.

---

### Task 1: Git Hygiene, Ignore Rules, and Remote Setup

**Files:**
- Create: `.gitignore`
- Modify: none
- Test: shell checks only

**Interfaces:**
- Consumes: GitHub repo URL `https://github.com/a0665x/ObjectAutoLabel`
- Produces: a repository that can be safely committed and pushed without local runtime artifacts

- [ ] **Step 1: Write `.gitignore`**

Create `.gitignore` with this content:

```gitignore
# Python
__pycache__/
*.py[cod]
*.pyo
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
coverage.xml
htmlcov/
.venv/
venv/
env/

# Node / frontend
frontend/node_modules/
frontend/dist/
frontend/.vite/
frontend/coverage/
frontend/tsconfig.tsbuildinfo
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Local runtime data
object_autolabel.db
*.db
*.sqlite
*.sqlite3
data/
runs/

# Model assets are large and should be managed outside git
models/
yolo_model/
world_model/
input_model/
output_model/
*.pt
*.pth
*.onnx
*.tflite
*.torchscript
*.engine

# Local secrets and environment
.env
.env.*
api_key.txt
*.pem
*.key

# Codex / agent / local workflow state
.codex/
.agents/
.superpowers/
.gstack/

# OS / editor
.DS_Store
Thumbs.db
*.swp
*.swo
.idea/
.vscode/

# Docker local overrides
docker-compose.override.yml
.run-mode
```

- [ ] **Step 2: Verify ignored sensitive/local paths**

Run:

```bash
git check-ignore -v .codex .agents .superpowers object_autolabel.db data runs world_model input_model output_model frontend/node_modules || true
```

Expected after git is initialized: each listed local/runtime path is ignored by `.gitignore`.

- [ ] **Step 3: Initialize Git only if needed**

Run:

```bash
test -d .git && test -f .git/HEAD || git init
```

Expected: if the current empty `.git` directory is unusable, initialize a usable repository.

- [ ] **Step 4: Set remote**

Run:

```bash
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/a0665x/ObjectAutoLabel
git remote -v
```

Expected: `origin` points to `https://github.com/a0665x/ObjectAutoLabel` for fetch and push.

- [ ] **Step 5: Commit Git hygiene**

Run:

```bash
git add .gitignore docs/superpowers/specs/2026-06-26-offline-label-workbench-design.md docs/superpowers/plans/2026-06-26-offline-label-workbench.md
git status --short
git commit -m "docs: add offline label workbench plan"
```

Expected: only intended documentation and `.gitignore` are staged; commit succeeds.

---

### Task 2: Align Model Folders and Docker Runtime

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.jetson.yml`
- Modify: `spec/RUNTIME.md`
- Modify: `spec/DATA_MODEL.md`
- Test: `tests/backend/test_world_models.py`, `tests/backend/test_models_api.py`

**Interfaces:**
- Consumes: `AppPaths.world_model_dir`, `AppPaths.input_model_dir`, `AppPaths.output_model_dir`
- Produces: Docker and docs aligned with backend model discovery

- [ ] **Step 1: Update compose mounts**

Replace legacy mounts:

```yaml
- ./models:/app/models:ro
- ./yolo_model:/app/yolo_model:ro
```

with:

```yaml
- ./world_model:/app/world_model:ro
- ./input_model:/app/input_model:ro
- ./output_model:/app/output_model
```

Apply this to both `docker-compose.yml` and `docker-compose.jetson.yml`.

- [ ] **Step 2: Add model folder listing test**

In `tests/backend/test_models_api.py`, add a test that creates files under temporary `world_model`, `input_model`, and `output_model` paths, then asserts:

```python
assert models["world_models"] == ["yolov8s-world.pt"]
assert models["input_models"] == ["yolov8n.pt"]
assert models["output_models"] == ["project-a/best.pt", "project-a/best.onnx"]
```

- [ ] **Step 3: Run model tests**

Run:

```bash
pytest tests/backend/test_models_api.py tests/backend/test_world_models.py -v
```

Expected: all selected model tests pass.

- [ ] **Step 4: Update specs**

Update `spec/RUNTIME.md` mounted paths to list the three active folders and remove the mismatch warning. Confirm `spec/DATA_MODEL.md` uses the same folder names.

- [ ] **Step 5: Validate compose config**

Run:

```bash
docker compose -f docker-compose.yml config
docker compose -f docker-compose.jetson.yml config
```

Expected: both compose files parse and include the three active model mounts.

- [ ] **Step 6: Commit**

Run:

```bash
git add docker-compose.yml docker-compose.jetson.yml spec/RUNTIME.md spec/DATA_MODEL.md tests/backend/test_models_api.py
git commit -m "fix: align model asset folders"
```

---

### Task 3: Backend Review Filters, Stats, and Annotation Validation

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/repositories.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/project_services.py`
- Test: `tests/backend/test_annotations_api.py`
- Test: `tests/backend/test_api_projects.py`

**Interfaces:**
- Produces: `GET /api/projects/{project_id}/images?review_status=&has_low_confidence=&source_asset_id=&limit=&offset=`
- Produces: `GET /api/projects/{project_id}/review-stats`
- Produces: stricter `PUT /api/images/{image_id}/annotations`

- [ ] **Step 1: Write failing backend tests**

Add tests covering:

```python
def test_images_can_be_filtered_by_review_status(client):
    response = client.get(f"/api/projects/{project_id}/images?review_status=reviewed")
    assert response.status_code == 200
    assert all(item["review_status"] == "reviewed" for item in response.json())

def test_review_stats_counts_statuses_and_low_confidence(client):
    response = client.get(f"/api/projects/{project_id}/review-stats")
    assert response.status_code == 200
    assert response.json()["pending_review"] == 1
    assert response.json()["reviewed"] == 1
    assert response.json()["low_confidence"] == 1

def test_annotation_save_rejects_invalid_bbox(client):
    response = client.put(f"/api/images/{image_id}/annotations", json={
        "review_status": "reviewed",
        "annotations": [{
            "class_id": 0,
            "class_name": "object",
            "x_center": 1.2,
            "y_center": 0.5,
            "width": 0.2,
            "height": 0.2,
            "source_type": "manual",
            "edited": True
        }]
    })
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pytest tests/backend/test_annotations_api.py tests/backend/test_api_projects.py -v
```

Expected: new tests fail because filters/stats/validation are not implemented.

- [ ] **Step 3: Implement review status validation**

In `backend/app/schemas.py`, define allowed review statuses:

```python
ReviewStatus = Literal["unreviewed", "pending_review", "needs_fix", "reviewed", "skipped"]
```

Use it in `AnnotationSaveRequest.review_status`.

- [ ] **Step 4: Implement repository filters and stats**

Add `Repository.list_images(..., review_status=None, has_low_confidence=None, source_asset_id=None)` and `Repository.get_review_stats(project_id: str, low_confidence_threshold: float = 0.5)`.

`get_review_stats` must count:

```python
{
    "unreviewed": 0,
    "pending_review": 0,
    "needs_fix": 0,
    "reviewed": 0,
    "skipped": 0,
    "edited": 0,
    "low_confidence": 0
}
```

- [ ] **Step 5: Wire FastAPI endpoints**

In `backend/app/main.py`, update `list_project_images` with query params and add:

```python
@app.get("/api/projects/{project_id}/review-stats")
def get_review_stats(project_id: str) -> dict[str, int]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.get_review_stats(project_id)
```

- [ ] **Step 6: Run backend tests**

Run:

```bash
pytest tests/backend/test_annotations_api.py tests/backend/test_api_projects.py tests/backend/test_project_services.py -v
```

Expected: all selected backend tests pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/app/schemas.py backend/app/repositories.py backend/app/main.py backend/app/project_services.py tests/backend/test_annotations_api.py tests/backend/test_api_projects.py
git commit -m "feat: add review filters and annotation validation"
```

---

### Task 4: Frontend Annotation Geometry and Reducer

**Files:**
- Create: `frontend/src/annotation/geometry.ts`
- Create: `frontend/src/annotation/reducer.ts`
- Create: `frontend/src/annotation/geometry.test.ts`
- Create: `frontend/src/annotation/reducer.test.ts`
- Modify: `frontend/src/types.ts`

**Interfaces:**
- Produces: `yoloToRect(annotation, imageSize): Rect`
- Produces: `rectToYolo(rect, imageSize): Pick<Annotation, "x_center" | "y_center" | "width" | "height">`
- Produces: `annotationReducer(state, action)`

- [ ] **Step 1: Write geometry tests**

Create tests asserting:

```ts
expect(yoloToRect({ x_center: 0.5, y_center: 0.5, width: 0.2, height: 0.4 }, { width: 1000, height: 500 }))
  .toEqual({ x: 400, y: 150, width: 200, height: 200 });

expect(rectToYolo({ x: 400, y: 150, width: 200, height: 200 }, { width: 1000, height: 500 }))
  .toEqual({ x_center: 0.5, y_center: 0.5, width: 0.2, height: 0.4 });
```

- [ ] **Step 2: Write reducer tests**

Create tests for:

- adding a manual annotation
- deleting selected annotation
- changing class
- moving box marks `edited: true`
- resizing box clamps to image bounds

- [ ] **Step 3: Run frontend tests to verify failure**

Run:

```bash
npm --prefix frontend test -- --run frontend/src/annotation
```

Expected: tests fail because files do not exist.

- [ ] **Step 4: Implement geometry helpers**

Implement pure helpers in `geometry.ts`:

```ts
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export function yoloToRect(box: Pick<Annotation, "x_center" | "y_center" | "width" | "height">, image: Size): Rect;
export function rectToYolo(rect: Rect, image: Size): Pick<Annotation, "x_center" | "y_center" | "width" | "height">;
export function clampRect(rect: Rect, image: Size): Rect;
```

- [ ] **Step 5: Implement reducer**

Implement actions:

```ts
type AnnotationAction =
  | { type: "add"; annotation: Annotation }
  | { type: "delete"; id: string }
  | { type: "changeClass"; id: string; class_id: number; class_name: string }
  | { type: "move"; id: string; rect: Rect; image: Size }
  | { type: "resize"; id: string; rect: Rect; image: Size }
  | { type: "replace"; annotations: Annotation[] };
```

- [ ] **Step 6: Run frontend tests**

Run:

```bash
npm --prefix frontend test -- --run frontend/src/annotation
```

Expected: geometry and reducer tests pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add frontend/src/annotation frontend/src/types.ts
git commit -m "feat: add annotation geometry state"
```

---

### Task 5: Offline Review Workbench UI

**Files:**
- Create: `frontend/src/pages/ReviewPage.tsx`
- Create: `frontend/src/components/review/AnnotationCanvas.tsx`
- Create: `frontend/src/components/review/AnnotationToolbar.tsx`
- Create: `frontend/src/components/review/AnnotationInspector.tsx`
- Create: `frontend/src/components/review/ImageQueue.tsx`
- Create: `frontend/src/components/review/ClassPalette.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: annotation geometry and reducer from Task 4
- Consumes: backend review filters/stats from Task 3
- Produces: a usable local SVG bbox editor

- [ ] **Step 1: Update API client types**

Add:

```ts
reviewStats: (projectId: string) => request<ReviewStats>(`/api/projects/${projectId}/review-stats`),
images: (projectId: string, filters: ImageFilters = {}) => request<ProjectImage[]>(`/api/projects/${projectId}/images?${new URLSearchParams(...)}`)
```

- [ ] **Step 2: Extract `ReviewPage` from `App.tsx`**

Move review loading/saving behavior into `frontend/src/pages/ReviewPage.tsx`. `App.tsx` should only render:

```tsx
{page === "review" && activeProject && <ReviewPage t={t} project={activeProject} />}
```

- [ ] **Step 3: Implement `AnnotationCanvas`**

Use an `<img>` plus `<svg>` overlay. Required props:

```ts
type AnnotationCanvasProps = {
  image: ProjectImage;
  annotations: Annotation[];
  selectedId: string | null;
  selectedClass: ClassItem | null;
  mode: "select" | "draw" | "pan";
  onChange: (annotations: Annotation[]) => void;
  onSelect: (id: string | null) => void;
};
```

- [ ] **Step 4: Implement inspector, toolbar, queue, palette**

Each component should be presentational where possible and receive callbacks from `ReviewPage`.

- [ ] **Step 5: Add keyboard shortcuts**

Support:

- `ArrowLeft` / `ArrowRight`: previous/next image.
- `Delete`: delete selected annotation.
- `w`: draw mode.
- `v`: select mode.
- `s`: save.
- `1` through `9`: select class by visible order.

- [ ] **Step 6: Build frontend**

Run:

```bash
npm --prefix frontend run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 7: Commit**

Run:

```bash
git add frontend/src/App.tsx frontend/src/api/client.ts frontend/src/styles.css frontend/src/pages frontend/src/components/review
git commit -m "feat: add offline review workbench"
```

---

### Task 6: End-to-End Verification and Documentation

**Files:**
- Modify: `spec/PROJECT_MAP.md`
- Modify: `spec/UI.md`
- Modify: `spec/API.md`
- Modify: `spec/OPERATIONS.md`
- Modify: `spec/TESTING.md`
- Test: project-wide commands

**Interfaces:**
- Consumes: all prior tasks
- Produces: documented, verified first-phase implementation

- [ ] **Step 1: Update spec docs**

Update spec docs to describe the implemented offline workbench, active model folders, review stats endpoint, image filters, and test commands.

- [ ] **Step 2: Run backend tests**

Run:

```bash
pytest -v
```

Expected: all backend tests pass.

- [ ] **Step 3: Run frontend tests**

Run:

```bash
npm --prefix frontend test
```

Expected: all frontend tests pass.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: build succeeds and writes `frontend/dist`, which remains ignored by git.

- [ ] **Step 5: Validate shell and compose**

Run:

```bash
bash -n run.sh
docker compose -f docker-compose.yml config
docker compose -f docker-compose.jetson.yml config
```

Expected: shell syntax and compose validation pass.

- [ ] **Step 6: Final commit**

Run:

```bash
git add spec docs/superpowers/plans/2026-06-26-offline-label-workbench.md
git commit -m "docs: document offline workbench implementation"
```

- [ ] **Step 7: Push to GitHub**

Run:

```bash
git branch -M main
git push -u origin main
```

Expected: repository is pushed to `https://github.com/a0665x/ObjectAutoLabel`.

---

## Self-Review

- Spec coverage: The plan covers model-folder cleanup, Docker alignment, offline SVG editor, review statuses, annotation validation, queue filters, review stats, split behavior, tests, docs, and Git hygiene.
- Placeholder scan: No placeholder markers or unspecified implementation steps remain.
- Type consistency: Frontend tasks consistently use `Annotation`, `ProjectImage`, `ClassItem`, `Rect`, `Size`, and `ReviewStats`. Backend tasks consistently use project image filters, review statuses, and normalized YOLO annotations.
