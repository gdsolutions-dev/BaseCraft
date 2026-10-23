// Table Fields edits, as pure functions: a new design and the mapping that tells the save which field is which. The table's
// rule and indexes are left alone: the save (alterTable) follows renames and drops deleted fields from them by the mapping.
import type { FieldMapping } from '../../shared/api';
import type { NamedFormat } from '../../shared/expr/format';
import { changeType, defaultProps, sameName, type FieldDef, type FieldProps, type FieldType, type NumberSize, type TableDesign } from '../../shared/field-types';

export interface FieldEdit { design: TableDesign; mapping: FieldMapping[] }

const same = (d: TableDesign): FieldMapping[] => d.fields.map((f) => ({ name: f.name, sourceName: f.name }));
const find = (d: TableDesign, field: string) => d.fields.findIndex((f) => sameName(f.name, field));

/** A new field after `after` (the end without it), named `${base}${n}` with the smallest free n ≥ 1. */
export function addField(d: TableDesign, after: string | null, type: FieldType, opts: { numberSize?: NumberSize; base: string }): FieldEdit {
  let n = 1;
  while (d.fields.some((f) => sameName(f.name, `${opts.base}${n}`))) n++;
  const name = `${opts.base}${n}`;
  const props: FieldProps = { ...defaultProps(type), ...(opts.numberSize ? { numberSize: opts.numberSize } : {}) };
  const at = after === null ? d.fields.length : find(d, after) + 1 || d.fields.length;
  const fields: FieldDef[] = [...d.fields.slice(0, at), { name, props }, ...d.fields.slice(at)];
  return { design: { ...d, fields }, mapping: fields.map((f) => ({ name: f.name, sourceName: f === fields[at] ? null : f.name })) };
}

const edit = (d: TableDesign, field: string, fn: (f: FieldDef) => FieldDef): FieldEdit => {
  const fields = d.fields.map((f) => (sameName(f.name, field) ? fn(f) : f));
  return { design: { ...d, fields }, mapping: d.fields.map((f, i) => ({ name: fields[i].name, sourceName: f.name })) };
};

/** Other properties are kept; a changed type goes through changeType (the properties of the old type go). */
export function patchField(d: TableDesign, field: string, patch: Partial<FieldProps>): FieldEdit {
  return edit(d, field, (f) => {
    const base = patch.type && patch.type !== f.props.type ? changeType(f.props, patch.type) : f.props;
    return { ...f, props: { ...base, ...patch } };
  });
}

/** An empty caption or description is removed. */
export function renameField(d: TableDesign, field: string, name: string, caption: string | undefined, description: string | undefined): FieldEdit {
  return edit(d, field, (f) => {
    const { caption: _c, description: _d, ...rest } = f.props;
    return { name, props: { ...rest, ...(caption ? { caption } : {}), ...(description ? { description } : {}) } as FieldProps };
  });
}

export function removeField(d: TableDesign, field: string): FieldEdit {
  const fields = d.fields.filter((f) => !sameName(f.name, field));
  return { design: { ...d, fields }, mapping: same({ ...d, fields }) };
}

const NAMED = { currency: 'currency', percent: 'percent', comma: 'standard' } as const satisfies Record<string, NamedFormat>; // stored by id, as Design view does
/** Currency / Percent / Comma buttons: Number and Currency fields only (null elsewhere). */
export function namedFormatPatch(p: FieldProps, kind: keyof typeof NAMED): Partial<FieldProps> | null {
  return p.type === 'number' || p.type === 'currency' ? { format: NAMED[kind] } : null;
}

/** Increase / Decrease Decimals: Auto becomes 2 whichever way, then ±1 within 0–15. */
export function stepDecimals(p: FieldProps, delta: 1 | -1): Partial<FieldProps> {
  const n = typeof p.decimalPlaces === 'number' ? Math.min(15, Math.max(0, p.decimalPlaces + delta)) : 2;
  return { decimalPlaces: n };
}

/** Unique: yesNoDuplicates ↔ no. Indexed: yesDuplicates ↔ no, and on a unique field it removes the index. */
export function toggleIndex(p: FieldProps, which: 'unique' | 'indexed'): Partial<FieldProps> {
  if (which === 'unique') return { indexed: p.indexed === 'yesNoDuplicates' ? 'no' : 'yesNoDuplicates' };
  return { indexed: p.indexed === 'no' ? 'yesDuplicates' : 'no' };
}

/** The table's own Validation Rule / Message (Record Validation); empty removes it. The fields are unchanged. */
export function patchTable(d: TableDesign, patch: { validationRule?: string; validationText?: string }): FieldEdit {
  const { validationRule: _r, validationText: _t, ...rest } = d;
  const next = { ...{ validationRule: d.validationRule, validationText: d.validationText }, ...patch };
  return { design: { ...rest, ...(next.validationRule ? { validationRule: next.validationRule } : {}), ...(next.validationText ? { validationText: next.validationText } : {}) }, mapping: same(d) };
}
