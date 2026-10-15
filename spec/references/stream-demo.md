# Stream Demo and Model Provenance

## Baseline

Local baseline commit `0239937`, tag `baseline-x86-training-export-20260909`,
captures the working desktop runtime. The operator confirmed training and
export completion before this feature. Runtime data and weights remain outside
Git; the tag snapshots source and configuration, not those files.

## Version Labels

`backend/app/model_lineage.py` derives labels from persisted training settings,
metrics, Split ratios, and class records (saved dataset YAML is the fallback).
Labels include classes, input model, optimizer, completed/configured epochs,
image size, Split name, training name/id, and best/last checkpoint. Conversion
labels add the conversion version and artifact formats. Unknown old settings
are shown as unknown, never filled from current defaults. Existing paths,
package names, training records, and exported manifests are not renamed.

Convert and Export show the full selected label below the dropdown. Stream Demo
selects a completed conversion first, then its available PT/ONNX/TFLite model.
Failed conversions and missing model files are not selectable.

## Runtime

- Native PT: PyTorch, CUDA:0 or CPU.
- ONNX: ONNX Runtime CPUExecutionProvider.
- TFLite: `ai_edge_litert.interpreter`, CPU/XNNPACK.
- Desktop already pins all three engines. The capabilities endpoint imports each
  engine and disables unavailable formats; it does not install packages at runtime.
- Jetson retains its PyTorch/ONNX runtimes and adds `ai-edge-litert==2.1.4`
  for inference, using the release's Linux aarch64 wheel. This does not add
  the desktop-only LiteRT converter to Jetson. The image imports all three
  inference engines at build time; Jetson hardware acceptance remains pending.
- Both Dockerfiles install GStreamer tools/base/good/bad/ugly/libav and V4L2
  utilities. The build checks `x264enc` and `mp4mux` availability.

