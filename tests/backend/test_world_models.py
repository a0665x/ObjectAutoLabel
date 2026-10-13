from pathlib import Path
from datetime import datetime
import sys
import types

import numpy as np
import pytest

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app.world_models import _schema_prompts, resolve_world_model, run_yolo_world_pseudo_label


def test_schema_prompts_keep_descriptor_to_target_class_mapping() -> None:
    prompts, mappings = _schema_prompts(
        {
            "classes": [
                {"class_id": 4, "class_name": "screw", "descriptors": ["tiny screw", "black screw"]},
                {"class_id": 7, "class_name": "washer", "descriptors": []},
            ]
        }
    )

    assert prompts == ["tiny screw", "black screw", "washer"]
    assert mappings == [
        {"class_id": 4, "class_name": "screw", "source_descriptor": "tiny screw"},
        {"class_id": 4, "class_name": "screw", "source_descriptor": "black screw"},
        {"class_id": 7, "class_name": "washer", "source_descriptor": "washer"},
    ]


def test_resolve_world_model_uses_world_model_folder(tmp_path: Path) -> None:
    paths = AppPaths(project_root=tmp_path)
    with connect(tmp_path / "db.sqlite") as db:
        initialize_schema(db)
        repo = Repository(db=db, paths=paths)

        assert resolve_world_model(repo, "yolov8s-world.pt") == tmp_path / "world_model" / "yolov8s-world.pt"


def _pseudo_repo(tmp_path: Path) -> tuple[Repository, dict, dict, dict]:
    paths = AppPaths(project_root=tmp_path)
    paths.world_model_dir.mkdir(parents=True, exist_ok=True)
    db = connect(tmp_path / "db.sqlite")
    initialize_schema(db)
    repo = Repository(db=db, paths=paths)
    project = repo.create_project("YOLOE")
    schema = repo.create_class_schema(
        project["id"],
        "hardware",
        [{"class_id": 7, "class_name": "washer", "descriptors": ["flat washer"]}],
    )
    image = repo.create_image(project["id"], str(tmp_path / "sample.jpg"), width=64, height=64)
    job = repo.create_job("pseudo_label", project_id=project["id"])
    return repo, project, schema, image | {"job_id": job["id"]}


def test_yoloe_pseudo_labels_persist_bbox_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo, project, schema, image = _pseudo_repo(tmp_path)
    (repo.paths.world_model_dir / "yoloe-26n-seg.pt").write_bytes(b"weights")

    class FakePromptedWorldModel:
        def __init__(self, checkpoint: Path, prompts: list[str]) -> None:
            assert checkpoint.name == "yoloe-26n-seg.pt"
            assert prompts == ["flat washer"]

        def predict(self, frame: np.ndarray, confidence: float, iou: float) -> list[dict]:
            return [{"xyxy": [10.0, 20.0, 30.0, 40.0], "prompt_class_id": 0, "confidence": 0.9}]

    monkeypatch.setattr("backend.app.world_models.PromptedWorldModel", FakePromptedWorldModel)
    monkeypatch.setattr("backend.app.world_models._draw_preview", lambda *args: None)
    monkeypatch.setitem(sys.modules, "cv2", types.SimpleNamespace(imread=lambda path: np.zeros((64, 64, 3))))

    run = run_yolo_world_pseudo_label(
        repo,
        project["id"],
        schema["id"],
        None,
        "yoloe-26n-seg.pt",
        0.25,
        0.7,
        job_id=image["job_id"],
    )

    assert run["run_name"] == f"Pseudo_{datetime.now().strftime('%m%d')}_v001"

    annotation = repo.list_annotations(image["id"])[0]
    assert {key: annotation[key] for key in (
        "class_id", "class_name", "x_center", "y_center", "width", "height",
        "confidence", "source_descriptor", "source_type", "edited",
    )} == {
        "class_id": 7,
        "class_name": "washer",
        "x_center": 0.3125,
        "y_center": 0.46875,
        "width": 0.3125,
        "height": 0.3125,
        "confidence": 0.9,
        "source_descriptor": "flat washer",
        "source_type": "pseudo",
        "edited": False,
    }
    assert "mask" not in annotation
    assert "segments" not in annotation


