"""Persisted project assignments and reusable, validated dataset recipes."""
from __future__ import annotations

import json
from typing import Any, Callable

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .db import transaction
from .repositories import Repository, new_id, utc_now

TABLES = {
    'pseudo': 'pseudo_label_runs', 'augmentation': 'augmentation_runs',
    'open_data': 'open_data_imports', 'split': 'dataset_splits',
    'training': 'training_runs', 'conversion': 'model_conversion_runs',
}
FIELDS = {'pseudo': 'pseudo_label_run_id', 'augmentation': 'augmentation_run_id', 'open_data': 'open_data_import_id'}


class Assignment(BaseModel):
    stage: str
    artifact_id: str | None = None


class CompositionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    pseudo_label_run_id: str | None = None
    augmentation_run_id: str | None = None
    open_data_import_id: str | None = None


def artifact(repo: Repository, project_id: str, stage: str, artifact_id: str) -> dict[str, Any]:
    if stage not in TABLES:
        raise ValueError('Unknown workflow stage')
    row = repo.db.execute(f'select * from {TABLES[stage]} where project_id = ? and id = ?', (project_id, artifact_id)).fetchone()
    if row is None:
        raise ValueError(f'{stage} version is no longer available in this project')
    row = dict(row)
    if row.get('outdated'):
        raise ValueError(f'{stage} version is outdated; rebuild it before assigning')
    if row.get('status') in ('queued', 'running', 'cancel_requested', 'failed', 'cancelled'):
        raise ValueError(f'{stage} version is not complete')
    if row.get('job_id'):
        job = repo.get_job(row['job_id'])
        if job and job['status'] != 'completed':
            raise ValueError(f'{stage} version is not complete')
    return row


def validate_recipe(repo: Repository, project_id: str, recipe: dict[str, Any]) -> dict[str, Any]:
    result = {field: recipe.get(field) or None for field in FIELDS.values()}
    rows = {stage: artifact(repo, project_id, stage, result[field]) for stage, field in FIELDS.items() if result[field]}
    augment = rows.get('augmentation')
    if augment:
        parent = augment.get('pseudo_label_run_id')
        if result['pseudo_label_run_id'] and result['pseudo_label_run_id'] != parent:
            raise ValueError('Augment and Pseudo versions have different lineage')
        result['pseudo_label_run_id'] = parent
        if parent:
            rows['pseudo'] = artifact(repo, project_id, 'pseudo', parent)
    if not augment and result['pseudo_label_run_id']:
        retained = repo.pseudo_build_images(project_id, result['pseudo_label_run_id'])
        if not retained:
            raise ValueError('This legacy Pseudo version has no retained original labels; select its saved Augment build or regenerate Pseudo')
    if not any(result.values()):
        raise ValueError('Select a Pseudo, Augment or Open Data version')
    schema_ids = [row['schema_id'] for row in rows.values() if row.get('schema_id')]
    schemas = [repo.db.execute('select distinct class_id, class_name from class_descriptors where schema_id = ? order by class_id', (sid,)).fetchall() for sid in schema_ids]
    if schemas and any([tuple(r) for r in schema] != [tuple(r) for r in schemas[0]] for schema in schemas[1:]):
        raise ValueError('Selected versions use incompatible class schemas')
    return result


def catalog(repo: Repository, project_id: str) -> dict[str, list[dict[str, Any]]]:
    output = {}
    for stage, table in TABLES.items():
        items = []
        for row in repo.db.execute(f'select * from {table} where project_id = ? order by created_at desc', (project_id,)).fetchall():
            row = dict(row)
            reason = ''
            try:
                artifact(repo, project_id, stage, row['id'])
            except ValueError as exc:
                reason = str(exc)
            count = row.get('labeled_count', row.get('created_image_count', row.get('selected_image_count', 0)))
            if stage == 'split':
                count = sum(len(ids) for ids in json.loads(row.get('image_ids_json') or '{}').values())
            details = json.loads(row.get('settings_json') or '{}')
            if stage == 'pseudo':
                details = {key: row.get(key) for key in ('world_model', 'confidence', 'iou', 'schema_id')}
            if stage == 'open_data':
                details = {key: row.get(key) for key in ('dataset_key', 'sample_percentage', 'seed', 'schema_id')}
            if stage == 'split':
                details = {key: row.get(key) for key in ('train_ratio', 'val_ratio', 'test_ratio')}
            items.append({'id': row['id'], 'name': row.get('run_name') or row.get('name') or row.get('version_name') or row.get('package_name') or row['id'][:8], 'count': count or 0, 'settings': details, 'reason': reason, 'parent_id': row.get('pseudo_label_run_id') if stage == 'augmentation' else row.get('dataset_split_id'), 'created_at': row['created_at']})
        output[stage] = items
    return output


def read_state(repo: Repository, project_id: str) -> dict[str, Any]:
    if not repo.get_project(project_id):
        raise FileNotFoundError('Project not found')
    row = repo.db.execute('select * from workflow_states where project_id = ?', (project_id,)).fetchone()
    assignments = json.loads(row['assignments_json']) if row else {}
    choices = catalog(repo, project_id)
    assignments = {stage: value for stage, value in assignments.items() if stage in choices and any(item['id'] == value and not item['reason'] for item in choices[stage])}
    compositions = []
    for item in repo.db.execute('select * from dataset_compositions where project_id = ? order by created_at desc', (project_id,)).fetchall():
        item = dict(item)
        try:
            validate_recipe(repo, project_id, item)
            item['reason'] = ''
        except ValueError as exc:
            item['reason'] = str(exc)
        compositions.append(item)
    composition_id = row['composition_id'] if row else None
    if not any(c['id'] == composition_id and not c['reason'] for c in compositions):
        composition_id = None
    return {'project_id': project_id, 'assignments': assignments, 'composition_id': composition_id, 'compositions': compositions, 'catalog': choices}


