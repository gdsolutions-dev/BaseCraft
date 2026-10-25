// Active content of a base (ruling R3): macros, modules, action queries and the event properties of forms and reports. Its
// fingerprint ties an approval to this exact content: any change to it (here or by another tool) asks again.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { PROPERTY_CATALOG } from '../../shared/design/properties';
import { foldName } from '../../shared/field-types';
import { isSelectBody } from '../../shared/query/ast';
import { parseSql } from '../../shared/query/sql-parser';

export interface ActiveContent { present: boolean; fingerprint: string /* sha256 hex; '' when !present */ }

const EVENT_PROPS = PROPERTY_CATALOG.filter((d) => d.tab === 'event').map((d) => d.name);

/** Object keys sorted at every depth: the same content always gives the same text. */
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable)
  : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;

const record = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The non-empty event properties of a form or report (the file is untrusted: any shape is read without failing). */
function events(doc: unknown): [string, string, unknown][] {
  const out: [string, string, unknown][] = [];
  const take = (where: string, props: unknown) => {
    const p = record(props);
    for (const name of EVENT_PROPS) if (p[name] !== undefined && p[name] !== null && p[name] !== '') out.push([where, name, p[name]]);
  };
  const controls = (cs: unknown) => {
    for (const c of list(cs)) {
      const r = record(c);
      take(String(r.name ?? ''), r.props);
      controls(r.children);
    }
  };
  const d = record(doc);
  take('', d.props);
  list(d.sections).forEach((s, i) => {
    take(`section:${i}`, record(s).props);
    controls(record(s).controls);
  });
  return out.map((e) => [JSON.stringify(stable(e)), e] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, e]) => e);
}

function isActionQuery(def: unknown): boolean {
  const sql = record(def).sql;
  if (typeof sql !== 'string') return false;
  try { return !isSelectBody(parseSql(sql)); } catch { return false; } // an unparsable query cannot run
}

export function activeContent(db: DatabaseSync): ActiveContent {
  const rows = db.prepare('SELECT kind, name, definition FROM bc_objects').all() as { kind: string; name: string; definition: string }[];
  const entries: [string, string, unknown][] = [];
  for (const { kind, name, definition } of rows) {
    let def: unknown;
    try { def = JSON.parse(definition); } catch { def = definition; }
    if (kind === 'macro' || kind === 'module') entries.push([kind, name, def]);
    else if (kind === 'query') { if (isActionQuery(def)) entries.push([kind, name, record(def).sql]); }
    else if (kind === 'form' || kind === 'report') {
      const ev = events(def);
      if (ev.length) entries.push([kind, name, ev]);
    }
  }
  if (!entries.length) return { present: false, fingerprint: '' };
  const key = ([k, n]: [string, string, unknown]) => [k, foldName(n), n];
  entries.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
    return 0;
  });
  return { present: true, fingerprint: createHash('sha256').update(JSON.stringify(stable(entries))).digest('hex') };
}
