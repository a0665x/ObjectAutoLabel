"""Per-session, class-isolated ByteTrack for decoded detector results."""
from __future__ import annotations

import numpy as np


def detector_arrays(result):
    boxes = result.boxes
    xyxy = boxes.xyxy.cpu().numpy() if boxes is not None else np.empty((0, 4), np.float32)
    scores = boxes.conf.cpu().numpy() if boxes is not None else np.empty(0, np.float32)
    classes = boxes.cls.cpu().numpy().astype(np.int32) if boxes is not None else np.empty(0, np.int32)
    valid = np.isfinite(xyxy).all(axis=1) & np.isfinite(scores) & (xyxy[:, 2] > xyxy[:, 0]) & (xyxy[:, 3] > xyxy[:, 1])
    return xyxy[valid], scores[valid], classes[valid], np.flatnonzero(valid)


def display_detections(result, minimum_confidence, arrays=None):
    xyxy, scores, classes, indices = arrays if arrays is not None else detector_arrays(result)
    return [{'id': None, 'tracked': False, 'detection_index': int(index),
             'box': box.tolist(), 'score': float(score), 'class_id': int(class_id),
             'name': result.names[int(class_id)]}
            for index, box, score, class_id in zip(indices, xyxy, scores, classes)
            if score >= minimum_confidence]


class StreamTracker:
    def __init__(self, fps: int, settings=None):
        import supervision as sv
        self.sv = sv
        self.fps = fps
        self.trackers = {}
        self.detections = []
        from .tracking_settings import TrackingSettings
        self.settings = settings or TrackingSettings()

    def update(self, result, minimum_confidence: float):
        xyxy, scores, classes, indices = detector_arrays(result)
        # Keep every display-eligible detection, independently of ID confirmation.
        self.detections = display_detections(result, minimum_confidence, (xyxy, scores, classes, indices))
        for class_id in np.unique(classes):
            if int(class_id) not in self.trackers:
                self.trackers[int(class_id)] = self.sv.ByteTrack(
                    track_activation_threshold=.20, lost_track_buffer=90,
                    minimum_matching_threshold=self.settings.AI_TRACK_MINIMUM_MATCHING_THRESHOLD, frame_rate=self.fps,
                    minimum_consecutive_frames=2,
                )
        objects = []
        for class_id, tracker in self.trackers.items():
            mask = classes == class_id
            tracked = tracker.update_with_detections(self.sv.Detections(
                xyxy=xyxy[mask], confidence=scores[mask], class_id=classes[mask],
                data={'detection_index': indices[mask]},
            ))
            for box, score, track_id, index in zip(tracked.xyxy, tracked.confidence, tracked.tracker_id,
                                                 tracked.data.get('detection_index', [])):
                if score < minimum_confidence:
                    continue
                objects.append({'id': f'{class_id}:{int(track_id)}', 'box': box.tolist(),
                                'tracked': True, 'detection_index': int(index),
                                'score': float(score), 'class_id': class_id, 'name': result.names[class_id]})
        return objects
