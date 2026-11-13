import type { DatabaseSync } from 'node:sqlite';
import type { LocaleInfo } from '../shared/locale-format';
import { sameName } from '../shared/field-types';
import type { RecordSourceRef, SourceInfo } from '../shared/record-source';
import { flattenControls, validateDesignDoc, type ControlDef, type ControlKind, type DesignDoc, type SectionKind } from '../shared/design/model';
import { isColorValue } from '../shared/design/colors';
import { autoForm } from '../shared/design/auto-form';
import { instantReport } from '../shared/report/instant';
import { bareName } from '../shared/report/model';
import { AGGS, CHART_TYPES, CHART_MAX_AXIS, CHART_MAX_SERIES, CHART_MAX_VALUES, DASHES, DATE_GROUPS, GAPS, isLineWidth, LINE_WIDTH, readChartSpec, SERIES_TYPES } from '../shared/chart/spec';
import { chartFormatIssue } from '../shared/chart/option';
import { TRENDLINES } from '../shared/chart/trend';
import { getObject, listObjects, saveObject, setObjectDescription } from '../main/db/objects';
import { isTableName, tableDesign } from '../main/db/schema';
import { describeQuerySource } from '../main/query/source';
import { listResources } from '../main/db/resources';
import { usedResourceNames } from '../shared/pictures';
import type { OpOutcome } from './ops';
import { checkEventBindings } from './ops-macro';

type Kind = 'form' | 'report';
const refuse = (message: string): OpOutcome => ({ ok: false, message });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The words the renderer's formLabels(t) resolves to in the en locale (designer.ctlPrefix.*, form.tabPage). */
const PREFIX: Record<ControlKind, string> = { label: 'Label', textBox: 'Text', checkBox: 'Check', optionGroup: 'Frame', optionButton: 'Option', comboBox: 'Combo',
  listBox: 'List', commandButton: 'Command', subform: 'Child', image: 'Image', line: 'Line', rectangle: 'Box', pageBreak: 'PageBreak', tabControl: 'TabCtl', toggleButton: 'Toggle', navigationControl: 'Nav', chart: 'Chart' };
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

