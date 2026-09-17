# Docker CLI Workspace

Stream Demo includes lazy-loaded xterm.js terminal sheets below the short
verification command, without Files, an editor, or a separate preview panel.
Host `cli_workspace/` is mounted at
`/app/cli_workspace` by both Compose files. See [operator and utility usage](../../cli_workspace/README.md).

## Security Boundary

Arbitrary code execution, NOT a sandbox. `OBJECT_AUTOLABEL_CLI_ENABLED` defaults
true for this trusted local deployment. The terminal no longer asks for a CLI
access token. Same-origin/allowlisted-Origin and existing OAuth session checks
still apply before PTY creation.

To disable the terminal, recreate the service with:

```bash
OBJECT_AUTOLABEL_CLI_ENABLED=false ./run.sh --up
```

Use `--rebuild` instead of `--up` after image/source changes.

## Sources and API

- `backend/app/cli_workspace.py`: `/api/cli/capabilities`, `GET
  /preview?session=<id>`, `WS /terminal`. Legacy file APIs remain available
  behind their path protections; the frontend no longer calls them.
- Existing-file writes require the last SHA256 `etag`. Hidden paths, traversal
  and symlinks are rejected. Limits: 256 KiB UTF-8, 1000 listed files, 64 KiB
  terminal input, six PTYs, one-hour sessions.
- PTYs run Bash in the workspace with the service environment and workspace
  `PYTHONPATH`. Disconnect cleanup is cancellation-shielded and reaps session
  processes; intentionally detached sessions are outside that guarantee.
- `frontend/src/pages/CliWorkspace.tsx`: add/close/select terminal sheets,
  persistent PTYs on tab switches, resizing/paste and shared-display handoff.
- `cli_workspace/utils/detector.py`: load engine, preprocess, predict,
  generation-aware `_postprocess_`, preview publishing and video loop.
- `backend/app/stream_routes.py`: validates artifact/source selection and builds
  shell-quoted `python -c` importing `utils.run_video` with Docker paths.
- `requirements-cli.txt`: PTY dependency; engines stay in existing image deps.

## Validation

`tests/backend/test_cli_workspace.py` covers enable/path gates, legacy file paths,
byte limits, CRUD/conflicts, hostile Origin, real PTY resize/input/Ctrl+C,
display grants, interrupt acknowledgment and disconnect reaping.
`CliWorkspace.test.tsx` covers persistent tabs and display handoff ordering.
`scripts/smoke-stream-postprocess.py` compares staged results with the existing
predictor for renamed YOLOv8n/YOLO26n PT, ONNX and TFLite artifacts, plus explicit
overlapping-box NMS versus NMS-free behavior.

The single upper monitor renders either terminal JPEG frames or the Start
GStreamer/H.264 video. Task Center is floating/draggable just as on other pages.

## Single Monitor Handoff

Each PTY has a random session-specific `.preview/<session>` directory. Utilities
request a ticket before loading/opening a source and wait for an explicit grant.
The terminal WebSocket forwards `display_request`; the frontend stops the prior
producer, waits for server cleanup/`interrupted`, then sends `display_grant`.
Frames are polled only for the owner session, preventing stale frames from another
sheet. Start waits for terminal interruption before opening its GStreamer source.
The utility checks a cooperative stop file between reads; other foreground
programs receive SIGINT, with bounded SIGKILL fallback for unresponsive commands.
Closing a sheet cleans up its entire PTY session. Ordinary shell commands do not
claim the display. Detached/background commands and cross-browser scheduling are
outside this trusted-local, page-scoped coordination contract.

Initial 2026-09-09 Chrome acceptance on x86 verified create/edit/save/rename/delete,
host bind-mount readability, clipboard paste into the real PTY, staged YOLOv8
TFLite inference with bbox preview, and the generated short command running a
YOLO26 TFLite MP4 through EOF as NMS-free. Ctrl+C, terminal close, and 375/1440px
layouts passed without browser errors. Full backend/frontend suites passed
330/238 tests. Jetson receives the same mount/CLI implementation but has not
been hardware-retested for this change.

The terminal-only revision was verified on the same x86 host with a real USB
webcam: Start -> Terminal 1 -> Terminal 2 -> Start all released the previous
camera producer before the next capture. Shell variables/output survived sheet
switches; closing/recreating sheets worked. Ordinary shell commands did not
seize the monitor. Desktop/mobile (1440/375px) screenshots and image-pixel checks
passed; Task Center drag changed its position. Cooperative video interruption
completed without a traceback. Frontend regressions cover both directions of
the display handshake, and backend tests cover session-isolated frame access.

Shutdown also sets an explicit closing flag before cancelling reader/writer
tasks. A send completing concurrently with cancellation must not loop back to
an idle PTY read, or disconnect cleanup can wait indefinitely. A deterministic
transport-completion regression covers this case; do not rely on task
cancellation alone to terminate these loops.
