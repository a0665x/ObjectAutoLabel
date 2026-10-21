"""Session-local YOLO evidence, captured before any tracker changes the boxes.

The ring stores immutable serialized crops/features, not decoded video frames.
One explicitly pinned sample survives eviction. No image is written to disk.
"""
from __future__ import annotations

import base64
from collections import OrderedDict, deque
import json
import math
import threading
from uuid import uuid4

import cv2
import numpy as np


def pixel_features(rgb: np.ndarray) -> dict:
    """bbox-appearance-v1; keep bins/Laplacian consistent with pixelAppearance.ts."""
    h, w = rgb.shape[:2]
    values = rgb.astype(np.float64)
    r, g, b = values.transpose(2, 0, 1)
    high, low = values.max(axis=2), values.min(axis=2)
    delta = high - low
    saturation = np.divide(delta, high, out=np.zeros_like(high), where=high != 0)
    value = high / 255
    hue = np.zeros_like(high)
    red = (delta != 0) & (high == r)
    green = (delta != 0) & (high != r) & (high == g)
    blue = (delta != 0) & (high != r) & (high != g)
    hue[red] = ((g[red] - b[red]) / delta[red] + 6) % 6
    hue[green] = (b[green] - r[green]) / delta[green] + 2
    hue[blue] = (r[blue] - g[blue]) / delta[blue] + 4
    hue = np.minimum(11, np.floor(hue * 2)).astype(np.int32)
    neutral = (value < .15) | (saturation < .15)
    colors = np.where(neutral, np.where(value < .15, 12, np.where(value > .8, 14, 13)), hue)
    bins = np.where(neutral, 108 + np.minimum(7, np.floor(value * 8)).astype(int),
                    hue * 9 + np.minimum(2, np.floor(saturation * 3)).astype(int) * 3
                    + np.minimum(2, np.floor(value * 3)).astype(int))
    # JS stores luminance in Float32Array, then performs the Laplacian in double.
    gray = (.299 * r + .587 * g + .114 * b).astype(np.float32).astype(np.float64)
    lap = gray[1:-1, :-2] + gray[1:-1, 2:] + gray[:-2, 1:-1] + gray[2:, 1:-1] - 4 * gray[1:-1, 1:-1]
    mask = np.abs(lap) >= 20
    edge_count = int(mask.sum())

    def hist(v, count, n):
        return (np.bincount(v.ravel(), minlength=n) / max(1, count)).tolist()

    spatial = []
    for yy in (np.arange(h) < h / 2, np.arange(h) >= h / 2):
        for xx in (np.arange(w) < w / 2, np.arange(w) >= w / 2):
            cell = colors[np.ix_(yy, xx)]
            spatial.extend(hist(cell, cell.size, 15))
    return {"pixels": w * h, "colors": hist(colors, w * h, 15), "vector": hist(bins, w * h, 116),
            "spatialColors": spatial, "meanRGB": values.mean(axis=(0, 1)).tolist(),
            "edgePixels": edge_count, "edgeColors": hist(colors[1:-1, 1:-1][mask], edge_count, 15),
            "edgeVector": hist(bins[1:-1, 1:-1][mask], edge_count, 116),
            "laplacianVariance": float(lap.var())}


class BboxFeatureCache:
    def __init__(self, max_bytes=32 * 1024 * 1024, max_frames=180, max_entries=8192):
        self.session_id = uuid4().hex
        self.max_bytes, self.max_frames, self.max_entries = max_bytes, max_frames, max_entries
        self._entries: OrderedDict[str, bytes] = OrderedDict()
        self._frames = deque()
        self._pinned: tuple[str, bytes] | None = None
        self._bytes = 0
        self._lock = threading.RLock()
        self._closed = False

    def capture(self, image, detections, frame_index, media_time):
        with self._lock:
            if self._closed:
                return []
        height, width = image.shape[:2]
        records, keys = [], []
        for item in detections:
            box = item["box"]
            if len(box) != 4 or not all(math.isfinite(x) for x in box):
                continue
            x1, y1 = max(0, math.floor(box[0])), max(0, math.floor(box[1]))
            x2, y2 = min(width, math.ceil(box[2])), min(height, math.ceil(box[3]))
            if x2 - x1 < 3 or y2 - y1 < 3:
                continue
            scale = min(1, 80 / max(x2 - x1, y2 - y1))
            cw, ch = math.floor((x2 - x1) * scale), math.floor((y2 - y1) * scale)
            if cw < 3 or ch < 3:
                continue
            rgb = cv2.resize(image[y1:y2, x1:x2, ::-1], (cw, ch), interpolation=cv2.INTER_AREA)
            rgba = np.full((ch, cw, 4), 255, dtype=np.uint8)
            rgba[:, :, :3] = rgb
            key = f"{self.session_id}:{frame_index}:{item['detection_index']}"
            record = {**item, "cache_id": key, "frame_index": frame_index, "media_time": media_time,
                      "image_width": width, "image_height": height, "width": cw, "height": ch,
                      "crop_box": [x1, y1, x2, y2], "features": pixel_features(rgb), "origin": "yolo-pre-tracker"}
            payload = json.dumps({**record, "rgba_base64": base64.b64encode(rgba.tobytes()).decode("ascii")},
                                 separators=(",", ":"), allow_nan=False).encode()
            records.append(record)
            keys.append((key, payload))
        with self._lock:
            if self._closed:
                return []
            self._frames.append([key for key, _ in keys])
            for key, payload in keys:
                old = self._entries.pop(key, None)
                self._bytes += len(payload) - (len(old) if old else 0)
                self._entries[key] = payload
            while len(self._frames) > self.max_frames:
                for key in self._frames.popleft():
                    old = self._entries.pop(key, None)
                    self._bytes -= len(old) if old else 0
            while self._entries and (self._bytes > self.max_bytes or len(self._entries) > self.max_entries):
                _, old = self._entries.popitem(last=False)
                self._bytes -= len(old)
        return records

    def get(self, cache_id, pin=False):
        with self._lock:
            payload = self._entries.get(cache_id)
            if payload is None and self._pinned and self._pinned[0] == cache_id:
                payload = self._pinned[1]
            if payload is None:
                return None
            if pin:
                self._pinned = (cache_id, payload)
        return json.loads(payload)

    def release(self):
        with self._lock:
            self._pinned = None

    def clear(self):
        with self._lock:
            self._entries.clear()
            self._frames.clear()
            self._pinned = None
            self._bytes = 0

    def close(self):
        with self._lock:
            self._closed = True
            self.clear()

    def status(self):
        with self._lock:
            return {"bytes": self._bytes, "max_bytes": self.max_bytes, "entries": len(self._entries),
                    "frames": len(self._frames), "pinned_bytes": len(self._pinned[1]) if self._pinned else 0}
