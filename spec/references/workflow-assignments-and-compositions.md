# Workflow assignments and dataset compositions

## Operator flow

Project cards retain confirmed project-package deletion and show the assigned
project with a red outline and an Assigned button. Active project jobs block
package deletion.

Pseudo, Review, Augment, Open Data, Split, Train, Validate and Convert expose a
shared Assign & history footer. Assign changes the project runtime selection,
not the underlying saved build. Upstream changes clear dependent assignments.
Input selectors use a green gradient; retained history uses a light-blue
gradient. Split's Assign/View/Delete actions remain visible rather than hidden
under a separate lineage list. Source parenting is restored when assigning a
Split, Train, Convert or saved composition as well as Pseudo/Augment.

## One Split page context

Split has explicit New and History modes. Selecting History binds the source
board, recorded ratios, sample images and coverage to the same saved Split id.
The board is read-only and includes every recorded parallel branch, including
when its saved composition has since been deleted. View does not assign; Assign
persists the choice for Train and downstream tabs.

New edits a provider-owned composition draft and has no saved result. A saved
combination dropdown and the existing source pickers edit that same draft. Do
not show the newest unrelated Split below it. Starting New from a historical
version copies its source recipe and ratios without changing the saved build.
A successful build selects only its own newly materialized name/composition,
not whichever historical output happened to be newest while the job was queued.

History selection survives source-tab visits and ordinary polling. Changed
project assignments reconcile the draft and clear obsolete version-inspector
focus; unchanged assignments must not reset selection. Late sample responses
are ignored after changing version or mode. Deletion keeps the other versions
and refreshes selectors; a missing selected history is reported explicitly.

## Sources and compositions

Source history also supports persisted `source` assignment. Each row shows the
registered folder/video basename, original-image count, path, timestamp and id.
Registration does not implicitly assign a new source. Videos without extracted
frames and sources with active extraction are unavailable for Pseudo generation.
The Pseudo input selector changes the same assignment and Generate passes its
concrete `source_asset_id`; no selected source disables Generate. API callers may
omit the id only when a valid persisted Source assignment exists; otherwise the
request returns 409 before creating a job. The worker revalidates that source.
Changing Source clears downstream Pseudo/Augment/Split/Train/Convert assignments
and the active recipe, while preserving saved artifacts and Open Data. Reassigning
the same Source is a no-op. Assigning a source-specific saved Pseudo/Augment also
restores its Source parent; legacy all-source Pseudo runs cannot infer one parent.
Source analysis and catalog counts exclude Augment/Open Data derived images.

Source history also offers confirmed Delete history: only that version's copied
images and dependent downstream history are removed, never original input or
unrelated versions. Active project jobs block deletion. Reprocessing the same
resolved path/kind first asks whether to intentionally create another version.
Pseudo's shared footer is now its sole run-history/delete surface; the duplicate
Previous pseudo-label runs list is removed. New runs may opt into post-merge
large-box filtering, with an adjustable one-third default area threshold and
persisted removed-box count.

Split's composition board accepts one or more parallel Pseudo → optional Augment
groups and one shared optional Open Data version. Each group's Augment replaces
its raw Pseudo image set; it is not added a second time. Groups are summed, and Open Data is additive
and keeps upstream train/validation membership. Select versions directly with
keyboard/touch buttons in an interactive processing flow. Modules show names,
counts, timestamps and processing settings. Selecting Augment supplies its
recorded Pseudo parent; changing Pseudo clears only that group's previously selected Augment.
`Add Pseudo → Augment group` adds a parallel row and opens its Pseudo picker.
Removing a group changes only the Split draft. Cards, version pickers, short
transitions and source inspectors retain their existing interaction patterns.
One source version cannot be included twice; overlapping raw originals across
Pseudo versions are rejected during materialization rather than silently given
conflicting labels. Select distinct sources or retained Augment outputs instead.

