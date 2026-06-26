#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="$(uname -m)"

log() {
  printf '%s\n' "$*" >&2
}

normalize_arch() {
  case "${ARCH}" in
    aarch64|arm64) printf 'arm64\n' ;;
    x86_64|amd64) printf 'amd64\n' ;;
    *) printf '%s\n' "${ARCH}" ;;
  esac
}

l4t_release() {
  if [[ -r /etc/nv_tegra_release ]]; then
    sed -n 's/^# R\([0-9]\+\).*REVISION: \([0-9.]\+\).*/\1.\2/p' /etc/nv_tegra_release | head -n 1
    return
  fi
  if command -v dpkg-query >/dev/null 2>&1; then
    dpkg-query -W -f='${Version}\n' nvidia-l4t-core 2>/dev/null | sed 's/-.*//' | head -n 1 || true
  fi
}

jetpack_version_from_l4t() {
  local l4t="$1"
  case "${l4t}" in
    36.4*) printf '6.2\n' ;;
    36.3*) printf '6.0\n' ;;
    36.2*) printf '6.0\n' ;;
    35.6*) printf '5.1.4\n' ;;
    35.5*) printf '5.1.3\n' ;;
    35.4*) printf '5.1.2\n' ;;
    35.3*) printf '5.1.1\n' ;;
    35.2*) printf '5.1\n' ;;
    35.1*) printf '5.0.2\n' ;;
    *) printf 'unknown\n' ;;
  esac
}

candidate_images_for_jetson() {
  local l4t="$1"
  local jetpack
  jetpack="$(jetpack_version_from_l4t "${l4t}")"

  if [[ -n "${JETSON_BASE_IMAGE:-}" ]]; then
    printf '%s\n' "${JETSON_BASE_IMAGE}"
    return
  fi

  case "${jetpack}" in
    6.2)
      printf '%s\n' \
        "nvcr.io/nvidia/pytorch:25.06-py3-igpu" \
        "nvcr.io/nvidia/pytorch:25.05-py3-igpu" \
        "nvcr.io/nvidia/pytorch:25.04-py3-igpu" \
        "nvcr.io/nvidia/pytorch:25.03-py3-igpu"
      ;;
    6.1)
      printf '%s\n' \
        "nvcr.io/nvidia/pytorch:25.01-py3-igpu" \
        "nvcr.io/nvidia/pytorch:24.12-py3-igpu" \
        "nvcr.io/nvidia/pytorch:24.11-py3-igpu" \
        "nvcr.io/nvidia/pytorch:24.10-py3-igpu" \
        "nvcr.io/nvidia/pytorch:24.09-py3-igpu"
      ;;
    6.0)
      printf '%s\n' \
        "nvcr.io/nvidia/pytorch:24.08-py3-igpu" \
        "nvcr.io/nvidia/pytorch:24.07-py3-igpu" \
        "nvcr.io/nvidia/pytorch:24.06-py3-igpu" \
        "nvcr.io/nvidia/pytorch:24.05-py3-igpu"
      ;;
    5.*)
      printf '%s\n' \
        "nvcr.io/nvidia/l4t-pytorch:r${l4t}-pth2.1-py3" \
        "nvcr.io/nvidia/l4t-pytorch:r${l4t}-pth2.0-py3" \
        "nvcr.io/nvidia/l4t-pytorch:r${l4t}-pth1.13-py3"
      ;;
    *)
      printf '%s\n' \
        "nvcr.io/nvidia/pytorch:25.06-py3-igpu" \
        "nvcr.io/nvidia/pytorch:25.05-py3-igpu" \
        "nvcr.io/nvidia/pytorch:25.01-py3-igpu" \
        "nvcr.io/nvidia/pytorch:24.08-py3-igpu"
      ;;
  esac
}

docker_available() {
  command -v docker >/dev/null 2>&1
}

manifest_exists() {
  local image="$1"
  docker manifest inspect "${image}" >/dev/null 2>&1
}

select_existing_image() {
  local image
  while IFS= read -r image; do
    [[ -z "${image}" ]] && continue
    log "Checking image manifest: ${image}"
    if manifest_exists "${image}"; then
      printf '%s\n' "${image}"
      return 0
    fi
  done
  return 1
}

detect_mode() {
  case "$(normalize_arch)" in
    arm64) printf 'jetson\n' ;;
    amd64) printf 'desktop\n' ;;
    *) printf 'unsupported\n' ;;
  esac
}

print_env() {
  local mode="${1:-auto}"
  local resolved_mode="${mode}"
  [[ "${mode}" == "auto" ]] && resolved_mode="$(detect_mode)"
  local arch_norm
  arch_norm="$(normalize_arch)"
  local l4t
  l4t="$(l4t_release || true)"
  local jetpack="unknown"
  [[ -n "${l4t}" ]] && jetpack="$(jetpack_version_from_l4t "${l4t}")"

  if [[ "${resolved_mode}" == "jetson" ]]; then
    local image=""
    local first_candidate=""
    first_candidate="$(candidate_images_for_jetson "${l4t}" | head -n 1)"
    if docker_available; then
      image="$(candidate_images_for_jetson "${l4t}" | select_existing_image || true)"
    else
      log "Docker CLI is not available to verify manifest; using first candidate."
    fi
    if [[ -z "${image}" ]]; then
      if [[ "${STRICT_RUNTIME_CHECK:-0}" == "1" ]]; then
        log "No compatible Jetson image manifest was found."
        exit 2
      fi
      image="${first_candidate}"
      log "Could not verify Jetson image manifest; falling back to version candidate: ${image}"
    fi
    cat <<EOF
OBJECT_AUTOLABEL_MODE=jetson
OBJECT_AUTOLABEL_ARCH=${arch_norm}
OBJECT_AUTOLABEL_L4T=${l4t:-unknown}
OBJECT_AUTOLABEL_JETPACK=${jetpack}
JETSON_BASE_IMAGE=${image}
COMPOSE_FILE=${PROJECT_DIR}/docker-compose.jetson.yml
EOF
    return
  fi

  if [[ "${resolved_mode}" == "desktop" ]]; then
    cat <<EOF
OBJECT_AUTOLABEL_MODE=desktop
OBJECT_AUTOLABEL_ARCH=${arch_norm}
OBJECT_AUTOLABEL_L4T=${l4t:-none}
OBJECT_AUTOLABEL_JETPACK=${jetpack}
COMPOSE_FILE=${PROJECT_DIR}/docker-compose.yml
EOF
    return
  fi

  log "Unsupported architecture: ${ARCH}"
  exit 2
}

case "${1:-env}" in
  env) print_env "${2:-auto}" ;;
  mode) detect_mode ;;
  candidates) candidate_images_for_jetson "$(l4t_release || true)" ;;
  l4t) l4t_release ;;
  jetpack)
    l4t="$(l4t_release || true)"
    jetpack_version_from_l4t "${l4t}"
    ;;
  *)
    cat >&2 <<'USAGE'
Usage:
  scripts/detect-runtime.sh env [auto|jetson|desktop]
  scripts/detect-runtime.sh mode
  scripts/detect-runtime.sh candidates
  scripts/detect-runtime.sh l4t
  scripts/detect-runtime.sh jetpack
USAGE
    exit 1
    ;;
esac
