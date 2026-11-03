// Name AutoCorrect (O4): the planner. Reads the whole base once (AutoCorrectWorld), runs the rewriters, checks every
// rewritten query and SQL text against the base as it will be (R7) and returns the writes and the log entries. Pure module.
import type { NameChange, ObjectKind, ObjRef, PropertyTarget, PropertyUpdate } from '../api';
import { flattenControls, validateDesignDoc, type DesignDoc } from '../design/model';
import { foldName, lookupOf, sameName, type LookupProps, type TableDesign } from '../field-types';
import { parseMacroDef } from '../macro/model';
import type { QueryDefinition } from '../query/ast';
import { bindQuery, LOCAL_SOURCE, type QueryCatalog } from '../query/bind';
import { parseQueryDefinition, passThroughOf } from '../query/definition';
import { parseSql } from '../query/sql-parser';
import { mentionsRenamed, reasonOf, Refused, rewriteDesign, rewriteLookup, rewriteMacro, type LogEntry, type RewriteCtx } from './objects';
import { outputRenames, renamedName, rewriteQueryDefinition, rewriteSql, sameMeaning, toRenames, type Renames } from './sql';

export interface AutoCorrectWorld {
  objects: { kind: ObjectKind; name: string; definition: unknown }[];   // every readable object, by its old name
  corrupt: { kind: ObjectKind; name: string }[];                        // getObject threw (R7: always failed)
  tables: TableDesign[];                                                // local tables, before the change (their lookups)
  catalog: QueryCatalog;                                                // the base before the change (Session.qc().catalog)
  startupForm: string;
}
export interface AutoCorrectPlan {
  objects: { kind: ObjectKind; name: string /* after the change */; definition: unknown }[];
  lookups: { table: string /* after the change */; field: string; lookup: LookupProps }[];
  startupForm?: string;
  entries: LogEntry[];          // in object order, failed ones included
  corrected: ObjRef[]; failed: ObjRef[];   // names after the change; `corrected ∪ failed` = the dependents (R10)
}

const NONE = new Map<string, string>();
/** The columns of a record source that does not bind (R7): reading a renamed field's name throws, so the rewriters report
 *  the text naming one failed; the other texts are left. No entries, so a copy can never leak a spelling (fix I3).
 *  ponytail: only renamed fields' names throw; an object rename alone (a clash-qualified [Clients.N°] column) fails nothing
 *  over it, the record source being already broken and itself reported when it names the object; key on those too if needed. */
class Unbound extends Map<string, string> {
  constructor(private readonly names: Set<string>) { super(); }
  override has(k: string): boolean { return this.names.has(k); }
  override get(k: string): string | undefined { if (this.has(k)) throw new Error('unbound'); return undefined; }
}
/** Every string of a definition: a malformed one is failed when one of them names something renamed (R7). */
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : typeof v === 'object' && v !== null ? Object.values(v).flatMap(strings) : []);

/** The base as it will be (R7's overlay): local tables under their new names with renamed fields, links as they are,
 *  queries with `sqlOf` (their new SQL, or their old one once put back). */
function overlayOf(world: AutoCorrectWorld, r: Renames, sqlOf: (name: string) => string | null): QueryCatalog {
  /** The old name of what `n` will name in that namespace; null: a name the change frees. */
  const oldOf = (kind: 'table' | 'query', n: string): string | null => {
    for (const [old, to] of r.objects[kind]) if (sameName(to, n)) return old;
    return r.objects[kind].has(foldName(n)) ? null : n;
  };
  return {
    table: (n) => {
      const old = oldOf('table', n);
      const d = old === null ? undefined : world.tables.find((x) => sameName(x.name, old));
      if (!d) return old === null ? null : world.catalog.table(old); // a link: never renamed (C1 R8)
      const m = r.fields.get(foldName(d.name));
      return { ...d, name: renamedName(r, 'table', d.name) ?? d.name, fields: d.fields.map((x) => ({ ...x, name: m?.get(foldName(x.name)) ?? x.name })) };
    },
    query: (n) => { const old = oldOf('query', n); return old === null ? null : sqlOf(old); },
    sourceOf: (n) => { const old = oldOf('table', n); return (old !== null && world.catalog.sourceOf?.(old)) || LOCAL_SOURCE; },
  };
}

/** The catalog read once per name: the base before the change does not change while planning (R1), and the live one reads
 *  a table's design from SQLite on every call (final I2). A throw is not kept. */
function readOnce(c: QueryCatalog): QueryCatalog {
  const seen = new Map<string, unknown>();
  const once = <T>(k: string, read: () => T): T => { if (!seen.has(k)) seen.set(k, read()); return seen.get(k) as T; };
  return { table: (n) => once(`t|${foldName(n)}`, () => c.table(n)), query: (n) => once(`q|${foldName(n)}`, () => c.query(n)),
    ...(c.sourceOf && { sourceOf: (n: string) => once(`s|${foldName(n)}`, () => c.sourceOf!(n)) }) };
}

