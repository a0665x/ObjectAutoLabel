from __future__ import annotations

import importlib
import os
import sys
from types import ModuleType


def _loaded_module(name: str) -> ModuleType | None:
    module = sys.modules.get(name)
    return module if isinstance(module, ModuleType) else None


def disable_ultralytics_autoinstall() -> None:
    """Disable Ultralytics package installation without importing it implicitly."""
    os.environ["YOLO_AUTOINSTALL"] = "False"
    if "ultralytics" not in sys.modules:
        return

    utils = _loaded_module("ultralytics.utils")
    if utils is None:
        try:
            utils = importlib.import_module("ultralytics.utils")
        except (ImportError, AttributeError):
            return
    utils.AUTOINSTALL = False  # type: ignore[attr-defined]

    checks = _loaded_module("ultralytics.utils.checks")
    if checks is None:
        try:
            checks = importlib.import_module("ultralytics.utils.checks")
        except (ImportError, AttributeError):
            checks = getattr(utils, "checks", None)
    if checks is not None:
        checks.AUTOINSTALL = False  # type: ignore[attr-defined]
