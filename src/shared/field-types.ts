import { parseMask } from './expr/input-mask'
import { fieldRefs, parseCanonical } from './expr/parser'

export type FieldType = 'autoNumber' | 'shortText' | 'longText' | 'number' | 'currency' | 'dateTime' | 'yesNo' | 'hyperlink'
export type NumberSize = 'byte' | 'integer' | 'longInteger' | 'single' | 'double' | 'decimal'
export type LookupProps =
  | { kind: 'values'; values: string[]; limitToList: boolean }
  | { kind: 'table'; table: string; boundField: string; displayFields: string[]; limitToList: boolean }
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
export interface TableDesign { name: string; description?: string; fields: FieldDef[]; extra?: Record<string, unknown> }
export type DesignErrorCode = 'nameEmpty' | 'nameInvalid' | 'reservedName' | 'nameDuplicate' | 'noFields'
  | 'autoNumberMultiple' | 'autoNumberNotPrimaryKey' | 'shortTextSize' | 'decimalPrecision' | 'reservedFieldName'
  | 'invalidExpression' | 'invalidMask'
export interface DesignError { code: DesignErrorCode; field?: string; prop?: 'defaultValue' | 'validationRule' }

/** Types that take an input mask (as in Access); on another type a stored mask is ignored. */
export const MASK_TYPES: readonly FieldType[] = ['shortText', 'number', 'currency', 'dateTime']

const TYPE_SPECIFIC = ['size', 'numberSize', 'precision', 'scale', 'decimalPlaces', 'allowZeroLength', 'format', 'inputMask'] as const

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
  const len = [...name].length
  // eslint-disable-next-line no-control-regex
  return len >= 1 && len <= 64 && !/^\s/.test(name) && !/[.!`[\]]/.test(name) && !/[\u0000-\u001f\u007f-\u009f]/.test(name)
}

export function isReservedName(name: string): boolean {
  return /^(bc_|bcx_|sqlite_)/.test(name.toLowerCase())
}

/** Identifiant SQL entre guillemets doubles (seule façon d'insérer un nom dans du SQL). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function sameName(a: string, b: string): boolean {
  return a.toLocaleLowerCase('und') === b.toLocaleLowerCase('und')
}

/** A field's expression is readable, and refers to no field (default value) or only to its own field (rule), as in Access. */
function validExpression(fd: FieldDef, prop: 'defaultValue' | 'validationRule'): boolean {
  const text = fd.props[prop]
  if (!text) return true
  try {
    const refs = fieldRefs(parseCanonical(text, { criteria: prop === 'validationRule' }))
    return prop === 'defaultValue' ? refs.length === 0 : refs.every(n => sameName(n, fd.name))
  } catch {
    return false
  }
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
    if (p.inputMask && MASK_TYPES.includes(p.type)) { try { parseMask(p.inputMask) } catch { errors.push({ code: 'invalidMask', field: name }) } }
    if (p.type === 'autoNumber' && (!p.primaryKey || design.fields.some(o => o !== fd && o.props.primaryKey))) errors.push({ code: 'autoNumberNotPrimaryKey', field: name })
  })
  return errors
}