/** Every rewrite of the dependents of `changes` (R4), each checked (R7). ponytail: every saved query is bound twice per
 *  round of the check (O(queries × rounds)), each table design read once: ≈0.4–0.6 s a plan for 30 tables, 400 queries and 150
 *  forms (measured on a Session, ≈2–3 s before the read-once catalog); an index of the dependents per name past that. */
export function planAutoCorrect(world: AutoCorrectWorld, changes: NameChange[]): AutoCorrectPlan {
  world = { ...world, catalog: readOnce(world.catalog) };
  const r = toRenames(changes);
  const key = (kind: string, name: string): string => `${kind}|${foldName(name)}`;
  const newName = (kind: ObjectKind | 'table', name: string): string => renamedName(r, kind, name) ?? name;
  const unreadable = (kind: ObjectKind | 'table', name: string): LogEntry => ({ kind, name, control: '', property: '', old: '', new: null, reason: 'unreadable' });
  const rewritten = new Map<string, QueryDefinition>();   // key → the query's new definition
  const broken = new Map<string, LogEntry[]>();           // key → a failed query's entry
  const overlay = overlayOf(world, r, (n) => rewritten.get(key('query', n))?.sql ?? world.catalog.query(n));
  const designs = new Map(world.objects.flatMap((o) => ((o.kind === 'form' || o.kind === 'report') && !validateDesignDoc(o.definition).length
    ? [[key(o.kind, o.name), o.definition as DesignDoc] as const] : [])));
  const passThrough = new Set(world.objects.filter((o) => o.kind === 'query' && passThroughOf(o.definition)).map((o) => key('query', o.name)));
  const unbound = new Unbound(new Set([...r.fields.values()].flatMap((m) => [...m.keys()])));
  const ctx: RewriteCtx = {
    r,
    sql: (text) => { // ruling 1: every SQL rewritten must mean what it meant, in the base as it will be
      const now = rewriteSql(text, world.catalog, r);
      if (now === null) return null;
      let ok = false;
      try { ok = sameMeaning(text, world.catalog, now, overlay, r); } catch { /* does not bind once renamed */ }
      if (!ok) throw new Refused();
      return now;
    },
    columns: (ref) => {
      if (!ref) return NONE;
      if (ref.kind === 'table') return r.fields.get(foldName(ref.name)) ?? NONE;
      if (ref.kind === 'query' && passThrough.has(key('query', ref.name))) return NONE; // the server's columns
      if (ref.kind === 'query' && broken.has(key('query', ref.name))) return unbound;   // put back: its columns do not follow
      try {
        // An SQL text that R7 would refuse (e.g. over a put-back query): its columns do not follow either (fix I2).
        if (ref.kind === 'sql' && !sameMeaning(ref.sql, world.catalog, rewriteSql(ref.sql, world.catalog, r) ?? ref.sql, overlay, r)) return unbound;
        const sql = ref.kind === 'sql' ? ref.sql : world.catalog.query(ref.name);
        return sql === null ? unbound : outputRenames(bindQuery(parseSql(sql), world.catalog, ref.kind === 'query' ? ref.name : undefined), r);
      } catch {
        return unbound;
      }
    },
    recordSourceOf: (kind, name) => designs.get(key(kind, name))?.recordSource ?? null,
  };
  const mentions = (v: unknown): boolean => strings(v).some((s) => mentionsRenamed(s, ctx));

  // Queries: each rewritten against the base before the change, then all checked against the overlay; a failing one is put
  // back, which changes what its dependents read: checked again until no query fails (R7).
  const queries: { name: string; def: QueryDefinition }[] = [];
  for (const o of world.objects) {
    if (o.kind !== 'query') continue;
    const k = key('query', o.name), name = newName('query', o.name);
    let def: QueryDefinition;
    try { def = parseQueryDefinition(o.definition); } catch { // ruling 2: a malformed definition
      if (mentions(o.definition)) broken.set(k, [unreadable('query', name)]);
      continue;
    }
    if (passThroughOf(def)) continue; // the server's text (out of scope)
    try {
      const now = rewriteQueryDefinition(def, o.name, world.catalog, r);
      if (now) rewritten.set(k, now);
      queries.push({ name: o.name, def });
    } catch (e) { // does not bind before the change, or a capture (ambiguousField)
      if (mentionsRenamed(def.sql, ctx)) broken.set(k, [{ kind: 'query', name, control: '', property: 'SQL', old: def.sql, new: null, reason: reasonOf(e) }]);
    }
  }
  for (let again = true; again;) {
    again = false;
    for (const x of queries) {
      const k = key('query', x.name);
      if (broken.has(k)) continue;
      let ok = false;
      try { ok = sameMeaning(x.def.sql, world.catalog, rewritten.get(k)?.sql ?? x.def.sql, overlay, r, x.name); } catch { /* does not bind once renamed */ }
      if (ok) continue;
      rewritten.delete(k);
      // ponytail: dependency = the text names a failed query (substring match on the folded name); else the rewrite itself changed the meaning
      const dependent = [...broken.keys()].some((b) => x.def.sql.toLowerCase().includes(b.slice(b.indexOf('|') + 1)));
      broken.set(k, [{ kind: 'query', name: newName('query', x.name), control: '', property: 'SQL', old: x.def.sql, new: null, reason: dependent ? 'dependency' : 'meaning' }]);
      again = true;
    }
  }

  const plan: AutoCorrectPlan = { objects: [], lookups: [], entries: [], corrected: [], failed: [] };
  /** An object with a failure is left unchanged and keeps only its failures; otherwise it is written. */
  const record = (ref: ObjRef, entries: LogEntry[], write: () => void): void => {
    if (!entries.length) return;
    const failures = entries.filter((e) => e.new === null);
    plan.entries.push(...(failures.length ? failures : entries));
    (failures.length ? plan.failed : plan.corrected).push(ref);
    if (!failures.length) write();
  };
  for (const o of world.objects) {
    if (o.kind === 'module') continue; // never read
    const kind = o.kind, name = newName(kind, o.name), k = key(kind, o.name);
    let out: { definition: unknown; entries: LogEntry[] } | null = null;
    if (kind === 'query') {
      const now = rewritten.get(k), def = o.definition as QueryDefinition;
      out = broken.has(k) ? { definition: def, entries: broken.get(k)! }
        : now ? { definition: now, entries: [{ kind, name, control: '', property: 'SQL', old: def.sql, new: now.sql }] } : null;
    } else {
      try {
        if (kind === 'macro') {
          const x = rewriteMacro(parseMacroDef(o.definition), ctx, { kind, name, control: '' });
          out = x && { definition: x.def, entries: x.entries };
        } else {
          const doc = designs.get(k);
          if (!doc) throw new Error('bc:invalidDefinition');
          const x = rewriteDesign(doc, kind, name, ctx);
          out = x && { definition: x.doc, entries: x.entries };
        }
      } catch { // a malformed definition (ruling 2)
        out = mentions(o.definition) ? { definition: o.definition, entries: [unreadable(kind, name)] } : null;
      }
    }
    if (out) { const definition = out.definition; record({ kind, name }, out.entries, () => plan.objects.push({ kind, name, definition })); }
  }
  for (const c of world.corrupt) {
    if (c.kind !== 'module') record({ kind: c.kind, name: newName(c.kind, c.name) }, [unreadable(c.kind, newName(c.kind, c.name))], () => {});
  }

  // Lookups of other tables (R4): the saved table's own are the designer's.
  const saved = changes.flatMap((c) => (c.k === 'fields' ? [c.table] : []));
  for (const d of world.tables) {
    const table = newName('table', d.name);
    if (saved.some((s) => sameName(s, table))) continue;
    const found: AutoCorrectPlan['lookups'] = [], entries: LogEntry[] = [];
    for (const fd of d.fields) {
      const l = lookupOf(fd);
      const x = l && rewriteLookup(l, ctx, { table, field: fd.name });
      if (x) { found.push({ table, field: fd.name, lookup: x.lookup }); entries.push(...x.entries); }
    }
    record({ kind: 'table', name: table }, entries, () => plan.lookups.push(...found));
  }

  const startup = world.startupForm && renamedName(r, 'form', world.startupForm);
  if (startup && startup !== world.startupForm) {
    plan.startupForm = startup;
    plan.entries.push({ kind: 'form', name: startup, control: '', property: 'StartupForm', old: world.startupForm, new: startup });
  }
  return plan;
}

