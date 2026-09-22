from pathlib import Path
import hashlib
import os
import subprocess


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "install-input-model.sh"


def _fake_curl(tmp_path: Path, body: str) -> Path:
    executable = tmp_path / "fake-curl"
    executable.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body, encoding="utf-8")
    executable.chmod(0o755)
    return executable


def _run(
    model_dir: Path,
    curl: Path,
    *models: str,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), *models],
        text=True,
        capture_output=True,
        env=os.environ | {"INPUT_MODEL_DIR": str(model_dir), "CURL_BIN": str(curl)} | (env or {}),
        check=False,
    )


def _override(name: str, content: bytes) -> dict[str, str]:
    prefix = name.removesuffix(".pt").upper()
    return {
        f"{prefix}_URL": f"https://example.invalid/{name}",
        f"{prefix}_SHA256": hashlib.sha256(content).hexdigest(),
    }


def test_default_installs_yolo11n_atomically(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf model > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"

    result = _run(model_dir, curl, env=_override("yolo11n.pt", b"model"))

    assert result.returncode == 0
    assert (model_dir / "yolo11n.pt").read_bytes() == b"model"
    assert not list(model_dir.glob(".*.partial.*"))


def test_can_install_both_catalog_models(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf model > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"
    env = _override("yolo11n.pt", b"model") | _override("yolo26n.pt", b"model")

    result = _run(model_dir, curl, "yolo11n.pt", "yolo26n.pt", env=env)

    assert result.returncode == 0
    assert (model_dir / "yolo11n.pt").is_file()
    assert (model_dir / "yolo26n.pt").is_file()


def test_rejects_unknown_model_before_downloading(tmp_path: Path) -> None:
    curl = _fake_curl(tmp_path, "exit 99\n")
    model_dir = tmp_path / "models"

    result = _run(model_dir, curl, "custom.pt")

    assert result.returncode == 2
    assert "Unsupported input model" in result.stderr
    assert not list(model_dir.glob("*"))


def test_rejects_corrupt_existing_model(tmp_path: Path) -> None:
    model_dir = tmp_path / "models"
    model_dir.mkdir()
    (model_dir / "yolo11n.pt").write_bytes(b"corrupt")
    curl = _fake_curl(tmp_path, "exit 99\n")

    result = _run(model_dir, curl)

    assert result.returncode != 0
    assert "SHA-256 mismatch" in result.stderr
    assert (model_dir / "yolo11n.pt").read_bytes() == b"corrupt"


def test_custom_url_requires_explicit_hash(tmp_path: Path) -> None:
    curl = _fake_curl(tmp_path, "exit 99\n")

    result = _run(
        tmp_path / "models",
        curl,
        env={"YOLO11N_URL": "https://example.invalid/yolo11n.pt"},
    )

    assert result.returncode == 2
    assert "YOLO11N_SHA256" in result.stderr


def test_bad_download_is_not_renamed(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf corrupt > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"

    result = _run(model_dir, curl)

    assert result.returncode != 0
    assert "SHA-256 mismatch" in result.stderr
    assert not (model_dir / "yolo11n.pt").exists()
    assert not list(model_dir.glob(".*.partial.*"))
