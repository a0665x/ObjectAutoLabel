from types import SimpleNamespace

import numpy as np
import pytest

from backend.app.stream_tracking import StreamTracker


class Array:
    def __init__(self, value):
        self.value = np.asarray(value, dtype=np.float32)

    def cpu(self):
        return self

    def numpy(self):
        return self.value


def result(boxes, scores=None, classes=None):
    return SimpleNamespace(boxes=SimpleNamespace(
        xyxy=Array(np.asarray(boxes).reshape(-1, 4)),
        conf=Array(scores if scores is not None else [.9] * len(boxes)),
        cls=Array(classes if classes is not None else [0] * len(boxes)),
    ), names={0: 'person', 1: 'car'})


def test_bytetrack_retains_id_after_movement_low_confidence_and_short_occlusion():
    pytest.importorskip('supervision')
    tracker = StreamTracker(15)
    detection = result([[10, 10, 40, 60]])
    for _ in range(3):
        objects = tracker.update(detection, .1)
    identity = objects[0]['id']
    objects = tracker.update(result([[12, 10, 42, 60]], [.15]), .1)
    assert objects[0]['id'] == identity
    assert tracker.update(result([]), .1) == []
    objects = tracker.update(result([[14, 10, 44, 60]]), .1)
    assert objects[0]['id'] == identity


def test_class_isolation_and_new_session_reset():
    pytest.importorskip('supervision')
    tracker = StreamTracker(15)
    detections = result([[10, 10, 40, 60], [10, 10, 40, 60]], classes=[0, 1])
    for _ in range(3):
        objects = tracker.update(detections, .25)
    assert len({obj['id'] for obj in objects}) == 2
    assert {obj['class_id'] for obj in objects} == {0, 1}
    assert StreamTracker(15).trackers == {}
    for _ in range(60):
        assert tracker.update(result([]), .25) == []
    for _ in range(3):
        new_objects = tracker.update(detections, .25)
    assert {obj['id'] for obj in new_objects}.isdisjoint({obj['id'] for obj in objects})
