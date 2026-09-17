import importlib
from pathlib import Path
import sys
from contextlib import contextmanager

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

import cv2
import numpy as np
import torch

from backend.app.world_model_adapter import PromptedWorldModel


WORLD_MODEL_DIR = Path("/app/world_model")
MOBILECLIP_PATH = Path("/app/mobileclip2_b.ts")
CLIP_DEFAULT_CACHE_PATH = Path.home() / ".cache" / "clip" / "ViT-B-32.pt"
ADAPTER_CLIP_CACHE_PATH = Path("/app/weights/clip/ViT-B-32.pt")


def select_catalog_weight(model_dir: Path) -> Path:
    checkpoint = model_dir / "yolov8s-worldv2.pt"
    if not checkpoint.is_file():
        raise FileNotFoundError(f"Catalog world-model checkpoint is not installed: {checkpoint}")
    return checkpoint


def adapter_clip_cache_path() -> Path:
    """Pinned Ultralytics supplies a relative `weights/clip` download root."""
    return ADAPTER_CLIP_CACHE_PATH


@contextmanager
def block_clip_network():
    """Make any CLIP cache miss fail rather than silently fetching an encoder."""
    clip_module = importlib.import_module("clip.clip")
    original_urlopen = clip_module.urllib.request.urlopen

    def offline_urlopen(*args, **kwargs):
        raise AssertionError(f"Network access attempted while loading cached CLIP: {args[0] if args else ''}")

    clip_module.urllib.request.urlopen = offline_urlopen
    try:
        yield
    finally:
        clip_module.urllib.request.urlopen = original_urlopen


def verify_clip_offline_cache() -> Path:
    """Load the real cached CLIP checkpoint while its network path is blocked."""
    import clip

    cached_checkpoint = CLIP_DEFAULT_CACHE_PATH
    if not cached_checkpoint.is_file():
        raise FileNotFoundError(f"CLIP cache checkpoint is not installed: {cached_checkpoint}")
    model, _ = clip.load("ViT-B/32", device="cpu")
    del model
    return cached_checkpoint


def main() -> None:
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for world-model smoke acceptance")

    model_dir = WORLD_MODEL_DIR
    mobileclip = MOBILECLIP_PATH
    if not mobileclip.is_file():
        raise FileNotFoundError(f"Prompt encoder is not preinstalled: {mobileclip}")
    adapter_clip_checkpoint = adapter_clip_cache_path()
    if not adapter_clip_checkpoint.is_file():
        raise FileNotFoundError(f"Ultralytics CLIP cache checkpoint is not installed: {adapter_clip_checkpoint}")
    with block_clip_network():
        clip_checkpoint = verify_clip_offline_cache()
        print(f"CLIP offline caches: default={clip_checkpoint} ultralytics={adapter_clip_checkpoint}")
        checkpoints = [select_catalog_weight(model_dir), model_dir / "yoloe-26n-seg.pt"]
        frame = np.zeros((640, 640, 3), dtype=np.uint8)
        cv2.rectangle(frame, (160, 160), (480, 480), (255, 255, 255), -1)
        for checkpoint in checkpoints:
            if not checkpoint.is_file():
                raise FileNotFoundError(checkpoint)
            model = PromptedWorldModel(checkpoint, ["white square"])
            predictions = model.predict(frame, 0.01, 0.7)
            print(
                f"{checkpoint.name}: family={model.family} predictions={len(predictions)} "
                f"device={torch.cuda.get_device_name(0)}"
            )


if __name__ == "__main__":
    main()
