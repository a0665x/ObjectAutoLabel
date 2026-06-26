# ObjectAutoLabel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Dataset Project Hub that replaces the Roboflow workflow with local pseudo-label generation, bbox review/editing, dataset splitting, training, and export.

**Architecture:** Keep FastAPI as the backend, add SQLite-backed metadata/repositories/jobs, and replace the static vanilla frontend with a React/Vite SPA served by FastAPI. The backend owns files, models, YOLO labels, and long-running jobs; the frontend owns project navigation, i18n, progress display, and a custom local bbox editor that saves annotations explicitly.

**Tech Stack:** FastAPI, Pydantic, SQLite (`sqlite3`), pytest, Ultralytics, OpenCV, React, Vite, TypeScript, Vitest, Playwright, Lucide icons.

---

## Scope Check

The approved spec spans several subsystems. This plan keeps them in one implementation sequence because each task produces working local product surface and the subsystems are tightly coupled through project metadata. Execute task-by-task with review checkpoints; do not attempt all tasks in one pass.

If time or risk forces a cut, complete Tasks 1-5 first. That gives a working local project hub with persistent metadata, models, sources, pseudo-label generation, and basic review APIs. Tasks 6-8 complete the React UI/editor and train/export loop.

## File Structure

### Backend Files

- Create `backend/app/config.py`: central paths and folder names (`world_model`, `input_model`, `output_model`, `object_autolabel.db`).
- Create `backend/app/db.py`: SQLite connection, schema creation, transaction helper, row serialization.
- Create `backend/app/repositories.py`: CRUD helpers for projects, sources, schemas, images, annotations, splits, training, exports, and jobs.
- Create `backend/app/schemas.py`: Pydantic request/response models for the new project-based API.
- Create `backend/app/label_io.py`: YOLO label read/write and normalized coordinate helpers.
- Create `backend/app/project_services.py`: local project, source, split, training artifact, and export operations.
- Create `backend/app/world_models.py`: model discovery and YOLO-World pseudo-label execution adapter.
- Modify `backend/app/jobs.py`: make jobs persist to SQLite while keeping thread-pool execution.
- Modify `backend/app/services.py`: move or wrap legacy useful functions behind project-aware services.
- Modify `backend/app/main.py`: replace form endpoints with project-based API while still serving built frontend assets.

### Frontend Files

- Create `frontend/package.json`: Vite/React scripts.
- Create `frontend/index.html`: Vite entry HTML.
- Create `frontend/src/main.tsx`: React entry point.
- Create `frontend/src/App.tsx`: app shell and route selection.
- Create `frontend/src/api/client.ts`: typed API helpers.
- Create `frontend/src/i18n.ts`: EN/ZH/JA/KO primary UI dictionary.
- Create `frontend/src/types.ts`: frontend DTOs.
- Create `frontend/src/components/AppShell.tsx`: top bar, sidebar, language selector, project switcher, job status.
- Create `frontend/src/components/ProgressPanel.tsx`: job list and progress UI.
- Create `frontend/src/pages/ProjectsPage.tsx`
- Create `frontend/src/pages/SourcesPage.tsx`
- Create `frontend/src/pages/ClassSchemaPage.tsx`
- Create `frontend/src/pages/PseudoLabelPage.tsx`
- Create `frontend/src/pages/ReviewPage.tsx`
- Create `frontend/src/pages/SplitDatasetPage.tsx`
- Create `frontend/src/pages/TrainPage.tsx`
- Create `frontend/src/pages/ModelsExportPage.tsx`
- Create `frontend/src/pages/SettingsPage.tsx`
- Create `frontend/src/editor/BBoxEditor.tsx`
- Create `frontend/src/editor/geometry.ts`
- Create `frontend/src/editor/useImagePreload.ts`
- Create `frontend/src/styles.css`
- Create `frontend/vite.config.ts`
- Create `frontend/tsconfig.json`
- Create explicit frontend tests listed in each task, starting with `frontend/src/i18n.test.ts`, `frontend/src/api/client.test.ts`, and `frontend/src/editor/geometry.test.ts`.

### Tests And Tooling

- Create `tests/backend/test_db.py`
- Create `tests/backend/test_repositories.py`
- Create `tests/backend/test_label_io.py`
- Create `tests/backend/test_api_projects.py`
- Create `tests/backend/test_jobs.py`
- Create `tests/backend/test_project_services.py`
- Create `tests/backend/test_models_api.py`
- Create `frontend/src/editor/geometry.test.ts`
- Create `frontend/src/i18n.test.ts`
- Create `frontend/src/api/client.test.ts`
- Create `frontend/tests/e2e/project-hub.spec.ts`
- Create `pytest.ini`
- Modify `requirements.txt` and `requirements-jetson.txt` only if new Python dependencies are required. Prefer stdlib SQLite and avoid adding backend dependencies unless necessary.
- Modify `Dockerfile`, `Dockerfile.jetson`, `docker-compose.yml`, `docker-compose.jetson.yml`, and `run.sh` after the React app exists.
- Update `spec/*.md` after implementation behavior is settled.

### Commit Checkpoints

This workspace currently appears not to be a Git repository. Each task includes a commit step because the plan is reusable. If `git status --short` fails with `fatal: not a git repository`, record the checkpoint in the task tracker and continue without committing.

---

## Task 1: Backend Configuration, SQLite Schema, And Test Harness

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/app/db.py`
- Create: `tests/backend/test_db.py`
- Create: `pytest.ini`

- [ ] **Step 1: Create pytest configuration**

Create `pytest.ini`:

```ini
[pytest]
testpaths = tests
pythonpath = .
addopts = -q
```

- [ ] **Step 2: Write failing database tests**

Create `tests/backend/test_db.py`:

```python
from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema


def test_app_paths_use_new_model_folder_names(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)

    assert paths.world_model_dir == tmp_path / "world_model"
    assert paths.input_model_dir == tmp_path / "input_model"
    assert paths.output_model_dir == tmp_path / "output_model"
    assert paths.database_path == tmp_path / "object_autolabel.db"


def test_initialize_schema_creates_core_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "object_autolabel.db"
    with connect(db_path) as db:
        initialize_schema(db)
        rows = db.execute(
            "select name from sqlite_master where type = 'table' order by name"
        ).fetchall()

    table_names = {row["name"] for row in rows}
    assert {
        "annotations",
        "class_descriptors",
        "class_schemas",
        "dataset_splits",
        "frame_extraction_runs",
        "images",
        "jobs",
        "model_exports",
        "projects",
        "pseudo_label_runs",
        "review_sessions",
        "source_assets",
        "training_runs",
    }.issubset(table_names)


def test_initialize_schema_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "object_autolabel.db"
    with connect(db_path) as db:
        initialize_schema(db)
        initialize_schema(db)
        count = db.execute("select count(*) as count from projects").fetchone()["count"]

    assert count == 0
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
python3 -m pytest tests/backend/test_db.py -q
```

Expected: FAIL because `backend.app.config` and `backend.app.db` do not exist.

- [ ] **Step 4: Implement path configuration**

Create `backend/app/config.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class AppPaths:
    project_root: Path = PROJECT_ROOT

    @property
    def data_dir(self) -> Path:
        return self.project_root / "data"

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "projects"

    @property
    def world_model_dir(self) -> Path:
        return self.project_root / "world_model"

    @property
    def input_model_dir(self) -> Path:
        return self.project_root / "input_model"

    @property
    def output_model_dir(self) -> Path:
        return self.project_root / "output_model"

    @property
    def runs_dir(self) -> Path:
        return self.project_root / "runs"

    @property
    def database_path(self) -> Path:
        return self.project_root / "object_autolabel.db"


def ensure_runtime_dirs(paths: AppPaths = AppPaths()) -> None:
    for path in (
        paths.data_dir,
        paths.projects_dir,
        paths.world_model_dir,
        paths.input_model_dir,
        paths.output_model_dir,
        paths.runs_dir,
    ):
        path.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 5: Implement SQLite schema**

Create `backend/app/db.py`:

```python
from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any


def connect(database_path: Path | str) -> sqlite3.Connection:
    db = sqlite3.connect(str(database_path), check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("pragma foreign_keys = on")
    return db


@contextmanager
def transaction(db: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def initialize_schema(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        create table if not exists projects (
            id text primary key,
            slug text not null unique,
            name text not null,
            description text not null default '',
            root_path text not null,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists source_assets (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            kind text not null check (kind in ('video', 'image_folder')),
            path text not null,
            status text not null default 'ready',
            created_at text not null
        );

        create table if not exists frame_extraction_runs (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            source_asset_id text not null references source_assets(id) on delete cascade,
            output_dir text not null,
            frames_per_second real not null,
            resize_enabled integer not null default 0,
            resize_width integer,
            resize_height integer,
            frame_count integer not null default 0,
            job_id text,
            created_at text not null
        );

        create table if not exists class_schemas (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            name text not null,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists class_descriptors (
            id text primary key,
            schema_id text not null references class_schemas(id) on delete cascade,
            class_id integer not null,
            class_name text not null,
            descriptor text not null,
            sort_order integer not null default 0
        );

        create table if not exists pseudo_label_runs (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            schema_id text not null references class_schemas(id),
            source_asset_id text references source_assets(id),
            world_model text not null,
            output_dir text not null,
            confidence real not null,
            iou real not null,
            image_count integer not null default 0,
            labeled_count integer not null default 0,
            job_id text,
            created_at text not null
        );

        create table if not exists images (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            source_asset_id text references source_assets(id) on delete set null,
            pseudo_label_run_id text references pseudo_label_runs(id) on delete set null,
            path text not null,
            width integer,
            height integer,
            review_status text not null default 'unreviewed',
            created_at text not null
        );

        create table if not exists annotations (
            id text primary key,
            image_id text not null references images(id) on delete cascade,
            class_id integer not null,
            class_name text not null,
            x_center real not null,
            y_center real not null,
            width real not null,
            height real not null,
            confidence real,
            source_descriptor text,
            source_type text not null default 'pseudo',
            edited integer not null default 0,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists review_sessions (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            pseudo_label_run_id text references pseudo_label_runs(id) on delete set null,
            reviewed_count integer not null default 0,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists dataset_splits (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            name text not null,
            train_ratio real not null,
            val_ratio real not null,
            test_ratio real not null,
            output_dir text not null,
            dataset_yaml_path text not null,
            image_ids_json text not null,
            job_id text,
            created_at text not null
        );

        create table if not exists training_runs (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            dataset_split_id text not null references dataset_splits(id),
            input_model text not null,
            output_dir text not null,
            best_model_path text,
            last_model_path text,
            status text not null default 'queued',
            job_id text,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists model_exports (
            id text primary key,
            project_id text not null references projects(id) on delete cascade,
            training_run_id text not null references training_runs(id) on delete cascade,
            source_model_path text not null,
            export_format text not null,
            output_path text,
            status text not null default 'queued',
            job_id text,
            created_at text not null,
            updated_at text not null
        );

        create table if not exists jobs (
            id text primary key,
            project_id text references projects(id) on delete set null,
            related_type text,
            related_id text,
            name text not null,
            status text not null,
            progress integer not null default 0,
            message text not null default '',
            result_json text,
            error text,
            created_at text not null,
            updated_at text not null
        );
        """
    )
    db.commit()
```