`stream_demo.py` owns a bounded session: FFmpeg seeks/decodes uploaded files,
GStreamer captures cameras, and both produce aspect-preserving padded BGR frames.
Ultralytics infers with the selected engine and GStreamer encodes H.264 into
fragmented MP4. Tracking mode draws timestamp-synchronized detections in the
browser: confirmed IDs are interactive, while unconfirmed detections remain
visible without a selectable ID. Detection-only mode keeps encoded OpenCV boxes. The browser uses MediaSource via a same-origin
WebSocket. The output is video-only; audio is not forwarded. X264 bitrate is a
target in kbps, not a guaranteed exact network rate. See
[x264enc](https://gstreamer.freedesktop.org/documentation/x264/index.html) and
[mp4mux](https://gstreamer.freedesktop.org/documentation/isomp4/mp4mux.html).

Conf/IoU changes apply to subsequent frames without restarting. Resolution,
FPS, bitrate, model, tracking mode, and inference device are fixed for a session and become
editable after Stop/completion. Actual inference FPS and latency are reported.
FPS is the output target; inference can be slower on larger models or CPU.
PT image size is selectable; exported models retain their export metadata dimensions.
Only one demo session runs at a time. Stop, page exit, WebSocket disconnect,
timeout, or pipeline failure terminates the decoder and encoder. Queues and
browser buffers are bounded. A file ends at EOF and may be started again.

### Playback and target selection

Uploaded files have a full-duration timeline, Pause/Resume, Replay, and a seconds
field with Go. Pointer release or keyboard adjustment waits for the previous
socket to release its slot, then re-decodes from the requested time. Seeking,
source/model changes (applied on Resume if paused), and replay reset tracking and selection. Pause freezes
both playback and inference. Cameras remain live, without pause or replay.
Invalid/non-finite/out-of-duration seek requests fail explicitly. Cleanup drains
decoder pipes after termination to avoid deadlock on read-ahead output.

`stream_tracking.py` uses Supervision ByteTrack with activation 0.20, matching
0.70 by default (configurable `AI_TRACK_MINIMUM_MATCHING_THRESHOLD`), lost buffer
90 scaled to session FPS, and two-frame confirmation, based
on the supplied Osiris plugin. Low-confidence candidates remain available for
association before applying the display threshold. Independent class trackers
use `class_id:track_id` identities without modulo wrapping. Empty frames age
tracks; expired tracks get new IDs. This is motion/IoU tracking, not visual
re-identification after a long disappearance.

`StreamTrackingOverlay.tsx` matches metadata to video playback time, not the
latest network message. Click/tap or Enter/Space selects an ID and shows a red
box with a Selected label. Missing targets may use a bounded predictive bridge;
confirmed motion/topology reassociation can change the raw ID while preserving
the selected stable ID. Ambiguous candidates never immediately acquire selection.
Clear target cancels both the viewer highlight and backend identity context.
The red highlight is local to the viewer, not baked into H.264. The existing CLI
command remains a detector verification, not the interactive tracking player.

### Detection visibility and low FPS (2026-10-14)

Detection visibility is independent of identity confirmation. Previously the
session exported only ByteTrack's confirmed output, so sampled fast motion at
1 FPS could return zero visible boxes indefinitely even when every model frame
contained a 0.9-confidence detection. A 0.15-confidence detection with a 0.10
display threshold was also hidden by the separate 0.20 track activation gate.

The tracker now retains display-eligible detections and carries each original
detection index through Supervision's matched rows. The session adds unmatched
observations back after the identity adapter, without duplicating matched boxes
or inventing IDs. Untracked entries have `id:null`, `tracked:false` and a
`detection_index`; confirmed entries keep their real ID. Only confirmed IDs enter
motion/topology/selected-identity logic. The SVG labels untracked boxes as
Detected and does not make them selectable. `detections` counts eligible observed
boxes; `tracks` and `untracked` report the separate current-frame counts.
Identity gates, bridge lifetime and consecutive confirmation remain unchanged.

FPS still changes which video frames are sampled and how well motion can be
associated. It must not hide an observed box solely because tracking failed.
Metadata includes `dt_ms`, so a 1-FPS detection remains visible for its actual
displayed frame instead of using a fixed high-FPS expiration window.

Acceptance: a deterministic moving-box replay changed from ten zero-box frames
at 1 FPS to one observed box on every frame, with tracking on/off and scores
0.9/0.15. The regression reaches the real Session → ByteTrack → Identity seam,
with only model inference supplied as a fixture. A read-only conversion-002
replay used identical decoded pixels from four retained 4K/30-FPS dashcam frames:
PT, ONNX and LiteRT each produced 8/9/6/5 eligible boxes at confidence 0.25,
and displayed all of them at configured 1/5/15 FPS despite no confirmed IDs.
This is same-frame visibility acceptance, not an assertion that different FPS
sampling schedules always produce identical model detections.
Deployed WebSocket acceptance then ran the actual GStreamer decode/inference/
H.264 path with conversion-002 ONNX at 1 FPS: the first three frames carried
8/8/7 detection boxes with no confirmed IDs and valid encoded video bytes. The
test stopped its own session and did not modify uploaded files or annotations.
The deployed browser player also decoded the video and rendered eight Detected
SVG boxes at media time 1.016 s with zero track buttons. This verifies the
playback-time overlay, not only the backend metadata.

### Osiris identity tuning and visualization (2026-09-29)

The detector adapter `Yolo26nTrackingPlugin.py` itself does not implement topology.
The reference implementation lives in `AI_Server/tracking_motion.py`,
`AI_Server/tracking_identity.py`, and the selected-target lifecycle in `main.py`.
The two pure algorithm modules are ported here, with their original regression
fixtures (`test_osiris_tracking_*`). `stream_identity.py` adapts the selected-target
lifecycle to Stream Demo without gimbal/drone dependencies. The only extension
to the pure motion module exposes center covariance for diagnostic rendering.

`tracking_settings.py` defines 19 exact YAML key names, ranges, and defaults taken
from the supplied `Osiris_ai_src/env_config.yaml`. ByteTrack still emits raw IDs;
only the clicked target has a persistent stable display identity. Candidate scores
combine predicted position, motion, size, static topology, and dynamic topology.
Score threshold, winner margin, and consecutive confirmation protect reassociation;
pending candidates and bridge frames never refresh the last trusted reference.
Direct raw-ID matches undergo the same innovation gate (including the original
fail-open behavior when motion/innovation is unavailable). This is not appearance
ReID and does not guarantee recovery after severe shake or long disappearance.

`Tracking` follows Inference. Its parameter-group dropdown offers ByteTrack,
Kalman motion, Identity/topology, and Predictive bridge. Algorithm settings are
immutable within one backend session. For uploaded videos, Pause unlocks model,
schema, output, inference and tracking controls while retaining the displayed
frame and exact absolute media position. Changes remain drafts with a visible
pending notice. Resume waits for the old session to release its slot, then loads
the latest settings from that position with fresh tracking/MSE buffers. It never
silently resumes old inference or jumps to zero. Invalid settings or an
uninspected local path disable Resume without clearing the paused frame.
Unchanged settings, annotation size and visualization-only edits resume the
original session without resetting tracking. Changing the input video/camera
still requires Stop. Cameras remain live-only. The legacy API YAML import accepts an
`env:` mapping or a flat mapping, ignores unrelated settings, rejects unknown
tracking keys/nonfinite/out-of-range values, and limits input to 64 KiB. Export
previously downloaded the supported tracking settings; the current UI exports
plain JSON instead (see 2026-10-01 update below). The legacy import API never
overwrites source YAML. Imported defaults are a snapshot, not live synchronization.
Endpoints: `GET /api/stream-demo/tracking-settings` and
`POST /api/stream-demo/tracking-settings/import` (raw YAML).

### Parameter help and direct numeric editing (2026-10-15)

Every displayed tracking/optical-flow setting has a `?` help trigger describing
its purpose and higher/lower trade-offs (or on/off and categorical effects).
The text distinguishes visual-only controls from computation, selected-target
bridge conditions, normalized distance from pixels, and matching cost from IoU.
Help follows the selected English/Chinese/Japanese/Korean language and stays
available when its control is disabled. Radix Tooltip provides hover, keyboard
focus, tap/click and Escape dismissal, with portal/collision handling for narrow
cards. Opening help never toggles its associated checkbox.

Numeric settings retain a local text draft while editing. Enter or blur commits
only finite in-range values; integer settings reject fractions instead of silently
truncating them. Escape restores the last committed value. Empty/intermediate
digits are not overwritten during frame/stat updates. Invalid tracking drafts
block Start/Resume and survive parameter-group changes until corrected or Reset
defaults; invalid optical-flow drafts leave the last valid Worker configuration
running. Displayed range hints explain the accepted values. This fixes Grid
columns reverting to 12 immediately when cleared, before a replacement could
be typed. Algorithms and defaults are unchanged.

Stream config carries `tracking_settings`. Clicks send
`{type:"select_track", id, time}` with the displayed metadata frame timestamp.
The backend binds selection to that historical frame (120-frame bounded snapshot
cache), not the newest inferred frame. Requests are applied on the inference
thread, including selection while paused once inference resumes. If the clicked
frame is no longer cached, diagnostics report `selection_expired`. Seek/new stream
clears all raw/motion/reference/confirmation history. Kalman dt, TTL and identity
age use frame_index/output_fps, matching the decoded/encoded media timeline;
inference latency and pauses do not artificially age a file's target. Camera
timing uses the fixed-rate output timeline, not original sensor capture PTS.

### Independent optical-flow visualization (2026-10-15)

`Show optical flow` adds a separate default-off canvas layer to Web UI camera
and uploaded-video playback. It is independent of detector boxes, ByteTrack
confirmation and the tracking-overlay master. The dependency-free Flow Lens
pyramidal Lucas–Kanade core was adapted from the operator's local `v2i/index.html`;
the application does not load that external file at runtime.

Defaults: 12×12 grid, 640px analysis maximum edge, radius 5, texture threshold 3,
3× arrows and 30 retained trail samples. Controls offer flow/brightness-gradient
arrows; displacement, speed, direction, gradient and texture-quality coloring;
grid, points, trails, gain, history length and reset. Lost or low-texture points
are orange crosses and reseed at their grid location on the next sample.
Statistics exclude invalid points. Units use decoded stream pixels and media
time, not original 4K source pixels, wall-clock speed or real-world velocity.
Texture quality is not calibrated accuracy; brightness gradient is not motion.

A bundled module Worker processes at most one transferable grayscale frame at
a time, coalescing busy callbacks to the latest displayed frame. There is no
full-video analysis/image cache or extra server inference. Disabled/stopped/CLI
display has no flow Worker or capture loop. Pause retains the last layer;
visual-only edits repaint it without restarting inference. Sampling changes,
reset, seek or a new inference session rebuild the reference and clear trails.
First references do not claim motion. Slow stale results are suppressed; Worker
failures/timeouts affect only flow and expose reset/retry guidance.
UI statistics are throttled during playback and explicitly flushed on pause,
so a quickly paused measured frame cannot retain stale reference-only numbers.

### Detection-first overlays and model switching (2026-10-15)

Observation defaults are 15 FPS, Kalman enabled, predictive bridge enabled,
maximum prediction 800 ms, bridge TTL 800 ms and at most 12 missed frames.
The first time/frame limit reached wins. The short cyan forecast remains capped
at 200 ms. Missing-observation bridging still requires a selected, previously
confirmed target and valid motion; the new defaults do not invent trajectories
for never-confirmed detections or add all-object missing-track bridges.

Web UI playback defaults to detection boxes and confidence. Opening the Tracking
panel does not enable overlays: check **Show tracking overlays** first, then
independently toggle trails, prediction, topology, and diagnostics. These switches
are live rendering preferences, not algorithm settings. Turning overlays off
hides IDs, synthetic bridge boxes and geometry, never observed detections.
The panel reports metadata for the currently displayed frame and explicitly
explains missing confirmed IDs. At low FPS it warns when the frame interval
exceeds Kalman state lifetime; no motion or topology is fabricated for untracked
detections. Topology additionally needs neighboring confirmed tracks.

Annotation size below IoU controls 8–24 screen-pixel labels during playback,
including diagnostics, without restarting inference. Both tracking-on and
tracking-off sessions send timestamped box metadata; annotations are not baked
into Web UI video. Terminal command output remains command-controlled.

Changing model source retires any terminal display before accepting the change;
stop failures preserve the existing source. Editing a local path invalidates its
inspection token and disables Start until reinspection. Inspecting prepares a
selection; Start loads it. A successful `started` message includes the resolved
`model: {model_id, path, format}` after loading, displayed under the monitor.
This identifies the actual session model, not the current conversion assignment.
Terminal model selection is explicitly determined by the executed command.

Read-only replay of conversion-002 PT on the uploaded dashcam video at 640×360
and confidence 0.25: 1 FPS produced 28 observed boxes across four sampled frames
and zero confirmed tracks. 15 FPS produced 333 observed boxes across 46 frames,
68 confirmed-track observations, 27 valid motion/trail/forecast observations
and 110 neighbor links. Counts aggregate different sampling rates, not accuracy
scores; detector visibility remains independent of confirmation.

Deployed Web UI acceptance also loaded two local PT files in sequence: the
project's `output_model/runs/train-6/weights/best.pt` and `/app/output_model/best.pt`.
Each returned its own inspected token and exact server-confirmed loaded path.
Across the first 30 metadata frames, observed-box totals were 236 and 114,
respectively; both emitted actual motion and topology metadata. Browser tests
verified overlay gating and 8px screen-sized labels at 375/768/1440px without
writing project labels, versions, or assignments.

Optional live visualization layers: Kalman history (up to 2 seconds, sampled to
24 points), ≤200 ms bounded forecast and velocity segment, posterior center 2σ
covariance ellipse, actual radius/max-anchor topology edges, and selected-ID
diagnostics (stable/raw ID, score, margin, evidence, confirmation, dt, innovation,
age/misses/gain). These are actual algorithm values, not decorative trails. The
ellipse describes model covariance, not calibrated tracking accuracy. Full
diagnostics are bounded to the first 40 objects plus the selected target.
Bridge boxes are dashed and confidence decays per missed frame. Prediction
cannot outlive min(requested horizon, bridge TTL), miss limit, or valid motion.

Intentional differences from the flight runtime: no attitude-based camera-motion
compensation or hardware control; position extrapolation uses the frozen Kalman
velocity; `TRACKING_BRIDGE_GAIN_SCALE/END` are displayed diagnostics only and do
not change association; `REACQUIRE_BLEND_FRAMES` smooths the displayed recovered
box instead of gimbal pitch/yaw. Raw observed boxes remain available internally.
Kalman process/measurement covariance constants remain as in Osiris, not exposed
as invented YAML knobs. Native form controls are reused; no new UI dependencies.

Acceptance includes synthetic raw-ID replacement/ambiguous candidates/direct-ID
jumps/bridge expiry at 5/15/30/60 FPS and real TFLite playback with server-side
selection, trails/covariance/topology, YAML import/export, live viz toggles and
375/768/1440px layouts. These tests do not establish identity accuracy on every
dashcam shake event; use diagnostics to compare settings on the same replay.
The final focused regression set has 95 passing backend tests (two additional
Supervision tests skip on the host without that dependency; the real Docker
ByteTrack/selection smoke passes) and 266 passing frontend tests. Synthetic tests
also cover common scene translation with both target/anchor raw IDs replaced,
and continuous raw-ID churn that must never bypass consecutive confirmation.

### Generic tracking UI and project labels (2026-10-01)

The application's selected `Language` is passed to Stream Demo, the Tracking
panel, and its SVG diagnostics. `trackingText.ts` supplies English, Traditional
Chinese, Japanese and Korean copy; parameter keys remain unchanged for API
compatibility. Help explains higher/lower trade-offs (or on/off for switches).
Changing language while playing does not restart inference or discard selection.
The UI no longer mentions a reference project's environment configuration and
does not offer YAML import. Settings export is `stream-tracking.json`, a flat
JSON mapping. The old import endpoint remains available for API compatibility,
but no UI request invokes it. Diagnostic-only gain knobs are hidden; algorithm
defaults and tracking behavior remain unchanged.

Label schema options load from `GET /api/projects/{id}/class-schemas`. Auto uses
the selected conversion's linked schema if it belongs to the current project;
otherwise it chooses the sole project schema. Multiple unlinked schemas are
ambiguous: Auto keeps model-native names and the UI asks the operator to choose.
With no project schemas, model-native names also remain available. The UI previews
the exact class-ID/name mapping and sends its resolved `schema_id` at Start.
Explicit `model` selects native labels; direct API clients may send `auto`.

`stream_labels.py` resolves only current-project schemas, rejects missing/foreign
or empty choices, and applies the names to detection results before tracking and
rendering. Model class IDs must be covered by the chosen schema; mismatches fail
with an actionable error rather than silently relabeling unknown IDs. Numeric
class IDs, model outputs, boxes and association logic are never remapped. Matching
ID coverage is not proof of semantic equivalence: operators must confirm the ID
order for externally trained models. The existing CLI verification still uses
native model labels. Schema changes reset the session/selection and are disabled
while streaming. If schema loading fails, refresh or explicitly choose native
labels; Start cannot silently substitute another schema.

Acceptance: 267 frontend tests and 101 focused backend tests passed. Browser
checks on the deployed service covered all four languages, schema/native-label
selection with real TFLite playback, selected-target diagnostics, language changes
without restarting the stream, JSON export, and 375/768/1440 px layouts.

### Stream workspace layout (2026-10-01)

`StreamControls.tsx` provides native-radio segmented choices and native-checkbox
switches, preserving keyboard and disabled semantics without extra dependencies.
Model source, video/camera source and tracking groups use segmented choices;
tracking and visualization use switches. The model/schema setup is split into
compact cards. Conversion and format menus use short labels; expandable model
details retain complete lineage and model metadata.

Start/Stop sit above the video. Video output and CLI verification are collapsed
initially. Tracking settings sit below the monitor in a wider, two-column panel;
each parameter has a readable title and expandable original API key plus
higher/lower guidance. API keys, defaults, inference and tracking are unchanged.
`streamUiText.ts` localizes the surrounding playback/configuration controls;
overlay language handling was already correct and now has an explicit regression
test for switching all four languages on the same frame.

On narrow screens, source/inference controls precede the monitor in DOM and visual
order; parameter cards collapse to one column. Task Center is docked below the
page only in Stream Demo so running jobs cannot obscure the timeline or boxes.
Reduced-motion mode disables control transitions. UI acceptance covers 270
frontend tests, keyboard selection/switches, real TFLite play/pause/select/restart,
four languages, and 375/768/1024/1440 px layouts.
The same browser acceptance passed on the deployed service. Because an
augmentation job was active, deployment copied new hashed frontend assets first
and atomically replaced the static index; the existing service PID/start time did
not change. The rebuilt image contains the same frontend for future recreation.

### LiteRT input and coordinate inspection

Stream Demo and the CLI detector read the actual fixed batch-1 RGB input shape
to select NCHW/NHWC and export height/width, including on the first frame.
Invalid, dynamic, multi-input, or ambiguous shapes fail explicitly. The model
selector shows the detected layout and shape instead of trusting a saved layout.

`backend/app/litert_contract.py` separates input layout from end-to-end detection
coordinate units. New NHWC exports record `oal_box_coordinates`; existing
litert-torch exports are identified by their `args.quantize` metadata (pixel
coordinates), while legacy TensorFlow exports use normalized coordinates.
Unknown end-to-end coordinate contracts fail with re-export guidance rather
than guessing from coordinate magnitudes. The adapter reads raw interpreter
output so the upstream NHWC branch cannot multiply pixel coordinates twice.
This corrects the observed YOLO26 NHWC failure where three detections collapsed
to the bottom-right corner despite scores matching ONNX. The smoke's
`--require-detections` gate checks drawable box area as well as detection count.

## Cameras and Uploads

Host cameras use V4L2 discrete modes reported by `v4l2-ctl --list-formats-ext`:
MJPG, YUYV, UYVY, NV12, RGB3, or BGR3. Output FPS cannot exceed the selected
capture mode. `gst-inspect` checks plugins, not physical camera modes. Browser
webcams, RTSP URLs, CSI/Argus-only cameras, and arbitrary user pipelines are not
part of this initial implementation.

Expose a host USB camera without privileged mode:

```bash
OBJECT_AUTOLABEL_CAMERA_DEVICE=/dev/video0 ./run.sh --rebuild
OBJECT_AUTOLABEL_CAMERA_DEVICE=/dev/video0 ./run.sh --up
```

The optional `docker-compose.camera.yml` maps that device to `/dev/video0`
inside the container. Use the same variable for subsequent lifecycle commands.
Without it, normal installation requires no camera. A USB camera inserted after
the container was created is not automatically visible to Docker: find its host
node with `v4l2-ctl --list-devices`, then recreate with that node, for example:

```bash
OBJECT_AUTOLABEL_CAMERA_DEVICE=/dev/video1 ./run.sh --down_up
```

Inside the container the selected host node is intentionally exposed as
`/dev/video0`, so Stream Demo will list `video0`. Recreate after changing camera
mappings. Physical camera acceptance is still required on a camera host.

MP4/MOV/MKV/WebM/AVI/M4V uploads have no fixed application size cap and are probed with
ffprobe before publication. Files and metadata live under the current project's
`stream_demo/uploads/`. Original source datasets are untouched. The page can
delete an uploaded video after its session stops. UUID source ids prevent path
traversal; model ids resolve from stored conversion records. WebSockets check
Origin and the existing session authentication gate explicitly.

The file picker accepts local files, not HTTP(S) MP4 URLs. Selecting a file
uploads it; inference starts only with Start. Upload completion retains the
filename and an Uploaded status, and the monitor changes to Ready. Source/model
changes clear the previous video and statistics. Empty/unsupported files are
rejected locally; failures appear beside the source controls. Large 2K/4K uploads
have no total upload deadline; the server retains a 300-second **idle** timeout
between chunks. Cancellation removes partial files. Disk capacity still applies.

### Local model path and incomplete recordings (2026-09-29)

Model source can select conversion history or an independent absolute local path.
`POST /api/projects/{id}/stream-demo/inspect-model` accepts `{path, coordinates}`
(`auto`, `pixels`, `normalized`), loads the model and performs a CPU dry inference.
It returns a project-scoped ephemeral model ID; inspect again after restart or
file replacement. Paths refer to the container filesystem: repository `input_model`
maps to `/app/input_model`; other project models are under `/app/data/projects`.
Only load trusted PyTorch checkpoints. No arbitrary host directories are mounted.

To use an external host model directory without copying files, set
`OBJECT_AUTOLABEL_EXTERNAL_MODEL_DIR=/absolute/path/to/models` in local `.env`
and recreate with `docker compose up -d`. Compose mounts only that directory
read-only at the same absolute path, so the original host path works in the UI.
The directory must already exist (`create_host_path: false`). Without the setting,
the fallback is the existing `input_model` directory at `/app/external_models`.
This addresses host paths failing at `/home/nvidia` inside the container; adding
a text field alone cannot grant container access to an unmounted host directory.

`stream_models.py` handles native YOLO Detect PT and single-input/single-output
YOLO Detect ONNX/TFLite. Tensor dimensions determine NCHW/NHWC and fixed spatial
size, including non-square models. Quantized TFLite tensors are dequantized before
postprocessing. Metadata supplies class names; missing names use `class_N`.
Unknown TFLite coordinate units require explicit selection. Standard ONNX defaults
to pixel coordinates, with manual override for custom exports. Segmentation,
multi-output and legacy objectness heads are not generally supported. Conversion
CLI verification remains separate and is hidden in path mode.

An unfinished dashcam MKV had valid frames but no header duration: the previous
zero-second duration caused even `start_seconds=0` to fail. Probe now checks stream,
tag and container duration, falling back to packet timestamps (no frame decoding).
The affected `dashcam_20260929_121356.mkv` recovers approximately 345.6 seconds.
Old upload metadata is repaired in the returned listing without touching originals;
probes are cached by path, size and modification time. If duration remains unknown,
start at zero is allowed, but timeline seeking is disabled.

Acceptance: 48 focused backend tests and 262 frontend tests passed. Real PT,
ONNX and NHWC TFLite path-mode sessions passed seek/pause/ByteTrack smoke tests
and browser click-to-red selection. Browser checks also played the recovered MKV
and checked 375/768/1440px layouts. A real 1,293,672,039-byte 3840×2160 MKV uploaded
successfully, reporting 426.099995 seconds; it remains available in the project's
video list. Source recordings were not modified.

On 2026-09-09, a real file-chooser click, MP4 upload, selected-source update,
Start, video playback, Stop, and QA-file cleanup were checked in Chrome.
The previous successful upload left the monitor at Idle with no persistent
completion notice; the page regression test now checks Ready and the uploaded
filename. This feedback fix does not establish support for a reported external
MP4 link; the original link/file is still needed to reproduce that exact case.

## CLI Verification and NMS

The verification area now generates short shell-quoted `python -c` commands
importing `utils.run_video`, for the [Docker CLI workspace](cli-workspace.md)
below it. Model/source paths refer to the running container. Selection changes
regenerate conversion, format, source, conf, IoU, FPS and device arguments.
`show()` publishes bbox output in the WebUI rather than requiring an X11 window.
The old standalone `stream_verify.py` remains available for desktop smoke tests,
but is no longer embedded in the copied command. The CLI uses the same installed
engines; it never automatically installs packages into host Python.
Task Center uses the same floating, draggable panel as every other page.
Terminal sheets share the upper monitor with Start; starting a display utility
stops and waits for the active stream before opening its own source. Clicking
Start stops the terminal display command first. There is no separate CLI preview.

Live inference and staged CLI utilities both use pinned Ultralytics processing.
Ultralytics reads the actual model/backend metadata and output contract: raw
YOLOv8 detections undergo class-aware NMS; end-to-end YOLO26 detections undergo
confidence filtering without another NMS. An artifact with baked-in NMS is
reported separately as `Embedded NMS`. The filename is not an architecture
switch. After the first frame, the UI reports the detected mode and disables
host IoU for NMS-free/embedded-NMS output. A YOLO26 exported with end2end disabled
is therefore not incorrectly forced into NMS-free mode. See the
[official end-to-end contract](https://docs.ultralytics.com/guides/end2end-detection).

The supplied Osiris YOLO26/YOLOv8 plugins inform ByteTrack settings; their custom
normalized-coordinate decoder and modulo-ID behavior are not reused.

## API and Verification

- `GET /api/stream-demo/capabilities`
- `GET /api/projects/{id}/stream-demo/models`
- `GET|POST /api/projects/{id}/stream-demo/uploads` (POST raw file body, `filename` query)
- `DELETE /api/projects/{id}/stream-demo/uploads/{source_id}`
- `POST /api/projects/{id}/stream-demo/verify-command`: StreamConfig to a short Docker-workspace command.
- `WS /api/projects/{id}/stream-demo/live`: first JSON is StreamConfig, including
  `start_seconds` (default 0) and `tracking` (default true). Subsequent JSON is
  `{thresholds: {conf, iou}}`, `{type: "playback", paused: boolean}` for uploads,
  or `{type: "stop"}`. Server sends MP4 chunks and `started`, `stats`, `tracks`,
  `ended`, or `error` JSON. `tracks` contains session-relative `time` in seconds,
  output `width`/`height`, and `objects` with `id`, pixel xyxy `box`, `score`,
  `class_id`, and `name`.

2026-09-29 playback acceptance: 261 frontend tests and 48 focused host backend
tests passed; two host tests need Supervision, whose real tracking behavior was
verified separately in the container. `scripts/smoke-stream-playback.py --model
... --video ... --start 3` verifies real NHWC inference, pause/resume, IDs, video
bytes and clean stop. Chrome verified red target selection, pause/resume,
0 → 5 → 2 → 0 second playback, selection reset, and no horizontal overflow at
375/768/851/1024/1440 CSS pixels. Physical-camera acceptance remains separate.

Regression coverage: `tests/backend/test_stream_demo.py`,
`frontend/src/pages/StreamDemoPage.test.tsx`. Offline real-engine acceptance:

```bash
docker run --rm --runtime=nvidia --gpus all --network none \
  -v "$PWD:/src:ro" object-autolabel:latest \
  python /src/scripts/smoke-stream-demo.py \
  --model /src/data/projects/<slug>/output_model/runs/<run>/weights/best.pt \
  --model /src/data/projects/<slug>/output_model/conversions/<version>/model-onnx-fp32.onnx \
  --model /src/data/projects/<slug>/output_model/conversions/<version>/model-tflite-fp32.tflite \
  --image /src/data/input/<image>.png --require-detections
```

On 2026-09-09, `conversion-004` from `crop-retrain-0831` passed this smoke on
RTX 2080 Ti: all three engines produced detections and 12 decodable H.264 frames,
and all pipeline processes exited. Chrome also played the real WebSocket/MSE
stream with bbox overlays. Layout checks passed at 375/768/851/1024/1440 CSS px.
Browser acceptance exercised each format, live IoU changes, Stop, and restart;
video canvas checks confirmed nonblack image pixels and green bbox pixels.
The full backend/frontend suites passed 311/229 tests respectively.
No physical camera was connected on the verification host.

`scripts/smoke-stream-postprocess.py` creates renamed temporary YOLOv8n and
YOLO26n checkpoints, exports each to ONNX/TFLite, and checks all six model/engine
combinations plus overlapping-box NMS/no-NMS behavior without downloading
weights. Add `--gui` under Xvfb to execute each standalone imshow command:

```bash
docker build -t object-autolabel:gui-check -f tests/Dockerfile.stream-gui .
docker run --rm --network none -v "$PWD:/src:ro" object-autolabel:gui-check \
  python /src/scripts/smoke-stream-postprocess.py --gui
```

All six standalone commands passed real `cv2.imshow` execution under Xvfb on
2026-09-09. The smoke starts/stops its own isolated Xvfb when DISPLAY is absent;
this avoids an observed `xvfb-run` readiness-signal wait under Docker Snap.