def test_unsupported_checkpoint_fails_with_filename(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo, project, schema, image = _pseudo_repo(tmp_path)
    (repo.paths.world_model_dir / "mystery.pt").write_bytes(b"weights")
    monkeypatch.setitem(sys.modules, "cv2", types.SimpleNamespace(imread=lambda path: pytest.fail("no image iteration")))

    with pytest.raises(RuntimeError, match=r"mystery\.pt \(unknown\) failed"):
        run_yolo_world_pseudo_label(
            repo,
            project["id"],
            schema["id"],
            None,
            "mystery.pt",
            0.25,
            0.7,
            job_id=image["job_id"],
        )


def test_selected_source_leaves_other_sources_and_their_labels_untouched(tmp_path,monkeypatch):
    repo,project,schema,image=_pseudo_repo(tmp_path)
    old_source=repo.create_source_asset(project['id'],'image_folder','/raw/old')
    new_source=repo.create_source_asset(project['id'],'image_folder','/raw/中庄imgs_1012')
    repo.db.execute('update images set source_asset_id = ? where id = ?',(old_source['id'],image['id']))
    existing={'class_id':7,'class_name':'washer','x_center':.5,'y_center':.5,'width':.2,'height':.2}
    repo.replace_image_annotations(image['id'],[existing],'reviewed')
    retained=repo.list_annotations(image['id'])
    new_image=repo.create_image(project['id'],str(tmp_path/'new.jpg'),source_asset_id=new_source['id'],width=64,height=64)
    (repo.paths.world_model_dir/'yoloe-26n-seg.pt').write_bytes(b'weights')
    class Model:
        def __init__(self,*args):pass
        def predict(self,*args):return [{'xyxy':[10.,20.,30.,40.],'prompt_class_id':0,'confidence':.9}]
    monkeypatch.setattr('backend.app.world_models.PromptedWorldModel',Model)
    monkeypatch.setattr('backend.app.world_models._draw_preview',lambda *args:None)
    processed=[]
    monkeypatch.setitem(sys.modules,'cv2',types.SimpleNamespace(imread=lambda path:processed.append(path) or np.zeros((64,64,3))))
    run=run_yolo_world_pseudo_label(repo,project['id'],schema['id'],new_source['id'],'yoloe-26n-seg.pt',.25,.7,job_id=image['job_id'])
    assert processed==[new_image['path'],new_image['path']]  # inference then filtered-preview pass
    assert run['image_count']==1 and run['source_asset_id']==new_source['id']
    assert repo.list_annotations(image['id'])==retained
    assert repo.get_image(image['id'])['pseudo_label_run_id'] is None
    assert repo.get_image(new_image['id'])['pseudo_label_run_id']==run['id']


@pytest.mark.parametrize('enabled,ratio,expected,filtered',[(False,1/3,4,0),(True,1/3,3,1),(True,.05,0,4)])
def test_large_box_filter_is_optional_strict_and_persisted(tmp_path,monkeypatch,enabled,ratio,expected,filtered):
    repo,project,schema,image=_pseudo_repo(tmp_path)
    (repo.paths.world_model_dir/'yoloe-26n-seg.pt').write_bytes(b'weights')
    class Model:
        def __init__(self,*args):pass
        def predict(self,*args):return [
            {'xyxy':[0.,0.,64.,64.],'prompt_class_id':0,'confidence':.99},
            {'xyxy':[0.,0.,64.,64/3],'prompt_class_id':0,'confidence':.9},
            {'xyxy':[8.,8.,24.,24.],'prompt_class_id':0,'confidence':.8},
            {'xyxy':[8.,8.,24.,24.],'prompt_class_id':0,'confidence':.7},
        ]
    monkeypatch.setattr('backend.app.world_models.PromptedWorldModel',Model)
    monkeypatch.setattr('backend.app.world_models._draw_preview',lambda *args:None)
    monkeypatch.setitem(sys.modules,'cv2',types.SimpleNamespace(imread=lambda path:np.zeros((64,64,3))))
    run=run_yolo_world_pseudo_label(repo,project['id'],schema['id'],None,'yoloe-26n-seg.pt',.25,.7,job_id=image['job_id'],filter_large_boxes=enabled,max_box_area_ratio=ratio)
    assert len(repo.list_annotations(image['id']))==expected
    assert run['filtered_box_count']==filtered
    assert run['max_box_area_ratio']==ratio and bool(run['filter_large_boxes'])==enabled
    assert run['labeled_count']==int(expected>0)
    assert repo.get_image(image['id']) is not None
    snapshot=repo.review_annotations(image['id'],run['id'])
    assert len(snapshot)==expected


def test_large_box_filter_does_not_count_merge_removals(tmp_path,monkeypatch):
    repo,project,schema,image=_pseudo_repo(tmp_path)
    (repo.paths.world_model_dir/'yoloe-26n-seg.pt').write_bytes(b'weights')
    class Model:
        def __init__(self,*args):pass
        def predict(self,*args):return [
            {'xyxy':[0.,0.,64.,64.],'prompt_class_id':0,'confidence':.99},
            {'xyxy':[8.,8.,24.,24.],'prompt_class_id':0,'confidence':.8},
            {'xyxy':[8.,8.,24.,24.],'prompt_class_id':0,'confidence':.7},
        ]
    monkeypatch.setattr('backend.app.world_models.PromptedWorldModel',Model)
    monkeypatch.setattr('backend.app.world_models._draw_preview',lambda *args:None)
    monkeypatch.setitem(sys.modules,'cv2',types.SimpleNamespace(imread=lambda path:np.zeros((64,64,3))))
    run=run_yolo_world_pseudo_label(repo,project['id'],schema['id'],None,'yoloe-26n-seg.pt',.25,.7,merge_boxes=True,job_id=image['job_id'],filter_large_boxes=True)
    assert run['raw_detection_count']==3
    assert run['merged_detection_count']==1 and run['filtered_box_count']==1
    assert len(repo.list_annotations(image['id']))==1


@pytest.mark.parametrize('mode,lower,upper,expected', [('auto',0,1/3,4),('manual',.005,.02,3)])
def test_area_filter_uses_current_run_modes_or_inclusive_manual_range(tmp_path,monkeypatch,mode,lower,upper,expected):
    import json
    repo,project,schema,image=_pseudo_repo(tmp_path)
    (repo.paths.world_model_dir/'yoloe-26n-seg.pt').write_bytes(b'weights')
    class Model:
        def __init__(self,*args):pass
        def predict(self,*args):return [
            {'xyxy':[0,0,size,size],'prompt_class_id':0,'confidence':.9}
            for size in [2,8,8,8,50,50,50,50,50]
        ]
    monkeypatch.setattr('backend.app.world_models.PromptedWorldModel',Model)
    monkeypatch.setattr('backend.app.world_models._draw_preview',lambda *args:None)
    monkeypatch.setitem(sys.modules,'cv2',types.SimpleNamespace(imread=lambda path:np.zeros((64,64,3))))
    run=run_yolo_world_pseudo_label(repo,project['id'],schema['id'],None,'yoloe-26n-seg.pt',.25,.7,job_id=image['job_id'],filter_large_boxes=True,area_filter_mode=mode,min_box_area_ratio=lower,max_box_area_ratio=upper)
    assert len(repo.list_annotations(image['id']))==expected
    assert run['filtered_box_count']==9-expected
    stats=json.loads(run['area_histogram_json'])
    assert stats['box_count']==9 and stats['pre_filter']
    if mode=='auto':assert run['max_box_area_ratio']==stats['suggested_max']
    assert not (Path(run['output_dir'])/'_candidates').exists()
