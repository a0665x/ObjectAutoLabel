"""Human-readable provenance derived from saved records, never current defaults."""
from __future__ import annotations

from pathlib import Path
import json
from typing import Any
import yaml

from .repositories import Repository


def compact_training_lineage_label(repo: Repository, run: dict[str, Any]) -> str:
    split = repo.get_dataset_split(run.get("dataset_split_id", "")) or {}
    pseudo = repo.get_pseudo_label_run(split.get("pseudo_label_run_id") or "") or {}
    augmentation = repo.get_augmentation_run(split.get("augmentation_run_id") or "") or {}
    open_data = next(
        (
            item
            for item in repo.list_open_data_imports(run.get("project_id", ""))
            if item["id"] == split.get("open_data_import_id")
        ),
        None,
    )
    pseudo_name = pseudo.get("run_name") or pseudo.get("schema_name") or "All project labels"
    augmentation_name = augmentation.get("name") or "None"
    split_name = split.get("name") or "Unknown split"
    name = run.get("run_name") or f"Train_{run['id'][:8]}"
    lineage = f"[Pseudo · {pseudo_name}] → [Augment · {augmentation_name}]"
    if open_data is not None:
        open_data_name = open_data.get("version_name") or open_data.get("dataset_key") or "linked import"
        lineage += f" + [Open Data · {open_data_name}]"
    return f"{lineage} → [Split · {split_name}] → [Train · {name}]"


def training_label(repo: Repository, run: dict[str, Any], *, include_classes: bool = True) -> str:
    """Detailed saved provenance used outside compact selector labels."""
    split = repo.get_dataset_split(run.get("dataset_split_id", "")) or {}
    pseudo = repo.get_pseudo_label_run(split.get("pseudo_label_run_id") or "") or {}
    schema = repo.get_class_schema(pseudo.get("schema_id") or "") or {}
    classes = ", ".join(item["class_name"] for item in schema.get("classes", []))
    if not classes and split.get("dataset_yaml_path"):
        try:
            saved = yaml.safe_load(Path(split["dataset_yaml_path"]).read_text(encoding="utf-8")) or {}
            names = saved.get("names", [])
            classes = ", ".join(str(name) for name in (names.values() if isinstance(names, dict) else names))
        except (OSError, ValueError, yaml.YAMLError):
            pass
    dataset = str(split.get("name") or "Unknown split")
    if split:
        ratios = "/".join(f"{100 * split.get(key, 0):g}" for key in ("train_ratio", "val_ratio", "test_ratio"))
        dataset += f" [{ratios}]"
    settings = run.get("settings") or {}
    optimizer = settings.get("optimizer") or "Unknown optimizer"
    epochs = settings.get("epochs")
    size = settings.get("imgsz")
    try:
        completed = max((m.get("epoch", 0) for m in json.loads(run.get("metrics_json") or "[]")), default=0)
    except (ValueError, TypeError):
        completed = 0
    epoch_label = f"{completed}/{epochs} epochs" if completed and epochs is not None else f"{epochs} epochs" if epochs is not None else "Epochs unknown"
    name = run.get("run_name") or f"Train_{run['id'][:8]}"
    parts = [classes if include_classes else None, Path(run.get("input_model") or "model").stem,
             str(optimizer), epoch_label, f"img {size}" if size is not None else None,
             dataset, f"{name} [{run['id'][:8]}]"]
    return " · ".join(part for part in parts if part)


def conversion_label(repo: Repository, conversion: dict[str, Any]) -> str:
    run = repo.get_training_run(conversion.get("training_run_id") or "")
    source = training_label(repo, run, include_classes=False) if run else Path(conversion["source_model_path"]).name
    classes = ", ".join(item["name"] for item in conversion.get("schema_snapshot", []))
    formats = ", ".join(f"{a['format'].upper()} {a['precision'].upper()} {a.get('layout', 'NCHW')}" for a in conversion.get("artifacts", []) if a["status"] == "completed")
    return " · ".join(filter(None, [conversion["package_name"], classes or conversion['schema_name'],
                                    source, Path(conversion["source_model_path"]).name if run else None, formats]))


def compact_conversion_lineage_label(repo: Repository, conversion: dict[str, Any]) -> str:
    run = repo.get_training_run(conversion.get("training_run_id") or "")
    source = compact_training_lineage_label(repo, run) if run else f"[Model · {Path(conversion['source_model_path']).name}]"
    formats = ", ".join(f"{a['format'].upper()} {a['precision'].upper()} {a.get('layout', 'NCHW')}" for a in conversion.get("artifacts", []) if a["status"] == "completed")
    label = f"{source} → [Convert · {conversion['package_name']}]"
    return f"{label} · {formats}" if formats else label


def list_conversions(repo: Repository, project_id: str) -> list[dict[str, Any]]:
    return [{**item, "display_label": compact_conversion_lineage_label(repo, item)} for item in repo.list_model_conversion_runs(project_id)]
