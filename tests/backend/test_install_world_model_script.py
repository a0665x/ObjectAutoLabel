from pathlib import Path
import hashlib
import os
import subprocess


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "install-world-model.sh"


def _fake_curl(tmp_path: Path, body: str) -> Path:
    executable = tmp_path / "fake-curl"
    executable.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body, encoding="utf-8")
    executable.chmod(0o755)
    return executable


def _run(script: Path, model_dir: Path, curl: Path, *models: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(script), *models],
        text=True,
        capture_output=True,
        env=os.environ | {"WORLD_MODEL_DIR": str(model_dir), "CURL_BIN": str(curl)} | (env or {}),
        check=False,
    )


def _custom_default_env(content: bytes) -> dict[str, str]:
    digest = hashlib.sha256(content).hexdigest()
    return {
        "WORLD_MODEL_URL": "https://example.invalid/yoloe-26n-seg.pt",
        "WORLD_MODEL_SHA256": digest,
        "YOLOE_ENCODER_URL": "https://example.invalid/mobileclip2_b.ts",
        "YOLOE_ENCODER_SHA256": digest,
        "YOLO_WORLD_ENCODER_URL": "https://example.invalid/ViT-B-32.pt",
        "YOLO_WORLD_ENCODER_SHA256": digest,
    }


