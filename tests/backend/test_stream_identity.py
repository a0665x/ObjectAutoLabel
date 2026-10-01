"""Deterministic raw-ID discontinuity, confirmation and media-time regression."""
from backend.app.stream_identity import IdentityTracker
from backend.app.tracking_settings import TrackingSettings
import pytest

def objects(raw=1, shift=0):
    return [dict(id=f'0:{raw}',box=[100+shift,100,150+shift,160],score=.9,class_id=0,name='person'),
            dict(id='1:1',box=[180+shift,100,220+shift,140],score=.9,class_id=1,name='car')]

def test_selected_id_survives_raw_id_change_only_after_confirmation():
    tracker=IdentityTracker(TrackingSettings(),640,360)
    for i in range(5): tracker.update(objects(),i/15)
    tracker.select('0:1',4/15)
    tracker.update(objects(),5/15)
    for i in range(6,10):
        output=tracker.update(objects(2,5),i/15)
        assert not any(o['id']=='0:1' and not o.get('predicted') for o in output)
    output=tracker.update(objects(2,5),10/15)
    chosen=next(o for o in output if o['id']=='0:1')
    assert chosen['raw_id']=='0:2' and not chosen.get('predicted')
    assert tracker.debug['state']=='reassociated'

def test_bridge_expires_on_media_time_not_wall_time():
    tracker=IdentityTracker(TrackingSettings(),640,360)
    for i in range(5): tracker.update(objects(),i/15)
    tracker.select('0:1',4/15)
    tracker.update(objects(),5/15)
    assert any(o.get('predicted') for o in tracker.update([],6/15))
    assert tracker.update([],1.0)==[]
    assert tracker.debug['state']=='lost'


def prepared(settings=None):
    tracker=IdentityTracker(settings or TrackingSettings(),640,360)
    for i in range(5): tracker.update(objects(),i/15)
    tracker.select('0:1',4/15)
    tracker.update(objects(),5/15)
    return tracker


def test_ambiguous_candidates_never_claim_selected_identity_or_extend_reference():
    tracker=prepared()
    for i in range(6,32):
        detections=objects(2,5)
        detections.append(dict(detections[0],id='0:3'))
        output=tracker.update(detections,i/15)
        assert not any(o['id']=='0:1' and not o.get('predicted') for o in output)
    assert tracker.debug['reason']=='reference_expired'


def test_disabled_kalman_has_bounded_static_bridge_and_no_fake_motion():
    tracker=prepared(TrackingSettings(TRACK_MOTION_KALMAN_ENABLE=False,TRACKING_BRIDGE_MAX_MISSES=1))
    bridge=next(o for o in tracker.update([],6/15) if o['id']=='0:1')
    assert bridge['predicted'] and 'motion' not in bridge
    assert tracker.update([],7/15)==[]


def test_suspect_same_raw_id_cannot_bypass_gate():
    tracker=prepared()
    result=tracker.update(objects(1,250),6/15)
    assert tracker.debug['direct_suspect']
    assert not any(o['id']=='0:1' and not o.get('predicted') for o in result)


def test_common_camera_translation_and_anchor_raw_id_churn_can_reassociate():
    tracker=prepared()
    for i in range(6,11):
        detections=objects(2,64)
        detections[1]['id']='1:2'
        output=tracker.update(detections,i/15)
    chosen=next(o for o in output if o['id']=='0:1' and not o.get('predicted'))
    assert chosen['raw_id']=='0:2'
    assert tracker.debug['state']=='reassociated'


def test_repeated_raw_churn_never_shortcuts_consecutive_confirmation():
    tracker=prepared()
    for i in range(6,18):
        output=tracker.update(objects(i,5),i/15)
        assert not any(o['id']=='0:1' and not o.get('predicted') for o in output)
        assert tracker.confirm.count<=1


def test_seek_or_duplicate_time_requires_reset():
    tracker=prepared()
    with pytest.raises(ValueError): tracker.update(objects(),5/15)


def test_selection_uses_clicked_snapshot_and_rejects_evicted_frames():
    tracker=prepared()
    tracker.select('0:1',100)
    assert tracker.selected is None
    assert tracker.debug['state']=='selection_expired'


@pytest.mark.parametrize('fps',[5,15,30,60])
def test_bridge_time_limit_at_different_fps(fps):
    tracker=IdentityTracker(TrackingSettings(TRACKING_BRIDGE_MAX_MISSES=120),640,360)
    for i in range(5): tracker.update(objects(),i/fps)
    tracker.select('0:1',4/fps)
    for i in range(5,5+fps):
        output=tracker.update([],i/fps)
        if (i-4)/fps>.400001: assert not any(o.get('predicted') for o in output)
