// Name AutoCorrect (O4) in macros and in other tables' lookups. Pure module: expressions go through the expression parser,
// SQL through ctx.sql (rewriteSql); a string literal is never renamed; a text that cannot be read is left and reported (R7).
import type { ObjectKind } from '../api';
import type { Expr } from '../expr/ast';
import { tokenize } from '../expr/lexer';
import { CANONICAL_DIALECT, parseCanonical, serializeCriteria, serializeWith } from '../expr/parser';
import { foldName, sameName, type LookupProps } from '../field-types';
import { readEvent, sectionName } from '../design/events';
import { flattenControls, type DesignDoc } from '../design/model';
import { PROPERTY_CATALOG } from '../design/properties';
import { actionDef } from '../macro/catalog';
import type { MacroDef, MacroItem } from '../macro/model';
import { isSqlSource } from '../query/definition';
import { printSelect } from '../query/print';
import { parseSql, QUERY_PARSE } from '../query/sql-parser';
import type { RecordSourceRef } from '../record-source';
import { QueryBindError } from '../query/bind';
import { renamedName, type Renames } from './sql';

/** One changed property (R9); `new` null: not corrected (failed). */
export interface LogEntry { kind: ObjectKind | 'table'; name: string; control: string; property: string; old: string; new: string | null;
  /** Why it failed (new: null): the text cannot be read (default), the rewrite would change the meaning, or it depends on a query that failed. */
  reason?: FailReason }
export type FailReason = 'unreadable' | 'meaning' | 'dependency';
/** A refused or captured rewrite changes the meaning; anything else thrown is a text that cannot be read. */
export const reasonOf = (e: unknown): FailReason =>
  e instanceof Refused || (e instanceof QueryBindError && e.code === 'ambiguousField') || (e instanceof Error && (e.message === 'capture' || e.message === 'subquery')) ? 'meaning' : 'unreadable';
/** What a rewriter needs beyond the renames. `sql` is rewriteSql with the planner's catalog and also R7's check: it throws
 *  when the text does not parse or bind, or when sameMeaning says the rewrite means something else (reported, text kept). */
export interface RewriteCtx {
  r: Renames;
  sql(text: string): string | null;
  columns(ref: RecordSourceRef | null): Map<string, string>;          // foldName(old column) → new
  recordSourceOf(kind: 'form' | 'report', name: string): RecordSourceRef | null;  // old name
}

/** Thrown by ctx.sql when R7's check refuses a rewrite: always reported, whatever the text's tokens name. */
export class Refused extends Error {}

/** Whether an unreadable text names something renamed (R7): any of its tokens does, a tokenize error counting as yes. */
export function mentionsRenamed(text: string, ctx: RewriteCtx, columns?: Map<string, string>): boolean {
  const names = new Set<string>(columns?.keys());
  for (const m of Object.values(ctx.r.objects)) m.forEach((_, k) => names.add(k));
  ctx.r.fields.forEach((m, t) => { names.add(t); m.forEach((_, k) => names.add(k)); });
  try { return tokenize(text).some((t) => t.t !== 'eof' && names.has(foldName(t.v))); } catch { return true; }
}

/** A canonical expression rewritten: members (form/report renames), bare ids not in `controls` found in `columns`, and each
 *  subquery through ctx.sql (its throw, e.g. a correlated one whose meaning cannot be kept, propagates: reported failed).
 *  `criteria`: parsed and printed in criteria form. Null: unchanged. Throws the parse error. */
