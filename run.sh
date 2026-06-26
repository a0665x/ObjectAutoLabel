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
Usage: ./run.sh --up | --down | --down_up | --logs | --status | --mode MODE

Modes:
  desktop   x86_64 CUDA PyTorch image
  jetson    NVIDIA Jetson L4T PyTorch image
  auto      Select by current CPU architecture

  --up       Build and start ObjectAutoLabel WebUI with Docker Compose
  --down     Stop and remove the Docker Compose service
  --down_up  Recreate service from a clean container
  --logs     Follow service logs
  --status   Show service status
  --mode     Save mode preference, e.g. ./run.sh --mode jetson
  --detect   Print detected runtime environment
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
  local options=("jetson" "desktop" "auto")
  local selected=0
  if [[ "${DEFAULT_MODE}" == "desktop" ]]; then
    selected=1
  fi

  if [[ ! -t 0 ]]; then
    printf '%s\n' "$(saved_mode)"
    return
  fi

  while true; do
    clear >&2
    echo "Select ObjectAutoLabel install mode" >&2
    echo >&2
    echo "Detected architecture: ${ARCH}" >&2
    echo "Use ↑/↓ or ←/→, Enter to confirm." >&2
    echo >&2
    for i in "${!options[@]}"; do
      local label="${options[$i]}"
      local note=""
      case "${label}" in
        jetson) note="Jetson Orin / L4T PyTorch ARM64" ;;
        desktop) note="x86_64 NVIDIA CUDA PyTorch" ;;
        auto) note="Use detected architecture default: ${DEFAULT_MODE}" ;;
      esac
      if [[ "$i" -eq "${selected}" ]]; then
        printf '  > %-8s %s\n' "${label}" "${note}" >&2
      else
        printf '    %-8s %s\n' "${label}" "${note}" >&2
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
      if [[ "${mode}" == "auto" ]]; then
        mode="${DEFAULT_MODE}"
      fi
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
  elif [[ "${1:-}" == "--up" || "${1:-}" == "--down_up" ]]; then
    interactive_mode
  else
    saved_mode
  fi
}

compose() {
  local mode="$1"
  shift
  local runtime_env
  runtime_env="$("${DETECT_SCRIPT}" env "${mode}")"
  eval "${runtime_env}"
  echo "Runtime mode: ${OBJECT_AUTOLABEL_MODE} (${OBJECT_AUTOLABEL_ARCH})" >&2
  if [[ "${OBJECT_AUTOLABEL_MODE}" == "jetson" ]]; then
    echo "Jetson L4T: ${OBJECT_AUTOLABEL_L4T}, JetPack: ${OBJECT_AUTOLABEL_JETPACK}" >&2
    echo "Jetson base image: ${JETSON_BASE_IMAGE}" >&2
  fi
  docker compose -f "${COMPOSE_FILE}" "$@"
}

case "${1:-}" in
  --up)
    MODE="$(mode_for_command "$1")"
    compose "${MODE}" up -d --build
    echo "ObjectAutoLabel is available at http://localhost:8501"
    ;;
  --down)
    MODE="$(mode_for_command "$1")"
    compose "${MODE}" down
    ;;
  --down_up)
    MODE="$(mode_for_command "$1")"
    compose "${MODE}" down
    compose "${MODE}" up -d --build
    echo "ObjectAutoLabel is available at http://localhost:8501"
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
  -h|--help|"")
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
