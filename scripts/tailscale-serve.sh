#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-status}"
TAILSCALE="${TAILSCALE_BIN:-tailscale}"
CURL="${CURL_BIN:-curl}"
TARGET="${OBJECT_AUTOLABEL_URL:-http://127.0.0.1:8501}"
HTTPS_PORT="${OBJECT_AUTOLABEL_HTTPS_PORT:-8501}"
HEALTH_URL="${TARGET%/}/api/health"

case "${ACTION}" in
  up|status|down) ;;
  *) printf 'Usage: %s up|status|down\n' "$0" >&2; exit 2 ;;
esac

command -v "${TAILSCALE}" >/dev/null 2>&1 || {
  printf 'Tailscale CLI is not installed.\n' >&2
  exit 2
}

TASK_TAILSCALE_TMP="$(mktemp -d)"
trap 'rm -rf "${TASK_TAILSCALE_TMP}"' EXIT
TASK_STATUS_FILE="${TASK_TAILSCALE_TMP}/status.json"
TASK_SERVE_FILE="${TASK_TAILSCALE_TMP}/serve.json"
TASK_FUNNEL_FILE="${TASK_TAILSCALE_TMP}/funnel.json"

"${TAILSCALE}" status --json > "${TASK_STATUS_FILE}" 2>/dev/null || {
  printf 'Tailscale is not logged in.\n' >&2
  exit 2
}

read_state() {
  "${TAILSCALE}" serve status --json > "${TASK_SERVE_FILE}" 2>/dev/null || printf '{}\n' > "${TASK_SERVE_FILE}"
  funnel_status="available"
  if ! "${TAILSCALE}" funnel status --json > "${TASK_FUNNEL_FILE}" 2>/dev/null; then
    printf '{}\n' > "${TASK_FUNNEL_FILE}"
    funnel_status="unavailable"
  fi

  python3 -c '
import json, sys

def load(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None

status, serve, funnel = map(load, sys.argv[1:4])
https_port = sys.argv[4]
funnel_status = sys.argv[5]
status = status if isinstance(status, dict) else {}
serve = serve if isinstance(serve, dict) else {}
funnel_known = funnel_status == "available" and isinstance(funnel, dict)
funnel = funnel if isinstance(funnel, dict) else {}
hostname = str(status.get("Self", {}).get("DNSName", "")).rstrip(".")
proxy = ""
for address, config in (serve.get("Web") or {}).items():
    address_host, _, address_port = str(address).rpartition(":")
    if address_port != https_port or (hostname and address_host != hostname):
        continue
    hostname = hostname or address_host
    root = (config.get("Handlers") or {}).get("/") or {}
    proxy = root.get("Proxy") or ""
    if isinstance(proxy, dict):
        proxy = proxy.get("URL") or proxy.get("Target") or ""
    break

MAX_FOREGROUND_DEPTH = 16

def funnel_routes_from(config, depth=0, ancestors=frozenset()):
    if depth > MAX_FOREGROUND_DEPTH or not isinstance(config, dict):
        return None
    config_id = id(config)
    if config_id in ancestors:
        return None
    ancestors = ancestors | {config_id}

    allow_funnel = config.get("AllowFunnel")
    if "AllowFunnel" not in config:
        allow_funnel = {}
    elif not isinstance(allow_funnel, dict) or not all(
        isinstance(address, str) and type(enabled) is bool
        for address, enabled in allow_funnel.items()
    ):
        return None
    routes = {str(address) for address, enabled in allow_funnel.items() if enabled is True}

    if "Foreground" not in config:
        return routes
    foreground = config["Foreground"]
    if not isinstance(foreground, dict) or not all(
        isinstance(session, str) and isinstance(nested, dict)
        for session, nested in foreground.items()
    ):
        return None
    for nested in foreground.values():
        nested_routes = funnel_routes_from(nested, depth + 1, ancestors)
        if nested_routes is None:
            return None
        routes.update(nested_routes)
    return routes

funnel_routes = funnel_routes_from(funnel) if funnel_known else None
if funnel_routes is None:
    funnel_known = False
    funnel_routes = set()
app_route = f"{hostname}:{https_port}" if hostname else ""
if not funnel_known:
    funnel_state = "unknown"
elif app_route in funnel_routes:
    funnel_state = "public"
else:
    funnel_state = "private"

print(hostname)
print(proxy)
print(funnel_state)
print(str(bool(funnel_routes - {app_route})).lower())
' "${TASK_STATUS_FILE}" "${TASK_SERVE_FILE}" "${TASK_FUNNEL_FILE}" "${HTTPS_PORT}" "${funnel_status}"
}

https_url() {
  if [[ "${HTTPS_PORT}" == "443" ]]; then
    printf 'https://%s/' "${hostname}"
  else
    printf 'https://%s:%s/' "${hostname}" "${HTTPS_PORT}"
  fi
}

require_private_funnel() {
  case "${funnel_state}" in
    public)
      printf 'Tailscale Serve port %s is public through Tailscale Funnel; refusing to claim tailnet-only access.\n' "${HTTPS_PORT}" >&2
      exit 3
      ;;
    unknown)
      printf 'Funnel status is unavailable for Tailscale Serve port %s; refusing to claim tailnet-only access.\n' "${HTTPS_PORT}" >&2
      exit 3
      ;;
  esac
}

