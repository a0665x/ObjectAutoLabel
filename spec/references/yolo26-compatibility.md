# YOLO26 detection compatibility

Verified against the pinned and installed **Ultralytics 8.4.130** desktop runtime.
Do not infer behavior from newer unversioned documentation or checkpoint names.

## Training

`input_model/yolo26n.pt` is accepted by the existing Train selector. Its Detect
head has `reg_max=1` and `end2end=True`. Native named losses are `box_loss`,
`cls_loss`, and **`l1_loss`**, not DFL. Preserve mapping keys rather than assigning
loss names by dictionary position. Sequence callbacks use reported loss names
with a loaded-head fallback. Save the loaded head, regression range, end-to-end
flag, loss names, and Ultralytics version in training settings `model_contract`.

The chart displays finite series actually reported. Historical callbacks
misnamed the third loss DFL; only explicit `val/l1_loss` evidence without
`val/dfl_loss` permits display-time repair. Histories without evidence remain
unchanged; a filename alone cannot prove which loss generated an old value.

Small-target assignment (STAL) and progressive one-to-many/one-to-one weighting
are already provided by the installed loss/assigner implementation. They need
no application inference switch. Keep the user's optimizer selection; choosing
YOLO26 does not silently change SGD into MuSGD. DFL-free does not mean disabling
the third regression term or setting its shared `dfl` gain to zero.

Versioned upstream implementations:

- [Losses and E2ELoss](https://github.com/ultralytics/ultralytics/blob/v8.4.130/ultralytics/utils/loss.py)
- [Task-aligned small-target assignment](https://github.com/ultralytics/ultralytics/blob/v8.4.130/ultralytics/utils/tal.py)

## Validate, Convert, Stream, CLI

Validation uses the official predictor and reports the loaded backend's
postprocessing mode. Stream and CLI distinguish ordinary NMS, NMS-free, and
embedded NMS using backend metadata. They never select behavior from a model
filename or force end-to-end behavior on legacy YOLO models. NMS-free still
filters by confidence and limits detections; the NMS IoU control is inapplicable.
Stream and CLI request `max_det=300`, matching standard inference rather than
the previous hidden cap of 100. Exported graph limits still apply.

Conversion preserves the official exporter contract. Existing supported output
formats remain ONNX FP32 and LiteRT FP32. No separate application NMS should be
added to native end-to-end outputs. CLI LiteRT requires its requested image size
to match the exported shape; Web Stream discovers the fixed backend dimensions.

## Acceptance

- `scripts/smoke-yolo26-training.py input_model/yolo26n.pt`: real checkpoint,
  renamed input, isolated temporary project, one CPU epoch at 64 px, persisted
  L1 metrics/model contract and checkpoint. Synthetic data verifies integration,
  not accuracy or small-object quality.
- `scripts/smoke-stream-postprocess.py`: renamed YOLOv8n and YOLO26n checkpoints,
  PT/ONNX/LiteRT inference, duplicate-box postprocessing semantics and staged CLI
  parity. Uses random-initialized architectures, not accuracy measurements.
- Regression tests cover shuffled named losses, sequence loss names, legacy
  chart repair, L1 vs DFL chart selection, and the inference detection limit.

Re-run these checks when changing Ultralytics: end-to-end defaults and output
contracts can differ between releases. Desktop acceptance does not establish
Jetson export support or dataset-specific accuracy improvements.
