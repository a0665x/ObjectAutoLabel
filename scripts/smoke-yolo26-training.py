"""Bounded real-checkpoint training acceptance; all outputs use a temporary project."""
import json
from pathlib import Path
import sys
import tempfile

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app.project_services import run_training
from backend.app.runtime_safety import disable_ultralytics_autoinstall

disable_ultralytics_autoinstall()
checkpoint = Path(sys.argv[1]).resolve()
assert checkpoint.is_file(), checkpoint
with tempfile.TemporaryDirectory(prefix="yolo26-training-") as directory:
    root = Path(directory)
    db = connect(root / "test.db")
    initialize_schema(db)
    repo = Repository(db=db, paths=AppPaths(project_root=root))
    project = repo.create_project("YOLO26 acceptance")
    repo.paths.input_model_dir.mkdir(parents=True, exist_ok=True)
    (repo.paths.input_model_dir / "renamed.pt").symlink_to(checkpoint)
    for subset in ("train", "val"):
        images = root / "dataset" / "images" / subset
        labels = root / "dataset" / "labels" / subset
        images.mkdir(parents=True)
        labels.mkdir(parents=True)
        for index in range(2):
            image = np.full((64, 64, 3), 80 + index * 40, np.uint8)
            cv2.rectangle(image, (28, 28), (36, 36), (255, 255, 255), -1)
            cv2.imwrite(str(images / f"{index}.jpg"), image)
            (labels / f"{index}.txt").write_text("0 0.5 0.5 0.125 0.125\n")
    dataset = root / "dataset.yaml"
    dataset.write_text(f"path: {root / 'dataset'}\ntrain: images/train\nval: images/val\nnames: [object]\n")
    split = repo.create_dataset_split_record(project_id=project["id"], name="smoke", train_ratio=.5,
        val_ratio=.5, test_ratio=0, output_dir=str(root / "dataset"), dataset_yaml_path=str(dataset), image_ids_json="{}")
    job = repo.create_job("training", project_id=project["id"], related_type="training_run")
    run = run_training(repo, project["id"], split["id"], "renamed.pt", epochs=1, imgsz=64,
        batch=2, device="cpu", patience=1, optimizer="SGD", lr0=.01, lrf=.01, amp=False, job_id=job["id"])
    contract = run["settings"]["model_contract"]
    metrics = json.loads(run["metrics_json"])
    assert contract["reg_max"] == 1 and contract["end2end"], contract
    assert len(metrics) == 1 and "l1_loss" in metrics[0] and "dfl_loss" not in metrics[0], metrics
    assert Path(run["best_model_path"]).is_file()
    print("PASS real YOLO26 training, persisted contract, L1 metrics, and checkpoint", contract, metrics, flush=True)
    db.close()
