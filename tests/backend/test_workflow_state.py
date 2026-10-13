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


def parallel_augment_data(data):
    repo, pid, first, second, image = data
    annotation = repo.list_annotations(image['id'])[0]
    branches = []
    for run in (first, second):
        root = Path(repo.get_project(pid)['root_path']) / 'augmentations' / run['run_name']
        root.mkdir(parents=True, exist_ok=True)
        path = root / 'same-name.jpg'
        path.write_bytes(b'image')
        aug = repo.create_augmentation_run_record(project_id=pid, pseudo_label_run_id=run['id'], name='aug-'+run['run_name'], output_dir=str(root), settings_json='{}', source_image_count=1, created_image_count=1, source_image_ids=[image['id']])
        generated = repo.create_image(pid, str(path), pseudo_label_run_id=run['id'], augmentation_run_id=aug['id'], width=100, height=100)
        repo.replace_image_annotations(generated['id'], [annotation | {'id':None}], 'pending_review')
        branches.append({'pseudo_label_run_id':run['id'], 'augmentation_run_id':aug['id']})
    return branches


def test_parallel_groups_materialize_union_and_secondary_deletion_cascades(data):
    repo, pid, first, second, image = data
    branches = parallel_augment_data(data)
    state = save_composition(repo, pid, CompositionCreate(name='parallel', branches=branches))
    assert state['compositions'][0]['branches'] == branches
    job = repo.create_job('dataset_split', project_id=pid)
    create_dataset_split(repo, pid, 'parallel', .5, .5, 0, composition_id=state['composition_id'], job_id=job['id'])
    repo.update_job(job['id'], status='completed')
    split = repo.list_dataset_splits(pid)[0]
    assert sum(map(len, json.loads(split['image_ids_json']).values())) == 2
    assert len(list(Path(split['output_dir']).rglob('*.txt'))) == 2
    assert json.loads(split['composition_json'])['branches'][1]['pseudo_name'] == 'second'
    assign(repo, pid, 'split', split['id'])
    assert read_state(repo,pid)['composition_id'] == state['composition_id']
    # The second group's dependency must be found even though legacy columns store the first.
    from backend.app.project_services import delete_history_artifact
    delete_history_artifact(repo, pid, 'augmentation', branches[1]['augmentation_run_id'])
    assert repo.get_dataset_split(split['id']) is None
    assert read_state(repo,pid)['compositions'][0]['reason']


def test_parallel_groups_reject_duplicates_empty_foreign_mismatched_and_outdated(data):
    repo, pid, first, second, image = data
    branches = parallel_augment_data(data)
    with pytest.raises(ValueError,match='twice'):
        validate_recipe(repo,pid,{'branches':[branches[0],branches[0]]})
    with pytest.raises(ValueError,match='every source group'):
        validate_recipe(repo,pid,{'branches':[branches[0],{}]})
    with pytest.raises(ValueError,match='different lineage'):
        validate_recipe(repo,pid,{'branches':[branches[0],branches[1] | {'pseudo_label_run_id':first['id']}]})
    other = repo.create_project('Foreign','')
    with pytest.raises(ValueError,match='this project'):
        validate_recipe(repo,other['id'],{'branches':branches})
    repo.db.execute('update augmentation_runs set outdated = 1 where id = ?', (branches[1]['augmentation_run_id'],))
    with pytest.raises(ValueError,match='outdated'):
        validate_recipe(repo,pid,{'branches':branches})


