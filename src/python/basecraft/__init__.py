import builtins
import sys

from . import data, errors, exports, immediate, modules, objects, ui  # noqa: F401
from ._bridge import call
from .errors import BaseCraftError  # noqa: F401


class _LogWriter:
    """Sends complete lines to the host log; a partial line waits for its newline or flush()."""

    encoding = 'utf-8'
    errors = 'strict'

    def isatty(self):
        return False

    def writable(self):
        return True

    def __init__(self):
        self._buf = ''

    def write(self, text):
        self._buf += text
        while '\n' in self._buf:
            line, self._buf = self._buf.split('\n', 1)
            call('log.write', [line + '\n'])
        return len(text)

    def flush(self):
        if self._buf:
            text, self._buf = self._buf, ''
            call('log.write', [text])


def flush():
    """Send any pending partial line (host calls it after each run)."""
    sys.stdout.flush()


def install():
    builtins.msgbox = ui.msgbox
    builtins.inputbox = ui.inputbox
    for n in ('app', 'forms', 'reports', 'me', 'screen', 'docmd', 'tempvars'):
        setattr(builtins, n, getattr(objects, n))
    builtins.db = data.db
    if not any(isinstance(f, modules.Finder) for f in sys.meta_path):
        sys.meta_path.append(modules.Finder())
    sys.stdout = sys.stderr = _LogWriter()
