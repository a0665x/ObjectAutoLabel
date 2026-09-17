# Open Data Import and Current Split

## Product contract

Open Data is optional and non-linear. Each publication creates a named, retained version. The newest version is active in Review, while Split explicitly selects None or any retained Open Data version. Editing/removing data invalidates only affected lineage; creating a newer version does not invalidate an older immutable Split. New training defaults to Current Split but may consume any non-outdated saved Split version. A running training job keeps the immutable materialized snapshot it started with.

The UI exposes two source modes. `Official datasets` is a curated adapter registry, not a free-form URL downloader: each adapter must define and verify its download, license notice, archive safety, source annotation parser, canonical bbox conversion, class metadata, and split policy. `Ultralytics Platform` accepts a Platform dataset URL and uses Platform metadata/NDJSON as the provider adapter. After provider normalization, both modes use the same mapping, sampling, versioning, Review, and Split contract.

## VisDrone2019-DET adapter

- Fixed source: the three official Ultralytics asset archives for train, val, and test-dev. Arbitrary URLs/YAML execution are not accepted.
- Shared cache: `data/opendata/visdrone2019-det/`, with resumable `.part` downloads, ZIP integrity checks, zip-slip rejection, staging, and verified manifest publication.
- MVP imports bbox annotations from official train and val only. Test-dev is retained in the shared cache but excluded because it has no training labels.
- Source labels are the ten VisDrone detection classes. Score-zero/ignored rows and images with no bbox after mapping are excluded.

## Ultralytics Platform Detect adapter

- The operator pastes one public Dataset URL or `ul://<owner>/datasets/<slug>` URI. Identity is always owner plus slug; mutable display names are never used as cache keys.
- Inspection is metadata-only and accepts only `task=detect` datasets with a non-empty, unique class-name list. Segment, semantic, pose, classify, depth, and OBB are explicitly blocked rather than converted lossily.
- Download uses the Platform NDJSON export API. Authentication comes from the request-only password field or host `ULTRALYTICS_API_KEY`; secrets are never stored or logged. Only trusted Platform storage HTTPS URLs are fetched, individual images are size-bounded and decoded before the cache is published, and the NDJSON checksum/version is recorded for traceability. Image fetches use four concurrent workers and four-attempt exponential backoff. Network failures retain decoded staged images with their labels; a later attempt reuses them only if the refreshed NDJSON checksum matches, while a changed export clears the staged payload.
- Train and validation bbox records are normalized into source-class YOLO labels under `data/opendata/ultralytics/<owner>/<slug>/`. Test remains visible in metadata but is excluded from training. If a compatible source has no labeled validation set, the selected eligible train images receive a deterministic 90/10 fallback so Split and Train still have a validation bucket.
- After normalization, class mapping, sampling, Review, version retention, Split lineage, invalidation, and Train use the same provider-independent project workflow as VisDrone.

## Mapping and sampling

Every source label must move out of the unassigned lane into one Project Class schema target or Ignore. Many sources may map to one target. Mapping occurs before deterministic per-official-split sampling; the slider is the percentage of eligible VisDrone images, default 50%, with seed 42.

The preview reports source, eligible, excluded-empty, selected image/bbox counts, official split counts, target-class counts, and six random bbox samples. Its dice control changes only `preview_seed`; the formal mapped selection remains deterministic from seed 42. Publication creates project-local symlinked images and normalized YOLO labels, registers the newest version as pending Review images, and records version/source lineage.

## Ownership and invalidation

Only the newest Open Data version is active in Review per project; older project-local imports and Review edits are retained as saved versions so Split can select them. Removing the active version deletes that derived import, never the shared cache. Open Data images bypass Pseudo and Augment. Review annotation changes or image removal make affected splits outdated; review-status-only saves do not.

Creating a split demotes earlier records and promotes the new record as Current Split. The request carries the explicit `open_data_import_id`; None excludes Open Data. Project images use the chosen ratios; selected Open Data train stays train and Open Data val stays validation. Each materialized snapshot keeps a safe `Split_YYYYMMDD_HHMMSS` build name. Train defaults to Current Split but may select any non-outdated saved Split version; the UI identifies it with color-coded Pseudo, Augment, named Open Data version, Split, and total-image lineage. Split sample cards are seed-randomized and have a dice reroll that never mutates the saved split.

## Diagnostic evidence

Important lifecycle, job, failure, and slow/non-GET access events are written to `logs/YYYY-MM-DD/`. UI errors carry a short error id that can be matched to `jobs.jsonl`. Routine mouse events and per-image success noise are deliberately omitted.

## Verification routes

- Backend: `tests/backend/test_open_data.py`, `tests/backend/test_logging_config.py`, dataset-flow/repository/API regressions.
- Frontend: `frontend/src/pages/OpenDataPage.test.tsx`, Review panel tests, App Current Split tests, production build.
- Runtime: Compose config, `run.sh` syntax, rebuild, `/api/health`, Open Data catalog, and browser layout smoke. Full multi-gigabyte VisDrone download is an operator action and is not part of routine regression.
