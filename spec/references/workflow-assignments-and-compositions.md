# Workflow assignments and dataset compositions

## Operator flow

Project cards retain confirmed project-package deletion and show the assigned
project with a red outline and an Assigned button. Active project jobs block
package deletion.

Pseudo, Review, Augment, Open Data, Train, Validate and Convert expose a
shared Assign & history footer. Assign changes the project runtime selection,
not the underlying saved build. Upstream changes clear dependent assignments.
Existing deletion actions remain available. Split has no duplicate Assign footer;
its detailed history is collapsed beneath Saved Splits.

Split's composition board accepts one Pseudo source, one optional Augment
built from that source, and one optional Open Data version. Augment replaces
the raw Pseudo image set; it is not added a second time. Open Data is additive
and keeps upstream train/validation membership. Drag modules into their typed
slots, or use the equivalent keyboard/touch buttons. Modules show names,
counts, timestamps and processing settings. Selecting Augment supplies its
recorded Pseudo parent; changing Pseudo clears a previously selected Augment.

The Split page follows **select source cards → set ratios → build**. Only the
current project's Pseudo/Augment/Open Data versions appear here, not every
workflow stage. Cards show a name, image count and date, with settings collapsed
under Details; each source column initially shows three versions plus its
selection, with Show all for older outputs. Blue/Purple/Teal accents connect
cards, source slots and the owning navigation tabs. Selection uses a check mark
as well as color. Linking an Augment briefly highlights affected slots; reduced
motion disables the movement. Source selection supports keyboard/touch and drag.
The Task Center is docked below this page rather than floating over source cards.

Selecting a source or a saved combination changes a provider-owned draft only.
It survives source-tab visits within the active project and is not overwritten
by polling; it is not a persisted browser draft. Changing projects resets it.
Build New Split Version validates the draft and reuses an identical valid saved
recipe, or saves an automatically named recipe before submitting the Split with
that exact composition id and explicit input ids. Save current combination is an
optional named-save disclosure, not a prerequisite. A save error stops Split
submission. The existing save API still persists its assignments; selecting a
card or Use combination does not. Confirmed Delete removes only the recipe.

Each source card's upper-right arrow opens its owning tab and an explicitly
selected, color-matched saved-version inspector. Pseudo uses that run's saved
preview when present; Augment selects the corresponding Inspect build entry;
Open Data highlights that import's history. Inspection never assigns the source
or overwrites generation settings or the active Open Data mapping. Back to Split
returns to the preserved draft. Missing/deleted sources show an unavailable
message and are not silently replaced by a newer version.

Saved Splits provides **Use this Split in Train** to assign the selected completed
Split and open Train, without starting a training job. Train and downstream model selectors
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
exact draft-to-Split submission, optional save, saved-recipe reuse, Open Data-only
null inputs, save failure, typed drag/drop, source navigation and draft retention,
shared Assign updates and deletion confirmation. Existing lineage, history
deletion, API, service and Pseudo tests remain required.

2026-10-01 acceptance: all 278 frontend tests and the production frontend build
passed; all 449 backend tests passed in the Docker runtime. A host-only run had
one missing-Authlib dependency failure, not a workflow regression. Headless Chrome
verified source navigation, exact Augment preview selection, draft retention,
reduced motion and no horizontal overflow at 375/768/1024/1440 px. These browsing
checks made no composition/assignment/Split writes against the real project.
