from pathlib import Path
import json
import os
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts" / "tailscale-serve.sh"
OWNED = '{"Web":{"agx.example.ts.net:8501":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8501"}}}}}'
UNRELATED = '{"Web":{"agx.example.ts.net:8501":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}}}}'
EXISTING_443 = '{"Web":{"agx.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:5000"}}}}}'
PUBLIC_APP_PORT = (
    '{"Web":{"agx.example.ts.net:8501":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8501"}}}},'
    '"AllowFunnel":{"agx.example.ts.net:8501":true}}'
)
UNRELATED_FUNNEL_PORT = (
    '{"Web":{"agx.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:5000"}}}},'
    '"AllowFunnel":{"agx.example.ts.net:443":true}}'
)
MALFORMED_ALLOW_FUNNEL = [
    None,
    [],
    "true",
    1,
    {"agx.example.ts.net:8501": "true"},
    {"agx.example.ts.net:8501": 1},
    {"agx.example.ts.net:8501": None},
]
NESTED_PUBLIC_APP_PORT = json.dumps(
    {"Foreground": {"session": {"AllowFunnel": {"agx.example.ts.net:8501": True}}}}
)
NESTED_UNRELATED_FUNNEL_PORT = json.dumps(
    {"Foreground": {"session": {"AllowFunnel": {"agx.example.ts.net:443": True}}}}
)
MULTILEVEL_PUBLIC_APP_PORT = json.dumps(
    {
        "Foreground": {
            "session": {"Foreground": {"nested": {"AllowFunnel": {"agx.example.ts.net:8501": True}}}}
        }
    }
)
MALFORMED_FOREGROUND = json.dumps({"Foreground": {"session": None}})
MALFORMED_NESTED_ALLOW_FUNNEL = json.dumps(
    {"Foreground": {"session": {"AllowFunnel": {"agx.example.ts.net:8501": "true"}}}}
)


def nested_foreground(levels: int) -> str:
    config: object = {"AllowFunnel": {"agx.example.ts.net:8501": True}}
    for level in range(levels):
        config = {"Foreground": {f"session-{level}": config}}
    return json.dumps(config)


def _executable(path: Path, body: str) -> Path:
    path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body, encoding="utf-8")
    path.chmod(0o755)
    return path


def run_helper(
    tmp_path: Path,
    action: str,
    *,
    serve_json: str = "{}",
    funnel_json: str = "{}",
    funnel_status_ok: bool = True,
    health_ok: bool = True,
    logged_in: bool = True,
) -> tuple[subprocess.CompletedProcess[str], str]:
    calls = tmp_path / "calls"
    tailscale = _executable(
        tmp_path / "tailscale",
        r'''
printf '%s\n' "$*" >> "$CALLS_FILE"
if [[ "$1" == "status" ]]; then
  [[ "${LOGGED_IN}" == "1" ]] || exit 1
  printf '%s\n' '{"BackendState":"Running","Self":{"DNSName":"agx.example.ts.net."}}'
elif [[ "$1" == "serve" && "${2:-}" == "status" ]]; then
  if grep -q '^serve --bg --https=8501 http://127.0.0.1:8501$' "$CALLS_FILE"; then printf '%s\n' "$OWNED_JSON"; else printf '%s\n' "$SERVE_JSON"; fi
elif [[ "$1" == "funnel" && "${2:-}" == "status" ]]; then
  [[ "${FUNNEL_STATUS_OK}" == "1" ]] || exit 1
  printf '%s\n' "$FUNNEL_JSON"
elif [[ "$1" == "serve" ]]; then
  exit 0
else
  exit 9
fi
''',
    )
    curl = _executable(
        tmp_path / "curl",
        'printf \'%s\\n\' "${HEALTH_BODY}"\n[[ "${HEALTH_OK}" == "1" ]]\n',
    )
    env = os.environ | {
        "TAILSCALE_BIN": str(tailscale),
        "CURL_BIN": str(curl),
        "CALLS_FILE": str(calls),
        "SERVE_JSON": serve_json,
        "OWNED_JSON": OWNED,
        "FUNNEL_JSON": funnel_json,
        "FUNNEL_STATUS_OK": "1" if funnel_status_ok else "0",
        "HEALTH_OK": "1" if health_ok else "0",
        "HEALTH_BODY": '{"ok":true}' if health_ok else '{"ok":false}',
        "LOGGED_IN": "1" if logged_in else "0",
    }
    result = subprocess.run(["bash", str(HELPER), action], text=True, capture_output=True, env=env, check=False)
    return result, calls.read_text(encoding="utf-8") if calls.exists() else ""


