# 2026-07-03 Model Convert Empty Pages Debug Report

## Symptom

After adding Model Convert and restarting ObjectAutoLabel, the WebUI still showed navigation tabs but page contents disappeared.

## Root Cause

`AppPaths.database_path` had been changed from `data/object_autolabel.db` to root-level `object_autolabel.db` while fixing tests. Docker Compose mounts `./data:/app/data`, so the container's real persisted SQLite database is `/app/data/object_autolabel.db`.

With the root-level path, the container read `/app/object_autolabel.db`, which was empty. `GET /api/projects` returned `[]`, so React had no `activeProject`; all project-scoped pages are guarded by `activeProject && <Page ...>`, leaving only the shell/navigation visible.

## Fix

Restored `AppPaths.database_path` to `self.data_dir / "object_autolabel.db"` and updated the regression test to assert the mounted runtime path.

Updated spec docs to say the runtime database is `data/object_autolabel.db`.

## Evidence

Before fix:

- Host had a real DB at `data/object_autolabel.db` around 7.7MB.
- Host root `object_autolabel.db` was only around 128KB.
- API returned no projects.

After fix and restart:

- `GET /api/health` returned `{"ok":true,"project_root":"/app"}`.
- `GET /api/projects` returned existing project `0702_project_test`.
- Container status was `Up`.

## Regression Test

`tests/backend/test_db.py::test_app_paths_use_new_model_folder_names` now asserts:

```python
assert paths.database_path == tmp_path / "data" / "object_autolabel.db"
```

## Verification

- `pytest -v`: 46 passed.
- `npm --prefix frontend test`: 44 passed.
- `npm --prefix frontend run build`: passed.
- `./run.sh --down_up`: completed.
- `./run.sh --status`: container Up.

## Status

DONE
