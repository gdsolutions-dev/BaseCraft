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

/** The table's rule (Access's record-level rule) against the whole record `row` (absent fields: Null); Null passes, as for a field. */
async function recordFailure(design: TableDesign, rule: Expr | null, row: Record<string, SqlValue>, now: () => Date, info: LocaleInfo): Promise<'validation' | 'expressionError' | null> {
  if (!rule) return 'expressionError';
  try {
    const field = (n: string) => {
      const fd = design.fields.find((x) => sameName(x.name, n));
      return fd ? fromStored(fd, Object.hasOwn(row, fd.name) ? row[fd.name]! : null) : fail('unknownField');
    };
    return truthy(await evaluate(rule, { field, now, locale: info.locale }), info) === false ? 'validation' : null;
  } catch {
    return 'expressionError';
  }
}

const parseTableRule = (design: TableDesign): Expr | null => {
  try { return parseCanonical(design.validationRule!); } catch { return null; }
};

/** The table's rule against the record `row`: a failure has no field (''), names the table, and has its Validation Text as message. */
export async function checkRecordRule(design: TableDesign, row: Record<string, SqlValue>, now: () => Date, info: LocaleInfo = EN): Promise<{ field: string; code: 'validation' | 'expressionError'; message?: string; table: string } | null> {
  if (!design.validationRule) return null;
  const code = await recordFailure(design, parseTableRule(design), row, now, info);
  return code && { field: '', code, table: design.name, ...(code === 'validation' && design.validationText ? { message: design.validationText } : {}) };
}

/** Rows of `design.name` whose `field` breaks its rule (an evaluation error counts); `field` '': the table's rule. */
export async function countViolations(db: DatabaseSync, design: TableDesign, field: string, info: LocaleInfo = EN): Promise<number> {
  const now = () => new Date();
  if (field === '') {
    if (!design.validationRule) return 0;
    const rule = parseTableRule(design);
    let n = 0;
    const all = db.prepare(`SELECT ${design.fields.map((x) => quoteIdent(x.name)).join(', ')} FROM ${quoteIdent(design.name)}`);
    for (const row of all.iterate() as Iterable<Record<string, SqlValue>>) if (await recordFailure(design, rule, row, now, info)) n++;
    return n;
  }
  const fd = design.fields.find((x) => x.name === field);
  if (!fd?.props.validationRule) return 0;
  const stmt = db.prepare(`SELECT ${quoteIdent(fd.name)} FROM ${quoteIdent(design.name)}`);
  stmt.setReturnArrays(true);
  const rule = parseRule(fd);
  let n = 0;
  for (const [v] of stmt.iterate() as Iterable<SqlValue[]>) if (await ruleFailure(fd, rule, v ?? null, now, info)) n++;
  return n;
}
