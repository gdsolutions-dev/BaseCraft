"""Bridge to the host.

Convention (Task 6 adapts): `_bc_bridge.call(method, args)` receives `args` as a plain JS
array built with JSON.parse (so None -> null, str() fallback for non-JSON values) and returns
any JS value; the reply is read back through JSON.stringify (null/undefined -> None).
"""
import datetime
import json
import math

import js
from _bc_bridge import call as _call
from pyodide.ffi import JsException

from .errors import BaseCraftError

_FMT = '%Y-%m-%d %H:%M:%S'


def _clean(v):
    # json.dumps emits NaN/Infinity (JSON.parse rejects) and raises on non-str keys
    if isinstance(v, float) and not math.isfinite(v):
        return str(v)
    if isinstance(v, datetime.datetime):
        return {'$date': v.strftime(_FMT)}
    if isinstance(v, datetime.date):
        return {'$date': v.strftime('%Y-%m-%d') + ' 00:00:00'}
    if type(v).__module__ == 'numpy' and hasattr(v, 'item'):
        return _clean(v.item())  # numpy scalar (no import numpy here)
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


def _decode(v):
    if isinstance(v, dict):
        if len(v) == 1 and '$date' in v:
            return datetime.datetime.strptime(v['$date'], _FMT)
        return {k: _decode(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_decode(x) for x in v]
    return v


def call(method, args):
    payload = js.JSON.parse(json.dumps(_clean(args), default=str))
    try:
        reply = _call(method, payload)
    except JsException as e:
        err = getattr(e, 'js_error', e)
        if getattr(err, 'name', None) == 'BridgeCallError':
            raise BaseCraftError(str(err.message), str(err.code)) from None
        raise
    if reply is None:
        return None
    text = js.JSON.stringify(reply)
    return None if text is None else _decode(json.loads(text))
