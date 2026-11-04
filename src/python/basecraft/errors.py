import traceback


class BaseCraftError(Exception):
    """A host handler failed; `.code` is the bc code (notOpen, notFound, ...), the message is the dialog's text."""

    def __init__(self, message, code='Error'):
        super().__init__(message)
        self.code = code


def describe(exc):
    module = line = None
    tb = exc.__traceback__
    while tb is not None:
        filename = tb.tb_frame.f_code.co_filename
        if filename.startswith('<module '):
            module, line = filename[8:-1], tb.tb_lineno
        tb = tb.tb_next
    fname = getattr(exc, 'filename', None)
    if isinstance(exc, SyntaxError) and isinstance(fname, str) and fname.startswith('<module '):
        module, line = fname[8:-1], exc.lineno
    return {
        'type': type(exc).__name__,
        'message': str(exc),
        'module': module,
        'line': line,
        'traceback': ''.join(traceback.format_exception(exc)),
    }
