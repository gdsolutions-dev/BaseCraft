from ._bridge import call

BUTTONS = ('ok', 'ok_cancel', 'yes_no', 'yes_no_cancel', 'retry_cancel', 'abort_retry_ignore')
ICONS = (None, 'critical', 'warning', 'question', 'information')


def msgbox(prompt, buttons='ok', title='BaseCraft', icon=None):
    if buttons not in BUTTONS:
        raise ValueError(f'buttons must be one of {BUTTONS}')
    if icon not in ICONS:
        raise ValueError(f'icon must be one of {ICONS}')
    return call('ui.msgbox', [str(prompt), buttons, str(title), icon])


def inputbox(prompt, title='BaseCraft', default=''):
    return call('ui.inputbox', [str(prompt), str(title), str(default)])


def eval_expr(text):
    """Evaluates a BaseCraft expression (the canonical text a macro stores) and returns its value."""
    return call('expr.eval', [str(text)])


def eval_cond(text):
    """Evaluates an expression as a macro's If condition: True only when the macro engine would take the branch."""
    return call('expr.eval', [str(text), 'bool'])


def eval_text(text):
    """Evaluates an expression and converts it to text as a macro argument is (Null gives "", numbers use the regional format)."""
    return call('expr.eval', [str(text), 'text'])