/** R12: bound controls of `table.field` carrying their own non-empty `prop` different from `value`. Bound: a `ControlSource`
 *  without `=` naming the field of a table record source, or a column of a query or SQL source whose origin is that field. */
export function propertyTargets(world: AutoCorrectWorld, table: string, field: string, prop: PropertyUpdate['prop'], value: string): PropertyTarget[] {
  const out: PropertyTarget[] = [];
  for (const o of world.objects) {
    if ((o.kind !== 'form' && o.kind !== 'report') || validateDesignDoc(o.definition).length) continue;
    const doc = o.definition as DesignDoc, rs = doc.recordSource;
    if (!rs) continue;
    let isField: (column: string) => boolean;
    if (rs.kind === 'table') isField = (c) => sameName(rs.name, table) && sameName(c, field);
    else {
      try {
        const sql = rs.kind === 'sql' ? rs.sql : world.catalog.query(rs.name);
        const cols = sql === null ? [] : bindQuery(parseSql(sql), world.catalog, rs.kind === 'query' ? rs.name : undefined).columns;
        isField = (c) => cols.some((x) => sameName(x.name, c) && x.origin && sameName(x.origin.table, table) && sameName(x.origin.field, field));
      } catch { continue; } // does not bind: no column to follow
    }
    for (const c of doc.sections.flatMap((s) => flattenControls(s.controls))) {
      const source = c.props.ControlSource, own = c.props[prop];
      if (typeof source !== 'string' || source.trim().startsWith('=') || !isField(source.trim())) continue;
      if (own === undefined || own === null || String(own) === '' || String(own) === value) continue;
      out.push({ kind: o.kind, name: o.name, control: c.name, current: String(own) });
    }
  }
  return out;
}