def test_assigned_review_uses_selected_snapshots_counts_histogram_and_save(data):
    from backend.app.project_services import save_image_annotations
    repo, pid, first, second, image = data
    branches = parallel_augment_data(data)
    live = repo.list_annotations(image['id'])[0]
    repo.replace_image_annotations(image['id'],[live | {'width':.8,'height':.8,'confidence':.9}],'reviewed')
    filters = {'pseudo_label_run_id':first['id'],'augmentation_run_id':branches[0]['augmentation_run_id']}
    selected = repo.list_images(pid,**filters)
    assert len(selected)==2
    assert repo.get_review_source_counts(pid,**filters)=={'pseudo':1,'augment':1,'open_data':0}
    assert len(repo.list_images(pid,pseudo_label_run_id='',augmentation_run_id=''))==0
    histogram = repo.get_bbox_histogram(pid,source_groups=['pseudo'],**filters)
    assert histogram[0]['bins'][1]['count']==1  # Saved .2 × .2 box, not live .8 × .8.
    assert repo.review_annotations(image['id'],first['id'])[0]['width']==.2
    position = repo.get_image_position(pid,image['id'],source_groups=['pseudo'],**filters)
    assert position['filtered_total']==1
    result=save_image_annotations(repo,image['id'],[live | {'width':.3}], 'reviewed',pseudo_label_run_id=first['id'])
    assert result['annotations'][0]['width']==.3
    assert repo.review_annotations(image['id'],first['id'])[0]['width']==.3
    assert repo.list_annotations(image['id'])[0]['width']==.8
    assert repo.review_annotations(image['id'],second['id'])[0]['width']==.2
    assert first['id'] in result['label_path']


def test_parallel_groups_add_open_data_once_and_preserve_official_buckets(data):
    repo, pid, first, second, image = data
    branches = parallel_augment_data(data)
    root = Path(repo.get_project(pid)['root_path']) / 'opendata' / 'tiny'
    root.mkdir(parents=True)
    annotation = repo.list_annotations(image['id'])[0]
    source_images = []
    for bucket in ('train','val'):
        path = root / (bucket+'.jpg')
        path.write_bytes(b'image')
        source_images.append({'path':str(path),'split':bucket,'source_key':bucket,'width':100,'height':100,'annotations':[annotation]})
    job = repo.create_job('open_data',project_id=pid)
    schema_id = first['schema_id']
    external,_ = repo.replace_active_open_data_import(import_id='external',project_id=pid,dataset_key='tiny',version_name='External',schema_id=schema_id,mapping={'person':0},sample_percentage=100,random_seed=42,project_dir=str(root),summary={'source_image_count':2,'eligible_image_count':2,'selected_image_count':2,'selected_annotation_count':2},images=source_images,job_id=job['id'])
    repo.update_job(job['id'],status='completed')
    state=save_composition(repo,pid,CompositionCreate(name='with external',branches=branches,open_data_import_id=external['id']))
    split_job=repo.create_job('dataset_split',project_id=pid)
    create_dataset_split(repo,pid,'combined',.5,0,.5,composition_id=state['composition_id'],job_id=split_job['id'])
    split=repo.list_dataset_splits(pid)[0]
    buckets=json.loads(split['image_ids_json'])
    assert sum(map(len,buckets.values()))==4
    assert sorted(map(len,buckets.values()))==[1,1,2]
    for item in repo.list_images(pid,source_groups=['open_data']):
        assert item['id'] in buckets['train' if item['source_split']=='train' else 'valid']
    assert image['id'] not in {iid for ids in buckets.values() for iid in ids}


def test_parallel_group_schema_mismatch_is_rejected(data):
    repo,pid,first,second,image=data
    branches=parallel_augment_data(data)
    schema=repo.create_class_schema(pid,'wrong order',[{'class_id':0,'class_name':'car','descriptors':['car']}])
    repo.db.execute('update pseudo_label_runs set schema_id = ? where id = ?',(schema['id'],second['id']))
    with pytest.raises(ValueError,match='incompatible'):
        validate_recipe(repo,pid,{'branches':branches})


