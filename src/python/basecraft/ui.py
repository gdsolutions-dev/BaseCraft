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
