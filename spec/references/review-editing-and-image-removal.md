# Review Editing and Project Image Removal

This is the current implementation contract for Review. Read it for pointer,
shortcut, history, removal, or downstream-staleness changes. Earlier plans
remain recoverable from Git history, but this file is the active source of
truth.

## Source Routing

- `frontend/src/pages/ReviewPage.tsx`: page state, queue position, clipboard,
  undo/redo, save, removal confirmation, and restore orchestration.
- `frontend/src/components/review/AnnotationCanvas.tsx`: pointer capture,
  gesture routing, zoom, pan, draw/lasso previews, move, and resize.
- `frontend/src/components/review/canvasInteraction.ts`: effective-tool
  precedence for persistent and temporary gestures.
- `frontend/src/components/review/reviewCommands.ts`: shared Edit menu,
  toolbar, and keyboard command registry.
- `frontend/src/components/review/reviewHistory.ts` and
  `reviewClipboard.ts`: session history and normalized bbox clipboard.
- `frontend/src/components/review/AnnotationContextMenu.tsx`: body-portaled,
  viewport-clamped box context menu.
- `backend/app/main.py`: image-position, remove, restore, annotation, queue,
  and review-stat routes.
- `backend/app/project_services.py`: recoverable file moves and restore logic.
- `backend/app/repositories.py`: tombstones, queue exclusion, removal records,
  and Augment/Split staleness recomputation.

## Gesture Contract

The active pointer gesture is captured on pointer-down and committed once on
pointer-up. Pointer moves update a ref-driven preview at most once per animation
frame. Invalid geometry, `pointercancel`, lost pointer capture, image changes,
and window blur abort without creating or moving a box; coordinate conversion
must never synthesize `(0,0)`.

Gesture precedence is:

1. Middle-drag or `Space`+left-drag temporarily pans from any tool.
2. Holding `Ctrl/Cmd` temporarily swaps Draw and Select for that gesture.
3. In Select, `Shift`+background drag creates a lasso.
4. Otherwise the persistent Select, Draw, or Pan tool applies.

Select permits direct bbox move/resize. At Fit, empty-background drag lassos;
above Fit it directly pans, while `Shift`+drag still lassos. Draw begins even
inside an existing bbox when Draw is the effective tool. Draw and lasso previews
are solid, overlay text cannot be browser-selected, and selected boxes stay
clamped to natural-image bounds. Normalized coordinates are clipped again after six-decimal rounding so an edge cannot become slightly negative or exceed 1 during save. Bbox strokes use fixed screen-pixel widths across fit and zoom levels; normal strokes are 4 px and selected strokes are 6 px.

`Ctrl/Cmd`+wheel zooms around the pointer from 25% to 800%; ordinary wheel
scrolling remains available to the page. The toolbar also exposes zoom out,
100%, zoom in, and Fit.

## Commands and Shortcuts

The Edit menu, toolbar, context menu, and keyboard dispatch share one command
registry. Disabled commands remain visible so the shortcut map is discoverable.

| Action | Shortcut |
| --- | --- |
| Select / Drag | `D` |
| Draw Box | `B` |
| Pan | `H` |
| Copy / Paste | `Ctrl/Cmd+C` / `Ctrl/Cmd+V` |
| Duplicate selected boxes | `Ctrl/Cmd+D` |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` |
| Delete selected boxes | `Delete` or `Backspace` |
| Save / Save & Next | `Ctrl/Cmd+S` / `N` or `Shift+S` |
| Remove active image from project | `Shift+X` |
| Cancel gesture, close menu, then deselect | `Escape` |
| Previous / next queue image | `ArrowLeft` / `ArrowRight` when no box is selected |
| Nudge selected boxes | Arrow keys; add `Shift` for ten pixels |
| Temporary pan | `Space`+drag or middle-drag |
| Temporary Draw/Select swap | hold `Ctrl/Cmd` while dragging |

Copy stores normalized YOLO geometry and class identity, so Paste can cross
images of different resolutions in the same Review session. Duplicate creates
fresh IDs with a visible offset. One completed gesture or command is one history
entry. History and clipboard are session-local and do not survive refresh.

## Image Removal and Lineage

`Shift+X` or `Remove Image From Project` opens one confirmation. Confirmation
calls `DELETE /api/projects/{project_id}/images/{image_id}` and advances to the
backend-selected next image. Only project-owned copies and reviewed-label files
are moved into project-local hidden trash; external/raw `data/input` files are
never deleted. `Ctrl/Cmd+Z` calls the restore endpoint while the operation is
still recoverable.

Removed images carry `images.removed_at` and `removal_operation_id` and are
excluded from normal queues. `image_removal_operations` records original/trash
paths and restore state. Affected `augmentation_runs` and `dataset_splits` are
marked `outdated` with a structured `project_image_removed` reason. New training
from an outdated split is blocked. Restoring recomputes lineage and clears
staleness only when no removed dependency remains; historical models are never
rewritten.

The hidden trash is swept only for unresolved operations created before the
current backend boot, making the current Review session the supported undo
window. Whole-project deletion also removes project-local trash.

## Queue and Position Semantics

Review uses a filename-free grid in stable queue order. The full-width Image Map appears below the Workflow Guide, followed by the full-width Object size distribution; the right column is reserved for current-image annotation details. Operators can combine Pseudo Label, Augment, and Open Sources groups, with each rounded, filled group button showing its full available count. Cell color is stretched across the selected cohort using a risk score from mean/min confidence, confidence spread, low-confidence ratio, and bbox count; the active cell has an outline. The histogram aggregates per-class bbox area percentages across the selected groups. Any bin containing at least five boxes and 35% of its class distribution is recursively split into five equal sub-bins, with bounded depth and a minimum width, so a dense 0–1% range first becomes 0–0.2%, 0.2–0.4%, and so on, then continues splitting any still-dominant child. Bar height uses square-root scaling so lower-count bins remain visible. Gold bins identify the current image, and clicking one adds a glow to matching current-image boxes. These are bbox statistics rather than segmentation-mask pixel coverage.

## Position and Save Semantics

The toolbar shows `Filtered queue N / M` and `Project total N / M`. Position is
recomputed after filter changes, save-driven queue membership changes, removal,
restore, and refresh. Saving replaces the full annotation set, writes the YOLO
label under `reviewed_labels/`, preserves the backend compatibility status without exposing checked/not-checked UI, and reconciles the active
image without displaying stale boxes from the previous image.

Dirty state compares only clipped annotation content against the successful load/save baseline. Legal boxes preserve their full coordinate precision during clipping; they are not round-tripped through rectangles again. A completed save followed by queue navigation must not prompt unless annotation content changed after the submitted save.

## Verification Focus

- Frontend: `ReviewPage.test.tsx`, `AnnotationCanvas.test.tsx`,
  `reviewCommands.test.ts`, context-menu, history, and clipboard tests.
- Backend: `test_annotations_api.py`, `test_project_services.py`,
  `test_repositories.py`, and `test_dataset_flow_updates.py`.
- Manual browser smoke remains required for pointer feel, context-menu placement,
  zoom/pan, and real-image queue transitions.
