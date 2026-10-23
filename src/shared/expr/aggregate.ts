// Accumulateurs exacts des fonctions d'agrégat, partagés par A3 (fonctions SQL bc_agg_*) et A5 (totaux d'un état) :
// une requête Regroupement et un état donnent la même somme pour les mêmes données (contrat 1.6 et 1.7). Module pur.
import type { Expr, Value } from './ast';
import { compare } from './evaluate';
import { fail, infoOf, num, toNum } from './library';
import { toDecimal } from '../coerce';
import { defaultProps, type FieldProps, type FieldType } from '../field-types';
import { roundDecimalString, type LocaleInfo } from '../locale-format';

export type AggregateName = 'Sum' | 'Avg' | 'Count' | 'Min' | 'Max' | 'First' | 'Last' | 'StDev' | 'StDevP' | 'Var' | 'VarP';
export interface Accumulator { add(v: Value): void; result(): Value }

const INTEGER_SIZES: readonly string[] = ['byte', 'integer', 'longInteger'];
/** Access Currency's bound; as a double it is 922337203685477.625, the largest value Currency storage can hold. */
const CURRENCY_LIMIT = 922337203685477.5807;
/** Extra decimal digits of an exact average before its single rounding to a double. */
const AVG_DIGITS = 19;

/** Decimal places of an exact sum (integers 0, Currency 4, Decimal its scale), or null for a floating-point sum. */
function exactScale(type: FieldType | null, props?: FieldProps): number | null {
  if (type === 'currency') return 4;
  if (type === 'autoNumber' || type === 'yesNo') return 0;
  if (type !== 'number') return null;
  const size = props?.numberSize ?? 'longInteger';
  if (INTEGER_SIZES.includes(size)) return 0;
  return size === 'decimal' ? Math.min(Math.max(props?.scale ?? 0, 0), 28) : null;
}

/** Exact decimal text of `b` × 10^-scale. */
function decimalText(b: bigint, scale: number): string {
  const neg = b < 0n;
  const s = (neg ? -b : b).toString().padStart(scale + 1, '0');
  return `${neg ? '-' : ''}${scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s}`;
}

/** A finite number, else ExprRuntimeError('overflow'), as the rest of the engine: never NaN or Infinity. */
const finite = (x: number): Value => (Number.isFinite(x) ? num(x) : fail('overflow'));

/**
 * Accumulator of `fn` over the values of a group.
 *
 * - `add()` takes `fromStored(field, raw)` Values only (or evaluator results), never raw stored text (C9): an SQL aggregate
 *   (A3) converts the stored values first, like a report (A5). A text Value is read in canonical form first ("12.34"), then
 *   in the region `info` (default en-US).
 * - `type`/`props`: the argument's type (aggregateArgType), which picks the arithmetic: Currency and Decimal sum exactly as
 *   scaled BigInt at their scale (0.1 + 0.2 = 0.3); integers as BigInt, switching to exact decimals at the first value that
 *   is not whole (an INTEGER column may hold 2.5: it is summed, never rounded); anything else (Double, dates…) as a
 *   compensated floating-point sum. The exact sum is rounded once to a double at the end. ponytail: a double holds 15-17
 *   significant digits, so a Currency sum is exact up to about 9e11 and the nearest double beyond.
 * - Only Null is skipped, as in Access; Empty (Nz without a replacement, A2-R7) counts as 0, or "" against text. An empty or
 *   all-Null group gives Null, except Count which gives 0. Count(*) counts rows: the caller adds a non-Null value per row.
 * - Min and Max compare as the evaluator does (text case-insensitive, dates by serial); for a numeric type, a numeric text is
 *   compared (and returned) as a number. First/Last: the first/last non-Null value.
 * - Sum and Avg of dates return a number of days (not a date). Avg of Currency is Currency: rounded to 4 decimals (banker's).
 * - StDev/Var (sample) and StDevP/VarP (population) use Welford's algorithm.
 * - Errors are ExprRuntimeError: a text that is not a number gives 'typeMismatch'; a result out of range gives 'overflow'
 *   (a non-finite double, or a Currency total beyond ±922 337 203 685 477.5807 compared on the stored double grid, so the
 *   largest storable value still sums).
 */
