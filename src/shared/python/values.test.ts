import { describe, expect, it } from 'vitest'
import { bool, date, num, str } from '../expr/library'
import { toSerial } from '../expr/library'
import { sqlToWire, valueToWire, wireToCell, wireToValue } from './values'

describe('python bridge values', () => {
  it('round trips', () => {
    for (const v of [num(1.5), str('é😀'), bool(true), null, date(toSerial('2026-01-31 14:05:00')), date(toSerial('2026-01-31 00:00:00'))])
      expect(wireToValue(valueToWire(v))).toEqual(v)
    expect(valueToWire({ t: 'empty' })).toBeNull()
    expect(valueToWire(date(toSerial('2026-01-31 14:05:00')))).toEqual({ $date: '2026-01-31 14:05:00' })
  })
  it('cells and sql', () => {
    expect(wireToCell({ $date: '2026-01-31 00:00:00' })).toBe('2026-01-31 00:00:00')
    expect(sqlToWire(-1, 'yesNo')).toBe(true)
    expect(sqlToWire(0, 'yesNo')).toBe(false)
    expect(sqlToWire('2026-01-31 00:00:00', 'dateTime')).toEqual({ $date: '2026-01-31 00:00:00' })
    expect(sqlToWire('2026-01-31', 'dateTime')).toEqual({ $date: '2026-01-31 00:00:00' })
    expect(sqlToWire('2026-01-31 08:30', 'dateTime')).toEqual({ $date: '2026-01-31 08:30:00' })
    expect(sqlToWire('x', 'shortText')).toBe('x')
  })
  it('refuses anything else', () => {
    expect(() => wireToValue({})).toThrow('bc:badValue')
    expect(() => wireToValue([1])).toThrow('bc:badValue')
    expect(() => wireToCell({ a: 1 })).toThrow('bc:badValue')
  })
})
