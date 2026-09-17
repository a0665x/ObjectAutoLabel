from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "smoke-world-models.py"


def _load_script():
    spec = spec_from_file_location("smoke_world_models", SCRIPT)
    assert spec and spec.loader
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_selects_catalog_world_v2_weight_and_both_images_expose_real_clip_cache(tmp_path: Path) -> None:
    (tmp_path / "yolov8s-worldv2.pt").write_bytes(b"small")
    (tmp_path / "yoloe-26n-seg.pt").write_bytes(b"yoloe")

    module = _load_script()

    assert str(module.APP_ROOT) in sys.path
    assert module.select_catalog_weight(tmp_path).name == "yolov8s-worldv2.pt"
    assert module.adapter_clip_cache_path() == Path("/app/weights/clip/ViT-B-32.pt")
    for name in ("Dockerfile", "Dockerfile.jetson"):
        dockerfile = (ROOT / name).read_text(encoding="utf-8")
        assert "COPY scripts/smoke-world-models.py /app/scripts/smoke-world-models.py" in dockerfile
        assert "ln -s /app/world_model/mobileclip2_b.ts /app/mobileclip2_b.ts" in dockerfile
        assert "ln -s /app/world_model/ViT-B-32.pt /app/weights/clip/ViT-B-32.pt" in dockerfile
        assert "ln -s /app/world_model/ViT-B-32.pt /root/.cache/clip/ViT-B-32.pt" in dockerfile


def test_smoke_blocks_clip_network_through_direct_load_and_both_adapter_invocations(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    module = _load_script()
    model_dir = tmp_path / "world_model"
    model_dir.mkdir()
    for name in ("yolov8s-worldv2.pt", "yoloe-26n-seg.pt", "mobileclip2_b.ts", "ViT-B-32.pt"):
        (model_dir / name).write_bytes(b"asset")
    direct_cache = tmp_path / "root-cache" / "ViT-B-32.pt"
    direct_cache.parent.mkdir()
    direct_cache.write_bytes(b"clip")
    adapter_cache = tmp_path / "adapter-cache" / "ViT-B-32.pt"
    adapter_cache.parent.mkdir()
    adapter_cache.write_bytes(b"clip")

    original_urlopen = lambda *_args, **_kwargs: None
    clip_impl = ModuleType("clip.clip")
    clip_impl.urllib = SimpleNamespace(request=SimpleNamespace(urlopen=original_urlopen))
    clip = ModuleType("clip")
    phases: list[str] = []

    def require_blocked(phase: str) -> None:
        phases.append(phase)
        assert clip_impl.urllib.request.urlopen is not original_urlopen
        with pytest.raises(AssertionError, match="Network access attempted"):
            clip_impl.urllib.request.urlopen("https://example.invalid/clip")

    def fake_load(name: str, device: str):
        assert (name, device) == ("ViT-B/32", "cpu")
        require_blocked("direct")
        return object(), None

    class FakePromptedWorldModel:
        def __init__(self, checkpoint: Path, prompts: list[str]) -> None:
            assert prompts == ["white square"]
            require_blocked(checkpoint.name)
            self.family = "yoloe-26" if checkpoint.name.startswith("yoloe") else "yolo-world-v2"

        def predict(self, frame, confidence: float, iou: float):
            assert frame == "frame"
            assert (confidence, iou) == (0.01, 0.7)
            return []

    clip.load = fake_load
    monkeypatch.setitem(sys.modules, "clip", clip)
    monkeypatch.setitem(sys.modules, "clip.clip", clip_impl)
    monkeypatch.setattr(module, "WORLD_MODEL_DIR", model_dir)
    monkeypatch.setattr(module, "MOBILECLIP_PATH", model_dir / "mobileclip2_b.ts")
    monkeypatch.setattr(module, "CLIP_DEFAULT_CACHE_PATH", direct_cache)
    monkeypatch.setattr(module, "ADAPTER_CLIP_CACHE_PATH", adapter_cache)
    monkeypatch.setattr(module, "PromptedWorldModel", FakePromptedWorldModel)
    monkeypatch.setattr(module, "np", SimpleNamespace(zeros=lambda *_args, **_kwargs: "frame", uint8=object()))
    monkeypatch.setattr(module, "cv2", SimpleNamespace(rectangle=lambda *_args, **_kwargs: None))
    monkeypatch.setattr(module, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, get_device_name=lambda _: "fake-gpu")))

    module.main()

    assert phases == ["direct", "yolov8s-worldv2.pt", "yoloe-26n-seg.pt"]
    assert clip_impl.urllib.request.urlopen is original_urlopen
