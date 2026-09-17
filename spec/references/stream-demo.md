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

`stream_demo.py` owns a bounded session: GStreamer decodes/captures BGR frames,
Ultralytics infers with the selected engine, OpenCV draws boxes, and GStreamer
encodes H.264 into fragmented MP4. The browser uses MediaSource via a same-origin
WebSocket. The output is video-only; audio is not forwarded. X264 bitrate is a
target in kbps, not a guaranteed exact network rate. See
[x264enc](https://gstreamer.freedesktop.org/documentation/x264/index.html) and
[mp4mux](https://gstreamer.freedesktop.org/documentation/isomp4/mp4mux.html).

Conf/IoU changes apply to subsequent frames without restarting. Resolution,
FPS, bitrate, model, and inference device are fixed for a session and become
editable after Stop/completion. Actual inference FPS and latency are reported.
FPS is the output target; inference can be slower on larger models or CPU.
PT image size is selectable; exported models retain their export metadata dimensions.
Only one demo session runs at a time. Stop, page exit, WebSocket disconnect,
timeout, or pipeline failure terminates both GStreamer processes. Queues and
browser buffers are bounded. A file ends at EOF and may be started again.

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

MP4/MOV/MKV/WebM/AVI/M4V uploads are capped at 1 GiB per file and probed with
ffprobe before publication. Files and metadata live under the current project's
`stream_demo/uploads/`. Original source datasets are untouched. The page can
delete an uploaded video after its session stops. UUID source ids prevent path
traversal; model ids resolve from stored conversion records. WebSockets check
Origin and the existing session authentication gate explicitly.

The file picker accepts local files, not HTTP(S) MP4 URLs. Selecting a file
uploads it; inference starts only with Start. Upload completion retains the
filename and an Uploaded status, and the monitor changes to Ready. Source/model
changes clear the previous video and statistics. Empty/unsupported/oversized
files are rejected locally, failures appear beside the source controls, and
the browser upload request times out after 330 seconds instead of waiting
indefinitely (server receive timeout: 300 seconds).

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

The supplied `YoloV8nTrackingPlugin.py` was inspected as a reference; its custom
normalized-coordinate decode and tracking policy are not reused across model
formats. The demo does not claim tracking IDs or ByteTrack support.

## API and Verification

- `GET /api/stream-demo/capabilities`
- `GET /api/projects/{id}/stream-demo/models`
- `GET|POST /api/projects/{id}/stream-demo/uploads` (POST raw file body, `filename` query)
- `DELETE /api/projects/{id}/stream-demo/uploads/{source_id}`
- `POST /api/projects/{id}/stream-demo/verify-command`: StreamConfig to a short Docker-workspace command.
- `WS /api/projects/{id}/stream-demo/live`: first JSON is StreamConfig; subsequent
  JSON is `{thresholds: {conf, iou}}` or `{type: "stop"}`. Server sends binary MP4
  chunks and JSON `started`, `stats`, `ended`, or `error` events.

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
