from types import SimpleNamespace

import numpy as np
import pytest

from backend.app.litert_contract import input_contract, prepare_litert_backend


@pytest.mark.parametrize('shape,layout,size', [
    ([1, 3, 320, 640], 'NCHW', [320, 640]),
    ([1, 320, 640, 3], 'NHWC', [320, 640]),
])
def test_actual_tensor_determines_layout_and_size(shape, layout, size):
    assert input_contract([{'shape': shape}]) == (layout, size)


@pytest.mark.parametrize('shape', [[2, 640, 640, 3], [1, 3, 640, 3], [1, -1, -1, 3], [640, 640, 3]])
def test_invalid_or_ambiguous_input_fails(shape):
    with pytest.raises(ValueError):
        input_contract([{'shape': shape}])


@pytest.mark.parametrize('layout', ['NCHW', 'NHWC'])
@pytest.mark.parametrize('coords', ['pixels', 'normalized'])
def test_end2end_coordinates_do_not_depend_on_input_layout(layout, coords):
    raw = np.array([[[20., 30., 100., 120., .8, 0.]]], dtype=np.float32)
    if coords == 'normalized':
        raw[..., :4] /= [640, 320, 640, 320]
    interpreter = SimpleNamespace(get_tensor=lambda _: raw.copy())
    backend = SimpleNamespace(
        input_details=[{'shape': [1, 320, 640, 3] if layout == 'NHWC' else [1, 3, 320, 640]}],
        output_details=[{'index': 0, 'dtype': np.float32}], interpreter=interpreter,
        metadata={'oal_box_coordinates': coords}, end2end=True, task='detect',
        forward=lambda im: [raw * 640],
    )
    auto = SimpleNamespace(format='litert', backend=backend)
    prepare_litert_backend(auto)
    prepare_litert_backend(auto)  # Idempotent across frames.
    output = backend.forward(None)[0]
    np.testing.assert_allclose(output[0, 0], [20, 30, 100, 120, .8, 0], rtol=1e-6)
    assert backend.nhwc == (layout == 'NHWC')
    assert backend.imgsz == [320, 640]


def test_existing_litert_torch_export_uses_pixel_coordinates():
    backend = SimpleNamespace(input_details=[{'shape': [1, 640, 640, 3]}],
        metadata={'args': {'quantize': None}}, end2end=True, task='detect', forward=lambda _: [])
    prepare_litert_backend(SimpleNamespace(format='litert', backend=backend))
    assert backend.oal_box_coordinates == 'pixels'


def test_unknown_coordinate_contract_is_not_guessed_from_box_sizes():
    backend = SimpleNamespace(input_details=[{'shape': [1, 640, 640, 3]}],
        metadata={}, end2end=True, task='detect')
    with pytest.raises(ValueError, match='coordinate'):
        prepare_litert_backend(SimpleNamespace(format='litert', backend=backend))