- [ ] **Step 6: Run database tests**

Run:

```bash
python3 -m pytest tests/backend/test_db.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint**

Run:

```bash
git status --short
git add pytest.ini backend/app/config.py backend/app/db.py tests/backend/test_db.py
git commit -m "feat: add sqlite schema and app paths"
```

Expected if Git is available: commit succeeds. If not a Git repository, note checkpoint complete without commit.

---

## Task 2: Repositories, Projects, Class Schemas, And Models

**Files:**
- Create: `backend/app/repositories.py`
- Create: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Create: `tests/backend/test_repositories.py`
- Create: `tests/backend/test_api_projects.py`
- Create: `tests/backend/test_models_api.py`

- [ ] **Step 1: Write repository tests**

Create `tests/backend/test_repositories.py`:

```python
from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def make_repo(tmp_path: Path) -> Repository:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    return Repository(db=db, paths=AppPaths(project_root=tmp_path))


def test_create_project_creates_project_folders(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)

    project = repo.create_project(name="Drone Cars", description="aerial labels")

    assert project["slug"] == "drone-cars"
    assert Path(project["root_path"]).exists()
    assert (Path(project["root_path"]) / "sources").exists()
    assert (Path(project["root_path"]) / "reviewed_labels").exists()


def test_create_class_schema_preserves_class_id_order(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    project = repo.create_project(name="Demo", description="")

    schema = repo.create_class_schema(
        project_id=project["id"],
        name="Default",
        classes=[
            {"class_id": 0, "class_name": "person", "descriptors": ["standing person", "walking person"]},
            {"class_id": 1, "class_name": "car", "descriptors": ["sedan car", "aerial vehicle"]},
        ],
    )
    loaded = repo.get_class_schema(schema["id"])

    assert loaded is not None
    assert loaded["classes"][0]["class_id"] == 0
    assert loaded["classes"][0]["descriptors"] == ["standing person", "walking person"]
    assert loaded["classes"][1]["class_name"] == "car"


def test_list_models_uses_world_and_input_dirs(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    (tmp_path / "world_model").mkdir()
    (tmp_path / "input_model").mkdir()
    (tmp_path / "world_model" / "yolov8s-world.pt").write_text("x", encoding="utf-8")
    (tmp_path / "input_model" / "yolov8n.pt").write_text("x", encoding="utf-8")

    models = repo.list_models()

    assert models == {
        "world_models": ["yolov8s-world.pt"],
        "input_models": ["yolov8n.pt"],
        "output_models": [],
    }
```

- [ ] **Step 2: Run repository tests and verify they fail**

Run:

```bash
python3 -m pytest tests/backend/test_repositories.py -q
```

Expected: FAIL because `Repository` does not exist.

- [ ] **Step 3: Implement repository helpers**

Create `backend/app/repositories.py`:

```python
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .config import AppPaths
from .db import row_to_dict, rows_to_dicts, transaction


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid4().hex


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "project"


class Repository:
    def __init__(self, db: Any, paths: AppPaths) -> None:
        self.db = db
        self.paths = paths

    def create_project(self, name: str, description: str = "") -> dict[str, Any]:
        now = utc_now()
        base_slug = slugify(name)
        slug = base_slug
        suffix = 2
        while self.db.execute("select 1 from projects where slug = ?", (slug,)).fetchone():
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        project_id = new_id()
        root_path = self.paths.projects_dir / slug
        for child in ("sources", "frames", "pseudo_labels", "reviewed_labels", "splits", "metadata"):
            (root_path / child).mkdir(parents=True, exist_ok=True)
        with transaction(self.db):
            self.db.execute(
                """
                insert into projects (id, slug, name, description, root_path, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (project_id, slug, name, description, str(root_path), now, now),
            )
        project = self.get_project(project_id)
        assert project is not None
        return project

    def list_projects(self) -> list[dict[str, Any]]:
        rows = self.db.execute("select * from projects order by created_at desc").fetchall()
        return rows_to_dicts(rows)

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from projects where id = ?", (project_id,)).fetchone())

    def create_class_schema(
        self,
        project_id: str,
        name: str,
        classes: list[dict[str, Any]],
    ) -> dict[str, Any]:
        schema_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into class_schemas (id, project_id, name, created_at, updated_at)
                values (?, ?, ?, ?, ?)
                """,
                (schema_id, project_id, name, now, now),
            )
            for item in classes:
                class_id = int(item["class_id"])
                class_name = str(item["class_name"])
                for sort_order, descriptor in enumerate(item.get("descriptors", [])):
                    self.db.execute(
                        """
                        insert into class_descriptors
                        (id, schema_id, class_id, class_name, descriptor, sort_order)
                        values (?, ?, ?, ?, ?, ?)
                        """,
                        (new_id(), schema_id, class_id, class_name, str(descriptor), sort_order),
                    )
        schema = self.get_class_schema(schema_id)
        assert schema is not None
        return schema

    def get_class_schema(self, schema_id: str) -> dict[str, Any] | None:
        schema = row_to_dict(
            self.db.execute("select * from class_schemas where id = ?", (schema_id,)).fetchone()
        )
        if not schema:
            return None
        rows = self.db.execute(
            """
            select class_id, class_name, descriptor
            from class_descriptors
            where schema_id = ?
            order by class_id asc, sort_order asc
            """,
            (schema_id,),
        ).fetchall()
        grouped: dict[int, dict[str, Any]] = {}
        for row in rows:
            class_id = int(row["class_id"])
            grouped.setdefault(
                class_id,
                {"class_id": class_id, "class_name": row["class_name"], "descriptors": []},
            )
            grouped[class_id]["descriptors"].append(row["descriptor"])
        schema["classes"] = [grouped[key] for key in sorted(grouped)]
        return schema

    def list_class_schemas(self, project_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "select id from class_schemas where project_id = ? order by created_at desc",
            (project_id,),
        ).fetchall()
        return [schema for row in rows if (schema := self.get_class_schema(row["id"])) is not None]

    def list_models(self) -> dict[str, list[str]]:
        def pt_files(path: Path) -> list[str]:
            return sorted(item.name for item in path.glob("*.pt")) if path.exists() else []

        output_models: list[str] = []
        if self.paths.output_model_dir.exists():
            output_models = sorted(
                str(item.relative_to(self.paths.output_model_dir))
                for item in self.paths.output_model_dir.rglob("*")
                if item.suffix in {".pt", ".tflite", ".onnx", ".torchscript"}
            )
        return {
            "world_models": pt_files(self.paths.world_model_dir),
            "input_models": pt_files(self.paths.input_model_dir),
            "output_models": output_models,
        }

    def create_job(
        self,
        name: str,
        project_id: str | None = None,
        related_type: str | None = None,
        related_id: str | None = None,
    ) -> dict[str, Any]:
        job_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into jobs
                (id, project_id, related_type, related_id, name, status, progress, message, created_at, updated_at)
                values (?, ?, ?, ?, ?, 'queued', 0, 'Queued', ?, ?)
                """,
                (job_id, project_id, related_type, related_id, name, now, now),
            )
        job = self.get_job(job_id)
        assert job is not None
        return job

    def update_job(self, job_id: str, **patch: Any) -> None:
        allowed = {"status", "progress", "message", "result_json", "error"}
        updates = {key: value for key, value in patch.items() if key in allowed}
        if not updates:
            return
        updates["updated_at"] = utc_now()
        columns = ", ".join(f"{key} = ?" for key in updates)
        values = list(updates.values()) + [job_id]
        with transaction(self.db):
            self.db.execute(f"update jobs set {columns} where id = ?", values)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        job = row_to_dict(self.db.execute("select * from jobs where id = ?", (job_id,)).fetchone())
        if job and job.get("result_json"):
            job["result"] = json.loads(job["result_json"])
        elif job:
            job["result"] = None
        return job

    def list_jobs(self) -> list[dict[str, Any]]:
        rows = self.db.execute("select * from jobs order by created_at desc limit 100").fetchall()
        jobs = []
        for row in rows:
            job = dict(row)
            job["result"] = json.loads(job["result_json"]) if job.get("result_json") else None
            jobs.append(job)
        return jobs
```

- [ ] **Step 4: Implement Pydantic schemas**

Create `backend/app/schemas.py`:

```python
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""


class ClassDescriptorItem(BaseModel):
    class_id: int = Field(ge=0)
    class_name: str = Field(min_length=1)
    descriptors: list[str] = Field(default_factory=list)


class ClassSchemaCreate(BaseModel):
    name: str = Field(min_length=1)
    classes: list[ClassDescriptorItem]


class ApiJob(BaseModel):
    id: str
    name: str
    status: str
    progress: int
    message: str
    result: Any | None = None
    error: str | None = None
```

- [ ] **Step 5: Add app factory and project/model routes**

Modify `backend/app/main.py` to initialize paths, DB, and repository. Keep legacy endpoints temporarily if needed, but add these routes:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import AppPaths, ensure_runtime_dirs
from .db import connect, initialize_schema
from .repositories import Repository
from .schemas import ClassSchemaCreate, ProjectCreate


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
STATIC_DIR = FRONTEND_DIR / "dist"

paths = AppPaths(project_root=PROJECT_ROOT)
ensure_runtime_dirs(paths)
db = connect(paths.database_path)
initialize_schema(db)
repo = Repository(db=db, paths=paths)

app = FastAPI(title="ObjectAutoLabel API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "project_root": str(PROJECT_ROOT)}


@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    return repo.list_projects()


@app.post("/api/projects")
def create_project(payload: ProjectCreate) -> dict[str, Any]:
    return repo.create_project(name=payload.name, description=payload.description)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.get("/api/projects/{project_id}/class-schemas")
def list_class_schemas(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_class_schemas(project_id)


@app.post("/api/projects/{project_id}/class-schemas")
def create_class_schema(project_id: str, payload: ClassSchemaCreate) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.create_class_schema(
        project_id=project_id,
        name=payload.name,
        classes=[item.model_dump() for item in payload.classes],
    )


@app.get("/api/models/world")
def list_world_models() -> dict[str, list[str]]:
    return {"world_models": repo.list_models()["world_models"]}


@app.get("/api/models/input")
def list_input_models() -> dict[str, list[str]]:
    return {"input_models": repo.list_models()["input_models"]}


@app.get("/api/models/output")
def list_output_models() -> dict[str, list[str]]:
    return {"output_models": repo.list_models()["output_models"]}


@app.get("/api/jobs")
def list_jobs() -> list[dict[str, Any]]:
    return repo.list_jobs()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = repo.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
else:
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
```

- [ ] **Step 6: Write API tests**

Create `tests/backend/test_api_projects.py`:

```python
from fastapi.testclient import TestClient

from backend.app.main import app


def test_create_and_list_project() -> None:
    client = TestClient(app)

    response = client.post("/api/projects", json={"name": "API Demo", "description": "demo"})
    assert response.status_code == 200
    project = response.json()

    assert project["name"] == "API Demo"
    assert project["slug"].startswith("api-demo")

    list_response = client.get("/api/projects")
    assert list_response.status_code == 200
    assert any(item["id"] == project["id"] for item in list_response.json())


def test_create_class_schema_via_api() -> None:
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "Schema API"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/class-schemas",
        json={
            "name": "Default",
            "classes": [
                {"class_id": 0, "class_name": "person", "descriptors": ["person"]},
                {"class_id": 1, "class_name": "car", "descriptors": ["car", "van"]},
            ],
        },
    )

    assert response.status_code == 200
    schema = response.json()
    assert schema["classes"][1]["descriptors"] == ["car", "van"]
```

Create `tests/backend/test_models_api.py`:

```python
from fastapi.testclient import TestClient

from backend.app.main import app


def test_model_endpoints_return_lists() -> None:
    client = TestClient(app)

    assert "world_models" in client.get("/api/models/world").json()
    assert "input_models" in client.get("/api/models/input").json()
    assert "output_models" in client.get("/api/models/output").json()
```

- [ ] **Step 7: Run backend tests**

Run:

```bash
python3 -m pytest tests/backend/test_db.py tests/backend/test_repositories.py tests/backend/test_api_projects.py tests/backend/test_models_api.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit checkpoint**

Run:

```bash
git status --short
git add backend/app/main.py backend/app/repositories.py backend/app/schemas.py tests/backend/test_repositories.py tests/backend/test_api_projects.py tests/backend/test_models_api.py
git commit -m "feat: add project metadata APIs"
```

Expected if Git is available: commit succeeds. If not a Git repository, note checkpoint complete without commit.

---

## Task 3: YOLO Label IO, Sources, Frame Extraction, And Image Registration

**Files:**
- Create: `backend/app/label_io.py`
- Create: `backend/app/project_services.py`
- Modify: `backend/app/repositories.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Create: `tests/backend/test_label_io.py`
- Create: `tests/backend/test_project_services.py`

- [ ] **Step 1: Write YOLO label IO tests**

Create `tests/backend/test_label_io.py`:

```python
from pathlib import Path

from backend.app.label_io import AnnotationRow, read_yolo_labels, write_yolo_labels


def test_write_and_read_yolo_labels(tmp_path: Path) -> None:
    path = tmp_path / "labels" / "image.txt"
    rows = [
        AnnotationRow(class_id=1, x_center=0.5, y_center=0.25, width=0.2, height=0.1),
        AnnotationRow(class_id=0, x_center=0.1, y_center=0.2, width=0.3, height=0.4),
    ]

    write_yolo_labels(path, rows)
    loaded = read_yolo_labels(path)

    assert loaded == rows
    assert path.read_text(encoding="utf-8").splitlines()[0] == "1 0.500000 0.250000 0.200000 0.100000"


def test_read_missing_yolo_label_returns_empty(tmp_path: Path) -> None:
    assert read_yolo_labels(tmp_path / "missing.txt") == []
```

- [ ] **Step 2: Implement YOLO label IO**

Create `backend/app/label_io.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AnnotationRow:
    class_id: int
    x_center: float
    y_center: float
    width: float
    height: float


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def write_yolo_labels(path: Path, rows: list[AnnotationRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(
        (
            f"{row.class_id} "
            f"{_clamp01(row.x_center):.6f} "
            f"{_clamp01(row.y_center):.6f} "
            f"{_clamp01(row.width):.6f} "
            f"{_clamp01(row.height):.6f}"
        )
        for row in rows
    )
    path.write_text(content, encoding="utf-8")


def read_yolo_labels(path: Path) -> list[AnnotationRow]:
    if not path.exists():
        return []
    rows: list[AnnotationRow] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        class_id, x_center, y_center, width, height = stripped.split()
        rows.append(
            AnnotationRow(
                class_id=int(class_id),
                x_center=float(x_center),
                y_center=float(y_center),
                width=float(width),
                height=float(height),
            )
        )
    return rows
```

- [ ] **Step 3: Run label IO tests**

Run:

```bash
python3 -m pytest tests/backend/test_label_io.py -q
```

Expected: PASS.

- [ ] **Step 4: Extend schemas for sources and frame runs**

Add to `backend/app/schemas.py`:

```python
class SourceCreate(BaseModel):
    kind: str
    path: str = Field(min_length=1)


class FrameRunCreate(BaseModel):
    source_asset_id: str
    frames_per_second: float = Field(2.0, gt=0)
    resize_enabled: bool = False
    resize_width: int | None = Field(None, gt=0)
    resize_height: int | None = Field(None, gt=0)
```

- [ ] **Step 5: Extend repository for sources and images**

Add these methods to `backend/app/repositories.py`:

```python
    def create_source_asset(self, project_id: str, kind: str, path: str) -> dict[str, Any]:
        source_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into source_assets (id, project_id, kind, path, created_at)
                values (?, ?, ?, ?, ?)
                """,
                (source_id, project_id, kind, path, now),
            )
        source = self.get_source_asset(source_id)
        assert source is not None
        return source

    def get_source_asset(self, source_asset_id: str) -> dict[str, Any] | None:
        return row_to_dict(
            self.db.execute("select * from source_assets where id = ?", (source_asset_id,)).fetchone()
        )

    def list_source_assets(self, project_id: str) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                "select * from source_assets where project_id = ? order by created_at desc",
                (project_id,),
            ).fetchall()
        )

    def create_image(
        self,
        project_id: str,
        path: str,
        source_asset_id: str | None = None,
        pseudo_label_run_id: str | None = None,
        width: int | None = None,
        height: int | None = None,
    ) -> dict[str, Any]:
        image_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into images
                (id, project_id, source_asset_id, pseudo_label_run_id, path, width, height, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (image_id, project_id, source_asset_id, pseudo_label_run_id, path, width, height, now),
            )
        image = self.get_image(image_id)
        assert image is not None
        return image

    def get_image(self, image_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from images where id = ?", (image_id,)).fetchone())

    def list_images(self, project_id: str, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                """
                select * from images
                where project_id = ?
                order by path asc
                limit ? offset ?
                """,
                (project_id, limit, offset),
            ).fetchall()
        )
