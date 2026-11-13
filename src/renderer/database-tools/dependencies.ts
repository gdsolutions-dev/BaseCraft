// Object Dependencies (K2): the objects an object names, read statically from the stored definitions. Pure module.
import { flattenControls, type DesignDoc } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import { isSqlSource } from '../../shared/query/definition';
import { parseSql } from '../../shared/query/sql-parser';
import { parseTargets } from '../form/nav-targets';

export type DepKind = 'table' | 'query' | 'form' | 'report' | 'macro';
export interface DepRef { kind: DepKind; name: string }
export interface DepObject { kind: Exclude<DepKind, 'table'>; name: string; definition: unknown }
export interface DepWorld { tables: string[]; objects: DepObject[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The tables and queries a SQL text names (FROM and JOIN, subqueries, INSERT and INTO targets). ponytail: a generic walk over
 *  the parsed tree; SQL that does not parse (a pass-through's server text) names nothing. */
export function sqlSources(sql: string): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (isObj(n)) {
      if (n.k === 'source') out.push(str(n.name));
      else if (n.k === 'insert') out.push(str(n.target));
      if (typeof n.into === 'string') out.push(n.into);
      Object.values(n).forEach(walk);
    }
  };
  try { walk(parseSql(sql)); } catch { /* names nothing */ }
  return out.filter(Boolean);
}

/** A name that may be a query or a table, or a name of one given kind. */
interface Raw { kinds: DepKind[]; name: string }
const SOURCE: DepKind[] = ['query', 'table'];
/** A record or row source as typed: SQL, or the name of a table or query. */
const sourceOf = (text: string): Raw[] =>
  (isSqlSource(text) ? sqlSources(text) : text.trim() ? [text.trim()] : []).map((name) => ({ kinds: SOURCE, name }));

const MACRO_OPENS: Record<string, [DepKind, string]> = { OpenForm: ['form', 'FormName'], OpenReport: ['report', 'ReportName'],
  OpenQuery: ['query', 'QueryName'], OpenTable: ['table', 'TableName'], RunMacro: ['macro', 'MacroName'] };

function macroRaw(items: unknown, out: Raw[]): void {
  if (!Array.isArray(items)) return;
  for (const i of items) {
    if (!isObj(i)) continue;
    if (i.k === 'action') {
      const open = MACRO_OPENS[str(i.action)];
      const name = open && isObj(i.args) ? str(i.args[open[1]]) : '';
      if (open && name) out.push({ kinds: [open[0]], name: open[0] === 'macro' ? name.split('.')[0] : name });   // Macro.Submacro
    } else {
      macroRaw(i.items, out);
      macroRaw(i.else, out);
      for (const b of Array.isArray(i.branches) ? i.branches : []) macroRaw(isObj(b) ? b.items : null, out);
    }
  }
}

function designRaw(kind: 'form' | 'report', d: unknown, out: Raw[]): void {
  const doc = d as Partial<DesignDoc>;
  const rs = doc.recordSource;
  if (rs?.kind === 'sql') out.push(...sourceOf(rs.sql)); else if (rs) out.push({ kinds: SOURCE, name: rs.name });
  for (const c of (Array.isArray(doc.sections) ? doc.sections : []).flatMap((s) => flattenControls(Array.isArray(s?.controls) ? s.controls : []))) {
    const p = c.props ?? {};
    if (str(p.SourceObject)) out.push({ kinds: [kind], name: str(p.SourceObject).trim() });   // a form's subform is a form, a report's a report
    if (p.RowSourceType !== 'valueList' && str(p.RowSource)) out.push(...sourceOf(str(p.RowSource)));
    for (const x of parseTargets(p.NavigationTargets)) out.push({ kinds: [x.kind], name: x.name });
  }
}

/** The objects `o` names that exist in `world`, once each and never itself. Not read: a command button's event, a field's lookup. */
export function refsOf(o: DepObject, world: DepWorld): DepRef[] {
  const raw: Raw[] = [];
  const d = o.definition;
  if (isObj(d)) {
    if (o.kind === 'query') { if (!/^2\./.test(str(d.formatVersion))) raw.push(...sqlSources(str(d.sql)).map((name) => ({ kinds: SOURCE, name }))); }
    else if (o.kind === 'macro') macroRaw(d.items, raw);
    else if (o.kind === 'form' || o.kind === 'report') designRaw(o.kind, d, raw);
  }
  const names = (kind: DepKind): string[] => (kind === 'table' ? world.tables : world.objects.filter((x) => x.kind === kind).map((x) => x.name));
  const out: DepRef[] = [];
  for (const r of raw) {
    for (const kind of r.kinds) {
      const name = names(kind).find((n) => sameName(n, r.name));
      if (name === undefined) continue;
      if (!(kind === o.kind && sameName(name, o.name)) && !out.some((x) => x.kind === kind && x.name === name)) out.push({ kind, name });
      break;
    }
  }
  return out;
}

const ORDER: DepKind[] = ['table', 'query', 'form', 'report', 'macro'];
const byKindName = (a: DepRef, b: DepRef) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name);

/** « Objects that depend on me » and « Objects that I depend on » for `target`. */
export function dependencies(world: DepWorld, target: DepRef): { dependsOnMe: DepRef[]; iDependOn: DepRef[] } {
  const same = (r: DepRef) => r.kind === target.kind && sameName(r.name, target.name);
  const self = world.objects.find(same);
  return {
    dependsOnMe: world.objects.filter((o) => refsOf(o, world).some(same)).map((o) => ({ kind: o.kind, name: o.name })).sort(byKindName),
    iDependOn: (self ? refsOf(self, world) : []).sort(byKindName),
  };
}
