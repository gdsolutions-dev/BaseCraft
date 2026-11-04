import ast
import importlib
import importlib.abc
import importlib.util
import inspect
import linecache
import sys

from ._bridge import call as bridge_call


class _Loader(importlib.abc.Loader):
    def __init__(self, source):
        self.source = source

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__bc_user__ = True
        name = f'<module {module.__name__}>'
        linecache.cache[name] = (len(self.source), None, self.source.splitlines(True), name)
        exec(compile(self.source, name, 'exec'), module.__dict__)


class Finder(importlib.abc.MetaPathFinder):
    """Appended last in sys.meta_path: a user module named like a standard module is unreachable."""

    def find_spec(self, name, path=None, target=None):
        if '.' in name:
            return None
        source = bridge_call('modules.source', [name])
        if source is None:
            return None
        return importlib.util.spec_from_loader(name, _Loader(source))


def call(module, fn, args):
    mod = importlib.import_module(module)
    f = getattr(mod, fn, None)
    if not (getattr(mod, '__bc_user__', False) and not fn.startswith('_') and inspect.isfunction(f) and f.__module__ == module):
        raise LookupError(f'{module}.{fn} is not a public function of a BaseCraft module')
    return f(*args)


def _imports(source):
    names = ['pandas'] if 'to_pandas' in source else []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return names
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            names += [a.name.split('.')[0] for a in n.names]
        elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
            names.append(n.module.split('.')[0])
    return names


def deps(code=None, module=None):
    """Top-level names imported by `code` and, transitively, by the user modules it reaches (to load packages before the run)."""
    if code is not None and code.lstrip().startswith('?'):
        code = code.lstrip()[1:]
    todo = _imports(code) if code else []
    if module:
        todo.append(module)
    seen = set()
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        if name in sys.stdlib_module_names or name in sys.modules:
            continue  # a user module already loaded had its packages loaded with it
        source = bridge_call('modules.source', [name])
        if source is not None:
            todo += _imports(source)
    return sorted(seen)


def reset():
    for name in [n for n, m in sys.modules.items() if getattr(m, '__bc_user__', False)]:
        del sys.modules[name]
