import { parseMask } from './expr/input-mask'
import { fieldRefs, hasAggregate, parseCanonical, renameRefs, serialize } from './expr/parser'

export type FieldType = 'autoNumber' | 'shortText' | 'longText' | 'number' | 'currency' | 'dateTime' | 'yesNo' | 'hyperlink'
export type NumberSize = 'byte' | 'integer' | 'longInteger' | 'single' | 'double' | 'decimal'
/** Lookup tab, as in Access; an absent key takes Access's default. Widths in twips (1440 = 2,54 cm). Display Control: absent
 *  is Combo Box (a Text Box has no lookup). A List Box shows in the datasheet as a combo box, as in Access. */
interface LookupTab {
  limitToList: boolean; displayControl?: 'listBox' | 'comboBox'
  boundColumn?: number; columnCount?: number; columnHeads?: boolean; columnWidths?: number[]
  listRows?: number; listWidth?: number; allowValueListEdits?: boolean
}
export type LookupProps = LookupTab & (
  | { kind: 'values'; values: string[] }
  /** table: the Row Source as typed: a table name, else SQL or a saved query's name (its list served by A3).
   *  boundField, displayFields: a lookup saved before the Access properties (see accessColumns). */
  | { kind: 'table'; table: string; boundField?: string; displayFields?: string[] }
  | { kind: 'fieldList'; table: string }
)
export type TableLookup = Extract<LookupProps, { kind: 'table' }>
export interface FieldProps {
  type: FieldType; size?: number; numberSize?: NumberSize; precision?: number; scale?: number
  decimalPlaces?: 'auto' | number; caption?: string; description?: string
  required: boolean; allowZeroLength?: boolean; indexed: 'no' | 'yesDuplicates' | 'yesNoDuplicates'
  primaryKey: boolean
  // expressions en forme canonique (voir contraintes A2) ; format et inputMask dépendent du type
  defaultValue?: string; validationRule?: string; validationText?: string
  format?: string; inputMask?: string; lookup?: LookupProps
  [unknownKey: string]: unknown // clés inconnues conservées (compatibilité mineure)
}
export interface FieldDef { name: string; props: FieldProps }
/** A multi-field index (Indexes dialog); a one-field index of its own name is the field's Indexed property instead.
 *  Unknown keys (of the index and of each field) are kept, as for field props (minor-version compatibility). */
export interface IndexDef { name: string; fields: IndexField[]; unique: boolean; [unknownKey: string]: unknown }
export interface IndexField { name: string; desc: boolean; [unknownKey: string]: unknown }

/** A stored IndexDef this version can read (another tool, or a newer version, may have written anything). */
export function readableIndex(ix: unknown): ix is IndexDef {
  const o = ix as { name?: unknown; unique?: unknown; fields?: unknown } | null
  return typeof o?.name === 'string' && typeof o.unique === 'boolean' && Array.isArray(o.fields)
    && o.fields.every((x: unknown) => typeof (x as { name?: unknown } | null)?.name === 'string' && typeof (x as { desc?: unknown }).desc === 'boolean')
}
/** validationRule: the record-level rule (Access's table Validation Rule), canonical; checked on the whole record.
 *  indexes: the Indexes dialog's other indexes, naming the fields as `fields` does (in a SaveTableRequest: by source names). */
export interface TableDesign { name: string; description?: string; validationRule?: string; validationText?: string; indexes?: IndexDef[]; fields: FieldDef[]; extra?: Record<string, unknown> }
export type DesignErrorCode = 'nameEmpty' | 'nameInvalid' | 'reservedName' | 'nameDuplicate' | 'noFields'
  | 'autoNumberMultiple' | 'autoNumberNotPrimaryKey' | 'shortTextSize' | 'decimalPrecision' | 'reservedFieldName'
  | 'invalidExpression' | 'invalidMask' | 'validationTextSize' | 'invalidIndex'
export interface DesignError { code: DesignErrorCode; field?: string; prop?: 'defaultValue' | 'validationRule' }

/** Types that take an input mask (as in Access); on another type a stored mask is ignored. */
export const MASK_TYPES: readonly FieldType[] = ['shortText', 'number', 'currency', 'dateTime']

/** Types that take a lookup (Short Text, Number, Yes/No, as in Access); on another type a stored lookup is ignored. */
export const LOOKUP_TYPES: readonly FieldType[] = ['shortText', 'number', 'yesNo']
export const lookupOf = (fd: FieldDef): LookupProps | undefined => (LOOKUP_TYPES.includes(fd.props.type) ? fd.props.lookup : undefined)

export const DEFAULT_COLUMN_WIDTH = 1440 // twips: Access's default column width (2,54 cm)
export const MAX_TWIPS = 31680 // 22 in, Access's limit for a width
export const LIST_ROWS = 16 // Access's default List Rows
const TWIPS_PER_CM = 1440 / 2.54

