# Current Status

Last updated: 2026-10-19.

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
- Split uses one New/History context for sources, ratios and results, with visible
  Assign/Delete history. Green input and light-blue history surfaces distinguish
  their roles. Coverage has three bucket rows and collapsed batch details.
- Saved Split coverage shows real per-batch train/validation/test distribution,
  a draggable inspection window and lazy 256×160 previews. New provenance is
  frozen; old versions retain explicit read-only legacy reconstruction. Preview
  memory is bounded to eight images; no image cache is written to disk.
- Open Data supports VisDrone and Ultralytics Platform Detect datasets with
  class mapping, sampling, preview, Review, and retained versions. Shared caches
  are separate from project-owned imports.
- Train selects an assigned or another valid saved Split, persists submitted
  parameters, and reports metrics. Task Center supports cooperative cancellation.
- x86_64 conversion supports ONNX FP32 and LiteRT FP32. Stream Demo supports
  PT/ONNX/LiteRT camera and video inference, with optional CLI terminals.
- Stream detection boxes now remain visible before tracking IDs are confirmed.
  Untracked boxes are labeled Detected and are not selectable identities. Low
  FPS affects sampling/association, not detection visibility gates.
- Stream defaults to detection/confidence only. An independent overlay checkbox
  gates live Kalman/trail/topology details, with displayed-frame counts and missing
  ID/low-FPS feedback. Annotation size is adjustable below IoU. Local-path selection
  retires terminal display and exposes the server-confirmed loaded model path.
- Stream observation defaults use an 800 ms prediction/bridge limit and 12
  missed frames at 15 FPS. Pause unlocks parameter/model editing; Resume applies
  drafts at the exact paused file position, resetting tracking only if inference
  settings changed. Validation failures retain the paused frame for correction.
- Stream has a separate default-off optical-flow checkbox, with local pyramidal
  Lucas–Kanade arrows/trails, gradient modes, sampling controls and measured
  image-motion statistics. Computation is a bounded browser Worker, independent
  of detector/tracking IDs; disabled flow does no analysis or image caching.
- Tracking/optical-flow settings have localized `?` help with plain-language
  meaning and adjustment trade-offs, usable even while controls are disabled.
  Numeric fields retain typing drafts and apply valid values on Enter/blur;
  Escape restores the last value. Invalid tracking drafts block Start/Resume.
- Selected tracked boxes expose a compact live crop, original-color Laplacian
  edge preview, color distributions and same-class appearance ranking below
  Annotation size. A fixed pixel sample can be resampled/exported as versioned
  numeric features. An explicit Color-sample tracking checkbox follows same-class
  detections without IDs or searches image pixels without detector boxes. Weak
  evidence retains a clearly unconfirmed dashed location, not a claimed match.
  Detection-backed sampling now uses immutable YOLO input crops/features captured
  before ByteTrack, keyed by stream/frame/detection. All valid same-class boxes
  are compared; one sample is pinned separately from a 32 MiB / 180-frame RAM
  ring. Missing cache entries never recrop playback pixels. Image-only search is
  separately labeled and cannot adapt/resample the locked reference. No disk
  image cache or ByteTrack identity changes are introduced.

## Validation

- Latest frontend regression: 415 tests passed; production build passed.
- YOLO cache acceptance used a real PT/video replay: paused no-ID selection,
  lossless crop/descriptor agreement between Python and JavaScript, exact JSON
  provenance, pinned features surviving 180-frame eviction, explicit unpinned
  expiry, and continued image-only search after browser-local removal of all
  box metadata. Four languages at 375/768/1440px passed without browser errors.
  The final deployed runtime also passed isolated GPU/video inference, exact
  crop/feature agreement and pin/release eviction checks. A concurrent project
  stream blocked a second browser replay; that session was not interrupted.
- Color tracking acceptance includes deterministic large-jump/no-box reacquisition,
  no-ID detection selection and weak-evidence dashed holds. A real PT/video browser
  replay locally removed IDs and then all box metadata: independent color tracking
  retained a box and exercised detection, image-search and hold states. Fixed
  features, JSON export, one-job Worker bounds, cleanup and four languages at
  375/768/1440px passed without project writes or browser errors.
- Deployed parameter-help acceptance verified hover, focus, tap and Escape,
  four languages and 375/768/1440px widths. Grid columns accepts clear → 1 → 16;
  invalid/out-of-range fractions retain the last valid setting, with Escape
  restoring it. Help remains readable beside disabled controls without overflow.
  Actual PT/video replay also verified help while streaming, invalid tracking
  drafts blocking Resume, corrected decimal input and exact-position retuning;
  optical-flow grid edits retained one model session. No browser errors or
  project/annotation writes occurred.
- Backend regression: all 515 tests passed in a fresh isolated Docker runtime.
- Stream browser checks passed at 375/768/1440px: detection-first default, live
  overlay gating and screen-pixel annotation scaling. Read-only live replay
  loaded two different local PT paths with separate external model tokens and
  server-confirmed paths. Both produced detections and real motion/topology data.
- Deployed Pause acceptance retained frame time 1.238677 s while editing FPS,
  bitrate, resolution, image size, confidence and tracking parameters. Resume
  submitted that exact offset at 8 FPS/960px/320 inference size. A second paused
  model switch preserved the cumulative offset (1.689286 s), with no browser or
  stream errors. Only ephemeral model inspections and owned playback were used.
- Deployed optical-flow acceptance ran with object tracking disabled and observed
  valid image-motion samples/statistics. It verified a single in-flight Worker
  job, pause/final-stat synchronization, grid/color/gradient controls, reset and
  disable cleanup, four languages and 375/768/1440px widths. Flow-only changes
  retained one model session, with no project writes or browser errors.
- Unified Split browser acceptance verified modes, cross-tab assignments,
  confirmed deletion using mocked APIs and four languages/five viewport widths.
- Deployed read-only acceptance verified actual Split_1013_v002's two recorded
  branches and Combination 2's new-mode isolation, with no API writes/errors.
- Split browser acceptance verified pointer/keyboard previews, range dragging,
  cache eviction/release and four languages/five widths without API writes.
- Read-only conversion-002 replay verified all eligible detections from PT,
  ONNX and LiteRT were visible at 1/5/15 FPS on identical decoded frames.
- Desktop service rebuilt with API health/CUDA verified. Live conversion-002
  ONNX playback at 1 FPS delivered 8/8/7 visible detections in its first three
  frames with zero confirmed IDs; retained Split coverage and JPEG previews
  were verified without changing project data.
- Live browser playback also displayed eight non-selectable Detected boxes on
  the actual 1-FPS video frame, with no confirmed track buttons or browser errors.
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
