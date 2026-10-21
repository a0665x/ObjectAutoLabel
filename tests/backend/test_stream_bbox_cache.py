import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pytest

from backend.app.stream_bbox_cache import BboxFeatureCache, pixel_features
from backend.app import stream_demo as stream


def rows(n=2):
    return [{"id": None, "tracked": False, "detection_index": i, "box": [0, 0, 8, 8],
             "score": .9, "class_id": i % 2, "name": f"class{i % 2}"} for i in range(n)]


def image():
    return np.full((8, 8, 3), [0, 0, 255], dtype=np.uint8)


def test_all_raw_classes_are_cached_without_track_ids_and_pixels_are_lossless():
    cache = BboxFeatureCache()
    items = cache.capture(image(), rows(160), 12, 21.8)
    assert len(items) == 160  # no former browser 64/128-box truncation
    assert {item['class_id'] for item in items} == {0, 1}
    sample = cache.get(items[-1]['cache_id'], pin=True)
    assert sample['origin'] == 'yolo-pre-tracker'
    assert sample['media_time'] == 21.8
    assert sample['frame_index'] == 12
    assert list(base64.b64decode(sample['rgba_base64'])[:4]) == [255, 0, 0, 255]
    assert sample['features']['colors'][0] == 1
    assert sample['features']['vector'][8] == 1
    assert sum(sample['features']['spatialColors']) == pytest.approx(4)


def test_feature_neutrals_and_laplacian_original_rgb_statistics():
    rgb = np.zeros((5, 5, 3), dtype=np.uint8)
    rgb[2, 2] = [255, 255, 255]
    f = pixel_features(rgb)
    assert f['pixels'] == 25
    assert f['colors'][12] == 24 / 25
    assert f['colors'][14] == 1 / 25
    assert f['edgePixels'] == 5
    assert f['edgeColors'][12] == 4 / 5
    assert f['edgeColors'][14] == 1 / 5
    assert f['laplacianVariance'] > 0
    assert sum(f['vector']) == pytest.approx(1)


def test_frame_ring_evicts_but_pinned_record_is_immutable_and_independent():
    cache = BboxFeatureCache(max_frames=1)
    first = cache.capture(image(), rows(), 0, 0)
    locked = cache.get(first[0]['cache_id'], pin=True)
    locked['features']['meanRGB'][0] = -1
    later = image()
    later[:] = [255, 0, 0]
    cache.capture(later, rows(), 1, 1)
    assert cache.get(first[1]['cache_id']) is None
    assert cache.get(first[0]['cache_id'])['features']['meanRGB'] == [255, 0, 0]
    assert cache.status()['frames'] == 1
    cache.release()
    assert cache.get(first[0]['cache_id']) is None


def test_byte_budget_and_entry_limit_are_enforced_without_unbounded_frame_buffers():
    cache = BboxFeatureCache(max_bytes=10000, max_frames=3, max_entries=2)
    for i in range(30):
        cache.capture(image(), rows(5), i, i)
        state = cache.status()
        assert state['bytes'] <= 10000
        assert state['entries'] <= 2
        assert state['frames'] <= 3
    cache.clear()
    assert cache.status()['bytes'] == cache.status()['pinned_bytes'] == 0


def test_crops_are_clipped_and_tiny_or_invalid_regions_are_excluded():
    cache = BboxFeatureCache()
    detections = rows(4)
    for item, box in zip(detections, [[-3, -2, 8, 8], [0, 0, 1, 1], [8, 8, 30, 30], [0, 0, float('nan'), 8]]):
        item['box'] = box
    samples = cache.capture(image(), detections, 0, 0)
    assert len(samples) == 1
    assert samples[0]['crop_box'] == [0, 0, 8, 8]
    large = cache.capture(np.zeros((720, 1280, 3), np.uint8), [{**rows(1)[0], 'box': [0, 0, 1280, 720]}], 1, 1)
    assert large[0]['width'] == 80
    assert large[0]['height'] == 45


def test_session_keys_do_not_resolve_across_models_or_sessions():
    a, b = BboxFeatureCache(), BboxFeatureCache()
    old = a.capture(image(), rows(1), 0, 0)[0]
    assert b.get(old['cache_id'], pin=True) is None
    a.clear()
    assert a.get(old['cache_id']) is None
    a.close()
    assert a.capture(image(), rows(), 1, 1) == []


def test_paused_cache_control_keeps_thresholds_and_handles_expiry_without_failing_stream():
    config = stream.StreamConfig(model_id='m', source='upload', source_id='v', conf=.4, iou=.6)
    session = stream.StreamSession(config, '/m.pt', Path('/v.mp4'))
    session.playing.clear()
    record = session.bbox_cache.capture(image(), rows(1), 0, 0)[0]
    reply = session.bbox_control({'type': 'bbox_sample', 'cache_id': record['cache_id'], 'request_id': 7, 'pin': True})
    assert reply['sample']['cache_id'] == record['cache_id']
    assert reply['request_id'] == 7
    assert not session.playing.is_set()
    assert session.bbox_control({'type': 'bbox_sample', 'cache_id': 'expired', 'request_id': 8})['error'] == 'expired'
    assert (config.conf, config.iou) == (.4, .6)
    session.bbox_control({'type': 'bbox_release'})
    assert session.bbox_cache.status()['pinned_bytes'] == 0


def test_concurrent_inference_capture_and_paused_selection_are_safe():
    cache = BboxFeatureCache(max_frames=2)
    first = cache.capture(image(), rows(1), 0, 0)[0]
    cache.get(first['cache_id'], pin=True)
    def write():
        for i in range(1, 20):
            cache.capture(image(), rows(), i, i)
    def read():
        for _ in range(50):
            assert cache.get(first['cache_id'])['features']['meanRGB'] == [255, 0, 0]
    with ThreadPoolExecutor(2) as executor:
        list(executor.map(lambda fn: fn(), [read, write]))


def test_yolo_evidence_is_captured_before_tracker_modifies_boxes_or_image(monkeypatch):
    import torch
    from ultralytics.engine.results import Results
    from backend.app.stream_tracking import StreamTracker
    from backend.app.stream_identity import IdentityTracker
    config = stream.StreamConfig(model_id='m', source='upload', source_id='v', tracking=True)
    session = stream.StreamSession(config, '/m.pt', Path('/v.mp4'))
    frame = np.zeros((60, 80, 3), np.uint8)
    frame[10:50, 10:50] = [0, 0, 255]
    result = Results(frame, path='fixture.png', names={0: 'person'},
                     boxes=torch.tensor([[10, 10, 50, 50, .9, 0]], dtype=torch.float32))
    monkeypatch.setattr(stream, 'predict_frame', lambda *_a, **_k: (result, 'NMS'))
    def mutate(tracker, result, _conf):
        assert session.raw_detections  # capture already happened
        result.boxes.data[:, :4] += 5
        frame[:] = [255, 0, 0]
        tracker.detections = []
        return []
    monkeypatch.setattr(StreamTracker, 'update', mutate)
    monkeypatch.setattr(IdentityTracker, 'update', lambda *_: [])
    session.predict(None, frame)
    record = session.raw_detections[0]
    assert record['box'] == [10, 10, 50, 50]
    assert session.bbox_cache.get(record['cache_id'])['features']['meanRGB'] == [255, 0, 0]