/** A width in cm as typed (« 2,54 », « 2.54cm »), in twips; null when unreadable or beyond 22 in. */
export function cmToTwips(text: string): number | null {
  const m = /^(\d+(?:[.,]\d*)?|[.,]\d+)\s*(?:cm)?$/i.exec(text.trim())
  const twips = m ? Math.round(Number(m[1]!.replace(',', '.')) * TWIPS_PER_CM) : NaN
  return twips <= MAX_TWIPS ? twips : null
}
export const twipsToCm = (twips: number, decimalSep: string): string => `${String(Math.round((twips / TWIPS_PER_CM) * 100) / 100).replace('.', decimalSep)}cm`

/** Column Widths as typed: cm separated by « ; », a blank one taking the default; '' gives [] (all default); null: unreadable. */
export function parseColumnWidths(text: string): number[] | null {
  if (text.trim() === '') return []
  const out = text.replace(/;\s*$/, '').split(';').map((x) => (x.trim() === '' ? DEFAULT_COLUMN_WIDTH : cmToTwips(x)))
  return out.every((x) => x !== null) ? (out as number[]) : null
}
export const columnWidthsText = (widths: number[], decimalSep: string): string => widths.map((x) => twipsToCm(x, decimalSep)).join(';')

/** The visible columns among the first `count`: a width of 0 hides one (Access); with every one hidden, the first. */
export function shownColumns(widths: number[] | undefined, count: number): number[] {
  const shown = Array.from({ length: count }, (_, i) => i).filter((i) => widths?.[i] !== 0)
  return shown.length ? shown : [0]
}

/** A value list read in rows of Column Count; with Column Heads, its first row is the heads (Access). */
export function valueListRows(l: { values: string[]; columnCount?: number; columnHeads?: boolean }): { heads?: string[]; rows: string[][] } {
  const n = l.columnCount ?? 1
  const rows: string[][] = []
  for (let i = 0; i < l.values.length; i += n) rows.push(l.values.slice(i, i + n))
  return l.columnHeads ? { heads: rows[0] ?? [], rows: rows.slice(1) } : { rows }
}

/** A value list as typed (« ; » between items, as Access writes it in every region): items trimmed, blank cells kept so the
 *  columns stay aligned; a trailing « ; » adds none. */
export function splitValueList(text: string): string[] {
  if (text.trim() === '') return []
  const items = text.split(';').map((x) => x.trim())
  return items[items.length - 1] === '' ? items.slice(0, -1) : items
}

/** The lookup with another Row Source Type. As in Access, the Row Source text, the columns and every other key are kept (a
 *  value list's items read as « ; »-separated text); only a pre-Access lookup's boundField and displayFields are dropped. */
export function withRowSourceType(l: LookupProps, kind: LookupProps['kind']): LookupProps {
  if (kind === l.kind) return l
  const { values: _v, table: _t, boundField: _b, displayFields: _d, ...rest } = l as LookupProps & Record<string, unknown>
  const text = l.kind === 'values' ? l.values.join(';') : l.table
  return (kind === 'values' ? { ...rest, kind, values: splitValueList(text) } : { ...rest, kind, table: text }) as LookupProps
}

/** Lookup tab properties typed as text (an unreadable entry blocks the save until fixed). */
export const LOOKUP_TEXT_KEYS = ['boundColumn', 'columnCount', 'columnWidths', 'listRows', 'listWidth'] as const
/** Whether the Lookup tab shows `key` for these props: a lookup type with a lookup (not a Text Box), and for a List Box, no
 *  List Rows, List Width nor Limit To List (Access). */
export function lookupRowShown(p: FieldProps, key: string): boolean {
  const l = LOOKUP_TYPES.includes(p.type) ? p.lookup : undefined
  return !!l && (l.displayControl !== 'listBox' || !['listRows', 'listWidth', 'limitToList'].includes(key))
}

const columnsOver = (count: number, bound: number, shown: number[]) =>
  ({ boundColumn: bound + 1, columnCount: count, columnWidths: Array.from({ length: count }, (_, i) => (shown.includes(i) ? DEFAULT_COLUMN_WIDTH : 0)) })

/** Access's wizard over a table's fields: bound to its key (else its first field), showing the next field, the key hidden. */
export function wizardColumns(fields: FieldDef[]): { boundColumn: number; columnCount: number; columnWidths: number[] } | null {
  if (!fields.length) return null
  const keys = fields.filter((x) => x.props.primaryKey)
  const bound = keys.length === 1 ? fields.indexOf(keys[0]!) : 0
  const next = fields.findIndex((_, i) => i !== bound)
  const shown = next < 0 ? bound : next
  return columnsOver(Math.max(bound, shown) + 1, bound, [shown])
}

