_ns = {'__name__': '__immediate__'}  # persists across modules.reset()


def run(line):
    s = line.strip()
    if s.startswith('?'):
        return str(eval(s[1:].strip(), _ns))
    exec(line, _ns)
    return ''