export function rewriteExpr(text: string, ctx: RewriteCtx, columns: Map<string, string>, controls: readonly string[], criteria = false): string | null {
  const opts = { subquery: QUERY_PARSE.subquery, ...(criteria ? { criteria: true } : {}) };
  const e = parseCanonical(text, opts);
  let changed = false;
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n !== 'object' || n === null) return;
    const x = n as Expr;
    if (x.k === 'sub' || x.k === 'inSub') {
      if (x.k === 'inSub') walk(x.e);
      const old = printSelect(x.q), now = ctx.sql(old);
      // Unchanged yet naming something renamed: an outer (correlated) reference ctx.sql cannot see, failed (R7).
      if ((now === null || now === old) && mentionsRenamed(old, ctx, columns)) throw new Error('subquery');
      if (now !== null && now !== old) {
        const { body } = parseSql(now);
        if (body.k !== 'select') throw new Error('subquery');
        x.q = body;
        changed = true;
      }
      return;
    }
    if (x.k === 'id' && x.table === undefined) {
      const to = controls.some((c) => sameName(c, x.name)) ? undefined : columns.get(foldName(x.name));
      if (to !== undefined && to !== x.name) { x.name = to; changed = true; }
    } else if (x.k === 'member') {
      const kind = x.path[0] === 'Forms' ? 'form' : x.path[0] === 'Reports' ? 'report' : undefined;
      const to = kind && x.path[1] !== undefined ? renamedName(ctx.r, kind, x.path[1]) : undefined;
      if (to !== undefined && to !== x.path[1]) { x.path[1] = to; changed = true; }
    }
    Object.values(n).forEach(walk);
  };
  walk(e);
  const printSub = printSelect;
  return changed ? (criteria ? serializeCriteria(e, { ...opts, printSub }) : serializeWith(e, { ...CANONICAL_DIALECT, sub: printSub })) : null;
}

const NONE = new Map<string, string>();
const OBJECT_ARG: Partial<Record<string, ObjectKind | 'table'>> = { formName: 'form', reportName: 'report', queryName: 'query', tableName: 'table' };
const OBJECT_TYPES = new Set(['table', 'query', 'form', 'report', 'macro']);

/** The macro rewritten (a copy), with the changed arguments logged; null when nothing changed and nothing failed. */
export function rewriteMacro(def: MacroDef, ctx: RewriteCtx, at: { kind: ObjectKind; name: string; control: string }): { def: MacroDef; entries: LogEntry[] } | null {
  const copy = structuredClone(def);
  const entries: LogEntry[] = [];
  /** `fix` returns the new text or null; a throw is reported (new: null) when the text names something renamed. */
  const apply = (path: string, property: string, old: string, fix: () => string | null, columns?: Map<string, string>): string => {
    const entry = (now: string | null, reason?: FailReason): void => { entries.push({ kind: at.kind, name: at.name, control: at.control || path, property, old, new: now, ...(reason && { reason }) }); };
    try {
      const now = fix();
      if (now === null || now === old) return old;
      entry(now);
      return now;
    } catch (e) {
      if (e instanceof Refused || mentionsRenamed(old, ctx, columns)) entry(null, reasonOf(e));
      return old;
    }
  };
  const walk = (items: MacroItem[], base: string): void => items.forEach((item, i) => {
    const p = `${base}[${i}]`;
    switch (item.k) {
      case 'action': {
        const adef = actionDef(item.action);
        if (!adef) return;
        for (const [name, value] of Object.entries(item.args)) {
          const type = adef.args.find((a) => a.name === name)?.type;
          if (!type || value.trim() === '') continue;
          const expr = (cols: Map<string, string>): string | null => rewriteExpr(value, ctx, cols, []);
          let fix: (() => string | null) | undefined, columns: Map<string, string> | undefined;
          if (OBJECT_ARG[type]) fix = () => renamedName(ctx.r, OBJECT_ARG[type]!, value) ?? null;
          else if (type === 'macroName') {
            const dot = value.indexOf('.');
            fix = () => { const to = renamedName(ctx.r, 'macro', dot < 0 ? value : value.slice(0, dot)); return to === undefined ? null : dot < 0 ? to : to + value.slice(dot); };
          } else if (type === 'objectName') {
            const kind = item.args.ObjectType ?? '';
            fix = () => (OBJECT_TYPES.has(kind) ? renamedName(ctx.r, kind as ObjectKind | 'table', value) ?? null : null);
          } else if (type === 'sql') fix = () => ctx.sql(value);
          else if (type === 'where' && (item.action === 'OpenForm' || item.action === 'OpenReport')) {
            const form = item.action === 'OpenForm';
            columns = ctx.columns(ctx.recordSourceOf(form ? 'form' : 'report', item.args[form ? 'FormName' : 'ReportName'] ?? ''));
            fix = () => expr(columns!);
          } else if (type === 'expression' || type === 'where' || type === 'reference') fix = () => expr(NONE);
          else if ((type === 'text' || type === 'number') && value.startsWith('=')) {
            fix = () => { const x = rewriteExpr(value.slice(1), ctx, NONE, []); return x === null ? null : '=' + x; };
          }
          if (fix) item.args[name] = apply(p, name, value, fix, columns);
        }
        break;
      }
      case 'if':
        item.branches.forEach((b, j) => {
          if (b.cond.trim() !== '') b.cond = apply(p, 'Condition', b.cond, () => rewriteExpr(b.cond, ctx, NONE, []));
          walk(b.items, `${p}.branches[${j}].items`);
        });
        if (item.else) walk(item.else, `${p}.else`);
        break;
      case 'group': case 'submacro': walk(item.items, `${p}.items`); break;
    }
  });
  walk(copy.items, 'items');
  return entries.length ? { def: copy, entries } : null;
}

