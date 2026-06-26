# Task 3 Report

## Scope

Implemented Task 3 backend-only changes in the scoped files from the brief:

- `backend/app/schemas.py`
- `backend/app/repositories.py`
- `backend/app/main.py`
- `backend/app/project_services.py`
- `tests/backend/test_annotations_api.py`
- `tests/backend/test_api_projects.py`

## Delivered

- Added review status typing with allowed values:
  - `unreviewed`
  - `pending_review`
  - `needs_fix`
  - `reviewed`
  - `skipped`
- Added image listing filters for:
  - `review_status`
  - `has_low_confidence`
  - `source_asset_id`
  - `limit`
  - `offset`
- Added `GET /api/projects/{project_id}/review-stats`
- Added review stats aggregation for image statuses plus:
  - `edited`
  - `low_confidence`
- Tightened annotation save validation:
  - invalid `review_status` rejected by schema validation
  - zero or negative box dimensions rejected
  - boxes extending outside normalized image bounds rejected
  - validation failures return HTTP 422 from the annotations save endpoint

## Tests

Added coverage for:

- filtering project images by review status
- review stats counting status buckets and low-confidence images
- rejecting invalid annotation payload review status
- rejecting annotation boxes outside normalized bounds

Verified with:

```bash
pytest tests/backend/test_annotations_api.py tests/backend/test_api_projects.py tests/backend/test_project_services.py -v
```

Result: `9 passed`

## Notes

- I avoided frontend annotation UI work per the brief.
- I did not modify compose/docs/model-folder setup from Task 2.
- The app's `TestClient` path appears to hang in this environment, so the new backend tests exercise the route functions and validation path directly instead of making in-process HTTP requests.