```

- [ ] **Step 6: Implement project services for image folder registration and frame extraction**

Create `backend/app/project_services.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2

from .repositories import Repository


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def register_image_folder(repo: Repository, project_id: str, source_asset_id: str, folder: str) -> dict[str, Any]:
    folder_path = Path(folder)
    if not folder_path.exists():
        raise FileNotFoundError(f"Image folder does not exist: {folder}")
    image_paths = sorted(path for path in folder_path.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS)
    created = 0
    for image_path in image_paths:
        image = cv2.imread(str(image_path))
        height = width = None
        if image is not None:
            height, width = image.shape[:2]
        repo.create_image(
            project_id=project_id,
            source_asset_id=source_asset_id,
            path=str(image_path),
            width=width,
            height=height,
        )
        created += 1
    return {"registered_images": created}


def split_video_into_frames(
    repo: Repository,
    project_id: str,
    source_asset_id: str,
    video_path: str,
    output_dir: str,
    frames_per_second: float,
    resize_enabled: bool = False,
    resize_width: int | None = None,
    resize_height: int | None = None,
    *,
    job_id: str,
) -> dict[str, Any]:
    if frames_per_second <= 0:
        raise ValueError("frames_per_second must be greater than 0")
    if resize_enabled and (not resize_width or not resize_height):
        raise ValueError("resize_width and resize_height are required when resize is enabled")

    images_dir = Path(output_dir) / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Unable to read video: {video_path}")

    frame_rate = cap.get(cv2.CAP_PROP_FPS) or frames_per_second
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_interval = max(1, int(frame_rate / frames_per_second))
    video_filename = Path(video_path).stem
    saved = 0
    frame_index = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index % frame_interval == 0:
            if resize_enabled:
                frame = cv2.resize(frame, (resize_width, resize_height), interpolation=cv2.INTER_AREA)
            timestamp = frame_index / frame_rate
            output_file = images_dir / f"{video_filename}_{frame_index:06d}_time_{timestamp:.2f}.jpg"
            cv2.imwrite(str(output_file), frame)
            height, width = frame.shape[:2]
            repo.create_image(
                project_id=project_id,
                source_asset_id=source_asset_id,
                path=str(output_file),
                width=width,
                height=height,
            )
            saved += 1
        frame_index += 1
        if total_frames:
            progress = min(99, int(frame_index / total_frames * 100))
            repo.update_job(job_id, progress=progress, message=f"Processed {frame_index}/{total_frames} frames")

    cap.release()
    return {"images_dir": str(images_dir), "saved_frames": saved}
```

- [ ] **Step 7: Add source routes**

Modify `backend/app/main.py`:

```python
from . import project_services
from .schemas import FrameRunCreate, SourceCreate
```

Add routes before the static mount:

```python
@app.get("/api/projects/{project_id}/sources")
def list_sources(project_id: str) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_source_assets(project_id)


