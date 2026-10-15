"""Read-only inspection of saved Split membership and batch provenance.

Coverage never loads image pixels. Only an explicit thumbnail request decodes one
saved copy; no generated image cache is written to the project.
"""
from collections import Counter
from functools import lru_cache
import hashlib
import io
import json
import math
from pathlib import Path
from typing import Any
from urllib.parse import quote

from PIL import Image, ImageDraw

from .label_io import read_yolo_labels

BUCKETS = ('train', 'valid', 'test')


def _counts(rows):
    values = Counter(row[3] for row in rows)
    return {bucket: values[bucket] for bucket in BUCKETS}


def _metadata(repo, project_id, images, branches):
    pseudo = {run['id']: run for run in repo.list_pseudo_label_runs(project_id)}
    augment = {run['id']: run for run in repo.list_augmentation_runs(project_id)}
    external = {run['id']: run for run in repo.list_open_data_imports(project_id)}
    sources = {row['id']: row for row in repo.list_source_assets(project_id)}
    historical = {}
    for branch in branches:
        run_id = branch.get('pseudo_label_run_id')
        if run_id and not branch.get('augmentation_run_id'):
            historical[run_id] = {row['image_id'] for row in repo.db.execute(
                'select image_id from pseudo_image_snapshots where run_id = ?', (run_id,)).fetchall()}
    groups = {}
    rows = []
    for image in images:
        aug_id = image.get('augmentation_run_id')
        open_id = image.get('open_data_import_id')
        if image.get('source_origin') == 'open_data':
            pseudo_id, aug_id = None, None
        elif '_split_pseudo_id' in image:
            pseudo_id = image['_split_pseudo_id']
        else:
            selected = next((branch for branch in branches if aug_id and branch.get('augmentation_run_id') == aug_id), None)
            if selected is None and not aug_id:
                selected = next((branch for branch in branches if image['id'] in historical.get(branch.get('pseudo_label_run_id'), set())), None)
            if selected is None and len(branches) == 1 and not aug_id:
                selected = branches[0]
            pseudo_id = (selected or {}).get('pseudo_label_run_id') or image.get('pseudo_label_run_id') or augment.get(aug_id, {}).get('pseudo_label_run_id')
        source_id = image.get('source_asset_id') or pseudo.get(pseudo_id, {}).get('source_asset_id')
        key = json.dumps([source_id, pseudo_id, aug_id, open_id], separators=(',', ':'))
        group_id = hashlib.sha256(key.encode()).hexdigest()[:20]
        if group_id not in groups:
            p, a, o = pseudo.get(pseudo_id, {}), augment.get(aug_id, {}), external.get(open_id, {})
            kind = 'open_data' if image.get('source_origin') == 'open_data' else 'augment' if aug_id else 'pseudo'
            pseudo_name = p.get('run_name') or (Path(p['output_dir']).name if p.get('output_dir') else None)
            augment_name = a.get('name')
            open_name = o.get('version_name') or o.get('dataset_key')
            source_name = Path(sources[source_id]['path']).name if source_id in sources else None
            name = f"Open Data · {open_name or 'Unknown version'}" if kind == 'open_data' else f"Pseudo · {pseudo_name or 'Unknown version'}"
            if aug_id:
                name += f" → Augment · {augment_name or 'Unknown version'}"
            groups[group_id] = dict(id=group_id, name=name, kind=kind, source_asset_id=source_id, source_name=source_name,
                pseudo_label_run_id=pseudo_id, pseudo_name=pseudo_name, augmentation_run_id=aug_id,
                augmentation_name=augment_name, open_data_import_id=open_id, open_data_name=open_name)
        rows.append([image['id'], group_id, Path(image.get('path') or image['id']).name])
    ordered = sorted(groups.values(), key=lambda group: (group['kind'] == 'open_data', group['pseudo_name'] or '',
        group['augmentation_name'] or '', group['source_name'] or '', group['id']))
    rank = {group['id']: index for index, group in enumerate(ordered)}
    rows.sort(key=lambda row: (rank[row[1]], row[2], row[0]))
    return dict(version=1, seed=42, ordering='source_then_filename', groups=ordered, images=rows)


def freeze(repo, project_id, images, branches):
    """Capture exact selected versions before publishing a new immutable Split."""
    return _metadata(repo, project_id, images, branches)


@lru_cache(maxsize=4)
def _read_json(path: str, modified: int, size: int):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _json(path):
    stat = path.stat()
    return _read_json(str(path), stat.st_mtime_ns, stat.st_size)


def _split(repo, project_id, split_id):
    split = repo.get_dataset_split(split_id)
    project = repo.get_project(project_id)
    if not split or not project or split['project_id'] != project_id:
        raise FileNotFoundError('Split version is unavailable in this project')
    root = Path(project['root_path']).resolve() / 'splits'
    output = Path(split['output_dir']).resolve()
    if not output.is_relative_to(root) or not output.is_dir():
        raise FileNotFoundError('Saved Split files are unavailable')
    return split, output


