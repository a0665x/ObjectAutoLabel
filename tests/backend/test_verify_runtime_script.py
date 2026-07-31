from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VERIFY_SCRIPT = ROOT / "scripts" / "verify-runtime.sh"


def make_fake_commands(
    tmp_path: Path,
    *,
    cuda_output: str,
) -> tuple[Path, Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log_path = tmp_path / "commands.log"

    curl = bin_dir / "curl"
    curl.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"curl $*\" >> \"${FAKE_COMMAND_LOG}\"\n"
        "printf '%s\\n' '{\"ok\":true,\"project_root\":\"/app\"}'\n",
        encoding="utf-8",
    )
    curl.chmod(0o755)

    docker = bin_dir / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"docker $*\" >> \"${FAKE_COMMAND_LOG}\"\n"
        "if [[ \"$1\" == 'inspect' ]]; then\n"
        "  printf '%s\\n' 'object-autolabel:jetson running'\n"
        "  exit 0\n"
        "fi\n"
        "if [[ \"$1\" == 'exec' && \"$*\" == *'find /app/input_model'* ]]; then\n"
        "  printf '%s\\n' '/app/input_model/yolo11n.pt'\n"
        "  exit 0\n"
        "fi\n"
        "if [[ \"$1\" == 'exec' && \"$*\" == *'torch.cuda'* ]]; then\n"
        "  printf '%s\\n' \"${FAKE_CUDA_OUTPUT}\"\n"
        "  if [[ \"${FAKE_CUDA_OUTPUT}\" == *' True '* ]]; then exit 0; fi\n"
        "  exit 3\n"
        "fi\n"
        "if [[ \"$1\" == 'exec' && \"$*\" == *'python3 -'* ]]; then\n"
        "  input=\"$(sed -n '1,260p')\"\n"
        "  printf '%s\\n' \"${input}\" >> \"${FAKE_COMMAND_LOG}\"\n"
        "  printf '%s\\n' 'device=0'\n"
        "  printf '%s\\n' 'save_dir=/tmp/object-autolabel-yolo-cuda-smoke/runs/cuda-smoke'\n"
        "  printf '%s\\n' 'best.pt: OK'\n"
        "  printf '%s\\n' 'last.pt: OK'\n"
        "  exit 0\n"
        "fi\n"
        "exit 0\n",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    return bin_dir, log_path


def run_verify_with_fakes(
    tmp_path: Path,
    *args: str,
    cuda_output: str,
) -> tuple[subprocess.CompletedProcess[str], str]:
    bin_dir, log_path = make_fake_commands(tmp_path, cuda_output=cuda_output)
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{bin_dir}:{env['PATH']}",
            "FAKE_COMMAND_LOG": str(log_path),
            "FAKE_CUDA_OUTPUT": cuda_output,
            "OBJECT_AUTOLABEL_HEALTH_ATTEMPTS": "1",
        }
    )
    result = subprocess.run(
        (str(VERIFY_SCRIPT), *args),
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )
    calls = log_path.read_text(encoding="utf-8") if log_path.exists() else ""
    return result, calls


def test_quick_verification_requires_cuda(tmp_path: Path) -> None:
    result, _ = run_verify_with_fakes(
        tmp_path,
        "--quick",
        "jetson",
        cuda_output="2.8.0 12.6 False unavailable",
    )

    assert result.returncode != 0
    assert "CUDA is not available inside object-autolabel." in result.stderr


def test_quick_verification_reports_health_and_device(tmp_path: Path) -> None:
    result, _ = run_verify_with_fakes(
        tmp_path,
        "--quick",
        "jetson",
        cuda_output="2.8.0 12.6 True Orin",
    )

    assert result.returncode == 0
    assert "API health: OK" in result.stdout
    assert "Container image: object-autolabel:jetson (running)" in result.stdout
    assert "PyTorch: 2.8.0 (CUDA 12.6)" in result.stdout
    assert "CUDA device: Orin" in result.stdout


def test_train_verification_uses_cuda_and_checks_weights(tmp_path: Path) -> None:
    result, calls = run_verify_with_fakes(
        tmp_path,
        "--train",
        "jetson",
        cuda_output="2.8.0 12.6 True Orin",
    )

    assert result.returncode == 0
    assert "device=0" in calls
    assert "amp=False" in calls
    assert "device=\"cpu\"" not in calls
    assert "best.pt: OK" in result.stdout
    assert "last.pt: OK" in result.stdout
    assert "MemAvailable before:" in result.stdout
    assert "MemAvailable after:" in result.stdout


def test_train_verification_does_not_download_missing_weights(
    tmp_path: Path,
) -> None:
    bin_dir, log_path = make_fake_commands(
        tmp_path,
        cuda_output="2.8.0 12.6 True Orin",
    )
    docker = bin_dir / "docker"
    docker.write_text(
        docker.read_text(encoding="utf-8").replace(
            "  printf '%s\\n' '/app/input_model/yolo11n.pt'\n",
            "",
        ),
        encoding="utf-8",
    )
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{bin_dir}:{env['PATH']}",
            "FAKE_COMMAND_LOG": str(log_path),
            "FAKE_CUDA_OUTPUT": "2.8.0 12.6 True Orin",
            "OBJECT_AUTOLABEL_HEALTH_ATTEMPTS": "1",
        }
    )

    result = subprocess.run(
        (str(VERIFY_SCRIPT), "--train", "jetson"),
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )

    assert result.returncode != 0
    assert "Place a compatible .pt model in input_model/." in result.stderr
    calls = log_path.read_text(encoding="utf-8")
    assert "wget" not in calls
    assert "pip install" not in calls
    assert "download" not in calls
