# Testing

## Current Validation

This project currently has smoke-test level validation:

- Python syntax compilation for backend modules.
- Shell syntax check for `run.sh`.
- Docker Compose config validation when Docker is available.
- Backend pytest coverage for repositories, jobs, DB schema, annotations API, model listing, project services, label IO, and YOLO-World helpers.
- Frontend TypeScript/Vite build and Vitest support through `frontend/package.json`.

## Suggested Commands

```bash
python3 -m py_compile backend/app/*.py
pytest
bash -n run.sh
docker compose -f docker-compose.yml config
npm --prefix frontend run build
npm --prefix frontend test
```

## Gaps

- No automated integration test covers YOLO-World inference yet.
- Frontend test coverage is still light.