/** A table lookup saved before the Access properties (boundField, displayFields) as Access columns over the source's fields
 *  `names` (resolved as field names are): the same list and texts. undefined when a name is gone; any other lookup as is. */
export function accessColumns(l: TableLookup, names: string[]): TableLookup | undefined {
  if (l.boundField === undefined) return l
  const { boundField, displayFields = [], ...rest } = l
  const at = (n: string) => { const i = names.indexOf(n); return i >= 0 ? i : names.findIndex((x) => sameName(x, n)) }
  const bound = at(boundField)
  const shown = displayFields.map(at)
  if (bound < 0 || shown.some((i) => i < 0)) return undefined
  return { ...rest, ...columnsOver(Math.max(bound, ...shown) + 1, bound, shown) }
}

const TYPE_SPECIFIC =['size', 'numberSize', 'precision', 'scale', 'decimalPlaces', 'allowZeroLength', 'format', 'inputMask'] as const

export function defaultProps(type: FieldType): FieldProps {
  const base: FieldProps = { type, required: false, indexed: 'no', primaryKey: false }
  switch (type) {
    case 'autoNumber': return { ...base, primaryKey: true, indexed: 'yesNoDuplicates' }
    case 'shortText': return { ...base, size: 255, allowZeroLength: true }
    case 'number': return { ...base, numberSize: 'longInteger', decimalPlaces: 'auto', precision: 18, scale: 0 }
    case 'currency': return { ...base, decimalPlaces: 2 }
    default: return base
  }
}

export function changeType(props: FieldProps, type: FieldType): FieldProps {
  const kept: Record<string, unknown> = { ...props }
  for (const k of TYPE_SPECIFIC) delete kept[k]
  const d = defaultProps(type)
  const specific = Object.fromEntries(TYPE_SPECIFIC.filter(k => k in d).map(k => [k, d[k]]))
  return { ...kept, ...specific, type } as FieldProps
}

