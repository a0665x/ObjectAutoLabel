"""Inspect trusted local YOLO models independently of conversion history."""
from __future__ import annotations

import ast
import json
from pathlib import Path
from types import SimpleNamespace
import zipfile

import cv2
import numpy as np

from .runtime_safety import disable_ultralytics_autoinstall


def local_model_path(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError('Use an absolute model path visible inside Docker, for example /app/input_model/model.pt')
    path = path.resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in {'.pt', '.onnx', '.tflite'}:
        raise ValueError('Select an existing local YOLO .pt, .onnx, or .tflite file')
    return path


def parse_metadata(values):
    result = {}
    for key, value in values.items():
        if isinstance(value, str):
            try:
                value = ast.literal_eval(value)
            except (ValueError, SyntaxError):
                pass
        result[key] = value
    return result


def image_contract(shape, metadata):
    if len(shape) != 4 or isinstance(shape[0], int) and shape[0] != 1:
        raise ValueError(f'Expected a batch-1 RGB image tensor, got {shape}')
    first, last = shape[1] == 3, shape[-1] == 3
    if first == last:
        raise ValueError(f'Cannot determine NCHW/NHWC from input shape {shape}')
    layout = 'NCHW' if first else 'NHWC'
    spatial = shape[2:4] if first else shape[1:3]
    fallback = metadata.get('imgsz', [640, 640])
    if isinstance(fallback, int):
        fallback = [fallback, fallback]
    size = [int(value) if isinstance(value, (int, np.integer)) and value > 0 else int(fallback[index]) for index, value in enumerate(spatial)]
    if any(value < 16 or value > 4096 for value in size):
        raise ValueError(f'Unsupported model image dimensions: {size}')
    return layout, size


def output_contract(shape):
    if len(shape) != 3 or isinstance(shape[0], int) and shape[0] != 1:
        raise ValueError(f'Expected a YOLO detection output (1,N,6) or (1,4+classes,N), got {shape}')
    if shape[-1] == 6:
        return 'end2end', None
    if isinstance(shape[1], int) and shape[1] >= 5 and (not isinstance(shape[2], int) or shape[1] < shape[2]):
        return 'raw_channels_first', shape[1] - 4
    if isinstance(shape[2], int) and shape[2] >= 5 and (not isinstance(shape[1], int) or shape[2] < shape[1]):
        return 'raw_channels_last', shape[2] - 4
    raise ValueError(f'Unsupported or ambiguous YOLO detection output: {shape}')


def coordinate_units(format, metadata, output, requested='auto'):
    if requested in {'pixels', 'normalized'}:
        return requested
    units = metadata.get('oal_box_coordinates')
    if units in {'pixels', 'normalized'}:
        return units
    if format == 'onnx':
        return 'pixels'  # Standard Ultralytics ONNX contract.
    args = metadata.get('args', {})
    if isinstance(args, dict) and 'quantize' in args:
        return 'pixels' if output == 'end2end' else 'normalized'
    if isinstance(args, dict) and ('int8' in args or args.get('format') == 'tflite'):
        return 'normalized'
    raise ValueError('Model has no coordinate-unit metadata. Select Pixels or Normalized (0–1), then inspect again.')


class ExternalDetector:
    """One-input/one-output YOLO detector with tensor-driven preprocessing."""
    def __init__(self, path: Path, coordinates='auto'):
        self.path = path
        self.format = 'onnx' if path.suffix.lower() == '.onnx' else 'tflite'
        if self.format == 'onnx':
            import onnxruntime as ort
            options = ort.SessionOptions()
            options.intra_op_num_threads = 4
            self.engine = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
            inputs, outputs = self.engine.get_inputs(), self.engine.get_outputs()
            self.metadata = parse_metadata(self.engine.get_modelmeta().custom_metadata_map)
            if len(inputs) != 1 or len(outputs) != 1:
                raise ValueError('Only single-input, single-output YOLO Detect models are supported')
            self.input_name = inputs[0].name
            self.shape, self.output_shape = inputs[0].shape, outputs[0].shape
            types = {'tensor(float)': np.float32, 'tensor(float16)': np.float16}
            if inputs[0].type not in types:
                raise ValueError(f'Unsupported ONNX input dtype: {inputs[0].type}')
            self.dtype = types[inputs[0].type]
        else:
            from ai_edge_litert.interpreter import Interpreter
            self.engine = Interpreter(model_path=str(path), num_threads=4)
            self.engine.allocate_tensors()
            inputs, outputs = self.engine.get_input_details(), self.engine.get_output_details()
            if len(inputs) != 1 or len(outputs) != 1:
                raise ValueError('Only single-input, single-output YOLO Detect models are supported')
            self.input, self.output = inputs[0], outputs[0]
            self.shape, self.output_shape = self.input['shape'].tolist(), self.output['shape'].tolist()
            self.dtype = self.input['dtype']
            self.metadata = {}
            if zipfile.is_zipfile(path):
                with zipfile.ZipFile(path) as archive:
                    for entry in archive.infolist():
                        if entry.filename == 'metadata.json' and entry.file_size <= 1024 * 1024:
                            self.metadata = parse_metadata(json.loads(archive.read(entry)))
        if self.metadata.get('task', 'detect') != 'detect':
            raise ValueError('Stream tracking requires a YOLO Detect/bounding-box model')
        self.layout, self.size = image_contract(self.shape, self.metadata)
        self.output_kind, self.nc = output_contract(self.output_shape)
        self.coordinates = coordinate_units(self.format, self.metadata, self.output_kind, coordinates)
        names = self.metadata.get('names', {})
        self.names = {int(k): str(v) for k, v in (enumerate(names) if isinstance(names, list) else names.items())}
        if self.nc and self.names and self.nc != len(self.names):
            raise ValueError('Output channels do not match class metadata; legacy objectness/segmentation outputs are not supported')
        self.predictor = SimpleNamespace(model=SimpleNamespace(format='external', dynamic=False, imgsz=self.size,
            end2end=self.output_kind == 'end2end', metadata=self.metadata))

    def predict(self, frame, *, conf=.25, iou=.7, max_det=300, **kwargs):
        import torch
        from ultralytics.engine.results import Results
        from ultralytics.utils.nms import non_max_suppression
        h, w = self.size
        fh, fw = frame.shape[:2]
        ratio = min(w / fw, h / fh)
        rw, rh = max(1, round(fw * ratio)), max(1, round(fh * ratio))
        left, top = (w - rw) // 2, (h - rh) // 2
        image = np.full((h, w, 3), 114, np.uint8)
        image[top:top + rh, left:left + rw] = cv2.resize(frame, (rw, rh))
        tensor = image[..., ::-1].astype(np.float32) / 255
        if self.layout == 'NCHW':
            tensor = tensor.transpose(2, 0, 1)
        tensor = np.ascontiguousarray(tensor[None])
        if self.format == 'onnx':
            raw = self.engine.run(None, {self.input_name: tensor.astype(self.dtype)})[0]
        else:
            if np.issubdtype(self.dtype, np.integer):
                scale, zero = self.input['quantization']
                if scale <= 0:
                    raise ValueError('Missing input quantization scale')
                limits = np.iinfo(self.dtype)
                tensor = np.clip(np.rint(tensor / scale + zero), limits.min, limits.max)
            self.engine.set_tensor(self.input['index'], tensor.astype(self.dtype))
            self.engine.invoke()
            raw = self.engine.get_tensor(self.output['index'])
            if np.issubdtype(raw.dtype, np.integer):
                scale, zero = self.output['quantization']
                if scale <= 0:
                    raise ValueError('Missing output quantization scale')
                raw = (raw.astype(np.float32) - zero) * scale
        raw = np.asarray(raw, dtype=np.float32).copy()
        if not np.isfinite(raw).all():
            raise ValueError('Model output contains NaN or infinite values')
        if self.output_kind == 'raw_channels_last':
            raw = raw.transpose(0, 2, 1)
        if self.coordinates == 'normalized':
            if self.output_kind == 'end2end':
                raw[..., :4] *= [w, h, w, h]
            else:
                raw[:, :4, :] *= np.array([w, h, w, h])[None, :, None]
        boxes = non_max_suppression(torch.from_numpy(raw), conf_thres=conf, iou_thres=iou,
            nc=self.nc or 0, max_det=max_det, end2end=self.output_kind == 'end2end')[0]
        boxes[:, [0, 2]] = (boxes[:, [0, 2]] - left) / ratio
        boxes[:, [1, 3]] = (boxes[:, [1, 3]] - top) / ratio
        boxes[:, [0, 2]] = boxes[:, [0, 2]].clamp(0, fw)
        boxes[:, [1, 3]] = boxes[:, [1, 3]].clamp(0, fh)
        boxes = boxes[(boxes[:, 2] > boxes[:, 0]) & (boxes[:, 3] > boxes[:, 1])]
        names = dict(self.names)
        for value in boxes[:, 5].tolist():
            names.setdefault(int(value), f'class_{int(value)}')
        return [Results(orig_img=frame, path=str(self.path), names=names, boxes=boxes)]


def load_external_model(path: Path, coordinates='auto'):
    disable_ultralytics_autoinstall()
    if path.suffix.lower() in {'.pt', '.pth'}:
        from ultralytics import YOLO
        model = YOLO(str(path), task='detect')
        if model.task != 'detect':
            raise ValueError('Stream tracking requires a YOLO Detect/bounding-box model')
        return model
    return ExternalDetector(path, coordinates)


def inspect_external_model(path: Path, coordinates='auto'):
    model = load_external_model(path, coordinates)
    format = 'pt' if path.suffix.lower() in {'.pt', '.pth'} else path.suffix.lower()[1:]
    # A loadable protobuf/flatbuffer alone does not prove a usable detector.
    model.predict(np.zeros((640, 640, 3), np.uint8), device='cpu', verbose=False, conf=.25)
    return {'format': format, 'layout': getattr(model, 'layout', 'NCHW'),
            'input_shape': getattr(model, 'shape', [1, 3, 'height', 'width']),
            'output_shape': getattr(model, 'output_shape', None),
            'coordinates': getattr(model, 'coordinates', 'pixels'),
            'output_kind': getattr(model, 'output_kind', 'native YOLO'),
            'resolved_path': str(path), 'available': True, 'reason': None}