def test_up_configures_private_https_after_health(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up")
    assert result.returncode == 0
    assert "serve --bg --https=8501 http://127.0.0.1:8501" in calls
    assert "https://agx.example.ts.net:8501/" in result.stdout
    assert "tailnet-only" in result.stdout
    assert "funnel --bg" not in calls


def test_up_refuses_unrelated_8501_route(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", serve_json=UNRELATED)
    assert result.returncode != 0
    assert "port 8501 is already configured" in result.stderr
    assert "serve --bg" not in calls


def test_down_refuses_to_remove_unrelated_route(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "down", serve_json=UNRELATED)
    assert result.returncode != 0
    assert "serve --https=8501 off" not in calls


def test_existing_443_route_does_not_conflict_with_dedicated_port(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", serve_json=EXISTING_443)
    assert result.returncode == 0
    assert "serve --bg --https=8501 http://127.0.0.1:8501" in calls
    assert "serve --https=443 off" not in calls


def test_owned_up_is_idempotent_and_status_reports_target(tmp_path: Path) -> None:
    up, calls = run_helper(tmp_path, "up", serve_json=OWNED)
    assert up.returncode == 0
    assert "serve --bg" not in calls

    status, _ = run_helper(tmp_path, "status", serve_json=OWNED)
    assert status.returncode == 0
    assert "HTTPS URL: https://agx.example.ts.net:8501/" in status.stdout
    assert "Target: http://127.0.0.1:8501" in status.stdout
    assert "Access: tailnet-only" in status.stdout


def test_owned_down_only_disables_https_8501(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "down", serve_json=OWNED)
    assert result.returncode == 0
    assert "serve --https=8501 off" in calls
    assert "reset" not in calls


def test_status_reports_public_when_funnel_owns_the_app_route(tmp_path: Path) -> None:
    result, _ = run_helper(tmp_path, "status", serve_json=OWNED, funnel_json=PUBLIC_APP_PORT)

    assert result.returncode == 0
    assert "Access: public (Funnel)" in result.stdout
    assert "Funnel: public on this route" in result.stdout


def test_up_refuses_to_claim_private_access_when_funnel_owns_the_app_route(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", serve_json=OWNED, funnel_json=PUBLIC_APP_PORT)

    assert result.returncode != 0
    assert "public through Tailscale Funnel" in result.stderr
    assert "serve --bg --https=8501" not in calls


def test_unrelated_funnel_port_keeps_app_route_private(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", funnel_json=UNRELATED_FUNNEL_PORT)

    assert result.returncode == 0
    assert "Access: tailnet-only (no Funnel)" in result.stdout
    assert "serve --bg --https=8501 http://127.0.0.1:8501" in calls


def test_status_reports_unknown_when_funnel_query_fails(tmp_path: Path) -> None:
    result, _ = run_helper(tmp_path, "status", serve_json=OWNED, funnel_status_ok=False)

    assert result.returncode == 0
    assert "Access: unknown (Funnel status unavailable)" in result.stdout
    assert "Funnel: unknown" in result.stdout


def test_up_refuses_when_funnel_status_is_unknown(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", funnel_status_ok=False)

    assert result.returncode != 0
    assert "Funnel status is unavailable" in result.stderr
    assert "serve --bg --https=8501" not in calls


def test_up_refuses_when_funnel_status_json_is_unreadable(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", funnel_json="not-json")

    assert result.returncode != 0
    assert "Funnel status is unavailable" in result.stderr
    assert "serve --bg --https=8501" not in calls


@pytest.mark.parametrize("allow_funnel", MALFORMED_ALLOW_FUNNEL)
def test_status_reports_unknown_for_malformed_allow_funnel_schema(tmp_path: Path, allow_funnel: object) -> None:
    result, _ = run_helper(tmp_path, "status", funnel_json=json.dumps({"AllowFunnel": allow_funnel}))

    assert result.returncode == 0
    assert "Access: unknown (Funnel status unavailable)" in result.stdout
    assert "Funnel: unknown" in result.stdout


@pytest.mark.parametrize("allow_funnel", MALFORMED_ALLOW_FUNNEL)
def test_up_refuses_for_malformed_allow_funnel_schema(tmp_path: Path, allow_funnel: object) -> None:
    result, calls = run_helper(tmp_path, "up", funnel_json=json.dumps({"AllowFunnel": allow_funnel}))

    assert result.returncode != 0
    assert "Funnel status is unavailable" in result.stderr
    assert "serve --bg --https=8501" not in calls


def test_status_reports_nested_public_funnel_for_the_app_route(tmp_path: Path) -> None:
    result, _ = run_helper(tmp_path, "status", serve_json=OWNED, funnel_json=NESTED_PUBLIC_APP_PORT)

    assert result.returncode == 0
    assert "Access: public (Funnel)" in result.stdout


def test_up_refuses_nested_public_funnel_for_the_app_route(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", serve_json=OWNED, funnel_json=NESTED_PUBLIC_APP_PORT)

    assert result.returncode != 0
    assert "public through Tailscale Funnel" in result.stderr
    assert "serve --bg --https=8501" not in calls


def test_status_keeps_app_route_private_for_nested_unrelated_funnel(tmp_path: Path) -> None:
    result, _ = run_helper(tmp_path, "status", funnel_json=NESTED_UNRELATED_FUNNEL_PORT)

    assert result.returncode == 0
    assert "Access: tailnet-only" in result.stdout
    assert "Funnel: configured on a separate route" in result.stdout


def test_up_allows_nested_unrelated_funnel_port(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", funnel_json=NESTED_UNRELATED_FUNNEL_PORT)

    assert result.returncode == 0
    assert "serve --bg --https=8501 http://127.0.0.1:8501" in calls


def test_status_reports_unknown_for_malformed_nested_foreground(tmp_path: Path) -> None:
    result, _ = run_helper(tmp_path, "status", funnel_json=MALFORMED_FOREGROUND)

    assert result.returncode == 0
    assert "Access: unknown (Funnel status unavailable)" in result.stdout


def test_up_refuses_malformed_nested_foreground(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", funnel_json=MALFORMED_FOREGROUND)

    assert result.returncode != 0
    assert "Funnel status is unavailable" in result.stderr
    assert "serve --bg --https=8501" not in calls


def test_status_reports_unknown_for_malformed_nested_allow_funnel(tmp_path: Path) -> None:
    result, _ = run_helper(tmp_path, "status", funnel_json=MALFORMED_NESTED_ALLOW_FUNNEL)

    assert result.returncode == 0
    assert "Access: unknown (Funnel status unavailable)" in result.stdout


def test_up_refuses_malformed_nested_allow_funnel(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", funnel_json=MALFORMED_NESTED_ALLOW_FUNNEL)

    assert result.returncode != 0
    assert "Funnel status is unavailable" in result.stderr
    assert "serve --bg --https=8501" not in calls


def test_status_reports_multilevel_nested_public_funnel(tmp_path: Path) -> None:
    result, _ = run_helper(tmp_path, "status", serve_json=OWNED, funnel_json=MULTILEVEL_PUBLIC_APP_PORT)

    assert result.returncode == 0
    assert "Access: public (Funnel)" in result.stdout


def test_up_refuses_multilevel_nested_public_funnel(tmp_path: Path) -> None:
    result, calls = run_helper(tmp_path, "up", serve_json=OWNED, funnel_json=MULTILEVEL_PUBLIC_APP_PORT)

    assert result.returncode != 0
    assert "public through Tailscale Funnel" in result.stderr
    assert "serve --bg --https=8501" not in calls


def test_deep_nested_foreground_is_unknown_and_up_refuses(tmp_path: Path) -> None:
    funnel_json = nested_foreground(33)
    status, _ = run_helper(tmp_path, "status", funnel_json=funnel_json)
    up, calls = run_helper(tmp_path, "up", funnel_json=funnel_json)

    assert status.returncode == 0
    assert "Access: unknown (Funnel status unavailable)" in status.stdout
    assert up.returncode != 0
    assert "Funnel status is unavailable" in up.stderr
    assert "serve --bg --https=8501" not in calls


def test_up_rejects_unhealthy_webui_but_ignores_other_funnel_ports(tmp_path: Path) -> None:
    unhealthy, calls = run_helper(tmp_path, "up", health_ok=False)
    assert unhealthy.returncode != 0
    assert "WebUI health check failed" in unhealthy.stderr
    assert "serve status" not in calls

    funnel, calls = run_helper(tmp_path, "up", funnel_json='{"Web":{"agx.example.ts.net:443":{}}}')
    assert funnel.returncode == 0
    assert "serve --bg --https=8501" in calls


def test_missing_cli_and_logged_out_are_reported(tmp_path: Path) -> None:
    missing = subprocess.run(
        ["bash", str(HELPER), "status"],
        text=True,
        capture_output=True,
        env=os.environ | {"TAILSCALE_BIN": str(tmp_path / "missing")},
        check=False,
    )
    assert missing.returncode == 2
    assert "not installed" in missing.stderr

    logged_out, _ = run_helper(tmp_path, "status", logged_in=False)
    assert logged_out.returncode == 2
    assert "not logged in" in logged_out.stderr
