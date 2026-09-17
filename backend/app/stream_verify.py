"""Standalone OpenCV verification, also used by the live stream predictor."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys


def postprocess_mode(backend):
    metadata = getattr(backend, "metadata", {}) or {}
    args = metadata.get("args", {})
    if isinstance(args, dict) and args.get("nms"):
        return "Embedded NMS"
    return "NMS-free" if getattr(backend, "end2end", False) else "NMS"


def predict_frame(model, frame, *, conf, iou, imgsz, device):
    backend = getattr(getattr(model, "predictor", None), "model", None)
    if backend is not None and getattr(backend, "format", "pt") != "pt" and not getattr(backend, "dynamic", False):
        imgsz = getattr(backend, "imgsz", imgsz)
    # Ultralytics decodes each format and chooses NMS versus end-to-end from the
    # loaded model/metadata and output contract, not the checkpoint filename.
    result = model.predict(frame, conf=conf, iou=iou, imgsz=imgsz, device=device,
                           verbose=False, max_det=100)[0]
    return result, postprocess_mode(model.predictor.model)


def main(config):
    os.environ["YOLO_AUTOINSTALL"] = "False"
    import cv2
    from ultralytics import YOLO
    import ultralytics.utils
    import ultralytics.utils.checks
    ultralytics.utils.AUTOINSTALL = False
    ultralytics.utils.checks.AUTOINSTALL = False

    model_path = Path(config["model"])
    if not model_path.is_file():
        raise SystemExit(f"Model not found: {model_path}. Run from the ObjectAutoLabel repository root or edit the model path.")
    if re.search(r"GUI:\s+NONE", cv2.getBuildInformation()) or not hasattr(cv2, "imshow"):
        raise SystemExit("cv2.imshow requires desktop opencv-python, not opencv-python-headless.")
    if sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        raise SystemExit("cv2.imshow requires a desktop display. Run in a desktop terminal, not the headless web container.")
    model = YOLO(str(model_path), task="detect")
    source = config["source"]
    if not config["camera"] and not Path(source).is_file():
        raise SystemExit(f"Video not found: {source}")
    cap = cv2.VideoCapture(source, cv2.CAP_V4L2 if config["camera"] else cv2.CAP_ANY)
    try:
        if config["camera"]:
            mode = config.get("camera_mode", "").split(":")
            if len(mode) == 4:
                cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*mode[0]))
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, int(mode[1]))
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, int(mode[2]))
                cap.set(cv2.CAP_PROP_FPS, float(mode[3]))
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video source: {source}")
        print("Press Q or Esc to stop. Postprocessing is detected from the loaded model.")
        previous_mode = None
        frames = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            result, mode = predict_frame(model, frame, conf=config["conf"], iou=config["iou"],
                                         imgsz=config["imgsz"], device=config["device"])
            if mode != previous_mode:
                print(f"Postprocess: {mode}; IoU {'active' if mode == 'NMS' else 'not applied by the host'}")
                previous_mode = mode
            cv2.imshow("ObjectAutoLabel - " + mode, result.plot())
            frames += 1
            if cv2.waitKey(max(1, round(1000 / config["fps"]))) & 0xFF in (27, ord("q")):
                break
            if cv2.getWindowProperty("ObjectAutoLabel - " + mode, cv2.WND_PROP_VISIBLE) < 1:
                break
        if not frames:
            raise RuntimeError("The source produced no decoded frames")
    finally:
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main(json.loads(sys.argv[1]))