@app.post("/api/projects/{project_id}/sources")
def create_source(project_id: str, payload: SourceCreate) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.kind not in {"video", "image_folder"}:
        raise HTTPException(status_code=422, detail="kind must be video or image_folder")
    source = repo.create_source_asset(project_id=project_id, kind=payload.kind, path=payload.path)
    if payload.kind == "image_folder":
        project_services.register_image_folder(repo, project_id, source["id"], payload.path)
    return source


@app.get("/api/projects/{project_id}/images")
def list_project_images(project_id: str, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return repo.list_images(project_id, limit=limit, offset=offset)
```

Frame-run job wiring will be finalized in Task 4 after persistent job execution is in place.

- [ ] **Step 8: Write project service tests**

Create `tests/backend/test_project_services.py`:

```python
from pathlib import Path

import cv2
import numpy as np

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.project_services import register_image_folder
from backend.app.repositories import Repository


def test_register_image_folder_creates_image_records(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    project = repo.create_project("Images")
    source = repo.create_source_asset(project["id"], "image_folder", str(tmp_path / "images"))
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    image = np.zeros((20, 30, 3), dtype=np.uint8)
    cv2.imwrite(str(image_dir / "a.jpg"), image)

    result = register_image_folder(repo, project["id"], source["id"], str(image_dir))
    images = repo.list_images(project["id"])

    assert result == {"registered_images": 1}
    assert images[0]["width"] == 30
    assert images[0]["height"] == 20
```

- [ ] **Step 9: Run backend tests**

Run:

```bash
python3 -m pytest tests/backend/test_label_io.py tests/backend/test_project_services.py tests/backend/test_api_projects.py -q
```

Expected: PASS.

- [ ] **Step 10: Commit checkpoint**

Run:

```bash
git status --short
git add backend/app/label_io.py backend/app/project_services.py backend/app/repositories.py backend/app/schemas.py backend/app/main.py tests/backend/test_label_io.py tests/backend/test_project_services.py
git commit -m "feat: add sources and image registration"
```

Expected if Git is available: commit succeeds. If not a Git repository, note checkpoint complete without commit.

---

## Task 4: Persistent Jobs And Long-Running Operations

**Files:**
- Modify: `backend/app/jobs.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/repositories.py`
- Create: `tests/backend/test_jobs.py`

- [ ] **Step 1: Write persistent job tests**

Create `tests/backend/test_jobs.py`:

```python
from pathlib import Path

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.jobs import JobRunner
from backend.app.repositories import Repository


def test_job_runner_persists_completed_result(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    runner = JobRunner(repo=repo, max_workers=1)

    def work(*, job_id: str) -> dict[str, str]:
        repo.update_job(job_id, progress=50, message="halfway")
        return {"ok": "yes"}

    job = runner.create("demo", work)
    runner.wait(job["id"], timeout=5)
    loaded = repo.get_job(job["id"])

    assert loaded is not None
    assert loaded["status"] == "completed"
    assert loaded["progress"] == 100
    assert loaded["result"] == {"ok": "yes"}


def test_job_runner_persists_failure(tmp_path: Path) -> None:
    db = connect(tmp_path / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=tmp_path))
    runner = JobRunner(repo=repo, max_workers=1)

    def work(*, job_id: str) -> dict[str, str]:
        raise RuntimeError("boom")

    job = runner.create("demo", work)
    runner.wait(job["id"], timeout=5)
    loaded = repo.get_job(job["id"])

    assert loaded is not None
    assert loaded["status"] == "failed"
    assert "boom" in loaded["message"]
    assert "RuntimeError" in loaded["error"]
```

- [ ] **Step 2: Implement persistent job runner**

Replace `backend/app/jobs.py` with:

```python
from __future__ import annotations

import json
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable

from .repositories import Repository


class JobRunner:
    def __init__(self, repo: Repository, max_workers: int = 2) -> None:
        self.repo = repo
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._futures: dict[str, Future[Any]] = {}

    def create(
        self,
        name: str,
        fn: Callable[..., Any],
        *args: Any,
        project_id: str | None = None,
        related_type: str | None = None,
        related_id: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        job = self.repo.create_job(
            name=name,
            project_id=project_id,
            related_type=related_type,
            related_id=related_id,
        )
        job_id = job["id"]

        def run() -> Any:
            self.repo.update_job(job_id, status="running", message="Running", progress=1)
            try:
                result = fn(*args, job_id=job_id, **kwargs)
                self.repo.update_job(
                    job_id,
                    status="completed",
                    message="Completed",
                    progress=100,
                    result_json=json.dumps(result),
                )
                return result
            except Exception as exc:  # noqa: BLE001 - background job errors must be visible in UI.
                self.repo.update_job(
                    job_id,
                    status="failed",
                    message=str(exc),
                    error=traceback.format_exc(),
                )
                raise

        future = self._executor.submit(run)
        future.add_done_callback(self._consume_exception)
        self._futures[job_id] = future
        return job

    def wait(self, job_id: str, timeout: float | None = None) -> Any:
        return self._futures[job_id].result(timeout=timeout)

    @staticmethod
    def _consume_exception(future: Future[Any]) -> None:
        try:
            future.result()
        except Exception:
            pass
```

- [ ] **Step 3: Wire JobRunner into main**

Modify `backend/app/main.py` after `repo = Repository(...)`:

```python
from .jobs import JobRunner

jobs = JobRunner(repo=repo, max_workers=2)
```

Add frame-run route:

```python
@app.post("/api/projects/{project_id}/frame-runs")
def create_frame_run(project_id: str, payload: FrameRunCreate) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    source = repo.get_source_asset(payload.source_asset_id)
    if not source or source["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Source not found")
    if source["kind"] != "video":
        raise HTTPException(status_code=422, detail="Frame extraction requires a video source")
    output_dir = str(Path(project["root_path"]) / "frames")
    return jobs.create(
        "frame_extraction",
        project_services.split_video_into_frames,
        repo,
        project_id,
        source["id"],
        source["path"],
        output_dir,
        payload.frames_per_second,
        payload.resize_enabled,
        payload.resize_width,
        payload.resize_height,
        project_id=project_id,
        related_type="frame_extraction_run",
    )
```

- [ ] **Step 4: Run job tests**

Run:

```bash
python3 -m pytest tests/backend/test_jobs.py -q
```

Expected: PASS.

- [ ] **Step 5: Run route smoke tests**

Run:

```bash
python3 -m pytest tests/backend/test_api_projects.py tests/backend/test_jobs.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint**

Run:

```bash
git status --short
git add backend/app/jobs.py backend/app/main.py tests/backend/test_jobs.py
git commit -m "feat: persist background jobs"
```

Expected if Git is available: commit succeeds. If not a Git repository, note checkpoint complete without commit.

---

## Task 5: Pseudo-Label Runs, Annotation API, And Dataset Split

**Files:**
- Create: `backend/app/world_models.py`
- Modify: `backend/app/repositories.py`
- Modify: `backend/app/project_services.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Create: `tests/backend/test_annotations_api.py`
- Create: `tests/backend/test_dataset_split.py`

- [ ] **Step 1: Extend schemas for annotations, pseudo labels, and splits**

Add to `backend/app/schemas.py`:

```python
class PseudoLabelRunCreate(BaseModel):
    schema_id: str
    source_asset_id: str | None = None
    world_model: str
    confidence: float = Field(0.1, ge=0, le=1)
    iou: float = Field(0.7, ge=0, le=1)


class AnnotationUpdateItem(BaseModel):
    id: str | None = None
    class_id: int = Field(ge=0)
    class_name: str
    x_center: float = Field(ge=0, le=1)
    y_center: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)
    confidence: float | None = None
    source_descriptor: str | None = None
    source_type: str = "manual"
    edited: bool = False


class AnnotationSaveRequest(BaseModel):
    annotations: list[AnnotationUpdateItem]
    review_status: str = "reviewed"


class DatasetSplitCreate(BaseModel):
    name: str = "default"
    train_ratio: float = Field(0.8, gt=0, lt=1)
    val_ratio: float = Field(0.1, ge=0, lt=1)
    test_ratio: float = Field(0.1, ge=0, lt=1)
```

- [ ] **Step 2: Extend repository for annotations**

Add methods to `backend/app/repositories.py`:

```python
    def replace_image_annotations(
        self,
        image_id: str,
        annotations: list[dict[str, Any]],
        review_status: str,
    ) -> list[dict[str, Any]]:
        image = self.get_image(image_id)
        if not image:
            raise ValueError(f"Image not found: {image_id}")
        now = utc_now()
        with transaction(self.db):
            self.db.execute("delete from annotations where image_id = ?", (image_id,))
            for item in annotations:
                self.db.execute(
                    """
                    insert into annotations
                    (id, image_id, class_id, class_name, x_center, y_center, width, height,
                     confidence, source_descriptor, source_type, edited, created_at, updated_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item.get("id") or new_id(),
                        image_id,
                        int(item["class_id"]),
                        item["class_name"],
                        float(item["x_center"]),
                        float(item["y_center"]),
                        float(item["width"]),
                        float(item["height"]),
                        item.get("confidence"),
                        item.get("source_descriptor"),
                        item.get("source_type", "manual"),
                        1 if item.get("edited") else 0,
                        now,
                        now,
                    ),
                )
            self.db.execute(
                "update images set review_status = ? where id = ?",
                (review_status, image_id),
            )
        return self.list_annotations(image_id)

    def list_annotations(self, image_id: str) -> list[dict[str, Any]]:
        return rows_to_dicts(
            self.db.execute(
                "select * from annotations where image_id = ? order by created_at asc",
                (image_id,),
            ).fetchall()
        )

    def create_dataset_split_record(
        self,
        project_id: str,
        name: str,
        train_ratio: float,
        val_ratio: float,
        test_ratio: float,
        output_dir: str,
        dataset_yaml_path: str,
        image_ids_json: str,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        split_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into dataset_splits
                (id, project_id, name, train_ratio, val_ratio, test_ratio, output_dir,
                 dataset_yaml_path, image_ids_json, job_id, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (split_id, project_id, name, train_ratio, val_ratio, test_ratio, output_dir, dataset_yaml_path, image_ids_json, job_id, now),
            )
        return dict(self.db.execute("select * from dataset_splits where id = ?", (split_id,)).fetchone())
```

- [ ] **Step 3: Implement annotation label syncing**

Add to `backend/app/project_services.py`:

```python
import json
import shutil
import yaml
from .label_io import AnnotationRow, write_yolo_labels


def save_image_annotations(repo: Repository, image_id: str, annotations: list[dict[str, Any]], review_status: str) -> dict[str, Any]:
    image = repo.get_image(image_id)
    if not image:
        raise FileNotFoundError(f"Image not found: {image_id}")
    saved = repo.replace_image_annotations(image_id, annotations, review_status)
    image_path = Path(image["path"])
    project = repo.get_project(image["project_id"])
    assert project is not None
    labels_dir = Path(project["root_path"]) / "reviewed_labels"
    label_path = labels_dir / f"{image_path.stem}.txt"
    write_yolo_labels(
        label_path,
        [
            AnnotationRow(
                class_id=int(item["class_id"]),
                x_center=float(item["x_center"]),
                y_center=float(item["y_center"]),
                width=float(item["width"]),
                height=float(item["height"]),
            )
            for item in saved
        ],
    )
    return {"annotations": saved, "label_path": str(label_path)}


def create_dataset_split(
    repo: Repository,
    project_id: str,
    name: str,
    train_ratio: float,
    val_ratio: float,
    test_ratio: float,
    *,
    job_id: str,
) -> dict[str, Any]:
    if round(train_ratio + val_ratio + test_ratio, 6) != 1.0:
        raise ValueError("Split ratios must add up to 1.0")
    project = repo.get_project(project_id)
    if not project:
        raise FileNotFoundError(f"Project not found: {project_id}")
    images = [image for image in repo.list_images(project_id, limit=100000, offset=0) if image["review_status"] == "reviewed"]
    output_dir = Path(project["root_path"]) / "splits" / name
    buckets = {"train": [], "valid": [], "test": []}
    train_cut = int(len(images) * train_ratio)
    val_cut = train_cut + int(len(images) * val_ratio)
    for index, image in enumerate(images):
        bucket = "train" if index < train_cut else "valid" if index < val_cut else "test"
        buckets[bucket].append(image["id"])
        image_path = Path(image["path"])
        target_image = output_dir / bucket / "images" / image_path.name
        target_label = output_dir / bucket / "labels" / f"{image_path.stem}.txt"
        target_image.parent.mkdir(parents=True, exist_ok=True)
        target_label.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image_path, target_image)
        reviewed_label = Path(project["root_path"]) / "reviewed_labels" / f"{image_path.stem}.txt"
        if reviewed_label.exists():
            shutil.copy2(reviewed_label, target_label)
        else:
            target_label.write_text("", encoding="utf-8")
        progress = int((index + 1) / max(1, len(images)) * 100)
        repo.update_job(job_id, progress=min(99, progress), message=f"Split {index + 1}/{len(images)} images")
    schema_rows = repo.db.execute(
        """
        select distinct class_id, class_name
        from class_descriptors
        where schema_id in (select id from class_schemas where project_id = ?)
        order by class_id asc
        """,
        (project_id,),
    ).fetchall()
    names = {int(row["class_id"]): row["class_name"] for row in schema_rows}
    dataset_yaml = output_dir / "dataset.yaml"
    dataset_yaml.write_text(
        yaml.safe_dump(
            {
                "train": str(output_dir / "train" / "images"),
                "val": str(output_dir / "valid" / "images"),
                "test": str(output_dir / "test" / "images"),
                "names": names,
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    split = repo.create_dataset_split_record(
        project_id=project_id,
        name=name,
        train_ratio=train_ratio,
        val_ratio=val_ratio,
        test_ratio=test_ratio,
        output_dir=str(output_dir),
        dataset_yaml_path=str(dataset_yaml),
        image_ids_json=json.dumps(buckets),
        job_id=job_id,
    )
    return split
```

- [ ] **Step 4: Add annotation and split routes**

Add to `backend/app/main.py`:

```python
from .schemas import AnnotationSaveRequest, DatasetSplitCreate, PseudoLabelRunCreate
```

Add routes:

```python
@app.get("/api/images/{image_id}/annotations")
def list_annotations(image_id: str) -> dict[str, Any]:
    image = repo.get_image(image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return {"image": image, "annotations": repo.list_annotations(image_id)}


@app.put("/api/images/{image_id}/annotations")
def save_annotations(image_id: str, payload: AnnotationSaveRequest) -> dict[str, Any]:
    try:
        return project_services.save_image_annotations(
            repo,
            image_id=image_id,
            annotations=[item.model_dump() for item in payload.annotations],
            review_status=payload.review_status,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/projects/{project_id}/dataset-splits")
def create_dataset_split(project_id: str, payload: DatasetSplitCreate) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return jobs.create(
        "dataset_split",
        project_services.create_dataset_split,
        repo,
        project_id,
        payload.name,
        payload.train_ratio,
        payload.val_ratio,
        payload.test_ratio,
        project_id=project_id,
        related_type="dataset_split",
    )
```

- [ ] **Step 5: Implement pseudo-label adapter skeleton**

Create `backend/app/world_models.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2

from .config import AppPaths
from .repositories import Repository


def resolve_world_model(paths: AppPaths, model_name: str) -> str:
    candidate = Path(model_name)
    if candidate.exists():
        return str(candidate)
    located = paths.world_model_dir / model_name
    return str(located) if located.exists() else model_name


def run_yolo_world_pseudo_label(
    repo: Repository,
    project_id: str,
    schema_id: str,
    world_model: str,
    confidence: float,
    iou: float,
    *,
    job_id: str,
) -> dict[str, Any]:
    import supervision as sv
    from ultralytics import YOLOWorld

    schema = repo.get_class_schema(schema_id)
    if not schema:
        raise FileNotFoundError(f"Class schema not found: {schema_id}")
    labels = [descriptor for item in schema["classes"] for descriptor in item["descriptors"]]
    mapping = {
        descriptor: item["class_id"]
        for item in schema["classes"]
        for descriptor in item["descriptors"]
    }
    names = {
        item["class_id"]: item["class_name"]
        for item in schema["classes"]
    }
    model = YOLOWorld(resolve_world_model(repo.paths, world_model))
    model.set_classes(labels)
    images = repo.list_images(project_id, limit=100000, offset=0)
    total_detections = 0
    for index, image_record in enumerate(images, start=1):
        image = cv2.imread(image_record["path"])
        if image is None:
            continue
        height, width = image.shape[:2]
        result = model.predict(image, conf=confidence, iou=iou, verbose=False)[0]
        detections = sv.Detections.from_ultralytics(result)
        annotations: list[dict[str, Any]] = []
        for xyxy, class_id in zip(detections.xyxy, detections.class_id):
            descriptor = labels[int(class_id)]
            final_class_id = int(mapping[descriptor])
            x1, y1, x2, y2 = map(float, xyxy)
            annotations.append(
                {
                    "class_id": final_class_id,
                    "class_name": names[final_class_id],
                    "x_center": (x1 + x2) / 2 / width,
                    "y_center": (y1 + y2) / 2 / height,
                    "width": (x2 - x1) / width,
                    "height": (y2 - y1) / height,
                    "confidence": None,
                    "source_descriptor": descriptor,
                    "source_type": "pseudo",
                    "edited": False,
                }
            )
        if annotations:
            repo.replace_image_annotations(image_record["id"], annotations, review_status="unreviewed")
            total_detections += len(annotations)
        repo.update_job(job_id, progress=min(99, int(index / max(1, len(images)) * 100)), message=f"Labeled {index}/{len(images)} images")
    return {"images": len(images), "detections": total_detections}
```

Add pseudo-label route to `backend/app/main.py`:

```python
from . import world_models


@app.post("/api/projects/{project_id}/pseudo-label-runs")
def create_pseudo_label_run(project_id: str, payload: PseudoLabelRunCreate) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return jobs.create(
        "pseudo_label",
        world_models.run_yolo_world_pseudo_label,
        repo,
        project_id,
        payload.schema_id,
        payload.world_model,
        payload.confidence,
        payload.iou,
        project_id=project_id,
        related_type="pseudo_label_run",
    )
```

- [ ] **Step 6: Write annotation API test**

Create `tests/backend/test_annotations_api.py`:

```python
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from backend.app.main import app, repo


def test_save_annotations_writes_yolo_label_file(tmp_path: Path) -> None:
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "Annot API"}).json()
    image_path = Path(project["root_path"]) / "sources" / "image.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(image_path), np.zeros((20, 30, 3), dtype=np.uint8))
    image = repo.create_image(project["id"], str(image_path), width=30, height=20)

    response = client.put(
        f"/api/images/{image['id']}/annotations",
        json={
            "review_status": "reviewed",
            "annotations": [
                {
                    "class_id": 1,
                    "class_name": "car",
                    "x_center": 0.5,
                    "y_center": 0.5,
                    "width": 0.2,
                    "height": 0.3,
                    "source_type": "manual",
                    "edited": True,
                }
            ],
        },
    )

    assert response.status_code == 200
    label_path = Path(response.json()["label_path"])
    assert label_path.read_text(encoding="utf-8") == "1 0.500000 0.500000 0.200000 0.300000"
```

- [ ] **Step 7: Run tests**

Run:

```bash
python3 -m pytest tests/backend/test_label_io.py tests/backend/test_annotations_api.py tests/backend/test_project_services.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit checkpoint**

Run:

```bash
git status --short
git add backend/app/world_models.py backend/app/project_services.py backend/app/repositories.py backend/app/schemas.py backend/app/main.py tests/backend/test_annotations_api.py
git commit -m "feat: add annotation and pseudo-label APIs"
```

Expected if Git is available: commit succeeds. If not a Git repository, note checkpoint complete without commit.

---

## Task 6: React/Vite Shell, i18n, And Project Hub

**Files:**
- Delete or replace: `frontend/app.js`
- Replace: `frontend/index.html`
- Replace: `frontend/styles.css`
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/i18n.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/components/AppShell.tsx`
- Create: `frontend/src/components/ProgressPanel.tsx`
- Create: `frontend/src/pages/ProjectsPage.tsx`
- Create: `frontend/src/pages/SourcesPage.tsx`
- Create: `frontend/src/pages/ClassSchemaPage.tsx`
- Create: `frontend/src/pages/PseudoLabelPage.tsx`
- Create: `frontend/src/pages/SplitDatasetPage.tsx`
- Create: `frontend/src/pages/TrainPage.tsx`
- Create: `frontend/src/pages/ModelsExportPage.tsx`
- Create: `frontend/src/pages/SettingsPage.tsx`
- Create: `frontend/src/i18n.test.ts`
- Create: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Create package configuration**

Create `frontend/package.json`:

```json
{
  "name": "object-autolabel-frontend",
  "private": true,
  "version": "0.2.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173",
    "build": "tsc && vite build",
    "test": "vitest run",
    "preview": "vite preview --host 0.0.0.0"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "lucide-react": "^0.468.0",
    "vite": "^6.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Create `frontend/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8501"
    }
  }
});
```

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": []
}
```

- [ ] **Step 2: Create frontend entry files**

Replace `frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ObjectAutoLabel</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `frontend/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 3: Create i18n dictionary and test**

Create `frontend/src/i18n.ts`:

```ts
export type Language = "en" | "zh" | "ja" | "ko";

export const languages: { code: Language; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "zh", label: "繁中" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" }
];

export const dictionary = {
  en: {
    projects: "Projects",
    sources: "Sources",
    classSchema: "Class Schema",
    pseudoLabel: "Pseudo Label",
    review: "Review",
    splitDataset: "Split Dataset",
    train: "Train",
    modelsExport: "Models / Export",
    settings: "Settings",
    createProject: "Create Project",
    save: "Save",
    reset: "Reset",
    previous: "Previous",
    next: "Next",
    jobs: "Jobs"
  },
  zh: {
    projects: "專案",
    sources: "來源",
    classSchema: "類別結構",
    pseudoLabel: "偽標註",
    review: "檢閱",
    splitDataset: "切分資料集",
    train: "訓練",
    modelsExport: "模型 / 匯出",
    settings: "設定",
    createProject: "建立專案",
    save: "儲存",
    reset: "重設",
    previous: "上一張",
    next: "下一張",
    jobs: "任務"
  },
  ja: {
    projects: "プロジェクト",
    sources: "ソース",
    classSchema: "クラス定義",
    pseudoLabel: "疑似ラベル",
    review: "レビュー",
    splitDataset: "データ分割",
    train: "学習",
    modelsExport: "モデル / 書き出し",
    settings: "設定",
    createProject: "プロジェクト作成",
    save: "保存",
    reset: "リセット",
    previous: "前へ",
    next: "次へ",
    jobs: "ジョブ"
  },
  ko: {
    projects: "프로젝트",
    sources: "소스",
    classSchema: "클래스 스키마",
    pseudoLabel: "의사 라벨",
    review: "검토",
    splitDataset: "데이터 분할",
    train: "학습",
    modelsExport: "모델 / 내보내기",
    settings: "설정",
    createProject: "프로젝트 생성",
    save: "저장",
    reset: "초기화",
    previous: "이전",
    next: "다음",
    jobs: "작업"
  }
} satisfies Record<Language, Record<string, string>>;

export type I18nKey = keyof typeof dictionary.en;

export function t(language: Language, key: I18nKey): string {
  return dictionary[language][key] ?? dictionary.en[key];
}
```

Create `frontend/src/i18n.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dictionary } from "./i18n";

describe("i18n", () => {
  it("has the same keys in every language", () => {
    const englishKeys = Object.keys(dictionary.en).sort();
    for (const entries of Object.values(dictionary)) {
      expect(Object.keys(entries).sort()).toEqual(englishKeys);
    }
  });
});
```

- [ ] **Step 4: Create API client**

Create `frontend/src/types.ts`:

```ts
export type Project = {
  id: string;
  slug: string;
  name: string;
  description: string;
  root_path: string;
};

export type Job = {
  id: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  error?: string | null;
};
```

Create `frontend/src/api/client.ts`:

```ts
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}
```

Create `frontend/src/api/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { api } from "./client";

describe("api", () => {
  it("throws readable errors for failed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve("bad request") })
    );

    await expect(api("/api/fail")).rejects.toThrow("bad request");
  });
});
```

- [ ] **Step 5: Create app shell and first-pass page components**

Create `frontend/src/App.tsx`, `frontend/src/components/AppShell.tsx`, `frontend/src/components/ProgressPanel.tsx`, and page files. Keep content minimal but functional:

```tsx
// frontend/src/App.tsx
import { useEffect, useState } from "react";
import { AppShell, PageId } from "./components/AppShell";
import { api } from "./api/client";
import { Job, Project } from "./types";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { ClassSchemaPage } from "./pages/ClassSchemaPage";
import { PseudoLabelPage } from "./pages/PseudoLabelPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SplitDatasetPage } from "./pages/SplitDatasetPage";
import { TrainPage } from "./pages/TrainPage";
import { ModelsExportPage } from "./pages/ModelsExportPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  const [page, setPage] = useState<PageId>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [jobs, setJobs] = useState<Job[]>([]);

  async function refresh() {
    const [projectList, jobList] = await Promise.all([
      api<Project[]>("/api/projects"),
      api<Job[]>("/api/jobs")
    ]);
    setProjects(projectList);
    setJobs(jobList);
    if (!activeProjectId && projectList[0]) setActiveProjectId(projectList[0].id);
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1600);
    return () => window.clearInterval(timer);
  }, []);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const pages = {
    projects: <ProjectsPage projects={projects} onChanged={refresh} />,
    sources: <SourcesPage project={activeProject} />,
    classSchema: <ClassSchemaPage project={activeProject} />,
    pseudoLabel: <PseudoLabelPage project={activeProject} />,
    review: <ReviewPage project={activeProject} />,
    splitDataset: <SplitDatasetPage project={activeProject} />,
    train: <TrainPage project={activeProject} />,
    modelsExport: <ModelsExportPage project={activeProject} />,
    settings: <SettingsPage />
  };

  return (
    <AppShell
      page={page}
      onPageChange={setPage}
      projects={projects}
      activeProjectId={activeProjectId}
      onProjectChange={setActiveProjectId}
      jobs={jobs}
    >
      {pages[page]}
    </AppShell>
  );
}
```

Create first-pass page components that export named functions. Each page must render its title, show the active project state, and avoid dead navigation. Use this exact pattern for `SourcesPage`, `ClassSchemaPage`, `PseudoLabelPage`, `SplitDatasetPage`, `TrainPage`, `ModelsExportPage`, and `SettingsPage`, changing only the exported component name and title:

```tsx
// frontend/src/pages/SourcesPage.tsx
import { Project } from "../types";

export function SourcesPage({ project }: { project: Project | null }) {
  return (
    <section className="panel">
      <h1>Sources</h1>
      <p>{project ? `Active project: ${project.name}` : "Create or select a project first."}</p>
    </section>
  );
}
```

Create `ProjectsPage` with a working project creation form:

```tsx
// frontend/src/pages/ProjectsPage.tsx
import { FormEvent, useState } from "react";
import { api } from "../api/client";
import { Project } from "../types";

export function ProjectsPage({ projects, onChanged }: { projects: Project[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await api<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, description })
    });
    setName("");
    setDescription("");
    await onChanged();
  }

  return (
    <section className="panel">
      <h1>Projects</h1>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <button className="primary" type="submit">Create Project</button>
      </form>
      <div className="cards-grid">
        {projects.map((project) => (
          <article className="card" key={project.id}>
            <h2>{project.name}</h2>
            <p>{project.description || "No description"}</p>
            <small>{project.root_path}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Style the Apple-inspired shell**

Create `frontend/src/styles.css` with semantic tokens and responsive shell:

```css
:root {
  color-scheme: light;
  --bg: #f5f7fb;
  --surface: rgba(255, 255, 255, 0.86);
  --surface-solid: #ffffff;
  --text: #101828;
  --muted: #667085;
  --line: #d0d5dd;
  --accent: #2563eb;
  --danger: #c2410c;
  --shadow: 0 18px 45px rgba(16, 24, 40, 0.10);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; color: var(--text); background: var(--bg); }
button, input, select, textarea { font: inherit; }
button { min-height: 44px; cursor: pointer; }

.app-shell {
  display: grid;
  grid-template-columns: 260px 1fr;
  min-height: 100dvh;
}

.sidebar {
  border-right: 1px solid var(--line);
  background: rgba(255,255,255,0.74);
  backdrop-filter: blur(18px);
  padding: 20px;
}

.main {
  min-width: 0;
  padding: 22px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.panel, .card {
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow);
  padding: 20px;
}

.nav-button, .primary, .secondary {
  width: 100%;
  border: 0;
  border-radius: 12px;
  padding: 10px 12px;
}

.nav-button {
  text-align: left;
  color: var(--muted);
  background: transparent;
}

.nav-button.active {
  color: var(--text);
  background: var(--surface-solid);
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.08);
}

.primary {
  color: white;
  background: var(--accent);
}

.secondary {
  color: var(--text);
  background: var(--surface-solid);
  border: 1px solid var(--line);
}

input, select, textarea {
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 12px;
  background: white;
}

:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.35);
  outline-offset: 2px;
}

@media (max-width: 900px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { position: static; }
}
```

- [ ] **Step 7: Install frontend dependencies**

Run:

```bash
npm install --prefix frontend
```

Expected: dependencies installed and `frontend/package-lock.json` created.

If network access is blocked, request escalation and rerun the same command.

- [ ] **Step 8: Run frontend tests and build**

Run:

```bash
npm run test --prefix frontend
npm run build --prefix frontend
```

Expected: tests pass and Vite writes `frontend/dist`.

- [ ] **Step 9: Commit checkpoint**

Run:

```bash
git status --short
git add frontend
git commit -m "feat: add react project hub shell"
```

Expected if Git is available: commit succeeds. If not a Git repository, note checkpoint complete without commit.

---

## Task 7: Review Page BBox Editor

**Files:**
- Create: `frontend/src/editor/geometry.ts`
- Create: `frontend/src/editor/BBoxEditor.tsx`
- Create: `frontend/src/editor/useImagePreload.ts`
- Modify: `frontend/src/pages/ReviewPage.tsx`
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/editor/geometry.test.ts`

- [ ] **Step 1: Write geometry tests**

Create `frontend/src/editor/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { denormalizeBox, normalizeBox, clampBox } from "./geometry";

describe("bbox geometry", () => {
  it("converts normalized YOLO boxes to pixel boxes and back", () => {
    const pixel = denormalizeBox(
      { x_center: 0.5, y_center: 0.5, width: 0.25, height: 0.5 },
      { width: 400, height: 200 }
    );
    expect(pixel).toEqual({ x: 150, y: 50, width: 100, height: 100 });

    const normalized = normalizeBox(pixel, { width: 400, height: 200 });
    expect(normalized).toEqual({ x_center: 0.5, y_center: 0.5, width: 0.25, height: 0.5 });
  });

  it("clamps boxes inside the image", () => {
    expect(clampBox({ x: -10, y: -20, width: 500, height: 300 }, { width: 400, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 200
    });
  });
});
```

- [ ] **Step 2: Implement geometry helpers**

Create `frontend/src/editor/geometry.ts`:

```ts
export type NaturalSize = { width: number; height: number };
export type PixelBox = { x: number; y: number; width: number; height: number };
export type NormalizedBox = { x_center: number; y_center: number; width: number; height: number };

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function denormalizeBox(box: NormalizedBox, size: NaturalSize): PixelBox {
  const width = box.width * size.width;
  const height = box.height * size.height;
  return {
    x: round6(box.x_center * size.width - width / 2),
    y: round6(box.y_center * size.height - height / 2),
    width: round6(width),
    height: round6(height)
  };
}

export function normalizeBox(box: PixelBox, size: NaturalSize): NormalizedBox {
  return {
    x_center: round6((box.x + box.width / 2) / size.width),
    y_center: round6((box.y + box.height / 2) / size.height),
    width: round6(box.width / size.width),
    height: round6(box.height / size.height)
  };
}

export function clampBox(box: PixelBox, size: NaturalSize): PixelBox {
  const x = Math.max(0, Math.min(size.width, box.x));
  const y = Math.max(0, Math.min(size.height, box.y));
  const right = Math.max(x, Math.min(size.width, box.x + box.width));
  const bottom = Math.max(y, Math.min(size.height, box.y + box.height));
  return {
    x: round6(x),
    y: round6(y),
    width: round6(right - x),
    height: round6(bottom - y)
  };
}
```

- [ ] **Step 3: Extend frontend types**

Add to `frontend/src/types.ts`:

```ts
export type ImageRecord = {
  id: string;
  project_id: string;
  path: string;
  width: number | null;
  height: number | null;
  review_status: string;
};

export type Annotation = {
  id?: string | null;
  class_id: number;
  class_name: string;
  x_center: number;
  y_center: number;
  width: number;
  height: number;
  confidence?: number | null;
  source_descriptor?: string | null;
  source_type: string;
  edited: boolean;
};
```

- [ ] **Step 4: Implement image preloader**

Create `frontend/src/editor/useImagePreload.ts`:

```ts
import { useEffect } from "react";

export function useImagePreload(urls: string[]) {
  useEffect(() => {
    const images = urls.map((url) => {
      const image = new Image();
      image.src = url;
      return image;
    });
    return () => {
      images.forEach((image) => {
        image.src = "";
      });
    };
  }, [urls.join("|")]);
}
```

- [ ] **Step 5: Implement first bbox editor**

Create `frontend/src/editor/BBoxEditor.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Annotation, ImageRecord } from "../types";
import { denormalizeBox, normalizeBox, PixelBox } from "./geometry";

type Props = {
  image: ImageRecord;
  annotations: Annotation[];
  onChange: (annotations: Annotation[]) => void;
};

export function BBoxEditor({ image, annotations, onChange }: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(annotations.length ? 0 : null);
  const naturalSize = { width: image.width ?? 1, height: image.height ?? 1 };
  const boxes = useMemo(
    () => annotations.map((annotation) => denormalizeBox(annotation, naturalSize)),
    [annotations, naturalSize.width, naturalSize.height]
  );

  function updateBox(index: number, box: PixelBox) {
    const next = [...annotations];
    next[index] = {
      ...next[index],
      ...normalizeBox(box, naturalSize),
      edited: true
    };
    onChange(next);
  }

  function deleteSelected() {
    if (selectedIndex === null) return;
    onChange(annotations.filter((_, index) => index !== selectedIndex));
    setSelectedIndex(null);
  }

  function addBox() {
    onChange([
      ...annotations,
      {
        class_id: 0,
        class_name: "unassigned",
        x_center: 0.5,
        y_center: 0.5,
        width: 0.2,
        height: 0.2,
        confidence: null,
        source_descriptor: null,
        source_type: "manual",
        edited: true
      }
    ]);
    setSelectedIndex(annotations.length);
  }

  return (
    <div className="bbox-editor" onKeyDown={(event) => {
      if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
    }} tabIndex={0}>
      <div className="bbox-toolbar">
        <button className="secondary" type="button" onClick={addBox}>Add Box</button>
        <button className="secondary" type="button" onClick={deleteSelected} disabled={selectedIndex === null}>Delete</button>
      </div>
      <div className="image-stage">
        <img src={`/api/files?path=${encodeURIComponent(image.path)}`} alt="" draggable={false} />
        <svg viewBox={`0 0 ${naturalSize.width} ${naturalSize.height}`} className="bbox-layer">
          {boxes.map((box, index) => (
            <rect
              key={index}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              className={selectedIndex === index ? "bbox selected" : "bbox"}
              onClick={() => setSelectedIndex(index)}
              onDoubleClick={() => updateBox(index, { ...box, width: box.width + 4, height: box.height + 4 })}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
```

This first editor supports rendering, selection, add, delete, and the state path. Drag/resize refinement should be added immediately after this task using pointer handles; keep API calls outside pointer movement.

- [ ] **Step 6: Add file serving route**

Modify `backend/app/main.py`:

```python
from fastapi.responses import FileResponse


@app.get("/api/files")
def serve_file(path: str) -> FileResponse:
    file_path = Path(path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)
```

- [ ] **Step 7: Wire ReviewPage to images and annotations**

Replace `frontend/src/pages/ReviewPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { BBoxEditor } from "../editor/BBoxEditor";
import { Annotation, ImageRecord, Project } from "../types";

export function ReviewPage({ project }: { project: Project | null }) {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [index, setIndex] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [dirty, setDirty] = useState(false);
  const image = images[index] ?? null;

  useEffect(() => {
    if (!project) return;
    api<ImageRecord[]>(`/api/projects/${project.id}/images`).then(setImages);
  }, [project?.id]);

  useEffect(() => {
    if (!image) return;
    api<{ annotations: Annotation[] }>(`/api/images/${image.id}/annotations`).then((data) => {
      setAnnotations(data.annotations);
      setDirty(false);
    });
  }, [image?.id]);

  async function save() {
    if (!image) return;
    await api(`/api/images/${image.id}/annotations`, {
      method: "PUT",
      body: JSON.stringify({ review_status: "reviewed", annotations })
    });
    setDirty(false);
  }

  function move(delta: number) {
    if (dirty && !window.confirm("You have unsaved annotation changes. Leave this image?")) return;
    setIndex((current) => Math.max(0, Math.min(images.length - 1, current + delta)));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, images.length]);

  if (!project) return <section className="panel"><h1>Review</h1><p>Create or select a project first.</p></section>;
  if (!image) return <section className="panel"><h1>Review</h1><p>No images in this project yet.</p></section>;

  return (
    <section className="panel review-layout">
      <aside className="image-queue">
        <h2>Images</h2>
        {images.map((item, itemIndex) => (
          <button key={item.id} className={itemIndex === index ? "nav-button active" : "nav-button"} onClick={() => move(itemIndex - index)}>
            {item.path.split("/").pop()}
          </button>
        ))}
      </aside>
      <main>
        <div className="review-actions">
          <button className="secondary" onClick={() => move(-1)}>Previous</button>
          <span>{index + 1} / {images.length}</span>
          <button className="secondary" onClick={() => move(1)}>Next</button>
          <button className="primary" onClick={save} disabled={!dirty}>Save</button>
        </div>
        <BBoxEditor
          image={image}
          annotations={annotations}
          onChange={(next) => {
            setAnnotations(next);
            setDirty(true);
          }}
        />
      </main>
      <aside className="inspector">
        <h2>Inspector</h2>
        <p>{dirty ? "Unsaved changes" : "Saved"}</p>
      </aside>
    </section>
  );
}
```

- [ ] **Step 8: Add editor CSS**

Append to `frontend/src/styles.css`:

```css
.review-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 240px;
  gap: 16px;
}

.image-stage {
  position: relative;
  width: 100%;
  min-height: 420px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #111827;
}

.image-stage img {
  display: block;
  width: 100%;
  height: auto;
}

.bbox-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.bbox {
  fill: rgba(37, 99, 235, 0.12);
  stroke: #2563eb;
  stroke-width: 2;
  cursor: pointer;
}

.bbox.selected {
  fill: rgba(249, 115, 22, 0.18);
  stroke: #f97316;
}

.bbox-toolbar, .review-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
```

- [ ] **Step 9: Run frontend tests and build**

Run:

```bash
npm run test --prefix frontend
npm run build --prefix frontend
```

Expected: PASS.

- [ ] **Step 10: Commit checkpoint**

Run:

```bash
git status --short
git add frontend/src backend/app/main.py
git commit -m "feat: add bbox review editor foundation"
```

Expected if Git is available: commit succeeds. If not a Git repository, note checkpoint complete without commit.

---

## Task 8: Training, Export, Docker Build, And End-To-End Validation

**Files:**
- Modify: `backend/app/project_services.py`
- Modify: `backend/app/repositories.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Modify: `Dockerfile`
- Modify: `Dockerfile.jetson`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.jetson.yml`
- Modify: `run.sh`
- Modify: `spec/*.md`
- Create: `tests/backend/test_training_export_api.py`
- Create: `frontend/tests/e2e/project-hub.spec.ts`

- [ ] **Step 1: Extend schemas for training and export**

Add to `backend/app/schemas.py`:

```python
class TrainingRunCreate(BaseModel):
    dataset_split_id: str
    input_model: str
    epochs: int = Field(200, gt=0)
    device: str = "cuda"
    patience: int = Field(10, gt=0)
    warmup_epochs: int = Field(10, ge=0)
    optimizer: str = "SGD"
    lr0: float = Field(0.05, ge=0)
    lrf: float = Field(0.01, ge=0)


class ModelExportCreate(BaseModel):
    source_model_path: str
    export_format: str = "tflite"
    int8: bool = True
    imgsz: int = Field(640, gt=0)
```

- [ ] **Step 2: Add repository records for training/export**

Add focused repository methods:

```python
    def get_dataset_split(self, split_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from dataset_splits where id = ?", (split_id,)).fetchone())

    def create_training_run_record(self, project_id: str, dataset_split_id: str, input_model: str, output_dir: str, job_id: str | None = None) -> dict[str, Any]:
        run_id = new_id()
        now = utc_now()
        with transaction(self.db):
            self.db.execute(
                """
                insert into training_runs
                (id, project_id, dataset_split_id, input_model, output_dir, status, job_id, created_at, updated_at)
                values (?, ?, ?, ?, ?, 'queued', ?, ?, ?)
                """,
                (run_id, project_id, dataset_split_id, input_model, output_dir, job_id, now, now),
            )
        return dict(self.db.execute("select * from training_runs where id = ?", (run_id,)).fetchone())

    def update_training_run(self, run_id: str, **patch: Any) -> None:
        allowed = {"status", "best_model_path", "last_model_path", "job_id"}
        updates = {key: value for key, value in patch.items() if key in allowed}
        updates["updated_at"] = utc_now()
        columns = ", ".join(f"{key} = ?" for key in updates)
        with transaction(self.db):
            self.db.execute(f"update training_runs set {columns} where id = ?", list(updates.values()) + [run_id])

    def get_training_run(self, run_id: str) -> dict[str, Any] | None:
        return row_to_dict(self.db.execute("select * from training_runs where id = ?", (run_id,)).fetchone())
```

- [ ] **Step 3: Implement training service**

Add to `backend/app/project_services.py`:

```python
def resolve_input_model(repo: Repository, input_model: str) -> str:
    candidate = Path(input_model)
    if candidate.exists():
        return str(candidate)
    located = repo.paths.input_model_dir / input_model
    return str(located) if located.exists() else input_model


def train_yolo_model(
    repo: Repository,
    training_run_id: str,
    epochs: int,
    device: str,
    patience: int,
    warmup_epochs: int,
    optimizer: str,
    lr0: float,
    lrf: float,
    *,
    job_id: str,
) -> dict[str, Any]:
    from ultralytics import YOLO

    run = repo.get_training_run(training_run_id)
    if not run:
        raise FileNotFoundError(f"Training run not found: {training_run_id}")
    split = repo.get_dataset_split(run["dataset_split_id"])
    if not split:
        raise FileNotFoundError(f"Dataset split not found: {run['dataset_split_id']}")

    repo.update_training_run(training_run_id, status="running", job_id=job_id)
    repo.update_job(job_id, progress=5, message="Training started")
    model = YOLO(resolve_input_model(repo, run["input_model"]))
    results = model.train(
        data=split["dataset_yaml_path"],
        epochs=epochs,
        imgsz=640,
        batch=16,
        device=device,
        patience=patience,
        warmup_epochs=warmup_epochs,
        optimizer=optimizer,
        lr0=lr0,
        lrf=lrf,
        rect=True,
        project=str(repo.paths.runs_dir / "detect"),
    )
    output_dir = Path(run["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    save_dir = Path(results.save_dir)
    best_src = save_dir / "weights" / "best.pt"
    last_src = save_dir / "weights" / "last.pt"
    best_dst = output_dir / "best.pt"
    last_dst = output_dir / "last.pt"
    if best_src.exists():
        shutil.copy2(best_src, best_dst)
    if last_src.exists():
        shutil.copy2(last_src, last_dst)
    repo.update_training_run(
        training_run_id,
        status="completed",
        best_model_path=str(best_dst),
        last_model_path=str(last_dst),
    )
    return {"output_dir": str(output_dir), "best_model_path": str(best_dst), "last_model_path": str(last_dst)}
```

- [ ] **Step 4: Add training/export routes**

Add to `backend/app/main.py`:

```python
from .schemas import ModelExportCreate, TrainingRunCreate
```

Add routes:

```python
@app.post("/api/projects/{project_id}/training-runs")
def create_training_run(project_id: str, payload: TrainingRunCreate) -> dict[str, Any]:
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    split = repo.get_dataset_split(payload.dataset_split_id)
    if not split or split["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Dataset split not found")
    run_id_preview = None
    output_base = Path(repo.paths.output_model_dir) / project["slug"]
    output_base.mkdir(parents=True, exist_ok=True)
    record = repo.create_training_run_record(
        project_id=project_id,
        dataset_split_id=payload.dataset_split_id,
        input_model=payload.input_model,
        output_dir=str(output_base / "pending"),
    )
    output_dir = output_base / record["id"]
    repo.db.execute("update training_runs set output_dir = ? where id = ?", (str(output_dir), record["id"]))
    repo.db.commit()
    return jobs.create(
        "training",
        project_services.train_yolo_model,
        repo,
        record["id"],
        payload.epochs,
        payload.device,
        payload.patience,
        payload.warmup_epochs,
        payload.optimizer,
        payload.lr0,
        payload.lrf,
        project_id=project_id,
        related_type="training_run",
        related_id=record["id"],
    )


@app.post("/api/training-runs/{run_id}/exports")
def create_model_export(run_id: str, payload: ModelExportCreate) -> dict[str, Any]:
    run = repo.get_training_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Training run not found")

    def export_model(*, job_id: str) -> dict[str, Any]:
        from ultralytics import YOLO

        repo.update_job(job_id, progress=10, message="Loading model")
        model = YOLO(payload.source_model_path)
        exported = model.export(format=payload.export_format, int8=payload.int8, imgsz=payload.imgsz)
        export_dir = Path(run["output_dir"]) / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        exported_path = Path(exported)
        target = export_dir / exported_path.name
        if exported_path.exists() and exported_path.resolve() != target.resolve():
            shutil.copy2(exported_path, target)
        else:
            target = exported_path
        return {"exported_path": str(target)}

    return jobs.create(
        "model_export",
        export_model,
        project_id=run["project_id"],
        related_type="model_export",
        related_id=run_id,
    )
```

- [ ] **Step 5: Update Dockerfiles for React build and folder names**

Modify `Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt \
    && pip install git+https://github.com/ultralytics/CLIP.git@main

COPY backend /app/backend
COPY --from=frontend-build /frontend/dist /app/frontend/dist
COPY world_model /app/world_model
COPY input_model /app/input_model

RUN mkdir -p /app/data/projects /app/output_model /app/runs

EXPOSE 8501
EXPOSE 8081

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8501"]
```

Mirror the same folder name and frontend build changes in `Dockerfile.jetson`.

Update `docker-compose.yml` and `docker-compose.jetson.yml` volumes:

```yaml
      - ./data:/app/data
      - ./runs:/app/runs
      - ./world_model:/app/world_model:ro
      - ./input_model:/app/input_model:ro
      - ./output_model:/app/output_model
      - ./object_autolabel.db:/app/object_autolabel.db
```

- [ ] **Step 6: Add migration note to run.sh**

Modify `run.sh` startup path to create new folders if missing:

```bash
mkdir -p "${PROJECT_DIR}/world_model" "${PROJECT_DIR}/input_model" "${PROJECT_DIR}/output_model"
if [[ -d "${PROJECT_DIR}/models" && ! -e "${PROJECT_DIR}/world_model/.migration_notice" ]]; then
  echo "Notice: models/ has been replaced by world_model/. Move existing pseudo-label models when ready." >&2
  touch "${PROJECT_DIR}/world_model/.migration_notice"
fi
if [[ -d "${PROJECT_DIR}/yolo_model" && ! -e "${PROJECT_DIR}/input_model/.migration_notice" ]]; then
  echo "Notice: yolo_model/ has been replaced by input_model/. Move existing training input models when ready." >&2
  touch "${PROJECT_DIR}/input_model/.migration_notice"
fi
```

Place this before the `case "${1:-}" in` block.

- [ ] **Step 7: Update spec docs**

Update these files:

- `spec/PROJECT_MAP.md`: describe local Dataset Project Hub and remove Roboflow as major workflow.
- `spec/ARCHITECTURE.md`: document React/Vite, SQLite, project-based API, job persistence.
- `spec/DATA_MODEL.md`: document `world_model`, `input_model`, `output_model`, SQLite tables, annotations.
- `spec/API.md`: document new endpoint groups.
- `spec/RUNTIME.md`: document frontend build and new Docker volumes.
- `spec/UI.md`: document Project Hub, Review editor, i18n scope.
- `spec/TESTING.md`: add backend pytest, frontend Vitest, Playwright.

- [ ] **Step 8: Run validation**

Run:

```bash
python3 -m py_compile backend/app/*.py
python3 -m pytest tests/backend -q
npm run test --prefix frontend
npm run build --prefix frontend
bash -n run.sh
docker compose -f docker-compose.yml config
```

Expected:

- Python compilation passes.
- Backend tests pass.
- Frontend tests pass.
- Vite build succeeds.
- `run.sh` syntax check passes.
- Compose config validates if Docker is available.

If Docker is unavailable, record `docker compose config` as not run with the exact error.

- [ ] **Step 9: Manual happy-path smoke**

Run the app:

```bash
./run.sh --up
```

Open:

```text
http://localhost:8501
```

Manual checks:

1. Create a project.
2. Add an image folder source with a few images.
3. Create a class schema with `person` and `car`.
4. Confirm `world_model` and `input_model` selectors read the correct folders.
5. Open Review and load an image.
6. Add a bbox, save, and confirm a YOLO `.txt` appears under `data/projects/<project>/reviewed_labels/`.
7. Create a split.
8. Confirm split folder contains `train/valid/test` directories and `dataset.yaml`.

- [ ] **Step 10: Commit checkpoint**

Run:

```bash
git status --short
git add backend frontend Dockerfile Dockerfile.jetson docker-compose.yml docker-compose.jetson.yml run.sh spec docs/superpowers/plans/2026-06-18-object-autolabel-redesign.md
git commit -m "feat: complete local object autolabel redesign"
```

Expected if Git is available: commit succeeds. If not a Git repository, note checkpoint complete without commit.

---

## Final Self-Review Checklist For Implementer

- [ ] Roboflow is not in the primary UI workflow.
- [ ] `world_model/`, `input_model/`, and `output_model/` are used in code, Docker, docs, and UI.
- [ ] SQLite persists projects, class schemas, images, annotations, splits, training runs, exports, and jobs.
- [ ] All long tasks return jobs and show progress/status.
- [ ] BBox editor uses manual Save and warns about unsaved changes.
- [ ] Drag/resize interactions do not call the API.
- [ ] Dataset split uses reviewed labels.
- [ ] Training uses `input_model`.
- [ ] Export output lands in `output_model/<project_slug>/<train_run_id>/exports/`.
- [ ] Primary UI language switch covers EN/ZH/JA/KO navigation and main actions.
- [ ] Tests and docs are updated before claiming completion.
