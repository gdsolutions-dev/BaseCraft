// Conversion d'une saisie (ou d'une valeur convertie lors d'une modification de table) vers la valeur stockée.
// Module pur. Arrondis et intervalles passent par des chaînes décimales, jamais par de l'arithmétique flottante.
import type { FieldDef, NumberSize } from './field-types'
import { parseDateTime, parseDecimal, roundDecimalString, type LocaleInfo } from './locale-format'

export type SqlValue = string | number | null
export type CellInput = string | number | boolean | null
export type FieldErrorCode = 'invalidNumber' | 'outOfRange' | 'invalidDate' | 'tooLong' | 'required' | 'zeroLength' | 'duplicate' | 'readOnly'
  | 'validation' | 'expressionError' | 'noParent' | 'notInList' | 'mask' | 'related'
export type CoerceResult = { ok: true; value: SqlValue } | { ok: false; error: FieldErrorCode }

const RANGES: Partial<Record<NumberSize, [number, number]>> = {
  byte: [0, 255], integer: [-32768, 32767], longInteger: [-2147483648, 2147483647]
}
const SINGLE_MAX = 3.4028235e38
/** Jetons Oui/Non acceptés (saisie, import, inférence des types d'un fichier), casse ignorée. */
export const YES_TOKENS = ['true', 'vrai', 'oui', 'yes', '1', '-1']
export const NO_TOKENS = ['false', 'faux', 'non', 'no', '0']

const ok = (value: SqlValue): CoerceResult => ({ ok: true, value })
const fail = (error: FieldErrorCode): CoerceResult => ({ ok: false, error })

/** Développe la notation exponentielle de String(n) en chaîne décimale exacte (sans perte). */
function numberToDecimal(n: number): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(n))!
  const [, sign, int, frac = '', exp = '0'] = m
  const shift = Number(exp)
  const digits = int + frac
  const point = int.length + shift
  const body = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
    : `${digits.slice(0, point)}.${digits.slice(point)}`
  return `${sign}${body}`
}

/** Chaîne décimale canonique, ou null si illisible ou non finie. */
export function toDecimal(input: string | number, info: LocaleInfo): string | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? parseDecimal(numberToDecimal(input), { ...info, decimalSep: '.', groupSep: '' }) : null
  }
  const d = parseDecimal(input, info)
  return d !== null && Number.isFinite(Number(d)) ? d : null
}

/** Nombre en texte comme CStr d'Access : séparateur décimal régional, sans groupement, tous les chiffres. */
export function numberToText(n: number, info: LocaleInfo): string {
  const d = toDecimal(n, info)
  return d === null ? String(n) : d.replace('.', info.decimalSep)
}

export function coerce(field: FieldDef, input: CellInput, info: LocaleInfo): CoerceResult {
  const p = field.props
  if (p.type === 'autoNumber') return fail('readOnly')
  if (p.type === 'yesNo') {
    if (input === null) return ok(0)
    const s = String(input).trim().toLowerCase()
    return YES_TOKENS.includes(s) ? ok(1) : s === '' || NO_TOKENS.includes(s) ? ok(0) : fail('invalidNumber')
  }

  const text = input === null ? '' : String(input).trim()
  if (text === '') return p.required ? fail('required') : ok(null)

  switch (p.type) {
    case 'shortText':
    case 'longText':
    case 'hyperlink': {
      const s = typeof input === 'number' ? numberToText(input, info) : text
      return p.type === 'shortText' && [...s].length > (p.size ?? 255) ? fail('tooLong') : ok(s)
    }
    case 'dateTime': {
      const d = typeof input === 'string' ? parseDateTime(text, info) : null
      return d === null ? fail('invalidDate') : ok(d)
    }
    case 'currency': {
      const d = typeof input === 'boolean' ? null : toDecimal(input as string | number, info)
      return d === null ? fail('invalidNumber') : ok(Number(roundDecimalString(d, 4)))
    }
    case 'number': {
      const d = typeof input === 'boolean' ? null : toDecimal(input as string | number, info)
      if (d === null) return fail('invalidNumber')
      const size = p.numberSize ?? 'longInteger'
      // Un nombre JS fini est conservé tel quel (aucune perte de chiffres lors d'une reconstruction de table).
      const v = typeof input === 'number' ? input : Number(d)
      if (size === 'double') return ok(v)
      if (size === 'single') return Math.abs(v) > SINGLE_MAX ? fail('outOfRange') : ok(v)
      if (size === 'decimal') {
        const scale = p.scale ?? 0
        const r = roundDecimalString(d, scale)
        const intDigits = r.replace(/^-/, '').split('.')[0].replace(/^0+/, '').length
        return intDigits > (p.precision ?? 18) - scale ? fail('outOfRange') : ok(r)
      }
      const n = Number(roundDecimalString(d, 0))
      const [lo, hi] = RANGES[size]!
      return n < lo || n > hi ? fail('outOfRange') : ok(n)
    }
  }
}
