#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${OBJECT_AUTOLABEL_CONTAINER_NAME:-object-autolabel}"
HEALTH_URL="${OBJECT_AUTOLABEL_HEALTH_URL:-http://127.0.0.1:8501/api/health}"
HEALTH_ATTEMPTS="${OBJECT_AUTOLABEL_HEALTH_ATTEMPTS:-30}"

usage() {
  cat <<'USAGE'
Usage: scripts/verify-runtime.sh --quick MODE | --train MODE

Modes:
  desktop   x86_64 / amd64
  jetson    Jetson / aarch64

  --quick   Verify API health, running image, and PyTorch CUDA access
  --train   Run quick verification and a bounded one-epoch YOLO CUDA smoke test
USAGE
}

validate_mode() {
  case "$1" in
    desktop|jetson) ;;
    *)
      echo "Unknown runtime mode: $1" >&2
      return 2
      ;;
  esac
}

wait_for_health() {
  local attempt health_json=""
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
    if health_json="$(curl -fsS "${HEALTH_URL}" 2>/dev/null)" \
      && [[ "${health_json}" == *'"ok":true'* ]]; then
      echo "API health: OK"
      return
    fi
    if ((attempt < HEALTH_ATTEMPTS)); then
      sleep 2
    fi
  done
  echo "API health check failed: ${HEALTH_URL}" >&2
  return 3
}

verify_container_identity() {
  local mode="$1"
  local identity image status expected_image
  identity="$(docker inspect \
    --format '{{.Config.Image}} {{.State.Status}}' \
    "${CONTAINER_NAME}")"
  read -r image status <<< "${identity}"
  case "${mode}" in
    desktop) expected_image="object-autolabel:latest" ;;
    jetson) expected_image="object-autolabel:jetson" ;;
  esac
  if [[ "${image}" != "${expected_image}" ]]; then
    echo "Running image ${image} does not match expected image ${expected_image}." >&2
    return 3
  fi
  if [[ "${status}" != "running" ]]; then
    echo "Container ${CONTAINER_NAME} is not running." >&2
    return 3
  fi
  echo "Container image: ${image} (${status})"
}

verify_cuda() {
  local cuda_output torch_version cuda_version available device_name
  if ! cuda_output="$(
    docker exec "${CONTAINER_NAME}" python3 -c \
      'import torch
available = torch.cuda.is_available()
name = torch.cuda.get_device_name(0) if available else "unavailable"
print(torch.__version__, torch.version.cuda, available, name)
raise SystemExit(0 if available else 3)'
  )"; then
    echo "CUDA is not available inside ${CONTAINER_NAME}." >&2
    return 3
  fi
  read -r torch_version cuda_version available device_name <<< "${cuda_output}"
  if [[ "${available}" != "True" ]]; then
    echo "CUDA is not available inside ${CONTAINER_NAME}." >&2
    return 3
  fi
  echo "PyTorch: ${torch_version} (CUDA ${cuda_version})"
  echo "CUDA device: ${device_name}"
}

quick_verify() {
  local mode="$1"
  wait_for_health
  verify_container_identity "${mode}"
  verify_cuda
}

mem_available() {
  awk '/^MemAvailable:/ { print $2 " kB"; exit }' /proc/meminfo
}

smallest_local_weight() {
  docker exec "${CONTAINER_NAME}" sh -lc \
    "find /app/input_model -maxdepth 2 -type f -name '*.pt' -printf '%s %p\n' 2>/dev/null | sort -n | head -n 1 | cut -d' ' -f2-"
}

train_verify() {
  local mode="$1"
  local model before="" after=""
  quick_verify "${mode}"
  model="$(smallest_local_weight)"
  if [[ -z "${model}" ]]; then
    echo "Place a compatible .pt model in input_model/." >&2
    return 4
  fi

  if [[ "${mode}" == "jetson" ]]; then
    before="$(mem_available)"
    echo "MemAvailable before: ${before}"
  fi
  echo "Training model: ${model}"

  docker exec \
    -e "OBJECT_AUTOLABEL_SMOKE_MODEL=${model}" \
    -i "${CONTAINER_NAME}" \
    python3 - <<'PY'
import os
import shutil
from pathlib import Path

from PIL import Image, ImageDraw
from ultralytics import YOLO

root = Path("/tmp/object-autolabel-yolo-cuda-smoke")
if root.exists():
    shutil.rmtree(root)

for split in ("train", "val"):
    (root / "images" / split).mkdir(parents=True)
    (root / "labels" / split).mkdir(parents=True)
    image = Image.new("RGB", (64, 64), "black")
    ImageDraw.Draw(image).rectangle((20, 20, 44, 44), fill="white")
    image.save(root / "images" / split / "sample.jpg")
    (root / "labels" / split / "sample.txt").write_text(
        "0 0.5 0.5 0.375 0.375\n",
        encoding="utf-8",
    )

(root / "dataset.yaml").write_text(
    f"path: {root}\n"
    "train: images/train\n"
    "val: images/val\n"
    "names:\n"
    "  0: square\n",
    encoding="utf-8",
)

model_path = os.environ["OBJECT_AUTOLABEL_SMOKE_MODEL"]
print("device=0")
result = YOLO(model_path).train(
    data=str(root / "dataset.yaml"),
    epochs=1,
    imgsz=64,
    batch=1,
    workers=0,
    device=0,
    project=str(root / "runs"),
    name="cuda-smoke",
    exist_ok=True,
    plots=False,
    verbose=False,
)
weights = Path(result.save_dir) / "weights"
assert (weights / "best.pt").is_file(), "best.pt was not created"
assert (weights / "last.pt").is_file(), "last.pt was not created"
print(f"save_dir={result.save_dir}")
print("best.pt: OK")
print("last.pt: OK")
shutil.rmtree(root)
PY

  if [[ "${mode}" == "jetson" ]]; then
    after="$(mem_available)"
    echo "MemAvailable after: ${after}"
  fi
}

if [[ "$#" -ne 2 ]]; then
  usage
  exit 2
fi

ACTION="$1"
MODE="$2"
validate_mode "${MODE}"

case "${ACTION}" in
  --quick) quick_verify "${MODE}" ;;
  --train) train_verify "${MODE}" ;;
  *)
    usage
    exit 2
    ;;
esac
