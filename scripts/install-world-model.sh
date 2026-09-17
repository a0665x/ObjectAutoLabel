#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODEL_DIR="${WORLD_MODEL_DIR:-${PROJECT_DIR}/world_model}"
DEFAULT_MODEL_NAME="yoloe-26n-seg.pt"
DEFAULT_MODEL_OFFICIAL_URL="https://github.com/ultralytics/assets/releases/download/v8.4.0/${DEFAULT_MODEL_NAME}"
DEFAULT_MODEL_URL="${WORLD_MODEL_URL:-${DEFAULT_MODEL_OFFICIAL_URL}}"
DEFAULT_MODEL_SHA256="1741c1f8da3cea47e2c01829c334a50dc0b9bbd05e685b90a3ce84fae32c8c1b"
YOLO_WORLD_V2_OFFICIAL_BASE_URL="https://github.com/ultralytics/assets/releases/download/v8.3.0"
YOLO_WORLD_V2_BASE_URL="${YOLO_WORLD_V2_BASE_URL:-${YOLO_WORLD_V2_OFFICIAL_BASE_URL}}"
YOLO_WORLD_V2_S_SHA256="9b2c17ab6124a913e9b3a5c170617920d91b0f01111a8479da69f00e2cf27792"
YOLOE_ENCODER_NAME="mobileclip2_b.ts"
YOLOE_ENCODER_OFFICIAL_URL="https://github.com/ultralytics/assets/releases/download/v8.4.0/${YOLOE_ENCODER_NAME}"
YOLOE_ENCODER_URL="${YOLOE_ENCODER_URL:-${YOLOE_ENCODER_OFFICIAL_URL}}"
YOLOE_ENCODER_OFFICIAL_SHA256="35d7f213e4d75f38514e4656ad3cb91158bd33e3805d8ac349f23b186f66982f"
YOLO_WORLD_ENCODER_NAME="ViT-B-32.pt"
YOLO_WORLD_ENCODER_OFFICIAL_URL="https://openaipublic.azureedge.net/clip/models/40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af/${YOLO_WORLD_ENCODER_NAME}"
YOLO_WORLD_ENCODER_URL="${YOLO_WORLD_ENCODER_URL:-${YOLO_WORLD_ENCODER_OFFICIAL_URL}}"
YOLO_WORLD_ENCODER_OFFICIAL_SHA256="40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af"
CURL="${CURL_BIN:-curl}"

REQUESTED=("$@")
if [[ "${#REQUESTED[@]}" -eq 0 ]]; then
  REQUESTED=(default)
fi

expected_hash_for_override() {
  local url="$1" official_url="$2" env_name="$3" default_hash="$4"
  local supplied="${!env_name:-}"
  local expected
  if [[ "${url}" != "${official_url}" && -z "${supplied}" ]]; then
    printf 'Custom URL %s requires %s with the expected SHA-256.\n' "${url}" "${env_name}" >&2
    exit 2
  fi
  expected="${supplied:-${default_hash}}"
  printf '%s\n' "${expected,,}"
}

validate_sha256() {
  local expected="$1" label="$2"
  if [[ ! "${expected}" =~ ^[a-fA-F0-9]{64}$ ]]; then
    printf 'Expected SHA-256 for %s must be a 64-character hexadecimal digest.\n' "${label}" >&2
    exit 2
  fi
}

DEFAULT_MODEL_EXPECTED_SHA256="$(expected_hash_for_override "${DEFAULT_MODEL_URL}" "${DEFAULT_MODEL_OFFICIAL_URL}" WORLD_MODEL_SHA256 "${DEFAULT_MODEL_SHA256}")"
YOLOE_ENCODER_EXPECTED_SHA256="$(expected_hash_for_override "${YOLOE_ENCODER_URL}" "${YOLOE_ENCODER_OFFICIAL_URL}" YOLOE_ENCODER_SHA256 "${YOLOE_ENCODER_OFFICIAL_SHA256}")"
YOLO_WORLD_ENCODER_EXPECTED_SHA256="$(expected_hash_for_override "${YOLO_WORLD_ENCODER_URL}" "${YOLO_WORLD_ENCODER_OFFICIAL_URL}" YOLO_WORLD_ENCODER_SHA256 "${YOLO_WORLD_ENCODER_OFFICIAL_SHA256}")"
YOLO_WORLD_V2_EXPECTED_SHA256="$(expected_hash_for_override "${YOLO_WORLD_V2_BASE_URL}" "${YOLO_WORLD_V2_OFFICIAL_BASE_URL}" YOLO_WORLD_V2_SHA256 "${YOLO_WORLD_V2_S_SHA256}")"
for expected in "${DEFAULT_MODEL_EXPECTED_SHA256}" "${YOLOE_ENCODER_EXPECTED_SHA256}" "${YOLO_WORLD_ENCODER_EXPECTED_SHA256}" "${YOLO_WORLD_V2_EXPECTED_SHA256}"; do
  validate_sha256 "${expected}" "catalog asset"
done

for requested in "${REQUESTED[@]}"; do
  case "${requested}" in
    default|yolov8s-worldv2.pt) ;;
    *)
      printf 'Unsupported world model: %s\n' "${requested}" >&2
      printf 'Supported checksum-verified choices: default, yolov8s-worldv2.pt\n' >&2
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
  local name="$1"
  local url="$2"
  local expected_sha256="$3"
  local final="${MODEL_DIR}/${name}"
  local partial actual_sha256
  case "${name}" in
    *[![:alnum:]._-]*|"")
      printf 'Unsafe catalog asset name: %s\n' "${name}" >&2
      return 2
      ;;
  esac
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
  if [[ "${requested}" == "default" ]]; then
    install_asset "${DEFAULT_MODEL_NAME}" "${DEFAULT_MODEL_URL}" "${DEFAULT_MODEL_EXPECTED_SHA256}"
    install_asset "${YOLOE_ENCODER_NAME}" "${YOLOE_ENCODER_URL}" "${YOLOE_ENCODER_EXPECTED_SHA256}"
    install_asset "${YOLO_WORLD_ENCODER_NAME}" "${YOLO_WORLD_ENCODER_URL}" "${YOLO_WORLD_ENCODER_EXPECTED_SHA256}"
  else
    install_asset "${requested}" "${YOLO_WORLD_V2_BASE_URL}/${requested}" "${YOLO_WORLD_V2_EXPECTED_SHA256}"
    install_asset "${YOLO_WORLD_ENCODER_NAME}" "${YOLO_WORLD_ENCODER_URL}" "${YOLO_WORLD_ENCODER_EXPECTED_SHA256}"
  fi
done
trap - EXIT
