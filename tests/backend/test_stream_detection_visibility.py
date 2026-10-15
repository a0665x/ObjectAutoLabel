"""Detection visibility must not depend on ByteTrack confirmation or sampling FPS."""
from pathlib import Path

import numpy as np
import pytest

from backend.app import stream_demo as stream


def detection(frame, x=10, score=.9):
    import torch
    from ultralytics.engine.results import Results

    return Results(frame, path="fixture.png", names={0: "car"},
                   boxes=torch.tensor([[x, 10, x + 40, 50, score, 0]], dtype=torch.float32))


@pytest.mark.parametrize("fps", [1, 2, 5, 15, 30])
def test_sampled_detections_remain_visible_even_without_a_confirmed_track(monkeypatch, fps):
    pytest.importorskip("supervision")
    config = stream.StreamConfig(model_id="fixture", source="upload", source_id="fixture",
                                 fps=fps, tracking=True, conf=.25)
    session = stream.StreamSession(config, "/fixture.pt", Path("/fixture.mp4"))
    frame = np.zeros((360, 640, 3), np.uint8)
    for index in range(4):
        # The same motion advances much farther between low-FPS samples.
        x = 10 + 60 * index / fps
        result = detection(frame, x)
        monkeypatch.setattr(stream, "predict_frame", lambda *_args, **_kwargs: (result, "NMS"))
        session.stats["frames"] = index
        session.predict(None, frame.copy())
        visible = [item for item in session.objects if not item.get("predicted")]
        assert len(visible) == 1, f"FPS={fps}, frame={index}: detector returned a box but display metadata dropped it"
        assert visible[0]["box"] == pytest.approx([x, 10, x + 40, 50])
        assert session.stats["detections"] == 1


def test_detection_below_track_activation_but_above_display_threshold_is_visible(monkeypatch):
    pytest.importorskip("supervision")
    config = stream.StreamConfig(model_id="fixture", source="upload", source_id="fixture",
                                 fps=1, tracking=True, conf=.1)
    session = stream.StreamSession(config, "/fixture.pt", Path("/fixture.mp4"))
    frame = np.zeros((360, 640, 3), np.uint8)
    result = detection(frame, score=.15)
    monkeypatch.setattr(stream, "predict_frame", lambda *_args, **_kwargs: (result, "NMS"))
    session.predict(None, frame.copy())
    assert session.stats["detections"] == 1
    assert len(session.objects) == 1
    assert session.objects[0]["score"] == pytest.approx(.15)


def test_tracking_off_keeps_raw_boxes_as_metadata_without_baking_annotations(monkeypatch):
    config = stream.StreamConfig(model_id="fixture", source="upload", source_id="fixture", tracking=False)
    session = stream.StreamSession(config, "/fixture.pt", Path("/fixture.mp4"))
    frame = np.zeros((360, 640, 3), np.uint8)
    result = detection(frame)
    monkeypatch.setattr(stream, "predict_frame", lambda *_args, **_kwargs: (result, "NMS"))
    output = session.predict(None, frame.copy())
    assert len(session.objects) == 1
    assert session.objects[0]["id"] is None
    assert session.stats["detections"] == 1
    assert session.stats["tracks"] == 0
    assert np.array_equal(output, frame), "Labels must remain resizable in the browser, not baked into the video"