export function createAccumulator(fn: AggregateName, type: FieldType | null, props?: FieldProps, info: LocaleInfo = infoOf('en-US')): Accumulator {
  const fixed = exactScale(type, props);
  /** Integers start at scale 0 and grow to the decimals of a non-whole value; Currency and Decimal keep their scale. */
  const growing = fixed === 0 && !(type === 'number' && props?.numberSize === 'decimal');
  let scale = fixed ?? 0;
  const numeric = fixed !== null || type === 'number';
  const canonical: LocaleInfo = { ...info, decimalSep: '.', groupSep: '' };
  let n = 0;
  let exact = 0n;
  let sum = 0, carry = 0; // Neumaier
  let mean = 0, m2 = 0; // Welford
  let kept: Value = null; // Min, Max, First, Last

  /** Decimal text of a text Value: canonical form first, then the region. */
  const textDecimal = (t: string): string => toDecimal(t, canonical) ?? toDecimal(t, info) ?? fail('typeMismatch');
  const toNumber = (v: NonNullable<Value>): number => (v.t === 'str' ? Number(textDecimal(v.v)) : toNum(v, info));
  const addExact = (v: NonNullable<Value>) => {
    let d: string;
    if (v.t === 'str') d = textDecimal(v.v);
    else {
      const x = toNum(v, info);
      if (scale === 0 && Number.isSafeInteger(x)) { exact += BigInt(x); return; } // fast path for integers
      d = toDecimal(x, info) ?? fail('overflow');
    }
    if (growing) {
      const decimals = Math.min((d.split('.')[1] ?? '').length, 40); // ponytail: beyond 40 decimals, rounded
      if (decimals > scale) { exact *= 10n ** BigInt(decimals - scale); scale = decimals; }
    }
    exact += BigInt(roundDecimalString(d, scale).replace('.', ''));
  };
  const addNumber = (v: NonNullable<Value>) => {
    if (fixed !== null) { addExact(v); return; }
    const x = toNumber(v);
    const t = sum + x;
    carry += Math.abs(sum) >= Math.abs(x) ? (sum - t) + x : (x - t) + sum;
    sum = t;
  };
  /** Currency: the result compared on the stored double grid (the literal bound itself rounds to …477.625). */
  const inRange = (x: number): number => (type === 'currency' && Math.abs(x) > CURRENCY_LIMIT ? fail('overflow') : x);
  const total = (): Value => (fixed !== null ? finite(inRange(Number(decimalText(exact, scale)))) : finite(sum + carry));
  /** Avg divides at the end; an exact sum is divided in decimal, so 0.6 / 3 is 0.2. */
  const average = (): Value => {
    if (fixed === null) return finite((sum + carry) / n);
    const text = decimalText((exact * 10n ** BigInt(AVG_DIGITS)) / BigInt(n), scale + AVG_DIGITS);
    return finite(inRange(Number(type === 'currency' ? roundDecimalString(text, 4) : text)));
  };
  /** Min/Max of a numeric type: a numeric text is a number. */
  const comparable = (v: NonNullable<Value>): NonNullable<Value> => (numeric && v.t === 'str' ? num(toNumber(v)) : v);

  return {
    add(v) {
      if (v === null) return;
      switch (fn) {
        case 'Sum': case 'Avg': addNumber(v); break;
        case 'Min': case 'Max': {
          const x = comparable(v);
          const c = kept === null ? null : compare(x, kept, info);
          if (kept === null || (fn === 'Min' ? c! < 0 : c! > 0)) kept = x;
          break;
        }
        case 'First': if (kept === null) kept = v; break;
        case 'Last': kept = v; break;
        case 'StDev': case 'StDevP': case 'Var': case 'VarP': {
          const x = toNumber(v);
          const d = x - mean;
          mean += d / (n + 1);
          m2 += d * (x - mean);
          break;
        }
        case 'Count': break;
      }
      n++;
    },
    result() {
      switch (fn) {
        case 'Count': return num(n);
        case 'Sum': return n ? total() : null;
        case 'Avg': return n ? average() : null;
        case 'Min': case 'Max': case 'First': case 'Last': return kept;
        case 'Var': return n > 1 ? finite(m2 / (n - 1)) : null;
        case 'StDev': return n > 1 ? finite(Math.sqrt(m2 / (n - 1))) : null;
        case 'VarP': return n ? finite(m2 / n) : null;
        case 'StDevP': return n ? finite(Math.sqrt(m2 / n)) : null;
      }
    },
  };
}

// ---- Type of an aggregate's argument ----

