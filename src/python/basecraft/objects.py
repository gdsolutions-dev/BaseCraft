"""Python object model over the bridge (R6, R7). Proxies keep names only; every access asks the host."""
from ._bridge import call

_PROPS = {'value', 'visible', 'enabled', 'locked', 'caption', 'fore_color', 'back_color', 'left', 'top', 'width', 'height'}
_WIRE = {'fore_color': 'foreColor', 'back_color': 'backColor'}


class Control:
    def __init__(self, kind, owner, name):
        object.__setattr__(self, '_k', (kind, owner, name))

    @property
    def name(self):
        return self._k[2]

    def __getattr__(self, prop):
        if prop not in _PROPS:
            raise AttributeError(prop)
        kind, owner, name = self._k
        if kind == 'form':
            return call('form.get', [owner, name, _WIRE.get(prop, prop)])
        if prop != 'value':
            raise AttributeError(f'{prop} can only be set on a report control')
        return call('report.get', [owner, name])

    def __setattr__(self, prop, v):
        if prop not in _PROPS:
            raise AttributeError(prop)
        kind, owner, name = self._k
        call(f'{kind}.set', [owner, name, _WIRE.get(prop, prop), v])


class _Owner:
    _kind = 'form'

    def __init__(self, name):
        self._name = name

    @property
    def name(self):
        return self._name

    def __getitem__(self, control):
        return Control(self._kind, self._name, control)

    def __getattr__(self, control):
        if control.startswith('_'):
            raise AttributeError(control)
        return self[control]


class Form(_Owner):
    def _do(self, method, *args):
        return call('form.do', [self._name, method, list(args)])

    def requery(self, control=None):
        return self._do('requery', *([] if control is None else [control]))

    def go_to_record(self, record='next', offset=1):
        return self._do('goToRecord', record, offset)

    def go_to_control(self, name):
        return self._do('goToControl', name)

    def save_record(self):
        return self._do('saveRecord')

    def undo_record(self):
        return self._do('undoRecord')

    def delete_record(self):
        return self._do('deleteRecord')

    def refresh_record(self):
        return self._do('refreshRecord')

    def apply_filter(self, where):
        return self._do('applyFilter', where)

    def show_all_records(self):
        return self._do('showAllRecords')


class Section:
    def __init__(self, report):
        object.__setattr__(self, '_c', Control('report', report, ''))

    def __getattr__(self, prop):
        return getattr(self._c, prop)

    def __setattr__(self, prop, v):
        setattr(self._c, prop, v)


class Report(_Owner):
    _kind = 'report'

    @property
    def section(self):
        return Section(self._name)


class _Collection:
    _cls = Form
    _what = 'forms'

    def __getitem__(self, name):
        stored = call(f'{self._what}.name', [name])
        if stored is None:
            raise KeyError(name)
        return self._cls(stored)

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name) from None

    def __contains__(self, name):
        return call(f'{self._what}.name', [name]) is not None


class Forms(_Collection):
    def __len__(self):
        return len(call('forms.list', []))

    def __iter__(self):
        return iter([Form(n) for n in call('forms.list', [])])


class Reports(_Collection):
    _cls = Report
    _what = 'reports'


class _Me:
    def _target(self):
        cur = call('event.current', [])
        if cur is None:
            raise RuntimeError('me is only available in a function run by an event')
        return (Form if cur['kind'] == 'form' else Report)(cur['name'])

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        return getattr(self._target(), name)

    def __getitem__(self, control):
        return self._target()[control]

    def __setattr__(self, name, value):
        raise AttributeError(f'me.{name} cannot be set; use me.<Control>.value = ...')


class Screen:
    @property
    def active_form(self):
        f = call('screen.active', [])['form']
        return None if f is None else Form(f)

    @property
    def active_control(self):
        a = call('screen.active', [])
        return None if a['form'] is None or a['control'] is None else Control('form', a['form'], a['control'])


_REFUSED = {
    'cancelevent': 'docmd.cancel_event()',
    'clearmacroerror': 'try/except around the call',
    'onerror': 'try/except',
    'removealltempvars': 'tempvars.clear()',
    'removetempvar': 'del tempvars[name]',
    'runmacro': 'docmd.run_macro(name)',
    'setlocalvar': 'a Python variable',
    'settempvar': 'tempvars[name] = value',
    'setvalue': 'the control value (forms.F.C.value = v)',
    'messagebox': 'msgbox()',
    'stopallmacros': 'return or raise',
    'stopmacro': 'return or raise',
    'runcode': 'a direct call of the function',
}


class DoCmd:
    def cancel_event(self):
        call('event.cancel', [])

    def run_macro(self, name):
        call('docmd.runMacro', [name])

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        repl = _REFUSED.get(name.replace('_', '').lower())
        if repl:
            raise AttributeError(f'docmd.{name} is not available in Python: use {repl}')
        return lambda *args, **kwargs: call('docmd.run', [name, list(args), kwargs])


class TempVars:
    def __getitem__(self, name):
        return call('tempvars.get', [name])

    def __setitem__(self, name, v):
        call('tempvars.set', [name, v])

    def __delitem__(self, name):
        call('tempvars.delete', [name])

    def __contains__(self, name):
        return str(name).casefold() in [n.casefold() for n in self.keys()]

    def __len__(self):
        return len(self.keys())

    def __iter__(self):
        return iter(self.keys())

    def keys(self):
        return list(call('tempvars.names', []))

    def items(self):
        return [(n, self[n]) for n in self.keys()]

    def clear(self):
        call('tempvars.clear', [])


class _Project:
    @property
    def name(self):
        return call('app.project', [])['name']


class App:
    current_project = _Project()

    def quit(self):
        call('docmd.run', ['quit', [], {}])


forms, reports, me, screen, docmd, tempvars, app = Forms(), Reports(), _Me(), Screen(), DoCmd(), TempVars(), App()
