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


def runtime_env(bin_dir: Path, log_path: Path) -> dict[str, str]:
    return {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_DOCKER_LOG": str(log_path),
        "OBJECT_AUTOLABEL_MODE": "jetson",
        "OBJECT_AUTOLABEL_SKIP_VERIFY": "1",
    }


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


def test_help_uses_public_platform_labels_and_english_commands() -> None:
    result = run_command("./run.sh", "--help")

    assert result.returncode == 0
    assert "x86_64 / amd64" in result.stdout
    assert "Jetson / aarch64" in result.stdout
    assert "--rebuild" in result.stdout


def test_bare_launcher_with_existing_image_only_prints_guidance(
    tmp_path: Path,
) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)

    result = run_command("./run.sh", env=runtime_env(bin_dir, log_path))

    calls = log_path.read_text(encoding="utf-8")
    assert result.returncode == 0
    assert "Existing image:" in result.stdout
    assert "./run.sh --up" in result.stdout
    assert "./run.sh --rebuild" in result.stdout
    assert "compose" not in calls


def test_bare_launcher_builds_and_starts_when_image_is_missing(
    tmp_path: Path,
) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=False)

    result = run_command("./run.sh", env=runtime_env(bin_dir, log_path))

    calls = log_path.read_text(encoding="utf-8")
    assert result.returncode == 0
    assert "compose" in calls
    assert "up -d --build" in calls
    assert "--no-cache" not in calls


def test_up_uses_existing_image_without_build(tmp_path: Path) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)

    result = run_command("./run.sh", "--up", env=runtime_env(bin_dir, log_path))

    calls = log_path.read_text(encoding="utf-8")
    assert result.returncode == 0
    assert "up -d --no-build" in calls
    assert "up -d --build" not in calls


def test_up_fails_with_install_guidance_when_image_is_missing(
    tmp_path: Path,
) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=False)

    result = run_command("./run.sh", "--up", env=runtime_env(bin_dir, log_path))

    assert result.returncode != 0
    assert "Run ./run.sh for first installation." in result.stderr


def test_rebuild_uses_cache_and_starts(tmp_path: Path) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)

    result = run_command(
        "./run.sh",
        "--rebuild",
        env=runtime_env(bin_dir, log_path),
    )

    calls = log_path.read_text(encoding="utf-8")
    assert result.returncode == 0
    assert "up -d --build" in calls
    assert "--no-cache" not in calls


def test_down_up_recreates_without_build(tmp_path: Path) -> None:
    bin_dir, log_path = make_fake_docker(tmp_path, image_exists=True)

    result = run_command(
        "./run.sh",
        "--down_up",
        env=runtime_env(bin_dir, log_path),
    )

    calls = log_path.read_text(encoding="utf-8")
    assert result.returncode == 0
    assert "down" in calls
    assert "up -d --no-build" in calls
    assert "up -d --build" not in calls
