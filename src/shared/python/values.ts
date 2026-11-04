// Values on the Python bridge (D2 R4): one wire form both ways. Pure, shared.
import type { Value } from '../expr/ast'
import { date, bool, fromSerial, num, str, toSerial } from '../expr/library'
import type { CellInput, SqlValue } from '../coerce'

export type Wire = null | number | string | boolean | { $date: string }

const bad = (): never => { throw new Error('bc:badValue') }
const isDate = (w: unknown): w is { $date: string } =>
  typeof w === 'object' && w !== null && !Array.isArray(w) && Object.keys(w).length === 1 && typeof (w as { $date?: unknown }).$date === 'string'

export function valueToWire(v: Value): Wire {
  if (v === null || v.t === 'empty') return null
  return v.t === 'date' ? { $date: fromSerial(v.v) } : v.v
}

export function wireToValue(w: unknown): Value {
  if (w === null) return null
  if (typeof w === 'number') return num(w)
  if (typeof w === 'string') return str(w)
  if (typeof w === 'boolean') return bool(w)
  return isDate(w) ? date(toSerial(w.$date)) : bad()
}

export function wireToCell(w: unknown): CellInput {
  if (w === null || typeof w === 'number' || typeof w === 'string' || typeof w === 'boolean') return w
  return isDate(w) ? w.$date : bad()
}

export function sqlToWire(v: SqlValue, type: string | undefined): Wire {
  if (v === null) return null
  if (type === 'yesNo' && typeof v === 'number') return v !== 0
  if (type === 'dateTime' && typeof v === 'string') {
    const m = /^(\d{4}-\d\d-\d\d)(?:[ T](\d\d:\d\d)(?::(\d\d))?)?/.exec(v)   // stored as a date alone, or with a time (seconds optional)
    return m ? { $date: `${m[1]} ${m[2] ?? '00:00'}:${m[3] ?? '00'}` } : v
  }
  return v
}