/** Numeric family of a sub-expression for exact sums; null = floating point (Double, Single, text, dates…); 'null' = a
 *  Null literal, which takes the other branch's family. */
type Kind = { k: 'int' } | { k: 'cur' } | { k: 'dec'; scale: number } | { k: 'null' } | null;
type Exact = { k: 'int' } | { k: 'cur' } | { k: 'dec'; scale: number };

function fieldKind(type: FieldType, props: FieldProps): Kind {
  const s = exactScale(type, props);
  return s === null ? null : type === 'currency' ? { k: 'cur' } : s === 0 && props.numberSize !== 'decimal' ? { k: 'int' } : { k: 'dec', scale: s };
}
const scaleOf = (x: Exact): number => (x.k === 'dec' ? x.scale : x.k === 'cur' ? 4 : 0);

/** + - and the branches of IIf/Nz: integer < Currency < Decimal (at the larger scale); anything else is floating point. */
function combine(a: Kind, b: Kind): Kind {
  if (a?.k === 'null') return b;
  if (b?.k === 'null') return a;
  if (!a || !b) return null;
  if (a.k === 'dec' || b.k === 'dec') return { k: 'dec', scale: Math.max(scaleOf(a), scaleOf(b)) };
  return a.k === 'cur' || b.k === 'cur' ? { k: 'cur' } : { k: 'int' };
}

/** *: a Decimal product keeps every digit, at the sum of the scales (Currency counts as 4), at most 28 (C7). */
function multiply(a: Kind, b: Kind): Kind {
  if (a?.k === 'null' || b?.k === 'null' || !a || !b) return combine(a, b);
  return a.k === 'dec' || b.k === 'dec' ? { k: 'dec', scale: Math.min(scaleOf(a) + scaleOf(b), 28) } : combine(a, b);
}

/**
 * Type the accumulator of `Sum(e)` (or Avg, Min…) uses (contract 1.7, C7): a field reference has its own type; Currency with
 * integers or Currency stays Currency; Decimal with integers, Currency or Decimal stays Decimal, at the larger scale for + and
 * -, at the sum of the scales for *; a Null literal takes the other branch's type (`IIf(c, [Prix], Null)` stays Currency);
 * Int, Fix, Round, Abs keep their argument's type; anything with Double, Single, text or a division is floating point (type
 * null). A3 (`bc_agg_*`) and A5 (report totals) both call it, so `Sum([Qté]*[Prix])` is the same in a Totals query and a report.
 */
export function aggregateArgType(
  e: Expr, field: (name: string) => { type: FieldType; props: FieldProps } | undefined,
): { type: FieldType | null; props?: FieldProps } {
  if (e.k === 'id') {
    const f = field(e.name);
    return f ? { type: f.type, props: f.props } : { type: null };
  }
  const kind = (x: Expr): Kind => {
    switch (x.k) {
      case 'id': { const f = field(x.name); return f ? fieldKind(f.type, f.props) : null; }
      case 'num': return /^-?\d+$/.test(x.v) ? { k: 'int' } : null;
      case 'bool': return { k: 'int' };
      case 'null': return { k: 'null' };
      case 'un': return x.op === '-' ? kind(x.e) : null;
      case 'bin':
        if (x.op === '+' || x.op === '-') return combine(kind(x.l), kind(x.r));
        if (x.op === '*') return multiply(kind(x.l), kind(x.r));
        if (x.op === '\\' || x.op === 'Mod') return kind(x.l) && kind(x.r) ? { k: 'int' } : null;
        return null;
      case 'call':
        switch (x.name) {
          case 'CCur': return { k: 'cur' };
          case 'CInt': case 'CLng': return { k: 'int' };
          case 'Abs': case 'Int': case 'Fix': case 'Round': return kind(x.args[0]!);
          case 'Nz': return x.args.length === 1 ? kind(x.args[0]!) : combine(kind(x.args[0]!), kind(x.args[1]!));
          case 'IIf': return combine(kind(x.args[1]!), kind(x.args[2]!));
          default: return null;
        }
      default: return null;
    }
  };
  const k = kind(e);
  if (!k || k.k === 'null') return { type: null };
  if (k.k === 'cur') return { type: 'currency', props: defaultProps('currency') };
  if (k.k === 'int') return { type: 'number', props: { ...defaultProps('number'), numberSize: 'longInteger' } };
  return { type: 'number', props: { ...defaultProps('number'), numberSize: 'decimal', precision: 28, scale: k.scale } };
}
