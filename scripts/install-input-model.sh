#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODEL_DIR="${INPUT_MODEL_DIR:-${PROJECT_DIR}/input_model}"
CURL="${CURL_BIN:-curl}"

YOLO11N_NAME="yolo11n.pt"
YOLO11N_OFFICIAL_URL="https://github.com/ultralytics/assets/releases/download/v8.3.0/${YOLO11N_NAME}"
YOLO11N_URL="${YOLO11N_URL:-${YOLO11N_OFFICIAL_URL}}"
YOLO11N_OFFICIAL_SHA256="0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1"

YOLO26N_NAME="yolo26n.pt"
YOLO26N_OFFICIAL_URL="https://github.com/ultralytics/assets/releases/download/v8.4.0/${YOLO26N_NAME}"
YOLO26N_URL="${YOLO26N_URL:-${YOLO26N_OFFICIAL_URL}}"
YOLO26N_OFFICIAL_SHA256="9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef"

REQUESTED=("$@")
if [[ "${#REQUESTED[@]}" -eq 0 ]]; then
  REQUESTED=("${YOLO11N_NAME}")
fi

expected_hash_for_override() {
  local url="$1" official_url="$2" env_name="$3" official_hash="$4"
  local supplied="${!env_name:-}"
  if [[ "${url}" != "${official_url}" && -z "${supplied}" ]]; then
    printf 'Custom URL %s requires %s with the expected SHA-256.\n' "${url}" "${env_name}" >&2
    exit 2
  fi
  printf '%s\n' "${supplied:-${official_hash}}" | tr '[:upper:]' '[:lower:]'
}

validate_sha256() {
  local expected="$1" label="$2"
  if [[ ! "${expected}" =~ ^[a-f0-9]{64}$ ]]; then
    printf 'Expected SHA-256 for %s must be a 64-character hexadecimal digest.\n' "${label}" >&2
    exit 2
  fi
}

YOLO11N_EXPECTED_SHA256="$(expected_hash_for_override "${YOLO11N_URL}" "${YOLO11N_OFFICIAL_URL}" YOLO11N_SHA256 "${YOLO11N_OFFICIAL_SHA256}")"
YOLO26N_EXPECTED_SHA256="$(expected_hash_for_override "${YOLO26N_URL}" "${YOLO26N_OFFICIAL_URL}" YOLO26N_SHA256 "${YOLO26N_OFFICIAL_SHA256}")"
validate_sha256 "${YOLO11N_EXPECTED_SHA256}" "${YOLO11N_NAME}"
validate_sha256 "${YOLO26N_EXPECTED_SHA256}" "${YOLO26N_NAME}"

for requested in "${REQUESTED[@]}"; do
  case "${requested}" in
    "${YOLO11N_NAME}"|"${YOLO26N_NAME}") ;;
    *)
      printf 'Unsupported input model: %s\n' "${requested}" >&2
      printf 'Supported checksum-verified choices: %s, %s\n' "${YOLO11N_NAME}" "${YOLO26N_NAME}" >&2
      exit 2
      ;;
  esac
done

mkdir -p "${MODEL_DIR}"
MODEL_DIR="$(cd "${MODEL_DIR}" && pwd -P)"
PARTIALS=()
cleanup_partials() {
  local partial
  for partial in "${PARTIALS[@]:-}"; do
    [[ -n "${partial}" ]] && rm -f -- "${partial}"
  done
}
trap cleanup_partials EXIT

install_asset() {
  local name="$1" url="$2" expected_sha256="$3"
  local final="${MODEL_DIR}/${name}"
  local partial actual_sha256

  if [[ -s "${final}" ]]; then
    actual_sha256="$(sha256sum "${final}" | awk '{print $1}')"
    if [[ "${actual_sha256}" != "${expected_sha256}" ]]; then
      printf 'SHA-256 mismatch for existing asset %s: expected %s, got %s\n' "${final}" "${expected_sha256}" "${actual_sha256}" >&2
      return 1
    fi
    printf 'Existing asset: %s\n' "${final}"
    return
  fi

  partial="$(mktemp "${MODEL_DIR}/.${name}.partial.XXXXXX")"
  PARTIALS+=("${partial}")
  "${CURL}" -fL --retry 3 --output "${partial}" -- "${url}"
  test -s "${partial}"
  actual_sha256="$(sha256sum "${partial}" | awk '{print $1}')"
  if [[ "${actual_sha256}" != "${expected_sha256}" ]]; then
    printf 'SHA-256 mismatch for downloaded asset %s: expected %s, got %s\n' "${name}" "${expected_sha256}" "${actual_sha256}" >&2
    return 1
  fi
  mv "${partial}" "${final}"
  printf 'Installed asset: %s\n' "${final}"
}

for requested in "${REQUESTED[@]}"; do
  case "${requested}" in
    "${YOLO11N_NAME}") install_asset "${YOLO11N_NAME}" "${YOLO11N_URL}" "${YOLO11N_EXPECTED_SHA256}" ;;
    "${YOLO26N_NAME}") install_asset "${YOLO26N_NAME}" "${YOLO26N_URL}" "${YOLO26N_EXPECTED_SHA256}" ;;
  esac
done
trap - EXIT
