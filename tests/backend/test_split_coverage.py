"""Saved membership, frozen batch provenance and bounded thumbnail acceptance."""
import io
import json
from pathlib import Path

import numpy as np
import cv2
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository
from backend.app.project_services import create_dataset_split
from backend.app.workflow import CompositionCreate, save_composition


@pytest.fixture
def split_data(tmp_path):
    repo = Repository(connect(tmp_path / 'test.db'), AppPaths(tmp_path))
    initialize_schema(repo.db)
    project = repo.create_project('Coverage')
    pid = project['id']
    schema = repo.create_class_schema(pid, 'objects', [{'class_id': 0, 'class_name': 'car', 'descriptors': ['car']}])
    annotation = dict(class_id=0, class_name='car', x_center=.5, y_center=.5, width=.4, height=.4)
    branches = []
    originals = []
    for label, count, augment in [('A', 8, False), ('B', 12, True)]:
        source = repo.create_source_asset(pid, 'image_folder', '/raw/' + label)
        root = Path(project['root_path']) / 'sources' / source['id'] / 'images'
        root.mkdir(parents=True)
        pseudo = repo.create_pseudo_label_run_record(project_id=pid, schema_id=schema['id'], source_asset_id=source['id'],
            world_model='fixture.pt', output_dir=str(root.parent / 'pseudo'), confidence=.2, iou=.7,
            image_count=count, labeled_count=count, run_name='Pseudo_' + label)
        rows = []
        for index in range(count):
            path = root / f'frame_{index:04d}.jpg'
            cv2.imwrite(str(path), np.full((480, 640, 3), 100, dtype=np.uint8))
            row = repo.create_image(pid, str(path), source['id'], width=640, height=480)
            repo.replace_image_annotations(row['id'], [annotation], 'pending_review')
            rows.append(row)
        repo.assign_pseudo_label_run_to_images(pseudo['id'], [row['id'] for row in rows])
        originals.extend(rows)
        aug = None
        if augment:
            output = Path(project['root_path']) / 'augmentations' / 'B'
            output.mkdir(parents=True)
            aug = repo.create_augmentation_run_record(project_id=pid, pseudo_label_run_id=pseudo['id'], name='Augment_B',
                output_dir=str(output), settings_json='{}', source_image_count=count, created_image_count=count,
                source_image_ids=[row['id'] for row in rows])
            for index in range(count):
                path = output / f'frame_{index:04d}_aug1.jpg'
                cv2.imwrite(str(path), np.full((480, 640, 3), 150, dtype=np.uint8))
                row = repo.create_image(pid, str(path), source['id'], pseudo_label_run_id=pseudo['id'], augmentation_run_id=aug['id'], width=640, height=480)
                repo.replace_image_annotations(row['id'], [annotation], 'pending_review')
        branches.append({'pseudo_label_run_id': pseudo['id'], 'augmentation_run_id': aug['id'] if aug else None})
    root = Path(project['root_path']) / 'opendata' / 'fixture'
    root.mkdir(parents=True)
    imported_rows = []
    for index in range(6):
        path = root / f'external_{index}.jpg'
        cv2.imwrite(str(path), np.zeros((480, 640, 3), dtype=np.uint8))
        imported_rows.append(dict(path=str(path), split='train' if index < 4 else 'val', source_key=str(index),
            width=640, height=480, annotations=[annotation]))
    job = repo.create_job('open_data', project_id=pid)
    external, _ = repo.replace_active_open_data_import(import_id='external', project_id=pid, dataset_key='fixture',
        version_name='OpenData_A', schema_id=schema['id'], mapping={'car':0}, sample_percentage=100, random_seed=42,
        project_dir=str(root), summary={'source_image_count':6,'eligible_image_count':6,'selected_image_count':6,'selected_annotation_count':6},
        images=imported_rows, job_id=job['id'])
    repo.update_job(job['id'], status='completed')
    state = save_composition(repo, pid, CompositionCreate(name='parallel', branches=branches, open_data_import_id=external['id']))
    job = repo.create_job('dataset_split', project_id=pid)
    split = create_dataset_split(repo, pid, 'coverage', .8, .1, .1, composition_id=state['composition_id'], job_id=job['id'])
    repo.update_job(job['id'], status='completed')
    return repo, pid, split, branches, originals


def test_coverage_reports_exact_membership_and_parallel_groups_without_loading_images(split_data, monkeypatch):
    from backend.app.split_coverage import distribution
    repo, pid, split, branches, _ = split_data
    monkeypatch.setattr(Image, 'open', lambda *_args, **_kwargs: pytest.fail('coverage must not decode thumbnails eagerly'))
    result = distribution(repo, pid, split['id'], bins=7)
    assert result['total'] == 26
    assert result['counts'] == {'train':20, 'valid':4, 'test':2}
    assert result['provenance'] == 'frozen'
    assert len(result['bins']) == 7
    assert sum(sum(item['counts'].values()) for item in result['bins']) == 26
    assert sorted(group['total'] for group in result['groups']) == [6, 8, 12]
    external = next(group for group in result['groups'] if group['kind'] == 'open_data')
    assert external['counts'] == {'train':4, 'valid':2, 'test':0}
    assert next(group for group in result['groups'] if group['augmentation_run_id'])['augmentation_name'] == 'Augment_B'
    assert len(json.dumps(result)) < 12_000


