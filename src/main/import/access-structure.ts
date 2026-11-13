// Access import (E2): one exported Access table (keys, indexes, field properties) laid over the design the file-only reader gave.
import type { ExportField, ExportTable } from '../../shared/access-export';
import type { ReportLine } from '../../shared/access-import';
import { usableProps } from '../db/schema';
import { cmToTwips, DEFAULT_COLUMN_WIDTH, LOOKUP_TYPES, MAX_INDEXES, sameName, splitValueList, validateDesign,
  type FieldDef, type FieldProps, type IndexDef, type LookupProps, type TableDesign } from '../../shared/field-types';

type Prop = string | number | boolean | undefined;
const text = (v: Prop): string | undefined => (v === undefined || v === '' ? undefined : String(v));
const bool = (v: Prop): boolean | undefined => (v === undefined || v === '' ? undefined : v === true || v === 1 || v === 'True' || v === 'true');
const num = (v: Prop): number | undefined => { const n = v === undefined || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; };

/** One width as DAO writes it ("0", "2,54cm", "1in", "1440twip"): twips; a blank one is the default. */
function twips(x: string): number | undefined {
  const m = /^\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*(twips?|in|cm)?\s*$/i.exec(x);
  if (x.trim() === '') return DEFAULT_COLUMN_WIDTH;
  if (!m) return undefined;
  const n = Number(m[1].replace(',', '.'));
  const unit = m[2]?.toLowerCase();
  return unit === 'cm' ? cmToTwips(`${n}`) ?? undefined : unit === 'in' ? Math.round(n * 1440) : Math.round(n);
}

/** The lookup of an exported field (list box or combo box only), or 'dropped' when BaseCraft cannot carry it. */
function lookupOf(f: ExportField, type: FieldProps['type']): LookupProps | 'dropped' | undefined {
  const p = f.props;
  const control = num(p.DisplayControl);
  if (control !== 110 && control !== 111) return undefined;
  const source = String(p.RowSource ?? '');
  const kind = text(p.RowSourceType);
  if (!LOOKUP_TYPES.includes(type) || !kind) return 'dropped';
  const rest: Record<string, unknown> = { limitToList: bool(p.LimitToList) ?? false, displayControl: control === 110 ? 'listBox' : 'comboBox' };
  const set = (k: string, v: unknown) => { if (v !== undefined) rest[k] = v; };
  set('boundColumn', num(p.BoundColumn)); set('columnCount', num(p.ColumnCount)); set('columnHeads', bool(p.ColumnHeads));
  set('listRows', num(p.ListRows)); set('allowValueListEdits', bool(p.AllowValueListEdits));
  const width = text(p.ListWidth); set('listWidth', width === undefined ? undefined : twips(width));
  const widths = text(p.ColumnWidths)?.replace(/;\s*$/, '').split(';').map(twips);
  if (widths?.every((w) => w !== undefined)) rest.columnWidths = widths;
  switch (kind.toLowerCase()) {
    case 'value list': return { ...rest, kind: 'values', values: splitValueList(source).map((v) => v.replace(/^"(.*)"$/, '$1')) } as LookupProps;
    case 'table/query': return { ...rest, kind: 'table', table: source } as LookupProps;
    case 'field list': return { ...rest, kind: 'fieldList', table: source } as LookupProps;
    default: return 'dropped';
  }
}

/** `design`: what accessDesign gave (types, sizes, skipped columns already left out). Returns the design completed from the
 *  export's table, and the report lines of what could not be carried. Never throws on an export value: what BaseCraft
 *  refuses is dropped and reported, so that the table is always created. `applied` is false when nothing could be carried
 *  (the design is then the input one). */