def _load(repo, project_id, split_id):
    split, output = _split(repo, project_id, split_id)
    buckets = json.loads(split.get('image_ids_json') or '{}')
    membership = {image_id: bucket for bucket in BUCKETS for image_id in buckets.get(bucket, [])}
    manifest = output / 'coverage_manifest.json'
    if manifest.exists():
        if not manifest.resolve().is_relative_to(output):
            raise FileNotFoundError('Invalid saved coverage path')
        data, provenance = _json(manifest), 'frozen'
    else:
        # Older versions remain readable without writing/migrating their files.
        ids = list(membership)
        images = {}
        for start in range(0, len(ids), 900):
            batch = ids[start:start + 900]
            marks = ','.join('?' for _ in batch)
            for row in repo.db.execute(f'select id, path, source_asset_id, pseudo_label_run_id, augmentation_run_id, open_data_import_id, source_origin from images where project_id = ? and id in ({marks})', [project_id, *batch]).fetchall():
                images[row['id']] = dict(row)
        file_manifest = output / 'image_manifest.json'
        if file_manifest.exists() and not file_manifest.resolve().is_relative_to(output):
            raise FileNotFoundError('Invalid saved image manifest')
        filenames = _json(file_manifest) if file_manifest.exists() else {}
        records = [images.get(image_id, dict(id=image_id, path=filenames.get(image_id, image_id))) for image_id in ids]
        composition = split.get('composition') or json.loads(split.get('composition_json') or '{}')
        branches = composition.get('branches') or [dict(pseudo_label_run_id=split.get('pseudo_label_run_id'), augmentation_run_id=split.get('augmentation_run_id'))]
        data, provenance = _metadata(repo, project_id, records, branches), 'legacy'
    rows = [(*row, membership[row[0]]) for row in data['images'] if row[0] in membership]
    return split, output, data['groups'], rows, provenance


def _selected(groups, rows, group_id):
    if group_id is not None and not any(group['id'] == group_id for group in groups):
        raise ValueError('Source group is not part of this Split')
    return [row for row in rows if group_id is None or row[1] == group_id]


def distribution(repo, project_id, split_id, *, group_id=None, start=0., end=1., bins=64):
    if not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= 1:
        raise ValueError('Coverage window must satisfy 0 <= start < end <= 1')
    split, _, groups, rows, provenance = _load(repo, project_id, split_id)
    selected = _selected(groups, rows, group_id)
    total = len(selected)
    first, last = math.floor(start * total), math.ceil(end * total)
    window = selected[first:last]
    size = max(1, min(128, int(bins), len(window) or 1))
    timeline = []
    for index in range(size):
        lower = first + index * len(window) // size
        upper = first + (index + 1) * len(window) // size
        timeline.append(dict(index=index, first_index=lower + 1, last_index=upper, counts=_counts(selected[lower:upper])))
    grouped = {group['id']: Counter() for group in groups}
    for row in rows:
        grouped[row[1]][row[3]] += 1
    all_counts = _counts(rows)
    result_groups = []
    for group in groups:
        counts = {bucket: grouped[group['id']][bucket] for bucket in BUCKETS}
        result_groups.append({**group, 'counts':counts, 'total':sum(counts.values()),
            'bucket_share':{bucket: counts[bucket] / all_counts[bucket] if all_counts[bucket] else 0 for bucket in BUCKETS}})
    return dict(split_id=split_id, split_name=split['name'], provenance=provenance, seed=42 if provenance == 'frozen' else None,
        ordering='source_then_filename', total=total, all_counts=all_counts, counts=_counts(selected),
        groups=result_groups, group_id=group_id, window=dict(start=start,end=end,first_index=first + 1 if total else 0,last_index=last,count=len(window)),
        window_counts=_counts(window), bins=timeline)


def sample(repo, project_id, split_id, *, bucket, position=0., group_id=None):
    if bucket not in BUCKETS or not math.isfinite(position) or not 0 <= position <= 1:
        raise ValueError('Invalid Split sample position')
    _, _, groups, rows, _ = _load(repo, project_id, split_id)
    selected = [row for row in _selected(groups, rows, group_id) if row[3] == bucket]
    if not selected:
        raise FileNotFoundError('This source has no images in this bucket')
    index = min(len(selected) - 1, math.floor(position * len(selected)))
    row = selected[index]
    group = next(group for group in groups if group['id'] == row[1])
    return dict(image_id=row[0],file_name=row[2],bucket=bucket,group_id=row[1],group_name=group['name'],
        index=index + 1,total=len(selected),thumbnail_url=f'/api/projects/{quote(project_id)}/dataset-splits/{quote(split_id)}/thumbnail/{quote(row[0])}')


def thumbnail(repo, project_id, split_id, image_id):
    _, output, _, rows, _ = _load(repo, project_id, split_id)
    row = next((row for row in rows if row[0] == image_id), None)
    if row is None:
        raise FileNotFoundError('Image is not part of this saved Split')
    file_manifest = output / 'image_manifest.json'
    if file_manifest.exists() and not file_manifest.resolve().is_relative_to(output):
        raise FileNotFoundError('Invalid saved image manifest')
    filenames = _json(file_manifest) if file_manifest.exists() else {}
    filename = filenames.get(image_id, row[2])
    if Path(filename).name != filename:
        raise FileNotFoundError('Invalid saved image path')
    path = (output / row[3] / 'images' / filename).resolve()
    if not path.is_relative_to(output) or not path.is_file():
        raise FileNotFoundError('Saved Split image is unavailable')
    label_path = (output / row[3] / 'labels' / (Path(filename).stem + '.txt')).resolve()
    if not label_path.is_relative_to(output):
        raise FileNotFoundError('Invalid saved label path')
    try:
        with Image.open(path) as original:
            original.thumbnail((256,160), Image.Resampling.LANCZOS)
            image = original.convert('RGB')
        draw = ImageDraw.Draw(image)
        if label_path.is_file():
            for annotation in read_yolo_labels(label_path):
                x, y = annotation.x_center * image.width, annotation.y_center * image.height
                w, h = annotation.width * image.width / 2, annotation.height * image.height / 2
                draw.rectangle((x-w,y-h,x+w,y+h), outline=(70,230,120), width=2)
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG', quality=75)
        return buffer.getvalue()
    except (OSError, ValueError) as exc:
        raise FileNotFoundError('Saved image could not be decoded') from exc
