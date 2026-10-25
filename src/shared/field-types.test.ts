import { describe, expect, it } from 'vitest'
import { accessColumns, changeType, columnWidthsText, defaultProps, isReservedName, isValidObjectName, parseColumnWidths, shownColumns, splitValueList, withRowSourceType, validateDesign, valueListRows, wizardColumns } from './field-types'
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
  it('a huge name is refused at once', () => {
    const t0 = Date.now()
    expect(isValidObjectName('x'.repeat(1e7))).toBe(false)
    expect(Date.now() - t0).toBeLessThan(20)
  })
  it('member references are refused in a field default or rule and in the table rule', () => {
    for (const [prop, text] of [['validationRule', '= [TempVars]![v]'], ['defaultValue', '[TempVars]![v]']] as const) {
      expect(validateDesign(t('T', [f('Prix', 'currency', { [prop]: text })])), text).toEqual([{ code: 'invalidExpression', field: 'Prix', prop }])
    }
    expect(validateDesign({ ...t('T', [f('Prix', 'currency')]), validationRule: '[Prix] > [TempVars]![v]' })).toEqual([{ code: 'invalidExpression', prop: 'validationRule' }])
  })
  it('lone surrogates make a name invalid; a valid astral character does not', () => {
    expect(isValidObjectName('a\uD800b')).toBe(false)
    expect(isValidObjectName('a\uDC00')).toBe(false)
    expect(isValidObjectName('Clé \u{1F511}')).toBe(true)
  })
  it('aggregates are refused in a field default or rule (they need a group)', () => {
    for (const [prop, text] of [['validationRule', 'Sum([Prix]) > 0'], ['defaultValue', 'Count(*)'], ['validationRule', '> Count(*)'], ['defaultValue', '1 + Max(2)']] as const) {
      expect(validateDesign(t('T', [f('Prix', 'currency', { [prop]: text })])), text).toEqual([{ code: 'invalidExpression', field: 'Prix', prop }])
    }
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
  it('a Validation Text has at most 255 characters, as in Access', () => {
    expect(validateDesign(t('T', [f('A', 'number', { validationText: 'é'.repeat(255) })]))).toEqual([])
    expect(validateDesign(t('T', [f('A', 'number', { validationText: 'é'.repeat(256) })]))).toEqual([{ code: 'validationTextSize', field: 'A' }])
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

describe('Lookup tab (Access properties)', () => {
  it('Column Widths: cm separated by « ; », stored in twips (1440 = 2,54 cm); a blank one takes the default; unreadable: null', () => {
    expect(parseColumnWidths('0;2,54')).toEqual([0, 1440])
    expect(parseColumnWidths(' 0cm ; 2.54 cm ;')).toEqual([0, 1440])
    expect(parseColumnWidths('3;;1')).toEqual([1701, 1440, 567])
    expect(parseColumnWidths('')).toEqual([])
    for (const bad of ['abc', '-1', '2 in', '60']) expect(parseColumnWidths(bad)).toBeNull() // 60 cm: beyond Access's 22 in
    expect(columnWidthsText([0, 1440, 1701], ',')).toBe('0cm;2,54cm;3cm')
    expect(columnWidthsText([1440], '.')).toBe('2.54cm')
  })

  it('the visible columns: a width of 0 hides one (Access); with every one hidden, the first', () => {
    expect(shownColumns(undefined, 3)).toEqual([0, 1, 2])
    expect(shownColumns([0, 1440], 3)).toEqual([1, 2])
    expect(shownColumns([0, 0], 2)).toEqual([0])
  })

  it('a value list is read in rows of Column Count; with Column Heads, its first row is the heads (Access)', () => {
    expect(valueListRows({ values: ['1', 'Ouverte', '2', 'Fermée', '3'], columnCount: 2 })).toEqual({ rows: [['1', 'Ouverte'], ['2', 'Fermée'], ['3']] })
    expect(valueListRows({ values: ['N°', 'Statut', '1', 'Ouverte'], columnCount: 2, columnHeads: true })).toEqual({ heads: ['N°', 'Statut'], rows: [['1', 'Ouverte']] })
    expect(valueListRows({ values: ['a', 'b'] })).toEqual({ rows: [['a'], ['b']] })
  })

  it("the wizard's defaults: bound to the table's key, showing the next field, the key hidden", () => {
    expect(wizardColumns(clients.fields)).toEqual({ boundColumn: 1, columnCount: 2, columnWidths: [0, 1440] })
    const keyLast = [f('Nom', 'shortText'), f('Ville', 'shortText'), f('Code', 'shortText', { primaryKey: true })]
    expect(wizardColumns(keyLast)).toEqual({ boundColumn: 3, columnCount: 3, columnWidths: [1440, 0, 0] })
    expect(wizardColumns([f('Seul', 'shortText')])).toEqual({ boundColumn: 1, columnCount: 1, columnWidths: [1440] })
    expect(wizardColumns([])).toBeNull()
  })

  it('a value list typed in « ; »: items trimmed, blank cells kept (columns stay aligned), a trailing « ; » ignored', () => {
    expect(splitValueList('Ouverte ; Fermée;')).toEqual(['Ouverte', 'Fermée'])
    expect(splitValueList('Code;Nom;1;;2;B')).toEqual(['Code', 'Nom', '1', '', '2', 'B'])
    expect(splitValueList(' ')).toEqual([])
  })

  it('changing Row Source Type keeps the Row Source text, the columns and unknown keys (Access)', () => {
    const sql = { kind: 'table' as const, table: 'SELECT a; b', boundColumn: 2, columnWidths: [0], limitToList: true, later: 1 }
    expect(withRowSourceType(sql, 'values')).toEqual({ kind: 'values', values: ['SELECT a', 'b'], boundColumn: 2, columnWidths: [0], limitToList: true, later: 1 })
    expect(withRowSourceType(sql, 'fieldList')).toEqual({ ...sql, kind: 'fieldList' })
    const values = { kind: 'values' as const, values: ['1', '', 'x'], limitToList: false }
    expect(withRowSourceType(values, 'table')).toEqual({ kind: 'table', table: '1;;x', limitToList: false })
    const old = { kind: 'table' as const, table: 'Clients', boundField: 'N°', displayFields: ['Nom'], limitToList: false }
    expect(withRowSourceType(old, 'fieldList')).toEqual({ kind: 'fieldList', table: 'Clients', limitToList: false })
    expect(withRowSourceType(values, 'values')).toBe(values)
  })

  it('a lookup saved before the Access properties (boundField, displayFields) gives the same list as Access columns', () => {
    const names = clients.fields.map((x) => x.name) // N°, Nom, Âge, Actif, Solde, Email
    const old = { kind: 'table' as const, table: 'Clients', boundField: 'N°', displayFields: ['Nom', 'Solde'], limitToList: true, extra: 1 }
    expect(accessColumns(old, names)).toEqual({ kind: 'table', table: 'Clients', limitToList: true, extra: 1, boundColumn: 1, columnCount: 5, columnWidths: [0, 1440, 0, 0, 1440] })
    expect(accessColumns({ ...old, boundField: 'email', displayFields: ['nom'] }, names)).toMatchObject({ boundColumn: 6, columnCount: 6, columnWidths: [0, 1440, 0, 0, 0, 0] })
    expect(accessColumns({ ...old, displayFields: ['Gone'] }, names)).toBeUndefined()
    const now = { kind: 'table' as const, table: 'Clients', limitToList: false, boundColumn: 2 }
    expect(accessColumns(now, names)).toBe(now)
  })
})
