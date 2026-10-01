from pathlib import Path
from types import SimpleNamespace
import json
import pytest
from backend.app.stream_models import image_contract, output_contract, coordinate_units, local_model_path
from backend.app import stream_demo

@pytest.mark.parametrize('shape,layout,size', [([1,3,320,640],'NCHW',[320,640]), ([1,480,640,3],'NHWC',[480,640]), (['batch',3,'h','w'],'NCHW',[640,640])])
def test_input_contract(shape, layout, size):
    assert image_contract(shape,{}) == (layout,size)

@pytest.mark.parametrize('shape', [[1,3,640,3],[2,3,640,640],[1,640,640],[1,1,640,640]])
def test_ambiguous_input_is_rejected(shape):
    with pytest.raises(ValueError): image_contract(shape,{})

def test_output_contract_and_missing_units():
    assert output_contract([1,300,6]) == ('end2end',None)
    assert output_contract([1,84,8400]) == ('raw_channels_first',80)
    assert output_contract([1,8400,84]) == ('raw_channels_last',80)
    with pytest.raises(ValueError): coordinate_units('tflite',{},'end2end')
    assert coordinate_units('tflite',{},'end2end','pixels') == 'pixels'

def test_relative_path_is_not_loaded():
    with pytest.raises(ValueError): local_model_path('model.pt')

def test_missing_duration_recovers_packet_timestamps(tmp_path,monkeypatch):
    video=tmp_path/'unfinished.mkv'
    video.write_bytes(b'test')
    responses=iter([json.dumps({'streams':[{'width':3840,'height':2160,'avg_frame_rate':'30/1'}],'format':{}}), '0.000,0.033\n345.567,0.033\n'])
    monkeypatch.setattr(stream_demo.subprocess,'run',lambda *a,**k: SimpleNamespace(returncode=0,stdout=next(responses),stderr=''))
    info=stream_demo.probe_video(video)
    assert info['duration'] == pytest.approx(345.6)
    assert info['duration_source'] == 'packets'
    assert stream_demo.probe_video(video) == info  # Cached, no third probe.

def test_upload_has_no_fixed_size_limit():
    assert stream_demo.MAX_UPLOAD_BYTES is None