export function withStructure(design: TableDesign, t: ExportTable): { design: TableDesign; lines: ReportLine[]; applied: boolean } {
  const object = design.name;
  const lines: ReportLine[] = [];
  const fields: FieldDef[] = design.fields.map((fd) => ({ name: fd.name, props: { ...fd.props } }));
  const at = (name: string) => fields.find((f) => sameName(f.name, name));

  for (const f of t.fields) {
    const fd = at(f.name);
    if (!fd) continue;
    const p = fd.props;
    const ex = f.props;
    const set = <K extends keyof FieldProps>(k: K, v: FieldProps[K] | undefined) => { if (v !== undefined) p[k] = v; };
    p.required = f.required;
    if (p.type === 'shortText' || p.type === 'longText') p.allowZeroLength = f.allowZeroLength;
    // A Yes/No default written as a word is the boolean literal the table designer stores (True / False).
    const dv = text(f.defaultValue);
    const word = p.type === 'yesNo' ? /^(?:(yes|on)|(no|off))$/i.exec(dv?.trim() ?? '') : null;
    set('defaultValue', word ? (word[1] ? 'True' : 'False') : dv); set('validationRule', text(f.validationRule)); set('validationText', text(f.validationText));
    set('caption', text(ex.Caption)); set('description', text(ex.Description)); set('format', text(ex.Format)); set('inputMask', text(ex.InputMask));
    const places = num(ex.DecimalPlaces);
    if ((p.type === 'number' || p.type === 'currency') && places !== undefined && (places === 255 || (Number.isInteger(places) && places >= 0 && places <= 15))) p.decimalPlaces = places === 255 ? 'auto' : places;
    const rich = num(ex.TextFormat);
    if (p.type === 'longText' && rich !== undefined) p.textFormat = rich === 1 ? 'rich' : 'plain';
    const lookup = lookupOf(f, p.type);
    if (lookup === 'dropped') lines.push({ code: 'propertyDropped', object, part: fd.name, reason: 'lookup' });
    else if (lookup) p.lookup = lookup;
    // Only props createTable accepts: a refused lookup is dropped alone, any other refusal gives back the field's input props.
    if (p.lookup && !usableProps({ ...p })) { delete p.lookup; lines.push({ code: 'propertyDropped', object, part: fd.name, reason: 'lookup' }); }
    if (!usableProps({ ...p })) { fd.props = { ...design.fields.find((x) => sameName(x.name, f.name))!.props }; lines.push({ code: 'propertyDropped', object, part: fd.name }); }
  }

  const names = (ix: ExportTable['indexes'][number]) => ix.fields.map((x) => at(x.name)?.name);
  const indexes: IndexDef[] = [];
  // A multi-field index is kept only if the design accepts it as it stands; a refused one is reported alone.
  const addIndex = (ix: IndexDef) => {
    if (validateDesign({ ...design, fields, indexes: [...indexes, ix] }).some((e) => e.code === 'invalidIndex')) lines.push({ code: 'indexDropped', object, part: ix.name });
    else indexes.push(ix);
  };
  const indexOn = (name: string, unique: boolean) => {
    const p = at(name)!.props;
    if (unique || p.indexed === 'no') p.indexed = unique ? 'yesNoDuplicates' : 'yesDuplicates';
  };
  const key = t.indexes.find((ix) => ix.primary);
  const keyNames = key ? names(key) : [];
  const keyKnown = !!key && keyNames.every((n) => n !== undefined);
  const auto = fields.find((f) => f.props.type === 'autoNumber');
  if (key && !keyKnown) lines.push({ code: 'indexDropped', object, part: key.name });
  else if (key && auto && keyNames.length) {
    if (!(keyNames.length === 1 && keyNames[0] === auto.name)) {
      lines.push({ code: 'keyApproximated', object, part: keyNames.join(', ') });
      if (keyNames.length === 1) indexOn(keyNames[0]!, true);
      else addIndex({ name: key.name, unique: true, fields: key.fields.map((x, i) => ({ name: keyNames[i]!, desc: x.desc })) });
    }
  } else if (key) for (const n of keyNames) at(n!)!.props.primaryKey = true;

  // Counted as validateDesign counts: once the design holds the most indexes BaseCraft accepts, the rest are one line, not examined.
  const full = () => indexes.length > 0 && indexes.length + fields.filter((f) => f.props.indexed !== 'no').length >= MAX_INDEXES;
  for (const ix of t.indexes) {
    if (ix.primary || ix.foreign) continue;
    if (full()) { lines.push({ code: 'indexDropped', object }); break; }
    const ns = names(ix);
    if (!ix.fields.length || ns.some((n) => n === undefined)) lines.push({ code: 'indexDropped', object, part: ix.name });
    else if (ns.length === 1) indexOn(ns[0]!, ix.unique);
    else addIndex({ name: ix.name, unique: ix.unique, fields: ix.fields.map((x, i) => ({ name: ns[i]!, desc: x.desc })) });
  }

  const out: TableDesign = { ...design, fields };
  for (const k of ['description', 'validationRule', 'validationText'] as const) { const v = text(t[k]); if (v !== undefined) out[k] = v; }
  if (indexes.length) out.indexes = indexes;

  // What BaseCraft refuses is dropped one property at a time, so that the table is still created.
  for (const e of validateDesign(out)) {
    if (e.code !== 'invalidExpression' && e.code !== 'invalidMask') continue;
    const reason = e.code === 'invalidMask' ? 'inputMask' : e.prop!;
    if (e.field === undefined) delete out.validationRule;
    else delete at(e.field)!.props[reason];
    lines.push(e.field === undefined ? { code: 'propertyDropped', object, reason } : { code: 'propertyDropped', object, part: e.field, reason });
  }
  const left = validateDesign(out)[0];
  if (left) return { design, lines: [{ code: 'propertyDropped', object, reason: left.code }], applied: false };
  return { design: out, lines, applied: true };
}