/** Why a chart control is refused (raw props, stricter than readChartSpec's tolerant read), or null. `docFields`: the document's own record source. */
function chartIssue(db: DatabaseSync, c: ControlDef, docFields: SourceInfo['fields'], info: LocaleInfo): string | null {
  const p = c.props;
  if (p.ChartType !== undefined && !(CHART_TYPES as readonly unknown[]).includes(p.ChartType)) return `ChartType "${String(p.ChartType)}" is not one of ${CHART_TYPES.join(', ')}`;
  if (p.ChartValues !== undefined && !Array.isArray(p.ChartValues)) return 'ChartValues must be an array';
  const raw = (p.ChartValues ?? []) as unknown[];
  if (raw.length > CHART_MAX_VALUES) return `ChartValues has ${raw.length} entries, at most ${CHART_MAX_VALUES}`;
  for (const [i, v] of raw.entries()) {
    if (!isObject(v) || typeof v.field !== 'string' || v.field.trim() === '') return `ChartValues[${i}] needs a string field`;
    if (v.agg !== undefined && !(AGGS as readonly unknown[]).includes(v.agg)) return `ChartValues[${i}] agg "${String(v.agg)}" is not one of ${AGGS.join(', ')}`;
  }
  if (p.ChartSeries !== undefined) {
    if (!Array.isArray(p.ChartSeries)) return 'ChartSeries must be an array';
    if (p.ChartSeries.length > CHART_MAX_SERIES) return `ChartSeries has ${p.ChartSeries.length} entries, at most ${CHART_MAX_SERIES}`;
    for (const [i, s] of (p.ChartSeries as unknown[]).entries()) {
      if (!isObject(s) || typeof s.field !== 'string' || !raw.some((v) => isObject(v) && typeof v.field === 'string' && sameName(v.field, s.field as string))) return `ChartSeries[${i}] needs the string field of an entry of ChartValues`;
      if (s.type !== undefined && !(SERIES_TYPES as readonly unknown[]).includes(s.type)) return `ChartSeries[${i}] type "${String(s.type)}" is not one of ${SERIES_TYPES.join(', ')}`;
      if (s.secondary !== undefined && typeof s.secondary !== 'boolean') return `ChartSeries[${i}] secondary must be a boolean`;
      if (s.name !== undefined && typeof s.name !== 'string') return `ChartSeries[${i}] name must be a string`;
      if (s.color !== undefined && !isColorValue(s.color)) return `ChartSeries[${i}] color must be a color value (theme:... or #rrggbb)`;
      if (s.borderColor !== undefined && !isColorValue(s.borderColor)) return `ChartSeries[${i}] borderColor must be a color value (theme:... or #rrggbb)`;
      for (const k of ['dataLabels', 'marker'] as const) if (s[k] !== undefined && typeof s[k] !== 'boolean') return `ChartSeries[${i}] ${k} must be a boolean`;
      if (s.trendlineName !== undefined && typeof s.trendlineName !== 'string') return `ChartSeries[${i}] trendlineName must be a string`;
      if (s.lineWidth !== undefined && !isLineWidth(s.lineWidth)) return `ChartSeries[${i}] lineWidth must be a number from ${LINE_WIDTH.min} to ${LINE_WIDTH.max}`;
      for (const [k, list] of [['trendline', TRENDLINES], ['dash', DASHES], ['gap', GAPS]] as const) {
        if (s[k] !== undefined && !(list as readonly unknown[]).includes(s[k])) return `ChartSeries[${i}] ${k} "${String(s[k])}" is not one of ${list.join(', ')}`;
      }
    }
  }
  const fmtIssue = chartFormatIssue(p);
  if (fmtIssue) return fmtIssue;
  if (p.ChartAxis !== undefined && (!Array.isArray(p.ChartAxis) || p.ChartAxis.some((a) => typeof a !== 'string'))) return 'ChartAxis must be an array of field names';
  if (Array.isArray(p.ChartAxis)) {
    if (p.ChartAxis.length > CHART_MAX_AXIS) return `ChartAxis has ${p.ChartAxis.length} fields, at most ${CHART_MAX_AXIS}`;
    if (p.ChartAxis.some((a) => (a as string).trim() === '')) return 'ChartAxis must not contain an empty field name';
  }
  if (p.ChartDateGroup !== undefined && !(DATE_GROUPS as readonly unknown[]).includes(p.ChartDateGroup)) return `ChartDateGroup "${String(p.ChartDateGroup)}" is not one of ${DATE_GROUPS.join(', ')}`;
  if (p.ChartLegend !== undefined && typeof p.ChartLegend !== 'string') return 'ChartLegend must be a string';
  let fields = docFields;
  if (p.ChartSource !== undefined) {
    const ref = readRef(p.ChartSource);
    if (typeof ref === 'string') return 'ChartSource must be { kind: "table"|"query", name } or { kind: "sql", sql }';
    const d = describe(db, ref, info);
    if (typeof d === 'string') return d;
    fields = d.info.fields;
  }
  const s = readChartSpec(p);
  const missing = [...s.axis, ...(s.legend ? [s.legend] : []), ...s.values.map((v) => v.field)].find((f) => !fields.some((x) => sameName(x.name, f)));
  return missing === undefined ? null : `field "${missing}" is not a field of the chart source`;
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
    const gallery = listResources(db).map((r) => r.name);
    const absent = usedResourceNames(design).find((n) => !gallery.includes(n));
    if (absent !== undefined) return refuse(`shared picture not in the gallery: ${absent}`);
    for (const c of design.sections.flatMap((s) => flattenControls(s.controls))) {
      if (c.kind === 'chart') {
        const issue = chartIssue(db, c, fields, info);
        if (issue !== null) return refuse(`control ${c.name}: ${issue}`);
        continue;
      }
      const src = c.props.ControlSource;
      if (src === undefined || src === '') continue;
      if (typeof src !== 'string') return refuse(`control ${c.name}: ControlSource must be a string`);
      if (src.startsWith('=')) continue; // an expression, not checked here
      const field = kind === 'report' ? bareName(src) : src; // a report also takes [Field]
      if (!fields.some((f) => sameName(f.name, field))) return refuse(`control ${c.name}: ControlSource "${src}" is not a field of the record source`);
    }
    const events = checkEventBindings(db, kind, design);
    if (events.length) return refuse(events.join('; '));
  }
  const r = saveObject(db, kind, name, design, null);
  if (!r.ok) return refuse(r.reason === 'nameExists' ? `${kind} name already used: ${name}` : r.reason === 'nameInvalid' ? `invalid ${kind} name: ${name}` : r.reason);
  if (description !== undefined) setObjectDescription(db, kind, name, description);
  return { ok: true };
}

export const formCreate = (db: DatabaseSync, args: Record<string, unknown>, info: LocaleInfo): OpOutcome => create('form', db, args, info);
export const reportCreate = (db: DatabaseSync, args: Record<string, unknown>, info: LocaleInfo): OpOutcome => create('report', db, args, info);

/** Every chart control of every form and report, nested ones included (for `basecraft-cli charts FILE`). */
export function listCharts(db: DatabaseSync): { object: { kind: Kind; name: string }; control: string; type: string; source: RecordSourceRef | null }[] {
  return (['form', 'report'] as const).flatMap((kind) => listObjects(db, kind).flatMap((o) => {
    try {
      const doc = getObject(db, kind, o.name)?.definition;
      if (!isObject(doc) || !Array.isArray(doc.sections)) return [];
      return (doc.sections as { controls?: ControlDef[] }[]).flatMap((s) => flattenControls(s.controls ?? [])).filter((c) => isObject(c) && c.kind === 'chart').map((c) => {
        const spec = readChartSpec(c.props);
        return { object: { kind, name: o.name }, control: c.name, type: spec.type, source: spec.source };
      });
    } catch { return []; } // objet abîmé à la main : ignoré, la liste continue
  }));
}