def test_assigned_review_api_keeps_version_scope(data,monkeypatch):
    from backend.app import main
    repo,pid,first,second,image=data
    branches=parallel_augment_data(data)
    monkeypatch.setattr(main,'repo',repo)
    client=TestClient(main.app)
    filters={'pseudo_label_run_id':first['id'],'augmentation_run_id':branches[0]['augmentation_run_id']}
    assert len(client.get(f'/api/projects/{pid}/images',params=filters).json())==2
    assert client.get(f'/api/projects/{pid}/review-source-counts',params=filters).json()['augment']==1
    assert client.get(f'/api/projects/{pid}/bbox-histogram',params=filters).status_code==200
    assert client.get(f'/api/projects/{pid}/image-position',params=filters|{'image_id':image['id']}).json()['filtered_total']==2
    assert client.get(f'/api/images/{image["id"]}/annotations',params={'pseudo_label_run_id':first['id']}).json()['image']['pseudo_label_run_id']==first['id']
    assert client.get(f'/api/images/{image["id"]}/annotations',params={'pseudo_label_run_id':'foreign'}).status_code==409


def test_source_assignment_scopes_generation_and_clears_only_downstream_choices(data):
    repo,pid,first,second,image=data
    source=repo.create_source_asset(pid,'image_folder','/raw/中庄imgs_1012')
    repo.db.execute('update images set source_asset_id = ? where id = ?',(source['id'],image['id']))
    repo.db.execute('update pseudo_label_runs set source_asset_id = ? where id = ?',(source['id'],first['id']))
    repo.db.commit()
    assign(repo,pid,'pseudo',first['id'])
    assert read_state(repo,pid)['assignments']['source']==source['id']
    catalog=read_state(repo,pid)['catalog']['source']
    assert catalog[0]['name']=='中庄imgs_1012' and catalog[0]['count']==1
    # Generated Augment copies never contribute to the Source's original-image count.
    parallel_augment_data(data)
    repo.db.execute('update images set source_asset_id = ? where project_id = ? and augmentation_run_id is not null',(source['id'],pid))
    assert read_state(repo,pid)['catalog']['source'][0]['count']==1
    from backend.app.project_services import analyze_project_sources
    assert analyze_project_sources(repo,pid,source['id'])['image_count']==1
    before=read_state(repo,pid)['assignments']
    assert assign(repo,pid,'source',source['id'])['assignments']==before
    video=repo.create_source_asset(pid,'video','/raw/clip.mp4')
    with pytest.raises(ValueError,match='no registered images'):
        assign(repo,pid,'source',video['id'])
    other=repo.create_project('foreign source','')
    with pytest.raises(ValueError,match='this project'):
        assign(repo,other['id'],'source',source['id'])
    assert read_state(repo,pid)['assignments']['pseudo']==first['id']
    assign(repo,pid,'source',None)
    assert read_state(repo,pid)['assignments']=={}
    assert repo.get_pseudo_label_run(first['id']) is not None


def test_pseudo_api_requires_source_and_freezes_assigned_id(data,monkeypatch):
    from backend.app import main
    repo,pid,first,second,image=data
    repo.paths.world_model_dir.mkdir(exist_ok=True)
    (repo.paths.world_model_dir/'yolov8s-world.pt').write_bytes(b'weights')
    (repo.paths.world_model_dir/'ViT-B-32.pt').write_bytes(b'encoder')
    monkeypatch.setattr(main,'repo',repo)
    calls=[]
    monkeypatch.setattr(main.jobs,'create',lambda *args,**kwargs:calls.append(args) or {'id':'test-job'})
    payload=lambda:main.PseudoLabelRunCreate(schema_id=first['schema_id'],world_model='yolov8s-world.pt')
    from fastapi import HTTPException
    with pytest.raises(HTTPException,match='Assign a Source'):
        main.create_pseudo_label_run(pid,payload())
    assert not calls
    source=repo.create_source_asset(pid,'image_folder','/raw/new-images')
    repo.db.execute('update images set source_asset_id = ? where id = ?',(source['id'],image['id']))
    repo.db.commit()
    assign(repo,pid,'source',source['id'])
    main.create_pseudo_label_run(pid,payload())
    assert calls[0][5]==source['id']
    # The worker received a concrete id; later selection changes cannot redirect it.
    assign(repo,pid,'source',None)
    assert calls[0][5]==source['id']
