// Valeurs par défaut et règles « Valide si » appliquées par la couche d'écriture (et contrôle des données existantes).
import type { DatabaseSync } from 'node:sqlite';
import type { CellInput, SqlValue } from '../../shared/coerce';
import { defaultInput, evaluate, fromStored, truthy } from '../../shared/expr/evaluate';
import { fail, infoOf } from '../../shared/expr/library';
import type { Expr } from '../../shared/expr/ast';
import { parseCanonical } from '../../shared/expr/parser';
import { sameName, type FieldDef, type TableDesign } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { quoteIdent } from './schema';

/** The default value of `field` could not be computed (expressionError on that field). */
export class DefaultValueError extends Error {
  constructor(public field: string) {
    super(`default value: ${field}`);
    this.name = 'DefaultValueError';
  }
}

const EN = infoOf('en-US');

/** Each field absent from `values` that has a default gets it (an explicit null is kept, as in Access). */
export async function applyDefaults(design: TableDesign, values: Record<string, CellInput>, info: LocaleInfo, now: () => Date): Promise<Record<string, CellInput>> {
  const added: [string, CellInput][] = [];
  for (const fd of design.fields) {
    if (!fd.props.defaultValue || fd.props.type === 'autoNumber' || Object.hasOwn(values, fd.name)) continue;
    try {
      added.push([fd.name, await defaultInput(fd, info, now)]);
    } catch {
      throw new DefaultValueError(fd.name);
    }
  }
  return Object.fromEntries([...Object.entries(values), ...added]); // fromEntries: a field named __proto__ stays a key
}

function parseRule(fd: FieldDef): Expr | null {
  try { return parseCanonical(fd.props.validationRule!, { criteria: true }); } catch { return null; }
}

/** null when the stored value satisfies the field's rule; only False fails (Null passes, unless the rule says Is Not Null). */
async function ruleFailure(fd: FieldDef, rule: Expr | null, v: SqlValue, now: () => Date, info: LocaleInfo): Promise<'validation' | 'expressionError' | null> {
  if (!rule) return 'expressionError';
  try {
    const subject = fromStored(fd, v);
    // validateDesign allows only the field itself in its rule.
    const r = await evaluate(rule, {
      field: (n) => (sameName(n, fd.name) ? subject : fail('unknownField')), subject, now, locale: info.locale,
    });
    return truthy(r, info) === false ? 'validation' : null;
  } catch {
    return 'expressionError';
  }
}

/** Rules of the `changed` fields against the stored values (absent: Null). `info` (extra): region of text conversions. */
export async function checkRules(design: TableDesign, stored: Record<string, SqlValue>, changed: string[], now: () => Date, info: LocaleInfo = EN): Promise<{ field: string; code: 'validation' | 'expressionError'; message?: string }[]> {
  const errors: { field: string; code: 'validation' | 'expressionError'; message?: string }[] = [];
  for (const fd of design.fields) {
    if (!fd.props.validationRule || fd.props.type === 'autoNumber' || !changed.includes(fd.name)) continue;
    const code = await ruleFailure(fd, parseRule(fd), Object.hasOwn(stored, fd.name) ? stored[fd.name]! : null, now, info);
    if (code) errors.push({ field: fd.name, code, ...(code === 'validation' && fd.props.validationText ? { message: fd.props.validationText } : {}) });
  }
  return errors;
}

/** Rows of `design.name` whose `field` breaks its rule (an evaluation error counts). */
export async function countViolations(db: DatabaseSync, design: TableDesign, field: string, info: LocaleInfo = EN): Promise<number> {
  const fd = design.fields.find((x) => x.name === field);
  if (!fd?.props.validationRule) return 0;
  const now = () => new Date();
  const stmt = db.prepare(`SELECT ${quoteIdent(fd.name)} FROM ${quoteIdent(design.name)}`);
  stmt.setReturnArrays(true);
  const rule = parseRule(fd);
  let n = 0;
  for (const [v] of stmt.iterate() as Iterable<SqlValue[]>) if (await ruleFailure(fd, rule, v ?? null, now, info)) n++;
  return n;
}