In New mode the Split page follows **select source cards → set ratios → build**. Only the
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

Review follows the project assignments from the Pseudo and Augment tabs. Its
Pseudo and Augment Image Map groups each show only the assigned version, with
its name and available count; an unassigned group is disabled. Open Sources
still shows the Review-active Open Data import. Selecting Augment assigns its
recorded Pseudo parent; changing Pseudo clears an incompatible Augment assignment.
The scoped queue, position, confidence colors and histogram use the same inputs.
Pseudo review loads the selected run's retained annotation snapshot. Saving an
older Pseudo updates only that snapshot and its version-local reviewed labels,
preserving the live annotations attached to another run. Switching assignments
clears annotation caches and session history, and dirty edits require confirmation.
New Pseudo runs preserve annotation snapshots for historical Augment/Split input.
Legacy runs whose originals were already overwritten cannot be reconstructed;
choose a retained Augment build or regenerate Pseudo when the API reports this.

## Saved Split source coverage (2026-10-14)

Saved Splits expose actual bucket proportions and each Source/Pseudo/Augment
batch's counts and shares of the combined train/validation/test buckets.
Official Open Data membership remains unchanged; therefore combined proportions
may differ from the requested local split ratios. The inspector does not alter
the existing seed-42 shuffle or prevent related-frame/augmentation leakage.

The source/filename-ordered coverage chart aggregates at most 128 bins. Native
dual handles zoom a read-only inspection window. Three separate horizontal rows
show Train/Validation/Test density, not a stack of unrelated versions. The
source filter is removed; all coverage belongs to the page's selected Split.
Batch counts/shares are under a collapsed detail disclosure. Folders belonging
to the same Pseudo/Augment pair are combined into one row matching the input
board, not presented as duplicate source-version cards. Counts provide a
text alternative to the colored chart.

Hover, keyboard focus/change, or touch resolves one saved member after a 180ms
dwell and loads only a JPEG bounded to 256×160. A native top-layer popover is
viewport-contained. The component caches at most eight Blob URLs and 32 small
metadata responses, aborts superseded requests, revokes evictions, and releases
all URLs on Split/project change or page exit. No original images are prefetched
and the backend writes no thumbnail cache.

New builds atomically publish frozen ids/names and compact ordered image rows in
`coverage_manifest.json`. Old builds reconstruct available provenance on GET,
explicitly label legacy metadata, and never create a retrospective manifest.
The saved DB bucket ids and copied label files remain authoritative.

Coverage/thumbnail tests verify multiple parallel groups, exact counts including
official Open Data groups, later assignment/name independence, membership and
symlink guards, read-only legacy fallback, compact JSON and no eager image loads.
Initial mocked browser acceptance exercised keyboard preview, pointer dragging,
four languages and five widths. Thirteen thumbnail loads
retained eight active URLs, evicted five, and released all on page exit; zero
data-changing API requests and page errors occurred.
Unified-context acceptance subsequently verified New/History switching, source
branch binding, visible Assign/Delete, Split → Train and Pseudo → Split updates,
mocked confirmed deletion, gradients and 20 locale/width combinations. No real
history was deleted.

## Persistence and validation

- `workflow_states`: project-keyed assignment JSON and assigned composition id.
- `dataset_compositions`: named recipe with `branches_json` containing ordered
  Pseudo/Augment pairs and one `open_data_import_id`. Legacy scalar columns retain
  the first pair, and old recipes with null `branches_json` remain readable.
  Recipes are immutable; create another to change the inputs.
- `dataset_splits.composition_id` / `composition_json`: origin recipe id and
  immutable recipe metadata, including every branch's ids, saved names and counts.
  Deleting a recipe preserves built splits. Deleting any upstream branch follows
  the full snapshot to find dependent Split/Train/Convert/Export history.
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
  `stage: "source"` assigns one registered input source.
