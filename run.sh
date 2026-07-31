#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCH="$(uname -m)"
MODE_FILE="${PROJECT_DIR}/.run-mode"
DETECT_SCRIPT="${PROJECT_DIR}/scripts/detect-runtime.sh"
DEFAULT_MODE="desktop"
if [[ "${ARCH}" == "aarch64" || "${ARCH}" == "arm64" ]]; then
  DEFAULT_MODE="jetson"
fi

usage() {
  cat <<'USAGE'
Usage: ./run.sh [--up | --rebuild | --down | --down_up | --logs | --status | --mode MODE | --plan [MODE]]

Platforms:
  x86_64 / amd64     Desktop NVIDIA CUDA PyTorch image
  Jetson / aarch64   NVIDIA Jetson L4T PyTorch image

  no option  First installation; build only when the selected image is absent
  --up       Start from the existing image without rebuilding
  --rebuild  Rebuild with Docker layer cache and start
  --down     Stop and remove the Docker Compose service
  --down_up  Recreate the service from the existing image without rebuilding
  --logs     Follow service logs
  --status   Show service status
  --mode     Save mode preference, e.g. ./run.sh --mode jetson
  --detect   Print detected runtime environment
  --plan     Print the resolved mode/compose/bind plan without running Docker
USAGE
}

saved_mode() {
  if [[ -f "${MODE_FILE}" ]]; then
    tr -d '[:space:]' < "${MODE_FILE}"
  else
    printf '%s\n' "${DEFAULT_MODE}"
  fi
}

save_mode() {
  case "$1" in
    desktop|jetson|auto)
      if [[ "$1" == "auto" ]]; then
        printf '%s\n' "${DEFAULT_MODE}" > "${MODE_FILE}"
      else
        printf '%s\n' "$1" > "${MODE_FILE}"
      fi
      ;;
    *) echo "Unknown mode: $1" >&2; exit 1 ;;
  esac
}

interactive_mode() {
  local options=("desktop" "jetson")
  local selected=0
  if [[ "${DEFAULT_MODE}" == "jetson" ]]; then
    selected=1
  fi

  if [[ ! -t 0 ]]; then
    printf '%s\n' "$(saved_mode)"
    return
  fi

  while true; do
    clear >&2
    echo "Select the ObjectAutoLabel platform" >&2
    echo >&2
    echo "Detected architecture: ${ARCH}" >&2
    echo "Use ↑/↓ or ←/→, Enter to confirm." >&2
    echo >&2
    for i in "${!options[@]}"; do
      local label="${options[$i]}"
      local note=""
      case "${label}" in
        desktop)
          label="x86_64 / amd64"
          note="Desktop NVIDIA CUDA PyTorch"
          ;;
        jetson)
          label="Jetson / aarch64"
          note="Jetson Orin / L4T PyTorch"
          ;;
      esac
      if [[ "$i" -eq "${selected}" ]]; then
        printf '  > %-20s %s\n' "${label}" "${note}" >&2
      else
        printf '    %-20s %s\n' "${label}" "${note}" >&2
      fi
    done

    IFS= read -rsn1 key || true
    if [[ "${key}" == $'\x1b' ]]; then
      read -rsn2 key || true
      case "${key}" in
        "[A"|"[D") selected=$(( (selected + ${#options[@]} - 1) % ${#options[@]} )) ;;
        "[B"|"[C") selected=$(( (selected + 1) % ${#options[@]} )) ;;
      esac
    elif [[ "${key}" == "" ]]; then
      local mode="${options[$selected]}"
      save_mode "${mode}"
      printf '%s\n' "${mode}"
      return
    elif [[ "${key}" == "q" ]]; then
      exit 1
    fi
  done
}

mode_for_command() {
  if [[ -n "${OBJECT_AUTOLABEL_MODE:-}" ]]; then
    printf '%s\n' "${OBJECT_AUTOLABEL_MODE}"
  elif [[ "${1:-}" == "" || "${1:-}" == "--rebuild" ]]; then
    interactive_mode
  else
    saved_mode
  fi
}

image_for_mode() {
  case "$1" in
    desktop) printf '%s\n' "object-autolabel:latest" ;;
    jetson) printf '%s\n' "object-autolabel:jetson" ;;
    *) echo "Unknown mode: $1" >&2; return 2 ;;
  esac
}

image_exists() {
  docker image inspect "$(image_for_mode "$1")" >/dev/null 2>&1
}

require_image() {
  if ! image_exists "$1"; then
    echo "The selected platform image is not installed." >&2
    echo "Run ./run.sh for first installation." >&2
    return 2
  fi
}

compose() {
  local mode="$1"
  shift
  local runtime_env
  runtime_env="$("${DETECT_SCRIPT}" env "${mode}")"
  eval "${runtime_env}"
  if [[ "${OBJECT_AUTOLABEL_MODE}" == "jetson" && -z "${OBJECT_AUTOLABEL_BIND_HOST:-}" ]]; then
    OBJECT_AUTOLABEL_BIND_HOST="$(
      python3 -c 'import socket
s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("8.8.8.8", 80))
    print(s.getsockname()[0])
except OSError:
    print("127.0.0.1")
finally:
    s.close()' 2>/dev/null || printf '127.0.0.1\n'
    )"
    export OBJECT_AUTOLABEL_BIND_HOST
  fi
  echo "Runtime mode: ${OBJECT_AUTOLABEL_MODE} (${OBJECT_AUTOLABEL_ARCH})" >&2
  if [[ "${OBJECT_AUTOLABEL_MODE}" == "jetson" ]]; then
    echo "Jetson L4T: ${OBJECT_AUTOLABEL_L4T}, JetPack: ${OBJECT_AUTOLABEL_JETPACK}" >&2
    echo "Jetson base image: ${JETSON_BASE_IMAGE}" >&2
    echo "WebUI bind host: ${OBJECT_AUTOLABEL_BIND_HOST:-127.0.0.1}" >&2
  fi
  docker compose -f "${COMPOSE_FILE}" "$@"
}