def write_state(repo: Repository, project_id: str, assignments: dict, composition_id: str | None = None) -> None:
    repo.db.execute('insert into workflow_states (project_id, assignments_json, composition_id) values (?, ?, ?) on conflict(project_id) do update set assignments_json = excluded.assignments_json, composition_id = excluded.composition_id', (project_id, json.dumps(assignments), composition_id))


def assign(repo: Repository, project_id: str, stage: str, artifact_id: str | None) -> dict:
    with transaction(repo.db):
        state = read_state(repo, project_id)
        values = state['assignments']
        if stage not in TABLES:
            raise ValueError('Unknown workflow stage')
        row = artifact(repo, project_id, stage, artifact_id) if artifact_id else None
        if stage == 'pseudo' and artifact_id and not repo.pseudo_build_images(project_id, artifact_id):
            raise ValueError('This legacy Pseudo version has no retained originals; select its saved Augment build instead')
        if values.get(stage) != artifact_id:
            downstream = {'pseudo': ['augmentation', 'split', 'training', 'conversion'], 'augmentation': ['split', 'training', 'conversion'], 'open_data': ['split', 'training', 'conversion'], 'split': ['training', 'conversion'], 'training': ['conversion'], 'conversion': []}
            for key in downstream[stage]:
                values.pop(key, None)
        values.pop(stage, None)
        if artifact_id:
            values[stage] = artifact_id
        if row and stage == 'augmentation':
            values.pop('pseudo', None)
            if row.get('pseudo_label_run_id'):
                values['pseudo'] = row['pseudo_label_run_id']
        if row and stage == 'split':
            for key, field in FIELDS.items():
                values.pop(key, None)
                if row.get(field):
                    values[key] = row[field]
        if row and stage in ('training', 'conversion'):
            training_id = artifact_id if stage == 'training' else row.get('training_run_id')
            if training_id:
                training = artifact(repo, project_id, 'training', training_id)
                split = artifact(repo, project_id, 'split', training['dataset_split_id'])
                values['training'] = training_id
                values['split'] = split['id']
                for key, field in FIELDS.items():
                    values.pop(key, None)
                    if split.get(field):
                        values[key] = split[field]
        write_state(repo, project_id, values, None if stage in (*FIELDS, 'split') else state['composition_id'])
    return read_state(repo, project_id)


def save_composition(repo: Repository, project_id: str, payload: CompositionCreate) -> dict:
    with transaction(repo.db):
        state = read_state(repo, project_id)
        recipe = validate_recipe(repo, project_id, payload.model_dump())
        name = payload.name.strip()
        if not name:
            raise ValueError('Composition name cannot be blank')
        cid = new_id()
        repo.db.execute('insert into dataset_compositions (id, project_id, name, pseudo_label_run_id, augmentation_run_id, open_data_import_id, created_at) values (?, ?, ?, ?, ?, ?, ?)', (cid, project_id, name, recipe['pseudo_label_run_id'], recipe['augmentation_run_id'], recipe['open_data_import_id'], utc_now()))
        write_state(repo, project_id, {key: recipe[field] for key, field in FIELDS.items() if recipe[field]}, cid)
    return read_state(repo, project_id)


def create_workflow_router(get_repo: Callable[[], Repository]) -> APIRouter:
    router = APIRouter(prefix='/api/projects/{project_id}')

    def call(fn, *args):
        try:
            return fn(get_repo(), *args)
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.get('/workflow-state')
    def get_state(project_id: str):
        return call(read_state, project_id)

    @router.put('/workflow-state')
    def put_state(project_id: str, payload: Assignment):
        return call(assign, project_id, payload.stage, payload.artifact_id)

    @router.post('/compositions')
    def create_composition(project_id: str, payload: CompositionCreate):
        return call(save_composition, project_id, payload)

    @router.post('/compositions/{composition_id}/assign')
    def assign_composition(project_id: str, composition_id: str):
        repo = get_repo()
        with transaction(repo.db):
            state = call(read_state, project_id)
            item = next((c for c in state['compositions'] if c['id'] == composition_id), None)
            if item is None:
                raise HTTPException(404, 'Composition not found')
            recipe = call(validate_recipe, project_id, item)
            write_state(repo, project_id, {key: recipe[field] for key, field in FIELDS.items() if recipe[field]}, composition_id)
        return call(read_state, project_id)

    @router.delete('/compositions/{composition_id}')
    def delete_composition(project_id: str, composition_id: str):
        repo = get_repo()
        with transaction(repo.db):
            state = call(read_state, project_id)
            if not any(c['id'] == composition_id for c in state['compositions']):
                raise HTTPException(404, 'Composition not found')
            repo.db.execute('delete from dataset_compositions where project_id = ? and id = ?', (project_id, composition_id))
            if state['composition_id'] == composition_id:
                write_state(repo, project_id, state['assignments'])
        return call(read_state, project_id)

    return router
