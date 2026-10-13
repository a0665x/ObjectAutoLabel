import json

import pytest
from pydantic import ValidationError

from backend.app.box_area import area_distribution, suggested_max_area
from backend.app.schemas import PseudoLabelRunCreate
from backend.app import main
from backend.app.config import AppPaths
from backend.app.db import connect, initialize_schema
from backend.app.repositories import Repository


def test_suggestion_excludes_dominant_large_mode_without_trimming_small_mode():
    areas = [.0001, .0002, .0003, .0004] + [.5, .55, .6, .65, .7, .75]
    threshold = suggested_max_area(areas)
    assert .0004 < threshold < .5
    stats = area_distribution(areas)
    assert len(stats['bins']) == 50
    assert sum(bin['count'] for bin in stats['bins']) == len(areas)
    assert stats['suggested_max'] == threshold
    assert stats['bins'][0]['lower'] == 0 and stats['bins'][-1]['upper'] == 1


@pytest.mark.parametrize('areas', [[], [.1], [.01]*10, [.1, .11, .12, .13, .14, .15], [.01,.02,.03,.04,.06,.08]])
def test_no_evidence_falls_back_to_one_third(areas):
    assert suggested_max_area(areas) == 1/3


def test_histogram_counts_boundaries_and_rejects_nonfinite_data():
    stats = area_distribution([0, 1, 1/3, float('nan'),float('inf'),-.1,1.1])
    assert stats['box_count'] == 3
    assert stats['bins'][0]['count'] == 1 and stats['bins'][-1]['count'] == 1


@pytest.mark.parametrize('lower,upper', [(.5,.3),(.3,.3),(-.1,.3),(1,1),(float('nan'),.3)])
def test_invalid_area_intervals_are_rejected(lower,upper):
    with pytest.raises(ValidationError):
        PseudoLabelRunCreate(schema_id='schema',world_model='world.pt',min_box_area_ratio=lower,max_box_area_ratio=upper)


def test_distribution_endpoint_retains_prefilter_statistics_and_source_scope(tmp_path,monkeypatch):
    db=connect(tmp_path/'test.db');initialize_schema(db)
    repo=Repository(db,AppPaths(project_root=tmp_path));project=repo.create_project('Areas')
    schema=repo.create_class_schema(project['id'],'labels',[{'class_id':0,'class_name':'car','descriptors':[]}])
    first=repo.create_source_asset(project['id'],'image_folder','/raw/first')
    second=repo.create_source_asset(project['id'],'image_folder','/raw/second')
    stats=area_distribution([.01]*5+[.6]*8)
    run=repo.create_pseudo_label_run_record(project['id'],schema['id'],first['id'],'world.pt',str(tmp_path/'run'),.1,.7,1,1,area_histogram_json=json.dumps(stats))
    monkeypatch.setattr(main,'repo',repo)
    result=main.pseudo_area_distribution(project['id'],first['id'])
    assert result['pre_filter'] and result['box_count']==13 and result['run_id']==run['id']
    assert main.pseudo_area_distribution(project['id'],second['id'])['box_count']==0
    other=repo.create_project('Other')
    with pytest.raises(main.HTTPException):main.pseudo_area_distribution(other['id'],first['id'])
    # Older histories truthfully identify the data as retained labels only.
    image=repo.create_image(project['id'],str(tmp_path/'image.jpg'),source_asset_id=second['id'])
    repo.replace_image_annotations(image['id'],[{'class_id':0,'class_name':'car','x_center':.5,'y_center':.5,'width':.2,'height':.3}],'reviewed')
    result=main.pseudo_area_distribution(project['id'],second['id'])
    assert not result['pre_filter'] and result['box_count']==1
