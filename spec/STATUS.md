# Current Status

Last updated: 2026-10-13.

## Current features

- Sources retain explicit version assignments. Reprocessing the same path requires
  confirmation; confirmed history deletion removes dependent project outputs
  while preserving original input files.
- Pseudo operates on the assigned Source and committed class schema. Same-class
  prompt merging and optional area filtering are supported. The counted area
  histogram has a draggable range and per-run Auto selection.
- Review uses the assigned Pseudo/Augment versions, including historical annotation
  snapshots. Reuse copies the latest compatible saved group, supports blank and
  labeled destinations, and retains destination boxes when same-class IoU is
  strictly above the selected threshold (default 0.8). Undo/Redo and manual Save
  remain available. Save & next preserves editing state across queue refreshes.
- Split supports multiple parallel Pseudo → optional Augment groups plus one
  optional Open Data version. Named compositions persist; built Splits retain
  immutable input lineage.
- Open Data supports VisDrone and Ultralytics Platform Detect datasets with
  class mapping, sampling, preview, Review, and retained versions. Shared caches
  are separate from project-owned imports.
- Train selects an assigned or another valid saved Split, persists submitted
  parameters, and reports metrics. Task Center supports cooperative cancellation.
- x86_64 conversion supports ONNX FP32 and LiteRT FP32. Stream Demo supports
  PT/ONNX/LiteRT camera and video inference, with optional CLI terminals.

## Validation

- Latest frontend regression: 321 tests passed; production build passed.
- Backend regression: all 486 tests passed in a fresh isolated Docker runtime.
- Browser regression covered edited labels → Save & next → blank destination →
  Reuse → overlapping destination, repeat clicks, Undo/Redo, and save payloads.
  Writes used mocked APIs. Four languages and five viewport widths were checked.
- Deployed read-only acceptance loaded an actual empty image and verified Reuse
  enabled, without modifying project annotations. API health and CUDA passed.
- Desktop environment verified with PyTorch 2.11.0+cu128, CUDA 12.8 and RTX 2080 Ti.
  Historical Jetson verification used AGX Orin, JetPack 6.2/L4T 36.4.7; it was not
  repeated for the latest frontend update.

Detailed checks: [Review](references/review-editing-and-image-removal.md#verification-focus),
[workflow versions](references/workflow-assignments-and-compositions.md#verification),
[runtime tests](TESTING.md), and
[Jetson acceptance](references/lesson-20260731-jetson-docker-cuda-training.md).

## Limits and operating notes

- Local/private-network tooling for trusted operators. Optional Google/Facebook/
  LINE sign-in does not isolate projects by user.
- Open Data accepts Detect/bbox tasks only. Generic archive ingestion and
  LLM-assisted normalization are planned, not available.
- Jetson/aarch64 conversion is not supported; move PT weights to x86_64.
  FP16, INT8 and calibration are not part of the active conversion flow.
- Review is a quality-control step, not a checked-status prerequisite for training.
  Annotation changes can invalidate downstream builds.
- Project deletion preserves raw `data/input/` and shared Open Data caches.
  Use the UI's stale-record cleanup rather than editing SQLite manually.
- Background jobs continue across page navigation. Wait for active jobs before
  rebuilding or restarting the service.
- Inspect current addresses with `./run.sh --status` and
  `./run.sh --tailscale-status`; historical LAN addresses are not configuration.

For setup, use [English](../README.md) or [繁體中文](../README.zh.md).