- `POST /api/projects/{id}/compositions`: name, optional `branches` array of
  `{pseudo_label_run_id, augmentation_run_id}` pairs (up to 32), and one optional
  `open_data_import_id`; the legacy three scalar input ids remain supported;
  returns updated runtime state and assigns the new recipe.
- `POST /api/projects/{id}/compositions/{id}/assign`: restore a saved recipe.
- `DELETE /api/projects/{id}/compositions/{id}`: remove the recipe only.
- `POST /api/projects/{id}/dataset-splits`: optional `composition_id` resolves
  the recipe server-side; legacy explicit-id callers remain supported.
- Review image list/position/source-count/histogram endpoints accept optional
  `pseudo_label_run_id` and `augmentation_run_id`. An empty id explicitly selects
  no version; omitting the query retains the legacy unscoped behavior.
- Annotation GET/PUT accept `pseudo_label_run_id` to read/save the selected
  Pseudo snapshot. Project membership and retained-image membership are validated.

## Verification

2026-10-13 histogram-range and Reuse acceptance: 313 frontend tests, 486 backend
tests and the production bundle passed. Coverage includes dominant large-mode
separation/fallback, inclusive manual bounds, raw distribution persistence,
source-scoped legacy fallback, fresh manual copy identities, no duplicate offsets,
source-boundary protection, Undo and explicit Save. Mocked browser acceptance
verified real drag of both native handles, keyboard adjustment, manual payload
preservation across four languages/five widths, and Reuse → no-op repeat →
Undo/Redo → Save on a missing-label next frame. Reuse aligns beside all three
tools, and neither Pseudo nor Review overflows at 375–1440px.
The final deployment's read-only acceptance also verified a real legacy Source's
1,212-box retained-only histogram and all five viewport widths. Desktop toolbar
container queries and top-bar wrapping contain the actual long-project-name case.
No live labels were saved or generated during browser verification.

2026-10-13 Source history and large-box filtering acceptance: 307 frontend tests
passed in the single-worker regression run; the parallel run exposed an unrelated
existing Stream seek timing flake. The production bundle and 471 backend tests
passed. Fake inference checks cover disabled filtering, strict one-third boundary,
custom thresholds, all-box removal with image retention, and merge/filter metrics.
Temporary-project tests cover canonical/symlink path duplicates, explicit override,
Source cascade, original-input/unrelated-version retention, legacy dependencies,
active-job protection and stale deletion plans. Mocked browser acceptance covers
duplicate cancel/confirm, source deletion/refresh, one Pseudo history surface and
25% payload persistence across four languages and five widths (375–1440px), with
no horizontal overflow or page errors. No live Source histories were deleted.

2026-10-13 Source assignment acceptance: 303 frontend tests and production build
passed. The backend suite passed 458 tests in the disposable runtime container;
focused follow-up checks also cover source-only analysis and same-source no-op
assignment. Fake-model inference processed only the selected Source and
preserved another Source's images/annotations. Browser fixtures verified Source
history assignment, Pseudo's selected id and custom name in the request, disabled
Generate without a Source, empty-video rejection, preserved fields across four
languages, and no overflow at 375/768/851/1024/1440 px. API writes were intercepted.
Late initial history loading no longer overwrites an operator-entered Pseudo name.

2026-10-13 parallel-source acceptance: 300 frontend tests and the production
build passed. The complete backend suite passed 455 tests in a disposable
container using the existing runtime image; host Python lacks PyTorch. Browser
fixture acceptance verified two parallel pairs, the 4,592 + 260 + 7,019 = 11,871
total, exact composition-to-Split submission, assignment-scoped Review requests,
four languages, touch/keyboard selection and Escape focus return. At
375/768/851/1024/1440 CSS pixels there was no page overflow and peer card widths
matched; 200% root text and reduced motion also passed. Browser fixture writes
were intercepted and did not modify production projects. Tests cover secondary
branch deletion, schema/lineage validation, snapshot isolation and official
Open Data bucket preservation.

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