def test_installs_model_atomically_with_fake_curl(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf model > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"

    result = _run(SCRIPT, model_dir, curl, env=_custom_default_env(b"model"))

    assert result.returncode == 0
    assert (model_dir / "yoloe-26n-seg.pt").read_bytes() == b"model"
    assert (model_dir / "mobileclip2_b.ts").read_bytes() == b"model"
    assert (model_dir / "ViT-B-32.pt").read_bytes() == b"model"
    assert not (model_dir / ".yoloe-26n-seg.pt.partial").exists()
    assert not list(model_dir.glob(".*.partial"))


def test_existing_model_is_a_noop(tmp_path: Path) -> None:
    model_dir = tmp_path / "models"
    model_dir.mkdir()
    (model_dir / "yoloe-26n-seg.pt").write_bytes(b"existing")
    (model_dir / "mobileclip2_b.ts").write_bytes(b"existing")
    (model_dir / "ViT-B-32.pt").write_bytes(b"existing")
    curl = _fake_curl(tmp_path, "exit 99\n")

    result = _run(SCRIPT, model_dir, curl, env=_custom_default_env(b"existing"))

    assert result.returncode == 0
    assert (model_dir / "yoloe-26n-seg.pt").read_bytes() == b"existing"


def test_failed_download_cleans_partial_file(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf partial > "$1"; exit 22; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"

    result = _run(SCRIPT, model_dir, curl)

    assert result.returncode == 22
    assert not (model_dir / "yoloe-26n-seg.pt").exists()
    assert not (model_dir / ".yoloe-26n-seg.pt.partial").exists()
    assert not list(model_dir.glob(".*.partial.*"))


def test_installs_checksum_verified_yolo_world_v2_and_clip_encoder(tmp_path: Path) -> None:
    calls = tmp_path / "curl-calls"
    curl = _fake_curl(
        tmp_path,
        f'''printf '%s\n' "$*" >> "{calls}"
while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf model > "$1"; exit 0; fi; shift; done
''',
    )
    model_dir = tmp_path / "models"

    digest = hashlib.sha256(b"model").hexdigest()
    result = _run(
        SCRIPT,
        model_dir,
        curl,
        "yolov8s-worldv2.pt",
        env={
            "YOLO_WORLD_V2_BASE_URL": "https://example.invalid/worldv2",
            "YOLO_WORLD_V2_SHA256": digest,
            "YOLO_WORLD_ENCODER_URL": "https://example.invalid/ViT-B-32.pt",
            "YOLO_WORLD_ENCODER_SHA256": digest,
        },
    )

    assert result.returncode == 0
    assert (model_dir / "yolov8s-worldv2.pt").is_file()
    assert (model_dir / "ViT-B-32.pt").is_file()
    assert not (model_dir / "mobileclip2_b.ts").exists()
    logged = calls.read_text(encoding="utf-8")
    assert "https://example.invalid/worldv2/yolov8s-worldv2.pt" in logged
    assert not list(model_dir.glob(".*.partial"))


def test_rejects_unknown_model_before_downloading(tmp_path: Path) -> None:
    model_dir = tmp_path / "models"
    curl = _fake_curl(tmp_path, "exit 99\n")

    result = _run(SCRIPT, model_dir, curl, "yolov8n-worldv2.pt")

    assert result.returncode == 2
    assert "Unsupported world model" in result.stderr
    assert not list(model_dir.glob("*"))


def test_rejects_corrupt_existing_assets_instead_of_trusting_nonempty_files(tmp_path: Path) -> None:
    model_dir = tmp_path / "models"
    model_dir.mkdir()
    for name in ("yoloe-26n-seg.pt", "mobileclip2_b.ts", "ViT-B-32.pt"):
        (model_dir / name).write_bytes(b"corrupt")
    curl = _fake_curl(tmp_path, "exit 99\n")

    result = _run(SCRIPT, model_dir, curl)

    assert result.returncode != 0
    assert "SHA-256 mismatch" in result.stderr
    assert (model_dir / "yoloe-26n-seg.pt").read_bytes() == b"corrupt"


def test_rejects_bad_download_before_atomic_rename(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf corrupt > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"

    result = _run(SCRIPT, model_dir, curl)

    assert result.returncode != 0
    assert "SHA-256 mismatch" in result.stderr
    assert not list(model_dir.glob("*.pt"))
    assert not list(model_dir.glob(".*.partial"))
    assert not list(model_dir.glob(".*.partial.*"))


def test_custom_url_requires_explicit_expected_hash(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf custom > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"

    result = _run(
        SCRIPT,
        model_dir,
        curl,
        env={
            "WORLD_MODEL_URL": "https://example.invalid/yoloe-26n-seg.pt",
            "YOLOE_ENCODER_URL": "https://example.invalid/mobileclip2_b.ts",
            "YOLO_WORLD_ENCODER_URL": "https://example.invalid/ViT-B-32.pt",
        },
    )

    assert result.returncode == 2
    assert "WORLD_MODEL_SHA256" in result.stderr


def test_custom_url_rejects_download_that_does_not_match_explicit_hash(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf custom > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"
    expected = "0" * 64

    result = _run(
        SCRIPT,
        model_dir,
        curl,
        env={
            "WORLD_MODEL_URL": "https://example.invalid/yoloe-26n-seg.pt",
            "WORLD_MODEL_SHA256": expected,
            "YOLOE_ENCODER_URL": "https://example.invalid/mobileclip2_b.ts",
            "YOLOE_ENCODER_SHA256": expected,
            "YOLO_WORLD_ENCODER_URL": "https://example.invalid/ViT-B-32.pt",
            "YOLO_WORLD_ENCODER_SHA256": expected,
        },
    )

    assert result.returncode != 0
    assert "SHA-256 mismatch" in result.stderr
    assert not list(model_dir.glob("*.pt"))


def test_custom_url_accepts_uppercase_expected_hash(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf custom > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"

    result = _run(SCRIPT, model_dir, curl, env={key: value.upper() if key.endswith("SHA256") else value for key, value in _custom_default_env(b"custom").items()})

    assert result.returncode == 0
    assert (model_dir / "yoloe-26n-seg.pt").is_file()


def test_install_does_not_follow_predictable_partial_symlink(tmp_path: Path) -> None:
    curl = _fake_curl(
        tmp_path,
        'while [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf model > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"
    model_dir.mkdir()
    victim = tmp_path / "victim"
    victim.write_bytes(b"safe")
    (model_dir / ".yoloe-26n-seg.pt.partial").symlink_to(victim)

    result = _run(SCRIPT, model_dir, curl, env=_custom_default_env(b"model"))

    assert result.returncode == 0
    assert victim.read_bytes() == b"safe"


def test_curl_treats_custom_url_as_an_argument_not_an_option(tmp_path: Path) -> None:
    calls = tmp_path / "calls"
    curl = _fake_curl(
        tmp_path,
        f'printf "%s\\n" "$*" >> "{calls}"\nwhile [[ "$#" -gt 0 ]]; do if [[ "$1" == "--output" ]]; then shift; printf model > "$1"; exit 0; fi; shift; done\n',
    )
    model_dir = tmp_path / "models"
    env = _custom_default_env(b"model") | {"WORLD_MODEL_URL": "-unsafe-url"}

    result = _run(SCRIPT, model_dir, curl, env=env)

    assert result.returncode == 0
    assert " -- -unsafe-url" in calls.read_text(encoding="utf-8")
