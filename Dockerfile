FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Match the PyTorch release used by litert-torch 0.9.0 upstream.
FROM pytorch/pytorch:2.11.0-cuda12.8-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics \
    YOLO_AUTOINSTALL=False

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg git python3-venv \
    && rm -rf /var/lib/apt/lists/*

# The base uses managed system Python; retain its preinstalled CUDA packages.
RUN python3 -m venv --system-site-packages /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt \
    && pip install git+https://github.com/ultralytics/CLIP.git@main

RUN python -c "import os; assert os.environ['YOLO_AUTOINSTALL'] == 'False'; import ultralytics; import ultralytics.utils.checks; import litert_torch; import ai_edge_litert; ultralytics.utils.AUTOINSTALL = False; ultralytics.utils.checks.AUTOINSTALL = False"

RUN apt-get update \
    && apt-get install -y --no-install-recommends gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav v4l-utils \
    && rm -rf /var/lib/apt/lists/* \
    && gst-inspect-1.0 x264enc >/dev/null \
    && gst-inspect-1.0 mp4mux >/dev/null

RUN python -c "import torch; import onnxruntime; from ai_edge_litert.interpreter import Interpreter"

COPY backend /app/backend
COPY requirements-cli.txt /app/requirements-cli.txt
RUN pip install --no-deps -r /app/requirements-cli.txt
COPY cli_workspace /app/cli_workspace
COPY scripts/smoke-world-models.py /app/scripts/smoke-world-models.py
COPY scripts/smoke-desktop-runtime.py /app/scripts/smoke-desktop-runtime.py
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

RUN mkdir -p /app/data/projects /app/runs /app/world_model /app/input_model /app/output_model /app/weights/clip /root/.cache/clip \
    && ln -s /app/world_model/mobileclip2_b.ts /app/mobileclip2_b.ts \
    && ln -s /app/world_model/ViT-B-32.pt /app/weights/clip/ViT-B-32.pt \
    && ln -s /app/world_model/ViT-B-32.pt /root/.cache/clip/ViT-B-32.pt

EXPOSE 8501
EXPOSE 8081

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8501"]
