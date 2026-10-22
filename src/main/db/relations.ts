// Relations entre tables : bc_relations (nom, props JSON), contrôles, et intégrité référentielle par de vraies clés étrangères
// SQLite (FOREIGN KEY dans la table enfant, reconstruite par le chemin d'alterTable). Une relation sans intégrité n'existe que
// dans bc_relations (jointures par défaut, A3).
import type { DatabaseSync } from 'node:sqlite';
import type { OpResult, Relation, RelationResult, RelationsLayout } from '../../shared/api';
import { isReservedName, isValidObjectName, sameName, type FieldDef, type TableDesign } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { isExternal, keyedTables, rebuildSame, uniqueKey, withForeignKeysOff } from './alter';
import { readOptions, updateOptions } from './file-format';
import { foreignKeyClauses, listRelations, quoteIdent, relationsOf, tableDesign } from './schema';

export { foreignKeyClauses, listRelations, relationsOf };

/** AutoNumber ↔ Long Integer; otherwise the same type, and the same size for a number (precision and scale for a decimal). */
function keyType(x: FieldDef): string {
  const p = x.props;
  if (p.type === 'autoNumber') return 'number:longInteger';
  if (p.type !== 'number') return p.type;
  const size = p.numberSize ?? 'longInteger';
  return size === 'decimal' ? `number:decimal:${p.precision}:${p.scale}` : `number:${size}`; // '12.50' never equals '12.5'
}

/** Child rows whose key (all fields set: a Null part is no reference, as in SQLite) has no parent row. */
function orphans(db: DatabaseSync, r: Relation): number {
  const c = r.childFields.map((x) => `c.${quoteIdent(x)}`);
  const match = r.parentFields.map((x, i) => `p.${quoteIdent(x)} = ${c[i]}`).join(' AND ');
  const sql = `SELECT count(*) AS n FROM ${quoteIdent(r.childTable)} AS c WHERE ${c.map((x) => `${x} IS NOT NULL`).join(' AND ')}
    AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(r.parentTable)} AS p WHERE ${match})`;
  return Number((db.prepare(sql).get() as { n: number | bigint }).n);
}

