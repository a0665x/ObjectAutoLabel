# CLI Workspace

This directory is bind-mounted at `/app/cli_workspace` in both Docker runtimes.
Stream Demo provides terminal sheets, without a Files/editor panel. Each starts here
with the application's Python environment, inference engines, GPU and mounts.

## Enable

Set `OBJECT_AUTOLABEL_CLI_ENABLED=true` in the project `.env`, then recreate the
container. Retain your camera selection, for example:

```bash
OBJECT_AUTOLABEL_CAMERA_DEVICE=/dev/video0 ./run.sh --up
```

Read `cli_workspace/.cli-token` locally and enter it in the WebUI CLI access
token field. It is generated on the first capabilities request, mode 0600, and
excluded from Git and Docker build context. Do not share it. The terminal is a
real shell, NOT a sandbox: it has the service user's permissions and mounted
data access. Use HTTPS remotely and restrict access to trusted operators.
Up to six terminals may remain connected; disconnect terminates their session
processes. Deliberately detached/new-session processes are outside that cleanup
guarantee. `Ctrl+C` interrupts a running command.

Use `+` to add a terminal and the sheet's `x` to close it. Switching sheets keeps
shell variables, output and running commands intact. Files can be changed with
shell commands or your host editor; the Python utilities remain bind-mounted.

## Quick Video Check

Select a conversion and model format in Stream Demo, copy its generated command,
open the CLI terminal, and paste. All model stages are imported from utilities:

```bash
python -c "from utils import run_video; run_video('/app/path/model.tflite', source='/app/path/clip.mp4', conf=.25, iou=.7)"
```

Use `source=0` or `source='/dev/video0'` for a mapped webcam. `run_video` uses
OpenCV capture and publishes latest-frame JPEG to the upper shared monitor. It is not an
encoded GStreamer stream and has no bitrate control; the main Stream Demo
player continues to use GStreamer/H.264.

`load_detector()`/`show()` request the monitor before inference/source capture.
The WebUI first stops any active Start stream or other terminal's display command,
waits for its resource release, then grants the requesting terminal the monitor.
Clicking Start or Stop stops the terminal's display command but keeps its shell
open. Ordinary commands such as `ls` do not take over the monitor. Keep Stream
Demo open while using these display utilities; an unanswered request times out.
There is no separate Inference preview panel. Display arbitration is within the
current Stream Demo page; it is not a cross-browser multi-user camera scheduler.

## Explicit Stages

```python
import cv2
from utils import load_detector, show

detector = load_detector('/app/path/model.tflite', conf=.25, iou=.7)
frame = detector.preprocess(cv2.imread('/app/path/image.jpg'))
prediction = detector.predict(frame)
result = detector.postprocess(prediction)
show(result)
```

Arrange these statements with semicolons for `python -c`, or edit/run
`examples/detect_image.py`. `result` is an Ultralytics Results object with boxes
in original-image pixel coordinates. `show()` publishes bbox overlays to WebUI
without requiring X11 or `cv2.imshow`.

`utils/detector.py` defines an abstract plugin and `_postprocess_` variants for
raw outputs (class-aware NMS), YOLO26 end-to-end outputs (confidence filtering,
no second NMS), and embedded-NMS exports. Selection uses loaded model metadata,
not filenames. Tensor layout, TFLite quantization handling, letterboxing,
decoding and coordinate restoration use the pinned Ultralytics implementation.
External models with missing/incorrect metadata are not guaranteed; prefer
artifacts created by this project's conversion workflow. Each detector is
stateful and intended for one loop, not concurrent calls. PT supports CPU/CUDA;
generated commands select CPU for ONNX/TFLite's installed providers.

Shell-created files follow normal Unix ownership. The former text-file HTTP APIs
remain token-protected for compatibility, but are no longer used by the WebUI.
