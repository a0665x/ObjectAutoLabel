from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi import HTTPException

from backend.app import main
from backend.app.config import AppPaths
from backend.app.db import connect,initialize_schema
from backend.app.repositories import Repository
from backend.app.schemas import SourceCreate,PseudoLabelRunCreate


def test_duplicate_registration_resolves_aliases_and_requires_confirmation(tmp_path,monkeypatch):
    db=connect(tmp_path/'test.db');initialize_schema(db)
    repo=Repository(db,AppPaths(project_root=tmp_path));project=repo.create_project('Duplicate sources')
    raw=tmp_path/'raw';raw.mkdir();cv2.imwrite(str(raw/'a.jpg'),np.zeros((12,12,3),np.uint8))
    alias=tmp_path/'alias';alias.symlink_to(raw,target_is_directory=True)
    monkeypatch.setattr(main,'repo',repo)
    first=main.create_source(project['id'],SourceCreate(kind='image_folder',path=str(raw)))
    for path in (str(raw)+'/',str(alias)):
        with pytest.raises(HTTPException) as error:
            main.create_source(project['id'],SourceCreate(kind='image_folder',path=path))
        assert error.value.status_code==409 and error.value.detail['code']=='duplicate_source'
        assert error.value.detail['sources'][0]['id']==first['id']
        assert len(repo.list_source_assets(project['id']))==1
    second=main.create_source(project['id'],SourceCreate(kind='image_folder',path=str(alias),allow_duplicate=True))
    assert second['id']!=first['id'] and len(repo.list_images(project['id']))==2
    other=repo.create_project('Other project')
    assert main.create_source(other['id'],SourceCreate(kind='image_folder',path=str(raw)))
    assert (raw/'a.jpg').is_file()


@pytest.mark.parametrize('ratio',[0,-.1,1.1,float('nan'),float('inf')])
def test_box_area_threshold_rejects_invalid_api_values(ratio):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        PseudoLabelRunCreate(schema_id='schema',world_model='world.pt',max_box_area_ratio=ratio)
