FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt \
    && pip install git+https://github.com/ultralytics/CLIP.git@main

COPY backend /app/backend
COPY frontend /app/frontend
COPY models /app/models
COPY yolo_model /app/yolo_model

RUN mkdir -p /app/data/input /app/data/output /app/data/datasets /app/runs

EXPOSE 8501
EXPOSE 8081

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8501"]