/** The lookup of another table rewritten: a SQL Row Source through ctx.sql, a query name by the query's rename (a table's
 *  name is A2's, R3); a value list never. Null: unchanged. */
export function rewriteLookup(l: LookupProps, ctx: RewriteCtx, at: { table: string; field: string }): { lookup: LookupProps; entries: LogEntry[] } | null {
  if (l.kind === 'values' || l.table.trim() === '') return null;
  // ponytail: legacy boundField/displayFields (pre-Access lookups, dropped on save) are left; a renamed field degrades to default columns
  const entry = (now: string | null, reason?: FailReason): LogEntry => ({ kind: 'table', name: at.table, control: at.field, property: 'RowSource', old: l.table, new: now, ...(reason && { reason }) });
  try {
    const now = isSqlSource(l.table) ? ctx.sql(l.table) : renamedName(ctx.r, 'query', l.table.trim()) ?? null;
    return now === null || now === l.table ? null : { lookup: { ...l, table: now }, entries: [entry(now)] };
  } catch (e) {
    return e instanceof Refused || mentionsRenamed(l.table, ctx) ? { lookup: l, entries: [entry(null, reasonOf(e))] } : null;
  }
}

const EDITOR = new Map(PROPERTY_CATALOG.map((d) => [d.name, d.editor]));

/** A form or report document rewritten (R4, R6); unknown keys and props kept; null: unchanged. Entries name the control
 *  ('' for the object, a section's invariant name for a section) and the property. */
