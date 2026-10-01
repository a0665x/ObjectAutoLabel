"""Separate LiteRT image layout from detection coordinate units."""
from __future__ import annotations

import numpy as np


def input_contract(details):
    if len(details) != 1:
        raise ValueError('LiteRT requires exactly one image input')
    shape = tuple(int(x) for x in details[0]['shape'])
    if len(shape) != 4 or shape[0] != 1 or min(shape) <= 0:
        raise ValueError(f'LiteRT requires a fixed batch-1 image input, got {shape}')
    nchw, nhwc = shape[1] == 3, shape[-1] == 3
    if nchw == nhwc:
        raise ValueError(f'LiteRT input layout is ambiguous or unsupported: {shape}')
    return ('NHWC', list(shape[1:3])) if nhwc else ('NCHW', list(shape[2:4]))


def prepare_litert_backend(auto):
    if getattr(auto, 'format', None) != 'litert':
        return
    backend = auto.backend
    if getattr(backend, '_oal_contract_ready', False):
        return
    layout, size = input_contract(backend.input_details)
    # AutoBackend receives BCHW; LiteRTBackend owns the single input transpose.
    auto.nhwc = False
    backend.nhwc = layout == 'NHWC'
    backend.imgsz = size
    metadata = backend.metadata or {}
    if backend.end2end and backend.task == 'detect':
        coords = metadata.get('oal_box_coordinates')
        args = metadata.get('args', {})
        if coords is None and 'quantize' in args:
            # Existing official litert-torch exports, including our NHWC wrapper.
            coords = 'pixels'
        if coords is None and ('int8' in args or args.get('format') == 'tflite'):
            # Legacy official TensorFlow/onnx2tf exporter contract.
            coords = 'normalized'
        if coords not in {'pixels', 'normalized'}:
            raise ValueError('Unknown LiteRT end-to-end coordinate contract; re-export with coordinate metadata')
        backend.oal_box_coordinates = coords
        original_forward = backend.forward

        def forward(im):
            outputs = original_forward(im)
            # Read unmodified interpreter output: upstream currently infers units
            # from NHWC and can multiply already-pixel coordinates by image size.
            detail = backend.output_details[0]
            boxes = backend.interpreter.get_tensor(detail['index']).copy()
            if np.issubdtype(boxes.dtype, np.integer):
                scale, zero = detail['quantization']
                if scale <= 0:
                    raise ValueError('Invalid LiteRT output quantization scale')
                boxes = (boxes.astype(np.float32) - zero) * scale
            if boxes.ndim != 3 or boxes.shape[0] != 1 or boxes.shape[-1] != 6:
                raise ValueError(f'Unsupported LiteRT end-to-end detection output: {boxes.shape}')
            if not np.isfinite(boxes).all():
                raise ValueError('LiteRT detection output contains non-finite values')
            if coords == 'normalized':
                boxes[..., :4] *= [size[1], size[0], size[1], size[0]]
            outputs[0] = boxes
            return outputs

        backend.forward = forward
    backend._oal_contract_ready = True
