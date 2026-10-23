import { describe, expect, it } from 'vitest'
import { coerce, listItemStored, listItemText, listItemValue } from './coerce'
import { localeInfo } from './locale-format'
import { f } from './test-fixtures'

const fr = localeInfo('fr-FR')

describe('coerce', () => {
  it.each([
    [f('Nom', 'shortText', { size: 5 }), 'Dupont', { ok: false, error: 'tooLong' }],
    [f('Nom', 'shortText', { size: 6 }), ' Dupont ', { ok: true, value: 'Dupont' }],
    [f('Nom', 'shortText', { required: true }), '', { ok: false, error: 'required' }],
    [f('Nom', 'shortText'), '', { ok: true, value: null }],
    [f('Q', 'number', { numberSize: 'integer' }), '2,5', { ok: true, value: 2 }],
    [f('Q', 'number', { numberSize: 'integer' }), '3,5', { ok: true, value: 4 }],
    [f('Q', 'number', { numberSize: 'byte' }), '256', { ok: false, error: 'outOfRange' }],
    [f('S', 'currency'), '922337203685477,5807', { ok: true, value: 922337203685477.5807 }],
    [f('S', 'currency'), '-922337203685477,5808', { ok: true, value: -922337203685477.5808 }],
    [f('S', 'currency'), '922337203685477,5808', { ok: false, error: 'outOfRange' }],
    [f('S', 'currency'), '-922337203685477,5809', { ok: false, error: 'outOfRange' }],
    [f('S', 'currency'), 1e16, { ok: false, error: 'outOfRange' }],
    [f('Q', 'number', { numberSize: 'integer' }), 'abc', { ok: false, error: 'invalidNumber' }],
    [f('Q', 'number', { numberSize: 'double' }), 12.5, { ok: true, value: 12.5 }],
    [f('S', 'currency'), '1 234,56785', { ok: true, value: 1234.5678 }],
    [f('D', 'number', { numberSize: 'decimal', precision: 5, scale: 2 }), '123,456', { ok: true, value: '123.46' }],
    [f('D', 'number', { numberSize: 'decimal', precision: 5, scale: 2 }), '1', { ok: true, value: '1.00' }],
    [f('D', 'number', { numberSize: 'decimal', precision: 5, scale: 2 }), '1234,5', { ok: false, error: 'outOfRange' }],
    [f('Le', 'dateTime'), '31/02/2026', { ok: false, error: 'invalidDate' }],
    [f('Le', 'dateTime'), '2026-10-21 00:00:00', { ok: true, value: '2026-10-21 00:00:00' }],
    [f('A', 'yesNo'), true, { ok: true, value: 1 }],
    [f('A', 'yesNo'), null, { ok: true, value: 0 }],
    [f('N°', 'autoNumber'), '5', { ok: false, error: 'readOnly' }],
    // décision contrôleur : non fini = invalidNumber, jamais stocké
    [f('Q', 'number', { numberSize: 'double' }), '9'.repeat(400), { ok: false, error: 'invalidNumber' }],
    [f('Q', 'number', { numberSize: 'integer' }), Infinity, { ok: false, error: 'invalidNumber' }],
    [f('S', 'currency'), '9'.repeat(400), { ok: false, error: 'invalidNumber' }],
    [f('D', 'number', { numberSize: 'decimal', precision: 5, scale: 2 }), '9'.repeat(400), { ok: false, error: 'invalidNumber' }],
    [f('Le', 'dateTime'), 5, { ok: false, error: 'invalidDate' }],
    [f('A', 'yesNo'), 'Oui', { ok: true, value: 1 }],
    [f('A', 'yesNo'), -1, { ok: true, value: 1 }],
    [f('A', 'yesNo'), 'non', { ok: true, value: 0 }],
    [f('Q', 'number', { numberSize: 'double' }), 0.1234567890123456789, { ok: true, value: 0.1234567890123456789 }],
    [f('Q', 'number', { numberSize: 'double' }), 1e-25, { ok: true, value: 1e-25 }],
    [f('Q', 'number', { numberSize: 'double' }), 123456789012.34567, { ok: true, value: 123456789012.34567 }],
    [f('S', 'currency'), 123456789012.3456, { ok: true, value: 123456789012.3456 }],
    [f('S', 'currency'), 0.1 + 0.2, { ok: true, value: 0.3 }],
    [f('Q', 'number', { numberSize: 'integer' }), 1e21, { ok: false, error: 'outOfRange' }],
    [f('Q', 'number', { numberSize: 'longInteger' }), -2.5, { ok: true, value: -2 }],
    [f('Q', 'number', { numberSize: 'integer' }), '-2,5', { ok: true, value: -2 }],
    [f('Q', 'number', { numberSize: 'byte' }), '0', { ok: true, value: 0 }],
    [f('Q', 'number', { numberSize: 'byte' }), '255', { ok: true, value: 255 }],
    [f('Q', 'number', { numberSize: 'byte' }), '-1', { ok: false, error: 'outOfRange' }],
    [f('Q', 'number', { numberSize: 'integer' }), '-32768', { ok: true, value: -32768 }],
    [f('Q', 'number', { numberSize: 'integer' }), '32768', { ok: false, error: 'outOfRange' }],
    [f('D', 'number', { numberSize: 'decimal', precision: 5, scale: 2 }), '999,995', { ok: false, error: 'outOfRange' }],
    [f('D', 'number', { numberSize: 'decimal', precision: 5, scale: 2 }), '-12,345', { ok: true, value: '-12.34' }],
    [f('D', 'number', { numberSize: 'decimal', precision: 28, scale: 25 }), -1.5e-25, { ok: true, value: '-0.0000000000000000000000002' }],
    [f('D', 'number', { numberSize: 'decimal', precision: 28, scale: 0 }), 1e21, { ok: true, value: '1000000000000000000000' }],
    [f('Q', 'number', { required: true }), '', { ok: false, error: 'required' }]
  ] as const)('coerce %#', (field, input, expected) => expect(coerce(field, input, fr)).toEqual(expected))

  it('a number becomes text with the regional decimal separator, no grouping, every digit (R16)', () => {
    const de = localeInfo('de-DE'), en = localeInfo('en-US')
    expect(coerce(f('T', 'shortText'), 12.5, de)).toEqual({ ok: true, value: '12,5' })
    expect(coerce(f('T', 'shortText'), 12.5, fr)).toEqual({ ok: true, value: '12,5' })
    expect(coerce(f('T', 'shortText'), 12.5, en)).toEqual({ ok: true, value: '12.5' })
    expect(coerce(f('T', 'longText'), 1234567.25, de)).toEqual({ ok: true, value: '1234567,25' })
    expect(coerce(f('T', 'hyperlink'), 1e21, en)).toEqual({ ok: true, value: '1000000000000000000000' })
    expect(coerce(f('T', 'shortText'), -1e-7, fr)).toEqual({ ok: true, value: '-0,0000001' })
    expect(coerce(f('T', 'shortText', { size: 3 }), 12.5, de)).toEqual({ ok: false, error: 'tooLong' })
  })
})

describe('value list items (Lookup): a Number\'s stored in canonical form, so the list means the same in every region', () => {
  const en = localeInfo('en-US')
  const qte = f('Q', 'number', { numberSize: 'double' })
  it('typed in the region, stored canonical; as typed when it does not convert, or for another type', () => {
    expect(['1,5', '1 234', 'abc'].map((x) => listItemStored('number', x, fr))).toEqual(['1.5', '1234', 'abc'])
    expect(['1.5', '1,234'].map((x) => listItemStored('number', x, en))).toEqual(['1.5', '1234'])
    expect(listItemStored('shortText', '1,5', fr)).toBe('1,5')
  })
  it('shown in the region', () => {
    expect(['1.5', 'abc'].map((x) => listItemText('number', x, fr))).toEqual(['1,5', 'abc'])
    expect(listItemText('number', '1.5', en)).toBe('1.5')
    expect(listItemText('shortText', '1.5', fr)).toBe('1.5')
  })
  it('read as stored whatever the region', () => {
    expect(['1.5', '2', 'abc'].map((x) => listItemValue(qte, x))).toEqual([1.5, 2, 'abc'])
    expect(listItemValue(f('O', 'yesNo'), 'Oui')).toBe(1)
  })
})