const storedProps = (db: DatabaseSync, name: string): Record<string, unknown> => {
  const row = db.prepare('SELECT props FROM bc_relations WHERE name = ?').get(name) as { props: string } | undefined;
  try {
    const v: unknown = JSON.parse(row?.props ?? '{}');
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

type External = { ok: false; reason: 'external'; table: string };

/**
 * Rebuilds the children whose FOREIGN KEY clauses `change` alters (one transaction, foreign keys OFF, keys checked after).
 * A child that must be rebuilt but is external (A2-R13) refuses the whole change: its unknown clauses would be lost. A change
 * that rebuilds nothing (a relation without integrity) works on any table.
 */
function withChildren<T extends RelationResult | OpResult>(db: DatabaseSync, children: string[], info: LocaleInfo, change: () => T): T | External {
  const tables = children.filter((t, i) => children.findIndex((x) => sameName(x, t)) === i);
  // Worked out before the change: isExternal compares the table with the clauses of the relations as they are now.
  const external = tables.map((t) => isExternal(db, tableDesign(db, t)));
  const rebuilt: string[] = [];
  return withForeignKeysOff<T | External>(db, () => {
    const before = tables.map((t) => foreignKeyClauses(db, t).join('\n'));
    const r = change();
    for (const [i, t] of tables.entries()) {
      if (foreignKeyClauses(db, t).join('\n') === before[i]) continue;
      if (external[i] || !rebuildSame(db, t, info).ok) return { ok: false, reason: 'external', table: t }; // rolled back
      rebuilt.push(t);
    }
    return r;
  }, () => rebuilt.flatMap((t) => keyedTables(db, t))); // only what was rebuilt: nothing else changed
}

/**
 * Creates (`originalName` null) or replaces a relation. An empty name gets `<Parent><Child>`, with a number when taken.
 * Unknown keys of the stored relation are kept. Unknown tables or relation: programming error (throws).
 */
export function saveRelation(db: DatabaseSync, rel: Relation, originalName: string | null, info: LocaleInfo): RelationResult {
  const n = rel.parentFields.length;
  if (n < 1 || n > 10 || rel.childFields.length !== n) return { ok: false, reason: 'fieldsMismatch' };
  if (sameName(rel.parentTable, rel.childTable)) return { ok: false, reason: 'sameTable' }; // A2: no self-relation
  const parent = tableDesign(db, rel.parentTable);
  const child = tableDesign(db, rel.childTable);
  const resolve = (d: TableDesign, names: string[]) => names.map((x) => d.fields.find((fd) => sameName(fd.name, x)));
  const pf = resolve(parent, rel.parentFields);
  const cf = resolve(child, rel.childFields);
  if (pf.some((x) => !x) || cf.some((x) => !x) || new Set(pf).size !== n || new Set(cf).size !== n) return { ok: false, reason: 'fieldsMismatch' };
  const all = listRelations(db);
  const original = originalName === null ? undefined : all.find((r) => sameName(r.name, originalName));
  if (originalName !== null && !original) throw new Error(`unknown relation: ${originalName}`);
  // An external table cannot join a relation. One already in it stays editable: withChildren refuses only a rebuild, and
  // a key to an external parent is only added when the relation has integrity.
  if ((rel.enforce || !original || !sameName(original.parentTable, parent.name)) && isExternal(db, parent)) return { ok: false, reason: 'external' };
  if ((!original || !sameName(original.childTable, child.name)) && isExternal(db, child)) return { ok: false, reason: 'external' };
  const parentFields = pf.map((x) => x!.name);
  if (rel.enforce && !uniqueKey(parent, parentFields)) return { ok: false, reason: 'parentNotUnique' };
  if (pf.some((x, i) => keyType(x!) !== keyType(cf[i]!))) return { ok: false, reason: 'typesMismatch' };

  // Names are unique ignoring Unicode case: the NOCASE of the primary key only folds ASCII.
  const taken = (x: string) => all.some((r) => r !== original && sameName(r.name, x));
  let name = rel.name;
  if (name === '') {
    // Cut to the 64 characters of an object name, the number included.
    const cut = (suffix: string) => [...(parent.name + child.name)].slice(0, 64 - suffix.length).join('') + suffix;
    name = cut('');
    for (let i = 1; taken(name); i++) name = cut(String(i));
  } else if (!isValidObjectName(name) || isReservedName(name)) return { ok: false, reason: 'nameInvalid' };
  else if (taken(name)) return { ok: false, reason: 'nameExists' };

  const relation: Relation = {
    name, parentTable: parent.name, parentFields, childTable: child.name, childFields: cf.map((x) => x!.name),
    enforce: rel.enforce, cascadeUpdate: rel.cascadeUpdate, cascadeDelete: rel.cascadeDelete, joinType: rel.joinType,
  };
  if (relation.enforce) {
    const rows = orphans(db, relation);
    if (rows > 0) return { ok: false, reason: 'violations', rows };
  }
  const r = withChildren(db, original ? [original.childTable, child.name] : [child.name], info, () => {
    const kept = original ? storedProps(db, original.name) : {};
    if (original) db.prepare('DELETE FROM bc_relations WHERE name = ?').run(original.name);
    const { name: _name, ...props } = relation;
    db.prepare('INSERT INTO bc_relations (name, props) VALUES (?, ?)').run(name, JSON.stringify({ ...kept, ...props }));
    return { ok: true as const, relation };
  });
  return r.ok || r.reason !== 'external' ? r : { ok: false, reason: 'external' };
}

/** Deletes a relation; with integrity, its child is rebuilt without the FOREIGN KEY clause. */
export function deleteRelation(db: DatabaseSync, name: string, info: LocaleInfo): OpResult {
  const r = listRelations(db).find((x) => sameName(x.name, name));
  if (!r) throw new Error(`unknown relation: ${name}`);
  return withChildren(db, [r.childTable], info, () => {
    db.prepare('DELETE FROM bc_relations WHERE name = ?').run(r.name);
    return { ok: true as const };
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Positions of the Relations window (bc_meta options.relationsLayout); untrusted file content, invalid entries dropped. */
export function relationsLayout(db: DatabaseSync): RelationsLayout {
  const raw = readOptions(db).relationsLayout;
  const tables: RelationsLayout['tables'] = {};
  if (isObj(raw) && isObj(raw.tables)) {
    for (const [k, v] of Object.entries(raw.tables)) {
      if (k !== '__proto__' && isObj(v) && Number.isFinite(v.x) && Number.isFinite(v.y)) tables[k] = { x: v.x as number, y: v.y as number };
    }
  }
  return { tables };
}

export function saveRelationsLayout(db: DatabaseSync, layout: RelationsLayout): void {
  updateOptions(db, (o) => { o.relationsLayout = layout; });
}
