// Moteur du Masque de saisie (syntaxe Access). Le masque est stocké tel quel : ce n'est pas une expression.
// ponytail: `.` `,` `:` `/` restent les caractères écrits (Access les remplace par les séparateurs régionaux) ; `!` (remplissage
// de droite à gauche) est ignoré ; le masque « Password » n'est pas géré.

export type MaskSlot = { kind: 'literal'; ch: string } | { kind: 'input'; accept: 'digit' | 'digitOrSpace' | 'letter' | 'alnum' | 'any'; required: boolean; caseRule: 'none' | 'lower' | 'upper' };
export interface Mask { slots: MaskSlot[]; storeLiterals: boolean; placeholder: string }
export type MaskErrorCode = 'maskUnclosedQuote' | 'maskTrailingBackslash' | 'maskNoInput' | 'maskBadSection';

export class MaskSyntaxError extends Error {
  constructor(public code: MaskErrorCode) {
    super(code);
    this.name = 'MaskSyntaxError';
  }
}

const INPUTS: Record<string, [Extract<MaskSlot, { kind: 'input' }>['accept'], boolean]> = {
  0: ['digit', true], 9: ['digit', false], '#': ['digitOrSpace', false],
  L: ['letter', true], '?': ['letter', false], A: ['alnum', true], a: ['alnum', false], '&': ['any', true], C: ['any', false],
};
const ACCEPT = { digit: /^[0-9]$/, digitOrSpace: /^[0-9 +-]$/, letter: /^\p{L}$/u, alnum: /^[\p{L}\p{N}]$/u, any: /^[^]$/u };

export function parseMask(text: string): Mask {
  const chars = Array.from(text);
  const slots: MaskSlot[] = [];
  let caseRule: 'none' | 'lower' | 'upper' = 'none';
  let i = 0;
  for (; i < chars.length && chars[i] !== ';'; i++) {
    const c = chars[i];
    if (c === '\\') {
      if (++i >= chars.length) throw new MaskSyntaxError('maskTrailingBackslash');
      slots.push({ kind: 'literal', ch: chars[i] });
    } else if (c === '"') {
      const end = chars.indexOf('"', i + 1);
      if (end < 0) throw new MaskSyntaxError('maskUnclosedQuote');
      for (const ch of chars.slice(i + 1, end)) slots.push({ kind: 'literal', ch });
      i = end;
    } else if (c === '<') caseRule = 'lower';
    else if (c === '>') caseRule = chars[i - 1] === '<' ? 'none' : 'upper'; // <> : no conversion
    else if (c === '!') continue;
    else if (Object.hasOwn(INPUTS, c)) slots.push({ kind: 'input', accept: INPUTS[c][0], required: INPUTS[c][1], caseRule });
    else slots.push({ kind: 'literal', ch: c });
  }
  if (!slots.some((s) => s.kind === 'input')) throw new MaskSyntaxError('maskNoInput');
  const [store = '', ...rest] = chars.slice(i + 1).join('').split(';');
  const placeholder = Array.from(rest.join(';')); // the placeholder may itself be « ; »
  if (!['', '0', '1'].includes(store) || placeholder.length > 1) throw new MaskSyntaxError('maskBadSection');
  return { slots, storeLiterals: store === '0', placeholder: placeholder[0] ?? '_' };
}

/** `c` as the input slot `s` takes it (case rule applied), or null when the slot refuses it. */
export function fitSlot(s: Extract<MaskSlot, { kind: 'input' }>, c: string): string | null {
  if (c === ' ' && !s.required) return ' '; // an optional slot takes a space (Access: « 9 » is a digit or a space)
  if (!ACCEPT[s.accept].test(c)) return null;
  const cased = s.caseRule === 'upper' ? c.toLocaleUpperCase() : s.caseRule === 'lower' ? c.toLocaleLowerCase() : c;
  return Array.from(cased).length === 1 ? cased : c; // « ß » stays one character (never « SS »)
}

/** Typing `ch` at input slot `k`, when no slot takes it: the input slot after the first literal `ch` reached by skipping only
 *  optional slots (`99-00`: « 1 » then « - » goes to the first 0), else null. */
export function skipToLiteral(mask: Mask, k: number, ch: string): number | null {
  let seen = 0; // input slots before this one
  for (const s of mask.slots) {
    if (s.kind === 'literal') { if (seen > k && s.ch === ch) return seen; } // seen === k: before slot k, already passed
    else if (seen++ >= k && s.required) return null;
  }
  return null;
}

/**
 * Each input slot's character ('' empty), filled left to right from `text`. A literal is taken when the text has it (a value
 * may come with or without its literals); the placeholder leaves its slot empty; a character an optional slot refuses leaves
 * that slot empty for the next one. One a required slot refuses: dropped (lenient) or a failure (strict: null).
 */
function fillSlots(mask: Mask, text: string, strict: boolean): string[] | null {
  const chars = Array.from(text);
  const fills: string[] = [];
  let i = 0;
  for (const s of mask.slots) {
    if (s.kind === 'literal') { if (chars[i] === s.ch) i++; continue; }
    for (;;) {
      const c = chars[i];
      if (c === undefined) { fills.push(''); break; }
      if (c === mask.placeholder) { i++; fills.push(''); break; }
      const fit = fitSlot(s, c);
      if (fit !== null) { i++; fills.push(fit); break; }
      if (!s.required) { fills.push(''); break; }
      if (strict) return null;
      i++;
    }
  }
  return strict && i < chars.length ? null : fills;
}

/** The editor's prefill: what fits of `value`, slot by slot. */
export const maskFills = (mask: Mask, value: string): string[] => fillSlots(mask, value, false)!;

/** The masked text: literals, then each slot's character or the placeholder. */
export function renderMask(mask: Mask, fills: readonly string[]): string {
  let k = 0;
  return mask.slots.map((s) => (s.kind === 'literal' ? s.ch : fills[k++] || mask.placeholder)).join('');
}

const complete = (mask: Mask, fills: readonly string[]) => mask.slots.filter((s) => s.kind === 'input').every((s, k) => !s.required || fills[k] !== '');

export function applyMask(mask: Mask, typed: string): { display: string; complete: boolean } {
  const fills = maskFills(mask, typed);
  return { display: renderMask(mask, fills), complete: complete(mask, fills) };
}

/** `value` matches the mask: the text to store, with or without literals per the mask. An empty optional slot is stored as a
 *  space, as in Access, so that positions survive when literals are not stored (A2-R11). */
export function checkMasked(mask: Mask, value: string): { ok: true; stored: string } | { ok: false } {
  const fills = fillSlots(mask, value, true);
  if (!fills || !complete(mask, fills)) return { ok: false };
  let k = 0;
  const stored = mask.slots.map((s) => (s.kind === 'input' ? fills[k++] || ' ' : mask.storeLiterals ? s.ch : '')).join('');
  return { ok: true, stored };
}
