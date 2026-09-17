#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DATE="$(TZ=Asia/Taipei date +%F)"
LOG_TIME="$(TZ=Asia/Taipei date +%H%M%S)"
LOG_DIR="${PROJECT_DIR}/logs/${LOG_DATE}"
mkdir -p "${PROJECT_DIR}/logs"
if command -v setfacl >/dev/null 2>&1 && [[ -O "${PROJECT_DIR}/logs" ]]; then
  HOST_LOG_USER="$(id -un)"
  setfacl -m "u:${HOST_LOG_USER}:rwx,d:u:${HOST_LOG_USER}:rwx" "${PROJECT_DIR}/logs" 2>/dev/null || true
fi
mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_DIR}/launcher-${LOG_TIME}.log") 2> >(tee -a "${LOG_DIR}/launcher-${LOG_TIME}.log" >&2)
ARCH="$(uname -m)"
MODE_FILE="${PROJECT_DIR}/.run-mode"
DETECT_SCRIPT="${OBJECT_AUTOLABEL_DETECT_SCRIPT:-${PROJECT_DIR}/scripts/detect-runtime.sh}"
TAILSCALE_SCRIPT="${OBJECT_AUTOLABEL_TAILSCALE_SCRIPT:-${PROJECT_DIR}/scripts/tailscale-serve.sh}"
DEFAULT_MODE="desktop"
if [[ "${ARCH}" == "aarch64" || "${ARCH}" == "arm64" ]]; then
  DEFAULT_MODE="jetson"
fi

usage() {
  cat <<'USAGE'
Usage: ./run.sh [--up | --rebuild | --down | --down_up | --logs | --status | --mode MODE | --plan [MODE] | --tailscale-up | --tailscale-status | --tailscale-down]

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
  --tailscale-up      Enable private tailnet-only HTTPS on dedicated port 8501
  --tailscale-status  Show the private HTTPS route without changing it
  --tailscale-down    Disable only this app's owned HTTPS route
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

load_runtime() {
  local mode="$1"
  local key value
  OBJECT_AUTOLABEL_ARCH=""
  OBJECT_AUTOLABEL_L4T=""
  OBJECT_AUTOLABEL_JETPACK=""
  JETSON_BASE_IMAGE=""
  COMPOSE_FILE=""
  while IFS='=' read -r key value; do
    case "${key}" in
      OBJECT_AUTOLABEL_MODE) OBJECT_AUTOLABEL_MODE="${value}" ;;
      OBJECT_AUTOLABEL_ARCH) OBJECT_AUTOLABEL_ARCH="${value}" ;;
      OBJECT_AUTOLABEL_L4T) OBJECT_AUTOLABEL_L4T="${value}" ;;
      OBJECT_AUTOLABEL_JETPACK) OBJECT_AUTOLABEL_JETPACK="${value}" ;;
      JETSON_BASE_IMAGE) JETSON_BASE_IMAGE="${value}" ;;
      COMPOSE_FILE) COMPOSE_FILE="${value}" ;;
      "") ;;
      *)
        echo "Unexpected runtime detector key: ${key}" >&2
        return 2
        ;;
    esac
  done < <("${DETECT_SCRIPT}" env "${mode}")

  case "${OBJECT_AUTOLABEL_MODE}" in
    desktop)
      if [[ "${COMPOSE_FILE}" != "${PROJECT_DIR}/docker-compose.yml" ]]; then
        echo "The runtime detector returned an invalid desktop Compose file." >&2
        return 2
      fi
      ;;
    jetson)
      if [[ "${COMPOSE_FILE}" != "${PROJECT_DIR}/docker-compose.jetson.yml" ]]; then
        echo "The runtime detector returned an invalid Jetson Compose file." >&2
        return 2
      fi
      if [[ -z "${JETSON_BASE_IMAGE}" ]]; then
        echo "The runtime detector did not return a Jetson base image." >&2
        return 2
      fi
      ;;
    *)
      echo "The runtime detector returned an invalid mode." >&2
      return 2
      ;;
  esac
  case "${OBJECT_AUTOLABEL_ARCH}" in
    amd64|arm64) ;;
    *)
      echo "The runtime detector returned an unsupported architecture." >&2
      return 2
      ;;
  esac
}

platform_label() {
  case "$1" in
    desktop) printf '%s\n' "x86_64 / amd64" ;;
    jetson) printf '%s\n' "Jetson / aarch64" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

validate_platform() {
  local mode="$1"
  local matches=0
  case "${mode}:${ARCH}" in
    desktop:x86_64|desktop:amd64|jetson:aarch64|jetson:arm64) matches=1 ;;
  esac
  if [[ "${matches}" != "1" ]]; then
    echo "Selected platform $(platform_label "${mode}") does not match host ${ARCH}." >&2
    return 2
  fi

  if [[ "${mode}" == "jetson" ]]; then
    load_runtime "${mode}"
    if [[ -z "${OBJECT_AUTOLABEL_L4T}" || "${OBJECT_AUTOLABEL_L4T}" == "unknown" ]]; then
      echo "Jetson startup requires a detected NVIDIA L4T release." >&2
      return 2
    fi
    local runtimes
    if ! runtimes="$(docker info --format '{{json .Runtimes}}' 2>&1)"; then
      echo "Docker runtime inspection failed: ${runtimes}" >&2
      return 2
    fi
    if [[ "${runtimes}" != *nvidia* ]]; then
      echo "Jetson startup requires the NVIDIA Docker runtime." >&2
      return 2
    fi
  fi
}

compose() {
  local mode="$1"
  shift
  load_runtime "${mode}"
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
  local camera_args=()
  local camera_device="${OBJECT_AUTOLABEL_CAMERA_DEVICE:-/dev/video0}"
  if [[ ! "${camera_device}" =~ ^/dev/video[0-9]+$ ]]; then
      echo "OBJECT_AUTOLABEL_CAMERA_DEVICE must be a /dev/videoN device." >&2
      return 2
  fi
  if [[ -n "${OBJECT_AUTOLABEL_CAMERA_DEVICE:-}" && ! -e "${camera_device}" ]]; then
      echo "Camera device ${OBJECT_AUTOLABEL_CAMERA_DEVICE} does not exist on the host." >&2
      echo "Run v4l2-ctl --list-devices after connecting the USB webcam." >&2
      return 2
  fi
  if [[ -e "${camera_device}" ]]; then
    camera_args=(-f "${PROJECT_DIR}/docker-compose.camera.yml")
    echo "Camera mapping: ${camera_device} -> /dev/video0" >&2
  else
    echo "Camera mapping: no ${camera_device} on host; start continues without camera" >&2
  fi
  docker compose -f "${COMPOSE_FILE}" "${camera_args[@]}" "$@"
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
  validate_platform "${mode}"
  compose "${mode}" up -d --build
  verify_started_runtime "${mode}"
  print_started_urls
}

plan() {
  local mode="$1"
  load_runtime "${mode}"
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
    validate_platform "${MODE}"
    require_image "${MODE}"
    compose "${MODE}" up -d --no-build
    verify_started_runtime "${MODE}"
    print_started_urls
    ;;
  --rebuild)
    MODE="$(mode_for_command "$1")"
    validate_platform "${MODE}"
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
    validate_platform "${MODE}"
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
  --tailscale-up)
    "${TAILSCALE_SCRIPT}" up
    ;;
  --tailscale-status)
    "${TAILSCALE_SCRIPT}" status
    ;;
  --tailscale-down)
    "${TAILSCALE_SCRIPT}" down
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
