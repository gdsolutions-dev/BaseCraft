import { describe, expect, it } from 'vitest'
import { changeType, defaultProps, isReservedName, isValidObjectName, validateDesign } from './field-types'
import { clients, f, t } from './test-fixtures'

describe('field-types', () => {
  it('defaults', () => {
    expect(defaultProps('shortText')).toMatchObject({ size: 255, required: false, allowZeroLength: true, indexed: 'no', primaryKey: false })
    expect(defaultProps('number')).toMatchObject({ numberSize: 'longInteger', decimalPlaces: 'auto' })
    expect(defaultProps('autoNumber')).toMatchObject({ primaryKey: true, indexed: 'yesNoDuplicates' })
  })
  it('names', () => {
    ['Nom du client', 'Prix "TTC" été', 'N°'].forEach(n => expect(isValidObjectName(n)).toBe(true))
    ;['', ' Nom', 'a.b', 'a!b', 'a`b', 'a[b', 'a]b', 'x'.repeat(65), 'a\u0007b'].forEach(n => expect(isValidObjectName(n)).toBe(false))
    ;['bc_x', 'BCX_y', 'sqlite_z'].forEach(n => expect(isReservedName(n)).toBe(true))
  })
  it('duplicates ignore case, including accented letters', () => {
    expect(validateDesign(t('T', [f('Nom', 'shortText'), f('nom', 'longText')]))).toContainEqual({ code: 'nameDuplicate', field: 'nom' })
    expect(validateDesign(t('T', [f('Été', 'shortText'), f('été', 'longText')]))).toContainEqual({ code: 'nameDuplicate', field: 'été' })
    expect(validateDesign(t('T', [f('Ete', 'shortText'), f('Été', 'longText')]))).toEqual([])
  })
  it('autoNumber rules', () => {
    expect(validateDesign(t('T', [f('A', 'autoNumber'), f('B', 'autoNumber')]))).toContainEqual({ code: 'autoNumberMultiple' })
    expect(validateDesign(t('T', [f('A', 'autoNumber', { primaryKey: false })]))).toContainEqual({ code: 'autoNumberNotPrimaryKey', field: 'A' })
  })
  it('ranges and empties', () => {
    expect(validateDesign(t('T', [f('A', 'shortText', { size: 256 })]))).toContainEqual({ code: 'shortTextSize', field: 'A' })
    expect(validateDesign(t('T', [f('D', 'number', { numberSize: 'decimal', precision: 5, scale: 6 })]))).toContainEqual({ code: 'decimalPrecision', field: 'D' })
    expect(validateDesign(t('T', []))).toContainEqual({ code: 'noFields' })
    expect(validateDesign(t('bc_T', [f('A', 'shortText')]))).toContainEqual({ code: 'reservedName' })
  })
  it('an unreadable input mask is refused on a masked type, ignored on another (A2-R10)', () => {
    expect(validateDesign(t('T', [f('A', 'shortText', { inputMask: '"0' })]))).toEqual([{ code: 'invalidMask', field: 'A' }])
    expect(validateDesign(t('T', [f('A', 'dateTime', { inputMask: '00/00/0000;0;_' }), f('B', 'yesNo', { inputMask: '"0' })]))).toEqual([])
  })
  it('rowid, oid and _rowid_ are reserved field names, any case (R18)', () => {
    expect(validateDesign(t('T', [f('RowID', 'shortText'), f('oid', 'longText'), f('_ROWID_', 'number'), f('rowids', 'shortText')]))).toEqual([
      { code: 'reservedFieldName', field: 'RowID' }, { code: 'reservedFieldName', field: 'oid' }, { code: 'reservedFieldName', field: '_ROWID_' }
    ])
  })
  it('returns all errors, and the Clients fixture is valid', () => {
    expect(validateDesign(t('', [f('', 'shortText', { size: 0 }), f('a.b', 'longText')]))).toEqual([
      { code: 'nameEmpty' }, { code: 'nameEmpty', field: '' }, { code: 'shortTextSize', field: '' }, { code: 'nameInvalid', field: 'a.b' }
    ])
    expect(validateDesign(clients)).toEqual([])
  })
  it('changeType keeps common and unknown props', () => {
    const p = changeType({ ...defaultProps('shortText'), size: 50, caption: 'Nom', required: true, futureProp: 1 }, 'longText')
    expect(p).toMatchObject({ type: 'longText', caption: 'Nom', required: true, futureProp: 1 })
    expect(p.size).toBeUndefined()
    expect(changeType(p, 'currency')).toMatchObject({ decimalPlaces: 2 })
  })
  it('changeType resets format and inputMask, keeps rules and lookup', () => {
    const lookup = { kind: 'values' as const, values: ['a', 'b'], limitToList: true }
    const p = changeType(
      { ...defaultProps('shortText'), format: '>', inputMask: 'LL', defaultValue: '"a"', validationRule: 'Is Not Null', validationText: 'Requis', lookup },
      'number',
    )
    expect(p.format).toBeUndefined()
    expect(p.inputMask).toBeUndefined()
    expect(p).toMatchObject({ type: 'number', defaultValue: '"a"', validationRule: 'Is Not Null', validationText: 'Requis', lookup })
  })
})