def test_window_and_source_filter_preserve_actual_frozen_membership(split_data):
    from backend.app.split_coverage import distribution
    repo, pid, split, branches, originals = split_data
    before = distribution(repo, pid, split['id'])
    group = next(group for group in before['groups'] if group['pseudo_label_run_id'] == branches[0]['pseudo_label_run_id'])
    filtered = distribution(repo, pid, split['id'], group_id=group['id'], start=0, end=.5)
    assert filtered['total'] == 8
    assert filtered['window']['count'] == 4
    assert sum(filtered['window_counts'].values()) == 4
    # Later assignment/name changes do not rewrite an existing Split's provenance.
    repo.db.execute('update images set pseudo_label_run_id = ? where id = ?', (branches[1]['pseudo_label_run_id'], originals[0]['id']))
    repo.db.execute('update pseudo_label_runs set run_name = ? where id = ?', ('Renamed later', branches[0]['pseudo_label_run_id']))
    repo.db.commit()
    assert distribution(repo, pid, split['id']) == before


def test_thumbnail_uses_saved_copy_and_labels_and_never_creates_cached_images(split_data):
    from backend.app.split_coverage import sample, thumbnail
    repo, pid, split, _, _ = split_data
    root = Path(split['output_dir'])
    before = set(root.rglob('*'))
    selected = sample(repo, pid, split['id'], bucket='train', position=.4)
    blob = thumbnail(repo, pid, split['id'], selected['image_id'])
    image = Image.open(io.BytesIO(blob))
    assert image.format == 'JPEG'
    assert image.width <= 256 and image.height <= 160
    assert len(blob) < 50_000
    assert selected['thumbnail_url'].endswith('/' + selected['image_id'])
    assert set(root.rglob('*')) == before


def test_legacy_coverage_is_read_only_and_foreign_or_unrelated_inputs_are_rejected(split_data):
    from backend.app.split_coverage import distribution, thumbnail
    repo, pid, split, _, originals = split_data
    (Path(split['output_dir']) / 'coverage_manifest.json').unlink()
    result = distribution(repo, pid, split['id'])
    assert result['provenance'] == 'legacy'
    assert result['counts'] == {'train':20,'valid':4,'test':2}
    assert not (Path(split['output_dir']) / 'coverage_manifest.json').exists()
    other = repo.create_project('Other')
    with pytest.raises(FileNotFoundError):
        distribution(repo, other['id'], split['id'])
    with pytest.raises(FileNotFoundError):
        thumbnail(repo, pid, split['id'], originals[-1]['id'])
    with pytest.raises(ValueError):
        distribution(repo, pid, split['id'], start=.8, end=.2)


def test_api_is_project_scoped_validates_windows_and_returns_no_store_thumbnails(split_data, monkeypatch):
    from backend.app import main
    repo, pid, split, _, _ = split_data
    monkeypatch.setattr(main, 'repo', repo)
    client = TestClient(main.app)
    url = f'/api/projects/{pid}/dataset-splits/{split["id"]}'
    response = client.get(url + '/coverage?bins=999')
    assert response.status_code == 422
    assert client.get(url + '/coverage?start=.8&end=.2').status_code == 400
    assert client.get(url + '/coverage?group_id=foreign').status_code == 400
    assert client.get(url.replace(pid, 'missing') + '/coverage').status_code == 404
    selected = client.get(url + '/coverage-sample?bucket=train&position=.9')
    assert selected.status_code == 200
    response = client.get(selected.json()['thumbnail_url'])
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/jpeg'
    assert response.headers['cache-control'] == 'no-store'
    assert client.get(url + '/thumbnail/not-a-member').status_code == 404


def test_thumbnail_rejects_symlink_escape(split_data, tmp_path):
    from backend.app.split_coverage import sample, thumbnail
    repo, pid, split, _, _ = split_data
    selected = sample(repo, pid, split['id'], bucket='train')
    manifest = json.loads((Path(split['output_dir']) / 'image_manifest.json').read_text())
    path = Path(split['output_dir']) / 'train' / 'images' / manifest[selected['image_id']]
    external = tmp_path / 'outside.jpg'
    cv2.imwrite(str(external), np.zeros((100,100,3), np.uint8))
    path.unlink();path.symlink_to(external)
    with pytest.raises(FileNotFoundError):
        thumbnail(repo, pid, split['id'], selected['image_id'])
