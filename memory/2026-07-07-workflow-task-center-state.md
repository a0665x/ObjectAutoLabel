# 2026-07-07 Workflow and Task Center State

## Symptom

- After registering and analyzing an image-folder source, Workflow Guide could still show Source as `Not done yet` on the Pseudo page.
- Clicking Generate Pseudo Labels could show two similar Pseudo Label tasks in Task Center.
- After pseudo-labeling completed, the page could still show a local queued/running `Pseudo Label Generate` task even though Review showed generated labels.

## Root Cause

- Source processing refreshed projects/jobs but did not immediately refresh the project artifact context used by Workflow Guide.
- Task Center rendered button-local client tasks and backend jobs independently, so the same Pseudo Label operation appeared twice.
- `localPseudoJob` remained a fallback even after the backend pseudo-label job had become visible or completed.

## Fix

- Sources now calls an artifact refresh hook after source processing changes the source inventory.
- Task Center now deduplicates client tasks when a matching backend job exists for the active project.
- Pseudo page reconciles the local pseudo job with the server job and drops the local queued state once the server job exists.
- Pseudo running feedback includes a disabled restart affordance that tells the operator to wait for the running job first.

## Verification

- `npm --prefix frontend test -- App.test.tsx`: 32 passed.
- `npm --prefix frontend run build`: passed.
- `npm --prefix frontend test`: 61 passed.
