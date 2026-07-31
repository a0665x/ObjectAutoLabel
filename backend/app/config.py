from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def default_project_root() -> Path:
    return Path(os.environ.get("OBJECT_AUTOLABEL_PROJECT_ROOT", PROJECT_ROOT))


@dataclass(frozen=True)
class AppPaths:
    project_root: Path = field(default_factory=default_project_root)

    @property
    def data_dir(self) -> Path:
        return self.project_root / "data"

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "projects"

    @property
    def world_model_dir(self) -> Path:
        return self.project_root / "world_model"

    @property
    def input_model_dir(self) -> Path:
        return self.project_root / "input_model"

    @property
    def output_model_dir(self) -> Path:
        return self.project_root / "output_model"

    @property
    def runs_dir(self) -> Path:
        return self.project_root / "runs"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "object_autolabel.db"


def ensure_runtime_dirs(paths: AppPaths = AppPaths()) -> None:
    for path in (
        paths.data_dir,
        paths.projects_dir,
        paths.world_model_dir,
        paths.input_model_dir,
        paths.output_model_dir,
        paths.runs_dir,
    ):
        path.mkdir(parents=True, exist_ok=True)