verify_started_runtime() {
  local mode="$1"
  if [[ "${OBJECT_AUTOLABEL_SKIP_VERIFY:-0}" == "1" ]]; then
    return
  fi
  if [[ -x "${PROJECT_DIR}/scripts/verify-runtime.sh" ]]; then
    "${PROJECT_DIR}/scripts/verify-runtime.sh" --quick "${mode}"
  fi
}

print_started_urls() {
  echo "ObjectAutoLabel is available at http://localhost:8501"
  if [[ -n "${OBJECT_AUTOLABEL_BIND_HOST:-}" && "${OBJECT_AUTOLABEL_BIND_HOST}" != "127.0.0.1" ]]; then
    echo "LAN URL: http://${OBJECT_AUTOLABEL_BIND_HOST}:8501"
  fi
}

first_install() {
  local mode="$1"
  local image
  image="$(image_for_mode "${mode}")"
  if image_exists "${mode}"; then
    echo "Existing image: $(docker image inspect --format '{{.Id}} {{.Created}}' "${image}")"
    echo "Run ./run.sh --up for normal startup."
    echo "Run ./run.sh --rebuild after source or dependency changes."
    return
  fi
  compose "${mode}" up -d --build
  verify_started_runtime "${mode}"
  print_started_urls
}

plan() {
  local mode="$1"
  local runtime_env
  runtime_env="$("${DETECT_SCRIPT}" env "${mode}")"
  eval "${runtime_env}"
  if [[ "${OBJECT_AUTOLABEL_MODE}" == "jetson" && -z "${OBJECT_AUTOLABEL_BIND_HOST:-}" ]]; then
    OBJECT_AUTOLABEL_BIND_HOST="127.0.0.1"
  fi
  echo "Runtime mode: ${OBJECT_AUTOLABEL_MODE}"
  echo "Architecture: ${OBJECT_AUTOLABEL_ARCH}"
  echo "Compose file: ${COMPOSE_FILE}"
  if [[ "${OBJECT_AUTOLABEL_MODE}" == "jetson" ]]; then
    echo "Jetson L4T: ${OBJECT_AUTOLABEL_L4T}"
    echo "JetPack: ${OBJECT_AUTOLABEL_JETPACK}"
    echo "Jetson base image: ${JETSON_BASE_IMAGE}"
    echo "WebUI bind host: ${OBJECT_AUTOLABEL_BIND_HOST:-127.0.0.1}"
  else
    echo "Desktop image: object-autolabel:latest"
    echo "WebUI bind host: 0.0.0.0 via docker-compose ports"
  fi
}

case "${1:-}" in
  "")
    MODE="$(mode_for_command "")"
    first_install "${MODE}"
    ;;
  --up)
    MODE="$(mode_for_command "$1")"
    require_image "${MODE}"
    compose "${MODE}" up -d --no-build
    verify_started_runtime "${MODE}"
    print_started_urls
    ;;
  --rebuild)
    MODE="$(mode_for_command "$1")"
    compose "${MODE}" up -d --build
    verify_started_runtime "${MODE}"
    print_started_urls
    ;;
  --down)
    MODE="$(mode_for_command "$1")"
    compose "${MODE}" down
    ;;
  --down_up)
    MODE="$(mode_for_command "$1")"
    require_image "${MODE}"
    compose "${MODE}" down
    compose "${MODE}" up -d --no-build
    verify_started_runtime "${MODE}"
    print_started_urls
    ;;
  --logs)
    MODE="$(mode_for_command "$1")"
    compose "${MODE}" logs -f
    ;;
  --status)
    MODE="$(mode_for_command "$1")"
    compose "${MODE}" ps
    ;;
  --mode)
    if [[ -z "${2:-}" ]]; then
      interactive_mode > /dev/null
      echo "Saved mode: $(saved_mode)"
    else
      save_mode "$2"
      echo "Saved mode: $(saved_mode)"
    fi
    ;;
  --detect)
    "${DETECT_SCRIPT}" env "${2:-auto}"
    ;;
  --plan)
    MODE="${2:-$(saved_mode)}"
    plan "${MODE}"
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