export function isValidObjectName(name: string): boolean {
  if (name.length > 128) return false // 64 code points never take more than 128 UTF-16 units: no spread of a huge string
  const len = [...name].length
  // eslint-disable-next-line no-control-regex
  return len >= 1 && len <= 64 && !/^\s/.test(name) && !/[.!`[\]]/.test(name) && !/[\u0000-\u001f\u007f-\u009f]/.test(name)
    && !/\p{Cs}/u.test(name) // a lone surrogate: SQLite would store U+FFFD and the name could not be found again
}

export function isReservedName(name: string): boolean {
  return /^(bc_|bcx_|sqlite_)/.test(name.toLowerCase())
}

/** Identifiant SQL entre guillemets doubles (seule façon d'insérer un nom dans du SQL). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Same object name for Access: case ignored, accents kept; compared in NFC (a decomposed é is the same é). */
export function sameName(a: string, b: string): boolean {
  return a === b || foldName(a) === foldName(b)
}

// The fold costs ~1 µs (ICU) and a report compares the same few names millions of times (fields, fonts): cached.
const folded = new Map<string, string>()
function foldName(s: string): string {
  let f = folded.get(s)
  if (f === undefined) {
    if (folded.size >= 10000) folded.clear()   // ponytail: plain reset, never grows past 10,000 names
    folded.set(s, f = s.normalize('NFC').toLocaleLowerCase('und'))
  }
  return f
}

/** A field's expression is readable, and refers to no field (default value) or only to its own field (rule), as in Access. */
function validExpression(fd: FieldDef, prop: 'defaultValue' | 'validationRule'): boolean {
  const text = fd.props[prop]
  if (!text) return true
  try {
    const tree = parseCanonical(text, { criteria: prop === 'validationRule' })
    if (hasAggregate(tree)) return false // Sum, Count… need a group: refused here, so no write ever meets them
    const refs = fieldRefs(tree)
    return prop === 'defaultValue' ? refs.length === 0 : refs.every(n => sameName(n, fd.name))
  } catch {
    return false
  }
}

/** The table's rule is readable and refers only to fields of the table: never another table, an aggregate or a function
 *  outside the catalogue (DCount… are unknown functions), as in Access. */
function validTableRule(design: TableDesign): boolean {
  if (!design.validationRule) return true
  try {
    const tree = parseCanonical(design.validationRule)
    return !hasAggregate(tree) && fieldRefs(tree).every(n => design.fields.some(fd => sameName(fd.name, n)))
  } catch {
    return false
  }
}

/** The table's rule with each field renamed by `mapping` (source name -> new name) followed, all at once (a swap stays a swap).
 *  The rule names fields by their source names, as stored; unreadable: as is. */
export function renamedRule(rule: string, mapping: { name: string; sourceName: string | null }[]): string {
  const renamed = mapping.filter(m => m.sourceName !== null && m.sourceName !== m.name)
  if (!renamed.length) return rule
  try {
    return serialize(renameRefs(parseCanonical(rule), n => renamed.find(m => sameName(m.sourceName!, n))?.name))
  } catch {
    return rule
  }
}

/** Access's limits: 10 fields in an index, 32 indexes in a table. */
export const MAX_INDEX_FIELDS = 10
export const MAX_INDEXES = 32

/** The indexes with each field renamed by `mapping` (source name -> new name) followed, all at once (a swap stays a swap). */
export function renamedIndexes(indexes: IndexDef[], mapping: { name: string; sourceName: string | null }[]): IndexDef[] {
  const to = (n: string) => mapping.find(m => m.sourceName !== null && sameName(m.sourceName, n))?.name ?? n
  return indexes.map(ix => ({ ...ix, fields: ix.fields.map(x => ({ ...x, name: to(x.name) })) }))
}

/** Each index: a valid name of its own, 1 to 10 distinct fields of the table; at most 32 indexes (indexed fields counted). */
function validIndexes(design: TableDesign): boolean {
  const ixs = design.indexes ?? []
  if (!ixs.length) return true // a table made before the dialog (or by another tool) is never refused for its indexed fields
  const indexed = design.fields.filter(fd => fd.props.indexed !== 'no').length
  return ixs.length + indexed <= MAX_INDEXES && ixs.every((ix, i) => isValidObjectName(ix.name)
    && !ixs.slice(0, i).some(o => sameName(o.name, ix.name))
    && ix.fields.length >= 1 && ix.fields.length <= MAX_INDEX_FIELDS
    && ix.fields.every((x, j) => design.fields.some(fd => sameName(fd.name, x.name)) && !ix.fields.slice(0, j).some(o => sameName(o.name, x.name))))
}

export function validateDesign(design: TableDesign): DesignError[] {
  const errors: DesignError[] = []
  const nameErrors = (name: string, field?: string): void => {
    const code = name === '' ? 'nameEmpty' : !isValidObjectName(name) ? 'nameInvalid' : undefined
    if (code) errors.push(field === undefined ? { code } : { code, field })
  }
  nameErrors(design.name)
  // Réservé : tables seulement (une colonne ne peut pas entrer en collision avec une table système).
  if (isReservedName(design.name)) errors.push({ code: 'reservedName' })
  if (design.fields.length === 0) errors.push({ code: 'noFields' })
  if (!validTableRule(design)) errors.push({ code: 'invalidExpression', prop: 'validationRule' })
  if ([...design.validationText ?? ''].length > 255) errors.push({ code: 'validationTextSize' })
  if (!validIndexes(design)) errors.push({ code: 'invalidIndex' })

  const autoNumbers = design.fields.filter(x => x.props.type === 'autoNumber')
  if (autoNumbers.length > 1) errors.push({ code: 'autoNumberMultiple' })

  design.fields.forEach((fd, i) => {
    const { name, props: p } = fd
    nameErrors(name, name)
    // Noms qui désignent le rowid en SQLite : une colonne ainsi nommée le masquerait.
    if (['rowid', 'oid', '_rowid_'].includes(name.toLowerCase())) errors.push({ code: 'reservedFieldName', field: name })
    if (design.fields.slice(0, i).some(o => sameName(o.name, name))) errors.push({ code: 'nameDuplicate', field: name })
    if (p.type === 'shortText' && !(Number.isInteger(p.size) && p.size! >= 1 && p.size! <= 255)) errors.push({ code: 'shortTextSize', field: name })
    if (p.type === 'number' && p.numberSize === 'decimal') {
      const { precision: pr, scale: sc } = p
      if (!(Number.isInteger(pr) && pr! >= 1 && pr! <= 28 && Number.isInteger(sc) && sc! >= 0 && sc! <= pr!)) errors.push({ code: 'decimalPrecision', field: name })
    }
    for (const prop of ['defaultValue', 'validationRule'] as const) if (!validExpression(fd, prop)) errors.push({ code: 'invalidExpression', field: name, prop })
    if ([...p.validationText ?? ''].length > 255) errors.push({ code: 'validationTextSize', field: name })
    if (p.inputMask && MASK_TYPES.includes(p.type)) { try { parseMask(p.inputMask) } catch { errors.push({ code: 'invalidMask', field: name }) } }
    if (p.type === 'autoNumber' && (!p.primaryKey || design.fields.some(o => o !== fd && o.props.primaryKey))) errors.push({ code: 'autoNumberNotPrimaryKey', field: name })
  })
  return errors
}