if [[ "${ACTION}" == "up" ]]; then
  health_body="$("${CURL}" -fsS --max-time 5 "${HEALTH_URL}")" || {
    printf 'WebUI health check failed: %s\n' "${HEALTH_URL}" >&2
    exit 4
  }
  if ! printf '%s' "${health_body}" | tr -d '[:space:]' | grep -q '"ok":true'; then
    printf 'WebUI health check failed: %s did not return ok=true.\n' "${HEALTH_URL}" >&2
    exit 4
  fi
fi

mapfile -t state_parts < <(read_state)
hostname="${state_parts[0]:-}"
proxy="${state_parts[1]:-}"
funnel_state="${state_parts[2]:-unknown}"
has_other_funnel="${state_parts[3]:-false}"

if [[ "${ACTION}" == "status" ]]; then
  if [[ -n "${proxy}" ]]; then
    printf 'HTTPS URL: %s\n' "$(https_url)"
    printf 'Target: %s\n' "${proxy}"
  else
    printf 'HTTPS URL: not configured\n'
    printf 'Target: none\n'
  fi
  case "${funnel_state}" in
    public)
      printf 'Access: public (Funnel)\n'
      printf 'Funnel: public on this route\n'
      ;;
    unknown)
      printf 'Access: unknown (Funnel status unavailable)\n'
      printf 'Funnel: unknown\n'
      ;;
    *)
      printf 'Access: tailnet-only\n'
      printf 'Funnel: %s\n' "$([[ "${has_other_funnel}" == "true" ]] && printf 'configured on a separate route' || printf 'off')"
      ;;
  esac
  exit 0
fi

if [[ "${ACTION}" == "down" ]]; then
  if [[ -z "${proxy}" ]]; then
    printf 'ObjectAutoLabel HTTPS is already disabled.\n'
    exit 0
  fi
  if [[ "${proxy}" != "${TARGET}" ]]; then
    printf 'Tailscale Serve port %s is configured for %s; refusing to remove it.\n' "${HTTPS_PORT}" "${proxy}" >&2
    exit 3
  fi
  "${TAILSCALE}" serve --https="${HTTPS_PORT}" off
  printf 'Disabled ObjectAutoLabel HTTPS on port %s.\n' "${HTTPS_PORT}"
  exit 0
fi

require_private_funnel

if [[ -n "${proxy}" && "${proxy}" != "${TARGET}" ]]; then
  printf 'Tailscale Serve port %s is already configured for %s.\n' "${HTTPS_PORT}" "${proxy}" >&2
  exit 3
fi

if [[ -z "${proxy}" ]]; then
  "${TAILSCALE}" serve --bg --https="${HTTPS_PORT}" "${TARGET}"
  mapfile -t state_parts < <(read_state)
  hostname="${state_parts[0]:-}"
  proxy="${state_parts[1]:-}"
  funnel_state="${state_parts[2]:-unknown}"
fi
if [[ "${proxy}" != "${TARGET}" || -z "${hostname}" ]]; then
  printf 'Tailscale Serve verification failed after configuration.\n' >&2
  exit 5
fi
require_private_funnel

printf 'HTTPS URL: %s\n' "$(https_url)"
printf 'Target: %s\n' "${proxy}"
printf 'Access: tailnet-only (no Funnel)\n'
