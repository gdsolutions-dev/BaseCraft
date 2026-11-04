import ast


def of(source):
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return {'exports': [], 'error': {'line': e.lineno or 1, 'col': e.offset or 0, 'message': e.msg}}
    out = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not node.name.startswith('_'):
            a = node.args
            out.append({'name': node.name, 'params': [p.arg for p in a.posonlyargs + a.args + a.kwonlyargs]})
    return {'exports': out, 'error': None}
