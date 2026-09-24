# Workflow assignments and dataset compositions

## Operator flow

Project cards retain confirmed project-package deletion and show the assigned
project with a red outline and an Assigned button. Active project jobs block
package deletion.

Pseudo, Review, Augment, Open Data, Split, Train, Validate and Convert expose a
shared Assign & history footer. Assign changes the project runtime selection,
not the underlying saved build. Upstream changes clear dependent assignments.
Existing deletion actions remain available and the previously collapsed
Pseudo/Augment/Split history starts expanded.

Split's composition board accepts one Pseudo source, one optional Augment
built from that source, and one optional Open Data version. Augment replaces
the raw Pseudo image set; it is not added a second time. Open Data is additive
and keeps upstream train/validation membership. Drag modules into their typed
slots, or use the equivalent keyboard/touch buttons. Modules show names,
counts, timestamps and processing settings. Selecting Augment supplies its
recorded Pseudo parent; changing Pseudo clears a previously selected Augment.

Save & assign creates a named recipe and selects it in project runtime state.
The saved-combination list supports Assign and confirmed Delete. Build New
Split Version consumes the assigned recipe by id and records its provenance
snapshot. Assign a completed Split in the footer or choose it in Train's
Split selector to train that version. Train and downstream model selectors
honor explicit runtime assignments rather than silently replacing them with
the newest output.

Review remains a live annotation workbench. Its footer assigns a Pseudo output
for downstream use; it does not replace the live review queue with a historical
snapshot. New Pseudo runs preserve annotation snapshots for historical
Augment/Split input. Review saves update the currently attached Pseudo snapshot.
Legacy runs whose originals were already overwritten cannot be reconstructed;
choose a retained Augment build or regenerate Pseudo when the API reports this.

## Persistence and validation

- `workflow_states`: project-keyed assignment JSON and assigned composition id.
- `dataset_compositions`: named recipe with explicit Pseudo, Augment and Open
  Data ids. Recipes are immutable; create another to change the inputs.
- `dataset_splits.composition_id` / `composition_json`: origin recipe id and
  immutable recipe metadata. Deleting a recipe preserves built splits.
- `pseudo_image_snapshots`: annotations keyed by Pseudo run and source image.
  Snapshot lookup excludes removed images and all Augment/Open Data inputs.

`backend/app/workflow.py` owns validation, the version catalog and runtime state
operations. The API rejects foreign-project, missing, incomplete or outdated
versions, mismatched Pseudo/Augment lineage, and incompatible canonical class
ids/names. Split validates the recipe again in the worker and at publication.
Open-Data-only recipes include no implicit project images. Empty recipes and
recipes with no retained labeled inputs fail explicitly. Snapshot installation
is additive and compatible with an existing database.

Deleting an upstream artifact uses the existing downstream cascade. Runtime
reads exclude deleted/unusable assignments; recipes referencing removed
versions stay visible with a reason and cannot be assigned. Deleting only a
recipe never cascades into its Split/Train outputs. Project deletion cascades
into all runtime state, recipes and Pseudo snapshots.

## API

- `GET /api/projects/{id}/workflow-state`: assignments, catalog and combinations.
- `PUT /api/projects/{id}/workflow-state`: `{stage, artifact_id}`; null clears.
- `POST /api/projects/{id}/compositions`: name and three optional input ids;
  returns updated runtime state and assigns the new recipe.
- `POST /api/projects/{id}/compositions/{id}/assign`: restore a saved recipe.
- `DELETE /api/projects/{id}/compositions/{id}`: remove the recipe only.
- `POST /api/projects/{id}/dataset-splits`: optional `composition_id` resolves
  the recipe server-side; legacy explicit-id callers remain supported.

## Verification

`tests/backend/test_workflow_state.py` covers persistence and project isolation,
recipe validation, assignment invalidation, recipe-only deletion, API errors,
and historical annotation snapshots consumed by Split and pass-through Augment.
`frontend/src/workflow/WorkflowState.test.tsx` covers parent synchronization,
exact recipe submission, typed drag/drop, shared Assign updates and deletion
confirmation. Existing lineage, history deletion, API, service and Pseudo tests
remain required. Browser visual acceptance was unavailable in the implementation
session because no browser was connected; do not interpret unit/build coverage
as a completed responsive browser check.
