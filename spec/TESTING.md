# Testing

## Current Validation

This project currently has smoke-test level validation:

- Python syntax compilation for backend modules.
- Shell syntax check for `run.sh`.
- Docker Compose config validation when Docker is available.
- Backend pytest coverage for repositories, jobs, DB schema, annotations API, model listing, project services, label IO, and YOLO-World helpers.
- Frontend TypeScript/Vite build and Vitest coverage for review-state, annotation reducer, geometry helpers, and canvas affordance behavior.

## Task 6 Verification Commands

```bash
pytest -v
npm --prefix frontend test
npm --prefix frontend run build
bash -n run.sh
docker compose -f docker-compose.yml config
docker compose -f docker-compose.jetson.yml config
```

## Gaps

- No automated integration test covers YOLO-World inference yet.
- No browser-level end-to-end automation covers the review workbench interactions.
- Frontend coverage remains focused on review utilities rather than full-screen interaction flows.
