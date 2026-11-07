import type { DatabaseSync } from 'node:sqlite';
import type { LocaleInfo } from '../shared/locale-format';
import { sameName } from '../shared/field-types';
import type { RecordSourceRef, SourceInfo } from '../shared/record-source';
import { flattenControls, validateDesignDoc, type ControlKind, type DesignDoc, type SectionKind } from '../shared/design/model';
import { autoForm } from '../shared/design/auto-form';
import { instantReport } from '../shared/report/instant';
import { bareName } from '../shared/report/model';
import { getObject, saveObject, setObjectDescription } from '../main/db/objects';
import { isTableName, tableDesign } from '../main/db/schema';
import { describeQuerySource } from '../main/query/source';
import type { OpOutcome } from './ops';

type Kind = 'form' | 'report';
const refuse = (message: string): OpOutcome => ({ ok: false, message });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The words the renderer's formLabels(t) resolves to in the en locale (designer.ctlPrefix.*, form.tabPage). */
const PREFIX: Record<ControlKind, string> = { label: 'Label', textBox: 'Text', checkBox: 'Check', optionGroup: 'Frame', optionButton: 'Option', comboBox: 'Combo',
  listBox: 'List', commandButton: 'Command', subform: 'Child', image: 'Image', line: 'Line', rectangle: 'Box', pageBreak: 'PageBreak', tabControl: 'TabCtl' };
export const LABELS = { prefix: (k: ControlKind) => PREFIX[k], tabPage: (n: number) => `Page${n}` };

const SECTIONS: Record<Kind, readonly SectionKind[]> = { form: ['formHeader', 'detail', 'formFooter'],
  report: ['reportHeader', 'pageHeader', 'groupHeader', 'detail', 'groupFooter', 'pageFooter', 'reportFooter'] };

/** Errors describeQuerySource throws by design: syntax, binding, an action query as a source, a missing table or query it names. */
const isSourceError = (e: unknown): e is Error => e instanceof Error && /^bc:(invalidQuery|queryBind|notSelectQuery|notFound)(\||$)/.test(e.message);

function readRef(v: unknown): RecordSourceRef | string {
  if (isObject(v) && (v.kind === 'table' || v.kind === 'query') && typeof v.name === 'string') return { kind: v.kind, name: v.name };
  if (isObject(v) && v.kind === 'sql' && typeof v.sql === 'string') return { kind: 'sql', sql: v.sql };
  return '"recordSource" must be { kind: "table"|"query", name } or { kind: "sql", sql }';
}

/** The fields of a record source, or the refusal message. A table is described from its design, as the application does (describeQuerySource takes queries and SQL only). */
function describe(db: DatabaseSync, ref: RecordSourceRef, info: LocaleInfo): { ref: RecordSourceRef; info: SourceInfo } | string {
  if (ref.kind === 'table') {
    if (!isTableName(db, ref.name)) return `record source not found: ${ref.name}`;
    const d = tableDesign(db, ref.name);
    return { ref: { kind: 'table', name: d.name }, info: { fields: d.fields.map((x) => ({ name: x.name, type: x.props.type, props: x.props, origin: { table: d.name, field: x.name } })), updatable: true, keyTable: d.name, parameters: [] } };
  }
  if (ref.kind === 'query') {
    const o = getObject(db, 'query', ref.name);
    if (!o) return `record source not found: ${ref.name}`;
    ref = { kind: 'query', name: o.name };
  }
  try {
    return { ref, info: describeQuerySource(db, ref, info) };
  } catch (e) {
    if (isSourceError(e)) return e.message.replace(/^bc:/, '');
    throw e;
  }
}

function create(kind: Kind, db: DatabaseSync, args: Record<string, unknown>, info: LocaleInfo): OpOutcome {
  const { name: rawName, layout, doc, recordSource, description, lang = 'en' } = args;
  if (typeof rawName !== 'string') return refuse('"name" must be a string');
  if (description !== undefined && typeof description !== 'string') return refuse('"description" must be a string');
  if (layout !== 'auto' && layout !== 'doc') return refuse('"layout" must be "auto" or "doc"');
  if (kind === 'report' && lang !== 'fr' && lang !== 'en') return refuse('"lang" must be "fr" or "en"');
  const name = rawName.normalize('NFC');
  let design: DesignDoc;
  if (layout === 'auto') {
    if (doc !== undefined) return refuse('"doc" is only allowed when layout is "doc"');
    if (recordSource === undefined) return refuse('"recordSource" is required when layout is "auto"');
    const ref = readRef(recordSource);
    if (typeof ref === 'string') return refuse(ref);
    const d = describe(db, ref, info);
    if (typeof d === 'string') return refuse(d);
    const title = d.ref.kind === 'sql' ? name : d.ref.name;
    design = kind === 'form' ? autoForm(d.ref, title, d.info, LABELS) : instantReport({ ...d.ref, name: title }, d.info, { lang: lang as 'fr' | 'en' });
  } else {
    if (recordSource !== undefined) return refuse('"recordSource" goes inside "doc" when layout is "doc"');
    if (doc === undefined) return refuse('"doc" is required when layout is "doc"');
    const errors = validateDesignDoc(doc);
    if (errors.length) return refuse(errors.map((e) => `design: ${e}`).join('; '));
    design = doc as DesignDoc;
    const wrong = design.sections.findIndex((s) => !SECTIONS[kind].includes(s.kind));
    if (wrong >= 0) return refuse(`design: sections[${wrong}].kind (${design.sections[wrong].kind} is not a ${kind} section)`);
    let fields: SourceInfo['fields'] = [];
    if (design.recordSource) {
      const d = describe(db, design.recordSource, info);
      if (typeof d === 'string') return refuse(d);
      fields = d.info.fields;
    }
    for (const c of design.sections.flatMap((s) => flattenControls(s.controls))) {
      const src = c.props.ControlSource;
      if (src === undefined || src === '') continue;
      if (typeof src !== 'string') return refuse(`control ${c.name}: ControlSource must be a string`);
      if (src.startsWith('=')) continue; // an expression, not checked here
      const field = kind === 'report' ? bareName(src) : src; // a report also takes [Field]
      if (!fields.some((f) => sameName(f.name, field))) return refuse(`control ${c.name}: ControlSource "${src}" is not a field of the record source`);
    }
  }
  const r = saveObject(db, kind, name, design, null);
  if (!r.ok) return refuse(r.reason === 'nameExists' ? `${kind} name already used: ${name}` : r.reason === 'nameInvalid' ? `invalid ${kind} name: ${name}` : r.reason);
  if (description !== undefined) setObjectDescription(db, kind, name, description);
  return { ok: true };
}

export const formCreate = (db: DatabaseSync, args: Record<string, unknown>, info: LocaleInfo): OpOutcome => create('form', db, args, info);
export const reportCreate = (db: DatabaseSync, args: Record<string, unknown>, info: LocaleInfo): OpOutcome => create('report', db, args, info);
