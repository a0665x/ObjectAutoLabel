from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def run_command(
    *args: str,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    command_env.update(env or {})
    return subprocess.run(
        args,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        env=command_env,
    )


def make_fake_docker(tmp_path: Path, *, image_exists: bool) -> tuple[Path, Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log_path = tmp_path / "docker.log"
    image_status = "0" if image_exists else "1"
    docker = bin_dir / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$*\" >> \"${FAKE_DOCKER_LOG}\"\n"
        "if [[ \"$1 $2\" == 'image inspect' ]]; then\n"
        f"  if [[ '{image_status}' == '0' ]]; then\n"
        "    printf 'sha256:test 2026-07-31T00:00:00Z\\n'\n"
        "    exit 0\n"
        "  fi\n"
        "  exit 1\n"
        "fi\n"
        "if [[ \"$1\" == 'info' ]]; then\n"
        "  printf '{\"nvidia\": {}}\\n'\n"
        "  exit 0\n"
        "fi\n"
        "exit 0\n",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    return bin_dir, log_path


def test_run_sh_supports_desktop_plan_without_starting_docker() -> None:
    result = run_command("./run.sh", "--plan", "desktop")

    assert result.returncode == 0
    assert "Runtime mode: desktop" in result.stdout
    assert "docker-compose.yml" in result.stdout
    assert "docker-compose.jetson.yml" not in result.stdout


def test_run_sh_supports_jetson_plan_without_starting_docker() -> None:
    result = run_command("./run.sh", "--plan", "jetson")

    assert result.returncode == 0
    assert "Runtime mode: jetson" in result.stdout
    assert "docker-compose.jetson.yml" in result.stdout
    assert "WebUI bind host:" in result.stdout
