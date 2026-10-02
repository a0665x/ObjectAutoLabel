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
and keeps upstream train/validation membership. Select versions directly with
keyboard/touch buttons in an interactive processing flow. Modules show names,
counts, timestamps and processing settings. Selecting Augment supplies its
recorded Pseudo parent; changing Pseudo clears a previously selected Augment.

The Split page follows **select source cards → set ratios → build**. Only the
current project's Pseudo/Augment/Open Data versions appear here, not every
workflow stage. The compact Pseudo → Augment + Open Data → Split diagram shows
the current version/count at each node. A hover or keyboard-focus preview fans
up to two other versions like a card deck; it never changes selection. Click/tap
opens that step's color-matched picker (three versions plus the selection, Show
all for older outputs). Names, counts and dates remain visible in the picker,
with settings under Details. Blue/Purple/Teal accents connect
cards and the owning navigation tabs. Selection uses a check mark as well as
color. There is no duplicate Compose/drag-slot area: source cards are the only
version selectors. The final Split node shows an approximate count that does not
double-add the Pseudo source and takes the user to ratios without submitting a
build. Picker-header removal
also works when a selected source has disappeared. Saved combinations is an
optional, initially collapsed disclosure.
Only one picker opens at a time. Pointer leave retracts the deck preview but
does not dismiss an explicitly opened picker; the same node, close button,
Escape or an outside click dismisses it. Selecting/removing a version collapses
it and returns focus to its node. Focus follows a newly opened picker so it is
reachable on small screens. Mobile uses a vertical flow with rotated arrows.
Short transform/opacity transitions use no animation dependency or continuous
animation and are disabled under prefers-reduced-motion.
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

Split content and the shared version inspector follow the application's English,
Traditional Chinese, Japanese or Korean selection via `WorkflowProvider.language`.
`workflow/text.ts` owns these messages. Feedback stores message keys/parameters,
not already-translated text, so language changes update existing notices without
resetting the draft. Version names, paths, class names and model identifiers are
preserved. Known source failures are translated; unknown server diagnostics stay
verbatim under localized Technical details. Ratio help is expandable on touch as
well as desktop. Shared lineage, sample labels, version settings and Split deletion
confirmation are localized too. This does not claim full translation of every
generation form or application-wide navigation/status component.

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
null inputs, save failure, source navigation and draft retention, shared Assign
updates and deletion confirmation. It also checks localized content/help/errors,
language changes without resetting selection, source-inspector translations,
collapsed optional combinations and translated destructive-action confirmations.
Existing lineage, history
deletion, API, service and Pseudo tests remain required.

2026-10-01 acceptance: all 278 frontend tests and the production frontend build
passed; all 449 backend tests passed in the Docker runtime. A host-only run had
one missing-Authlib dependency failure, not a workflow regression. Headless Chrome
verified source navigation, exact Augment preview selection, draft retention,
reduced motion and no horizontal overflow at 375/768/1024/1440 px. These browsing
checks made no composition/assignment/Split writes against the real project.

2026-10-02 acceptance: 289 frontend tests pass, including content-level locale
coverage (not only sidebar labels), saved-history confirmation, invalid ratios,
and preservation of original version names. Headless Chrome verified the four
languages, source-version navigation, retained selections, keyboard activation
and 375/768/1024/1440 px layouts without data-changing requests. Production
frontend compilation also remains required before publishing static assets.

Interactive-flow coverage additionally checks click/keyboard disclosure, Escape
and focus restoration, pointer-leave versus outside-click behavior, locked and
unavailable versions, linked-node updates, non-duplicated totals and navigation
to ratios without building. Hover/fan transforms, touch, reduced motion and
responsive layout require a real-browser check.
2026-10-02 flow acceptance: all 292 frontend tests and the production build pass.
Headless Chrome verified four languages, hover enter/leave, click toggling,
keyboard/Escape and focus return, touch selection with an onscreen picker,
source-tab round trips, ratio navigation, reduced motion, 200% root text size,
and 375/768/1024/1440 px widths. No page errors or data-changing requests occurred.