export function rewriteDesign(doc: DesignDoc, kind: 'form' | 'report', name: string, ctx: RewriteCtx): { doc: DesignDoc; entries: LogEntry[] } | null {
  const copy = structuredClone(doc);
  const entries: LogEntry[] = [];
  const columns = ctx.columns(doc.recordSource);
  const controls = copy.sections.flatMap((s) => flattenControls(s.controls)).map((c) => c.name);
  // A field renamed onto a control's name would be captured by that control: not rewritten (R6).
  const filtered = new Map([...columns].filter(([, v]) => !controls.some((c) => sameName(c, v))));
  const safe = filtered.size === columns.size ? columns : filtered; // columns itself: an unbound one keeps throwing
  const expr = (text: string, criteria = false): string | null => {
    const full = rewriteExpr(text, ctx, columns, controls, criteria);
    if (full !== (safe === columns ? full : rewriteExpr(text, ctx, safe, controls, criteria))) throw new Error('capture');
    return full;
  };
  /** Sets `holder[key]` to the rewritten text; a throw is reported when the text names something renamed. */
  const fix = (holder: Record<string, unknown>, key: string, control: string, property: string, change: (old: string) => string | null): void => {
    const old = holder[key];
    if (typeof old !== 'string' || old.trim() === '') return;
    const entry = (now: string | null, reason?: FailReason): void => { entries.push({ kind, name, control, property, old, new: now, ...(reason && { reason }) }); };
    try {
      const now = change(old);
      if (now !== null && now !== old) { holder[key] = now; entry(now); }
    } catch (e) {
      if (e instanceof Refused || mentionsRenamed(old, ctx, columns)) entry(null, reasonOf(e));
    }
  };
  const source = (text: string): string | null => (isSqlSource(text) ? ctx.sql(text) : renamedName(ctx.r, 'query', text.trim()) ?? renamedName(ctx.r, 'table', text.trim()) ?? null);
  const fields = (text: string, cols: Map<string, string>): string | null => {
    let changed = false;
    const out = text.split(';').map((f) => { const to = cols.get(foldName(f.trim())); if (to === undefined || to === f.trim()) return f; changed = true; return f.replace(f.trim(), to); }).join(';');
    return changed ? out : null;
  };
  const target = (c: { props: Record<string, unknown>; kind: string }): Map<string, string> => {
    const so = typeof c.props.SourceObject === 'string' ? c.props.SourceObject : '';
    return ctx.columns(ctx.recordSourceOf(kind, so));   // a form's subform is a form, a report's a report (PropertySheet: ctx.objects(docKind))
  };
  const props = (holder: { props: Record<string, unknown> }, control: string, subform?: Map<string, string>): void => {
    const p = holder.props;
    for (const key of Object.keys(p)) {
      switch (EDITOR.get(key)) {
        case 'controlSource': fix(p, key, control, key, (t) => (t.startsWith('=') ? ((x) => (x === null ? null : '=' + x))(expr(t.slice(1))) : columns.get(foldName(t.trim())) ?? null)); break;
        case 'expression': fix(p, key, control, key, (t) => expr(t)); break;
        case 'criteria': fix(p, key, control, key, (t) => expr(t, true)); break;
        case 'rowSource': if (p.RowSourceType !== 'valueList') fix(p, key, control, key, source); break;
        case 'objectName': fix(p, key, control, key, (t) => renamedName(ctx.r, kind, t.trim()) ?? null); break;
        case 'fieldList': fix(p, key, control, key, (t) => fields(t, key === 'LinkMasterFields' ? safe : subform ?? NONE)); break;
        case 'event': {
          const b = readEvent(p[key]);
          if (b.kind === 'macro') fix(p, key, control, key, (t) => { const dot = t.indexOf('.'); const to = renamedName(ctx.r, 'macro', dot < 0 ? t : t.slice(0, dot)); return to === undefined ? null : dot < 0 ? to : to + t.slice(dot); });
          else if (b.kind === 'embedded') {
            const out = rewriteMacro(b.def, ctx, { kind, name, control: control ? `${control}.${key}` : key });
            if (out) { p[key] = { ...(p[key] as object), embedded: out.def }; entries.push(...out.entries); }
          }
        }
      }
    }
  };
  const chartOwn = (p: Record<string, unknown>): RecordSourceRef | null => {
    const cs = p.ChartSource as Record<string, unknown> | undefined;
    return cs && typeof cs === 'object' && (cs.kind === 'table' || cs.kind === 'query' || cs.kind === 'sql') ? (cs as unknown as RecordSourceRef) : null;
  };
  /** The columns a chart reads: its own ChartSource when valid, else the document's. */
  const chartCols = (p: Record<string, unknown>): Map<string, string> => { const o = chartOwn(p); return o ? ctx.columns(o) : columns; };
  /** A chart's ChartSource (table, query or SQL) and its Axis / Legend / Values fields, against its own source or the document's. */
  const chart = (c: { name: string; props: Record<string, unknown> }): void => {
    const p = c.props, own = chartOwn(p);
    const emit = (property: string, old: string, now: string | null, reason?: FailReason): void => { entries.push({ kind, name, control: c.name, property, old, new: now, ...(reason && { reason }) }); };
    if (own) {
      const old = own.kind === 'sql' ? own.sql : own.name;
      try {
        const now = own.kind === 'sql' ? ctx.sql(own.sql) : renamedName(ctx.r, own.kind, own.name);
        if (now != null && now !== old) { p.ChartSource = own.kind === 'sql' ? { kind: 'sql', sql: now } : { kind: own.kind, name: now }; emit('ChartSource', old, now); }
      } catch (e) {
        if (own.kind === 'sql' && (e instanceof Refused || mentionsRenamed(old, ctx))) emit('ChartSource', old, null, reasonOf(e));
      }
    }
    const cols = chartCols(p);
    const one = (f: string): string => cols.get(foldName(f.trim())) ?? f;
    const list = (property: string, olds: string[], set: (news: string[]) => void): void => {
      const news = olds.map(one);
      if (news.some((n, i) => n !== olds[i])) { set(news); emit(property, olds.join('; '), news.join('; ')); }
    };
    if (Array.isArray(p.ChartAxis) && p.ChartAxis.every((x) => typeof x === 'string')) list('ChartAxis', p.ChartAxis as string[], (n) => { p.ChartAxis = n; });
    if (typeof p.ChartLegend === 'string' && p.ChartLegend !== '') list('ChartLegend', [p.ChartLegend], ([n]) => { p.ChartLegend = n; });
    if (Array.isArray(p.ChartValues)) {
      const vs = p.ChartValues as { field?: unknown }[];
      const fs = vs.filter((v) => v && typeof v.field === 'string');
      list('ChartValues', fs.map((v) => v.field as string), (n) => fs.forEach((v, i) => { v.field = n[i]; }));
    }
    if (Array.isArray(p.ChartSeries)) {
      const fs = (p.ChartSeries as { field?: unknown }[]).filter((v) => v && typeof v.field === 'string');
      list('ChartSeries', fs.map((v) => v.field as string), (n) => fs.forEach((v, i) => { v.field = n[i]; }));
    }
  };
  props(copy, '');
  if (copy.recordSource) {
    const rs = copy.recordSource, old = rs.kind === 'sql' ? rs.sql : rs.name;
    try {
      const now = rs.kind === 'sql' ? ctx.sql(rs.sql) : renamedName(ctx.r, rs.kind, rs.name);
      if (now != null && now !== old) { copy.recordSource = rs.kind === 'sql' ? { kind: 'sql', sql: now } : { kind: rs.kind, name: now }; entries.push({ kind, name, control: '', property: 'RecordSource', old, new: now }); }
    } catch (e) {
      if (rs.kind === 'sql' && (e instanceof Refused || mentionsRenamed(old, ctx))) entries.push({ kind, name, control: '', property: 'RecordSource', old, new: null, reason: reasonOf(e) });
    }
  }
  if (Array.isArray(copy.props.grouping)) (copy.props.grouping as Record<string, unknown>[]).forEach((g, i) => {
    if (g && typeof g === 'object') fix(g, 'expression', '', `GroupLevel${i + 1}`, (t) => (t.startsWith('=') ? ((x) => (x === null ? null : '=' + x))(expr(t.slice(1))) : columns.get(foldName(t.trim())) ?? null));
  });
  for (const s of copy.sections) {
    props(s, sectionName(s.kind, s.groupLevel));
    for (const c of flattenControls(s.controls)) {
      props(c, c.name, c.kind === 'subform' ? target(c) : c.kind === 'chart' ? chartCols(c.props) : undefined);
      if (c.kind === 'chart') chart(c);
    }
  }
  return entries.length ? { doc: copy, entries } : null;
}
