from types import SimpleNamespace
import pytest
from backend.app.stream_labels import resolve_stream_labels, apply_stream_labels


def schema(id, names):
    return {'id':id,'classes':[{'class_id':i,'class_name':n} for i,n in names.items()]}


def repo(schemas):
    return SimpleNamespace(list_class_schemas=lambda project_id: schemas if project_id=='p' else [])


def test_auto_prefers_model_link_then_unique_project_schema():
    first=schema('one',{0:'Person',1:'Car'})
    second=schema('two',{0:'Pedestrian',1:'Vehicle'})
    assert resolve_stream_labels(repo([first,second]),'p',{'schema_id':'two'})=={0:'Pedestrian',1:'Vehicle'}
    assert resolve_stream_labels(repo([first]),'p',{})=={0:'Person',1:'Car'}
    assert resolve_stream_labels(repo([first,second]),'p',{}) is None
    assert resolve_stream_labels(repo([]),'p',{}) is None
    assert resolve_stream_labels(repo([first]),'p',{},'model') is None


def test_foreign_or_deleted_schema_is_rejected():
    with pytest.raises(ValueError,match='this project'):
        resolve_stream_labels(repo([schema('one',{0:'Person'})]),'other',{},'one')


def test_mapping_uses_class_ids_not_schema_order_or_class_names():
    names=resolve_stream_labels(repo([schema('one',{1:'Vehicle',0:'Pedestrian'})]),'p',{})
    result=SimpleNamespace(names={0:'person',1:'car'},boxes=object())
    original=result.boxes
    apply_stream_labels(result,names)
    assert result.names=={0:'Pedestrian',1:'Vehicle'}
    assert result.boxes is original


def test_mismatched_schema_never_silently_labels_model_outputs():
    result=SimpleNamespace(names={0:'person',1:'car',2:'dog'})
    with pytest.raises(ValueError,match='class IDs'):
        apply_stream_labels(result,{0:'person',1:'car'})
    assert result.names[2]=='dog'


def test_empty_schema_rejected():
    with pytest.raises(ValueError,match='empty'):
        resolve_stream_labels(repo([schema('empty',{})]),'p',{})
