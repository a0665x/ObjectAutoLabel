import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app.workflow import CompositionCreate, assign, create_workflow_router, read_state, save_composition, validate_recipe
from backend.app.project_services import create_dataset_split


@pytest.fixture
def data(tmp_path):
    db = connect(tmp_path / 'test.db')
    initialize_schema(db)
    repo = Repository(db, AppPaths(project_root=tmp_path))
    project = repo.create_project('Workflow', '')
    schema = repo.create_class_schema(project['id'], 'people', [{'class_id': 0, 'class_name': 'person', 'descriptors': ['person']}])
    path = Path(project['root_path']) / 'sources' / 'a.jpg'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'image')
    image = repo.create_image(project['id'], str(path), width=100, height=100)
    annotation = {'class_id': 0, 'class_name': 'person', 'x_center': .5, 'y_center': .5, 'width': .2, 'height': .2}
    repo.replace_image_annotations(image['id'], [annotation], 'pending_review')
    def pseudo(name):
        run = repo.create_pseudo_label_run_record(project_id=project['id'], schema_id=schema['id'], source_asset_id=None, world_model='yolo.pt', output_dir=str(Path(project['root_path']) / 'pseudo_labels' / name), confidence=.2, iou=.7, image_count=1, labeled_count=1, run_name=name)
        repo.assign_pseudo_label_run_to_images(run['id'], [image['id']])
        return run
    first = pseudo('first')
    second = pseudo('second')
    return repo, project['id'], first, second, image


def test_assignment_persists_and_is_project_scoped(data):
    repo, pid, first, second, _ = data
    assign(repo, pid, 'pseudo', first['id'])
    reloaded = Repository(repo.db, repo.paths)
    assert read_state(reloaded, pid)['assignments'] == {'pseudo': first['id']}
    other = repo.create_project('Other', '')
    with pytest.raises(ValueError, match='this project'):
        assign(repo, other['id'], 'pseudo', first['id'])
    assert read_state(repo, other['id'])['assignments'] == {}


def test_composition_saved_assigned_and_cannot_mix_augment_parents(data):
    repo, pid, first, second, image = data
    augment = repo.create_augmentation_run_record(project_id=pid, pseudo_label_run_id=first['id'], name='aug', output_dir='/unused', settings_json='{}', source_image_count=1, created_image_count=1, source_image_ids=[image['id']])
    with pytest.raises(ValueError, match='different lineage'):
        save_composition(repo, pid, CompositionCreate(name='invalid', pseudo_label_run_id=second['id'], augmentation_run_id=augment['id']))
    result = save_composition(repo, pid, CompositionCreate(name='recipe', augmentation_run_id=augment['id']))
    assert result['assignments'] == {'pseudo': first['id'], 'augmentation': augment['id']}
    assert result['composition_id'] == result['compositions'][0]['id']
    assign(repo, pid, 'pseudo', second['id'])
    assert read_state(repo, pid)['assignments'] == {'pseudo': second['id']}
    assert read_state(repo, pid)['composition_id'] is None


def test_deleted_upstream_clears_assignment_and_disables_recipe(data):
    repo, pid, first, _, _ = data
    save_composition(repo, pid, CompositionCreate(name='recipe', pseudo_label_run_id=first['id']))
    repo.db.execute('delete from pseudo_label_runs where id = ?', (first['id'],))
    repo.db.commit()
    state = read_state(repo, pid)
    assert state['assignments'] == {}
    assert state['composition_id'] is None
    assert state['compositions'][0]['reason']


def test_snapshot_preserves_old_pseudo_annotations_for_split(data):
    repo, pid, first, second, image = data
    # Live labels belong to another run and differ from the first snapshot.
    repo.replace_image_annotations(image['id'], [{'class_id': 0, 'class_name': 'person', 'x_center': .5, 'y_center': .5, 'width': .8, 'height': .8}], 'reviewed')
    state = save_composition(repo, pid, CompositionCreate(name='old labels', pseudo_label_run_id=first['id']))
    job = repo.create_job('dataset_split', project_id=pid)
    result = create_dataset_split(repo, pid, 'saved', .8, .1, .1, composition_id=state['composition_id'], job_id=job['id'])
    split = repo.list_dataset_splits(pid)[0]
    labels = list(Path(split['output_dir']).rglob('*.txt'))
    assert len(labels) == 1
    assert '0.200000' in labels[0].read_text()
    assert json.loads(split['composition_json'])['name'] == 'old labels'
    assert result
    from backend.app.project_services import list_dataset_split_samples
    samples = list_dataset_split_samples(repo, pid, split['id'])
    sample = next(item for bucket in samples.values() for item in bucket)
    assert sample['annotations'][0]['width'] == .2


def test_delete_recipe_keeps_saved_split_and_api_validation(data):
    repo, pid, first, _, _ = data
    app = FastAPI()
    app.include_router(create_workflow_router(lambda: repo))
    client = TestClient(app)
    response = client.post(f'/api/projects/{pid}/compositions', json={'name': 'recipe', 'pseudo_label_run_id': first['id']})
    assert response.status_code == 200
    cid = response.json()['composition_id']
    split = repo.create_dataset_split_record(pid, 'retained', .8, .1, .1, '/unused', '/unused/data.yaml', '{}', pseudo_label_run_id=first['id'])
    assert client.delete(f'/api/projects/{pid}/compositions/{cid}').status_code == 200
    assert repo.get_dataset_split(split['id'])
    assert client.put(f'/api/projects/{pid}/workflow-state', json={'stage': 'bad', 'artifact_id': 'none'}).status_code == 409
    assert client.get('/api/projects/missing/workflow-state').status_code == 404


def test_historical_pseudo_pass_through_uses_snapshot(data):
    import cv2
    import numpy as np
    from backend.app.project_services import create_image_augmentation_run
    repo, pid, first, second, image = data
    cv2.imwrite(image['path'], np.zeros((100, 100, 3), dtype=np.uint8))
    repo.replace_image_annotations(image['id'], [{'class_id': 0, 'class_name': 'person', 'x_center': .5, 'y_center': .5, 'width': .8, 'height': .8}], 'reviewed')
    job = repo.create_job('augmentation', project_id=pid)
    create_image_augmentation_run(repo, pid, 'historical', pseudo_label_run_id=first['id'], skip_augment=True, job_id=job['id'])
    generated = [row for row in repo.list_images(pid) if row.get('augmentation_run_id')]
    assert len(generated) == 1
    assert repo.list_annotations(generated[0]['id'])[0]['width'] == .2


def test_outdated_and_incompatible_compositions_rejected(data):
    repo, pid, first, _, image = data
    aug = repo.create_augmentation_run_record(project_id=pid, pseudo_label_run_id=first['id'], name='aug', output_dir='/unused', settings_json='{}', source_image_count=1, created_image_count=1, source_image_ids=[image['id']])
    repo.db.execute('update augmentation_runs set outdated = 1 where id = ?', (aug['id'],))
    repo.db.commit()
    with pytest.raises(ValueError, match='outdated'):
        validate_recipe(repo, pid, {'augmentation_run_id': aug['id']})
    with pytest.raises(ValueError, match='Select'):
        save_composition(repo, pid, CompositionCreate(name='empty'))
