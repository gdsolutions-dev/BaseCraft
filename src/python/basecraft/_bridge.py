"""Bridge to the host.

Convention (Task 6 adapts): `_bc_bridge.call(method, args)` receives `args` as a plain JS
array built with JSON.parse (so None -> null, str() fallback for non-JSON values) and returns
any JS value; the reply is read back through JSON.stringify (null/undefined -> None).
"""
import json
import math

import js
from _bc_bridge import call as _call


def _clean(v):
    # json.dumps emits NaN/Infinity (JSON.parse rejects) and raises on non-str keys
    if isinstance(v, float) and not math.isfinite(v):
        return str(v)
    if isinstance(v, dict):
        out = {}
        for k, x in v.items():
            k = k if isinstance(k, str) else str(k)
            if k in out:
                raise TypeError(f'dict keys collide after conversion to text: {k!r}')
            out[k] = _clean(x)
        return out
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    return v


def call(method, args):
    reply = _call(method, js.JSON.parse(json.dumps(_clean(args), default=str)))
    if reply is None:
        return None
    text = js.JSON.stringify(reply)
    return None if text is None else json.loads(text)
