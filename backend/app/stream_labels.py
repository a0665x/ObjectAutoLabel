"""Project-scoped display labels. Class IDs and detector outputs never change."""
def resolve_stream_labels(repo, project_id, model, schema_id='auto'):
    if schema_id == 'model':
        return None
    schemas = repo.list_class_schemas(project_id)
    by_id = {schema['id']: schema for schema in schemas}
    if schema_id == 'auto':
        schema_id = model.get('schema_id')
        if schema_id not in by_id:
            schema_id = schemas[0]['id'] if len(schemas) == 1 else None
        if schema_id is None:
            return None
    schema = by_id.get(schema_id)
    if schema is None:
        raise ValueError('Label schema is unavailable in this project; refresh and select again')
    names = {int(item['class_id']): item['class_name'] for item in schema['classes']}
    if not names:
        raise ValueError('The selected label schema is empty; select another schema or model native labels')
    return names


def apply_stream_labels(result, names):
    if names is None:
        return
    native = result.names
    known = set(native) if isinstance(native, dict) else set(range(len(native)))
    if not known.issubset(names):
        raise ValueError('Label schema class IDs do not cover this model. Select a matching project schema or model native labels')
    result.names = dict(names)
