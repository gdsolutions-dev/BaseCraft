// Stored definition of a macro (`bc_objects`, kind 'macro'): checked when received over IPC and when read back. Pure module.
// Invariant names are stored (action, argument, enum value, canonical expression); labels come from the i18n catalogues.
import { parseCanonical } from '../expr/parser';
import { foldName, isValidObjectName, sameName } from '../field-types';
import { actionDef } from './catalog';

export interface MacroDef { formatVersion: '1.0'; items: MacroItem[] }
export type MacroItem =
  | { k: 'action'; action: string /* invariant; may be unknown */; args: Record<string, string> }
  | { k: 'comment'; text: string }
  | { k: 'group'; name: string; items: MacroItem[] }
  | { k: 'if'; branches: { cond: string /* canonical */; items: MacroItem[] }[] /* ≥ 1: If, then Else If */; else?: MacroItem[] }
  | { k: 'submacro'; name: string; items: MacroItem[] };

export const MAX_MACRO_ITEMS = 10_000;
export const MAX_MACRO_DEPTH = 32;

export type MacroIssue = { path: string /* 'items[2].branches[0].cond' */; code: 'shape' | 'tooMany' | 'tooDeep' | 'submacroPlace' | 'submacroOrder'
  | 'duplicateName' | 'badName' | 'emptyCondition' | 'badExpression' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const KINDS = new Set(['action', 'comment', 'group', 'if', 'submacro']);

function parses(text: string): boolean {
  try { parseCanonical(text); return true; } catch { return false; }
}

/**
 * The issues of a definition ([] = valid). Unknown keys, actions and arguments are not issues (a newer BaseCraft may have
 * written them); a missing required argument is not either (the interpreter reports it when the action runs).
 * Paths look like `items[2].branches[0].cond`; a block deeper than MAX_MACRO_DEPTH and every item past MAX_MACRO_ITEMS
 * are reported and not walked further.
 */
export function validateMacro(def: unknown): MacroIssue[] {
  const issues: MacroIssue[] = [];
  const add = (path: string, code: MacroIssue['code']): void => { issues.push({ path, code }); };
  if (!isObject(def) || def.formatVersion !== '1.0') return [{ path: isObject(def) ? 'formatVersion' : '', code: 'shape' }];
  if (!Array.isArray(def.items)) return [{ path: 'items', code: 'shape' }];

  let count = 0, full = false;
  const submacros = new Map<string, string[]>();

  const checkAction = (node: Record<string, unknown>, p: string): void => {
    if (typeof node.action !== 'string') add(`${p}.action`, 'shape');
    if (!isObject(node.args)) return add(`${p}.args`, 'shape');
    const known = typeof node.action === 'string' ? actionDef(node.action) : undefined;
    for (const [name, value] of Object.entries(node.args)) {
      if (typeof value !== 'string') { add(`${p}.args.${name}`, 'shape'); continue; }
      const type = known?.args.find((a) => a.name === name)?.type;
      const formula = type === 'expression' || type === 'where' || type === 'reference' ? value.trim() === '' ? undefined : value   // blank: not set
        : (type === 'text' || type === 'number') && value.startsWith('=') ? value.slice(1) : undefined;     // '=' + expression
      if (formula !== undefined && !parses(formula)) add(`${p}.args.${name}`, 'badExpression');
    }
  };

  const walk = (items: unknown[], listPath: string, level: number): void => {
    const sub = (list: unknown, path: string): void => { if (Array.isArray(list)) walk(list, path, level + 1); else add(path, 'shape'); };
    let afterSubmacro = false;
    for (let i = 0; i < items.length && !full; i++) {
      const p = `${listPath}[${i}]`, node = items[i];
      if (!isObject(node) || typeof node.k !== 'string' || !KINDS.has(node.k)) { add(p, 'shape'); continue; }
      if (++count > MAX_MACRO_ITEMS) { full = true; add(p, 'tooMany'); return; }
      if (level === 0) { if (node.k === 'submacro') afterSubmacro = true; else if (afterSubmacro) add(p, 'submacroOrder'); }
      if (level >= MAX_MACRO_DEPTH && node.k !== 'action' && node.k !== 'comment') { add(p, 'tooDeep'); continue; }
      switch (node.k) {
        case 'action': checkAction(node, p); break;
        case 'comment': if (typeof node.text !== 'string') add(`${p}.text`, 'shape'); break;
        case 'group':
          if (typeof node.name !== 'string') add(`${p}.name`, 'shape');   // free text: any string, empty included
          sub(node.items, `${p}.items`);
          break;
        case 'submacro':
          if (level > 0) add(p, 'submacroPlace');
          if (typeof node.name !== 'string') add(`${p}.name`, 'shape');
          else if (!isValidObjectName(node.name)) add(`${p}.name`, 'badName');
          else {
            // sameName decides; the buckets only keep it from comparing every pair (10,000 submacros took ~2 s)
            const key = foldName(node.name), bucket = submacros.get(key) ?? [];
            if (bucket.some((n) => sameName(n, node.name as string))) add(`${p}.name`, 'duplicateName');
            else submacros.set(key, [...bucket, node.name]);
          }
          sub(node.items, `${p}.items`);
          break;
        case 'if': {
          if (!Array.isArray(node.branches) || node.branches.length === 0) add(`${p}.branches`, 'shape');
          else node.branches.forEach((b: unknown, j: number) => {
            const bp = `${p}.branches[${j}]`;
            if (!isObject(b)) return add(bp, 'shape');
            if (typeof b.cond !== 'string') add(`${bp}.cond`, 'shape');
            else if (b.cond.trim() === '') add(`${bp}.cond`, 'emptyCondition');
            else if (!parses(b.cond)) add(`${bp}.cond`, 'badExpression');
            sub(b.items, `${bp}.items`);
          });
          if (node.else !== undefined) sub(node.else, `${p}.else`);
          break;
        }
      }
    }
  };
  walk(def.items, 'items', 0);
  return issues;
}

/** The definition as stored, after checking its shape. Unknown keys are kept (the object itself is returned); the other
 *  issues (limits, names, expressions) are for the designer and the interpreter to report. Throws Error('bc:invalidDefinition'). */
export function parseMacroDef(def: unknown): MacroDef {
  if (validateMacro(def).some((i) => i.code === 'shape')) throw new Error('bc:invalidDefinition');
  return def as MacroDef;
}

/** Names of the submacros, in order. */
export const submacroNames = (def: MacroDef): string[] => def.items.flatMap((i) => (i.k === 'submacro' ? [i.name] : []));

export const emptyMacro = (): MacroDef => ({ formatVersion: '1.0', items: [] });
