import os
import tempfile
from pathlib import Path


os.environ.setdefault(
    "OBJECT_AUTOLABEL_PROJECT_ROOT",
    str(Path(tempfile.mkdtemp(prefix="object-autolabel-tests-"))),
)
