import builtins

# the names install() puts in builtins: jedi sees them as the module's globals
_NAMES = ('app', 'forms', 'reports', 'me', 'screen', 'docmd', 'tempvars', 'db', 'msgbox', 'inputbox', 'eval_expr', 'eval_cond', 'eval_text')


def of(source, line, column):
    """Jedi completions at (line 1-based, column 0-based). Objects are inspected statically: no bridge call is made."""
    import jedi
    ns = {n: getattr(builtins, n) for n in _NAMES if hasattr(builtins, n)}
    cs = jedi.Interpreter(source, [ns]).complete(line, column)
    out = []
    for c in cs:
        if len(out) >= 60:
            break
        if c.name.startswith('_') and c.get_completion_prefix_length() == 0:
            continue
        out.append({'label': c.name, 'type': c.type, 'detail': c.description})
    return {'prefix': cs[0].get_completion_prefix_length() if cs else 0, 'items': out}
