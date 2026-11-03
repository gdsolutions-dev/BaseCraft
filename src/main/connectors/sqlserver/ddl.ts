// SQL Server text of a server migration (C7 R4–R8): plan entries → DDL and multi-row INSERTs. Pure: no import of `tedious`.
// Every identifier through msIdent and every row value a parameter (@p0…, sent as text, R7); a literal Default Value is the
// only literal, written by msLiteral.
import { sameName, type FieldProps } from '../../../shared/field-types';
import type { Literal, ServerForeignKey, ServerIndex, ServerTable } from '../../migrate/plan';
import { msIdent } from './sql-expr';

const NUMBERS: Record<string, string> = { byte: 'tinyint', integer: 'smallint', longInteger: 'int', single: 'real', double: 'float' };
const invalid = (): never => { throw new Error('bc:invalidArgument'); };

/** Defence in depth: a size, precision, scale or identity value is written into the text, so it is an integer in range or nothing. */
const int = (v: number | undefined, def: number, min: number, max: number): number => {
  const n = v ?? def;
  return Number.isInteger(n) && n >= min && n <= max ? n : invalid();
};

/** R4: the column type of a BaseCraft field. */
export function msColumnType(p: FieldProps): string {
  switch (p.type) {
    case 'autoNumber': return 'int IDENTITY(1,1)';
    case 'shortText': return `nvarchar(${int(p.size, 255, 1, 255)})`;
    case 'number': return p.numberSize === 'decimal' ? `decimal(${int(p.precision, 18, 1, 28)},${int(p.scale, 0, 0, int(p.precision, 18, 1, 28))})` : NUMBERS[p.numberSize ?? 'longInteger'] ?? invalid();
    case 'currency': return 'money';
    case 'dateTime': return 'datetime2(0)';
    case 'yesNo': return 'bit';
    default: return 'nvarchar(max)'; // Long Text, Hyperlink
  }
}

/** R5: a literal default as T-SQL: text as N'…' with ' doubled, each line break as NCHAR (T-SQL drops a backslash followed by
 *  one: line continuation); a date in ISO 8601 with T (read so whatever the language or DATEFORMAT); a number or a date
 *  checked to be one (a plan entry is never trusted as SQL). */
export function msLiteral(l: Literal): string {
  switch (l.k) {
    case 'str': {
      const parts = l.v.split(/(\r|\n)/).map((s) => (s === '\r' ? 'NCHAR(13)' : s === '\n' ? 'NCHAR(10)' : `N'${s.replace(/'/g, "''")}'`)).filter((s) => s !== "N''");
      return parts.length === 0 ? "N''" : parts.length === 1 ? parts[0]! : `(${parts.join(' + ')})`;
    }
    case 'num': return /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(l.v) ? l.v : invalid();
    case 'date': return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(l.v) ? `'${l.v.replace(' ', 'T')}'` : invalid();
    case 'bool': return l.v ? '1' : '0';
  }
}

const tableSql = (t: { schema: string; name: string }) => `${msIdent(t.schema)}.${msIdent(t.name)}`;

/** R5: the rowversion column's name: bc_rowversion, else bc_rowversion1, 2… the first no field of `t` has (sameName). */
export function msVersionColumn(t: ServerTable): string {
  const taken = (n: string) => t.fields.some((x) => sameName(x.name, n));
  let name = 'bc_rowversion';
  for (let i = 1; taken(name); i++) name = `bc_rowversion${i}`;
  return name;
}

/** R5: NOT NULL for Required and key fields (Yes/No always, DEFAULT 0 without a literal); the rowversion column `version`;
 *  PRIMARY KEY (unnamed: SQL Server's PK__…__<hex> name is unique by construction) in design order. */
export function msCreateTable(t: ServerTable, version: string): string {
  const cols = t.fields.map(({ name, props: p, default: d }) => {
    const notNull = p.required || p.primaryKey || t.key.includes(name) || p.type === 'yesNo';
    const def = d ? msLiteral(d) : p.type === 'yesNo' ? '0' : undefined;
    return [msIdent(name), msColumnType(p), ...(notNull ? ['NOT NULL'] : []), ...(def ? [`DEFAULT ${def}`] : [])].join(' ');
  });
  cols.push(`${msIdent(version)} rowversion`);
  if (t.key.length) cols.push(`PRIMARY KEY (${t.key.map(msIdent).join(', ')})`);
  return `CREATE TABLE ${tableSql(t)} (${cols.join(', ')})`;
}

const TEXT = new Set(['shortText', 'longText', 'hyperlink']);
/** R8: one INSERT of `rows` rows, values @p0… in t.fields order: text as sent (never CAST: a value too long for its nvarchar
 *  fails, 2628, instead of being cut), anything else CAST to its column type; an AutoNumber's values kept (IDENTITY_INSERT
 *  around it, in the same request: sp_executesql's scope ends it in any case). */
export function msInsertRows(t: ServerTable, rows: number): string {
  const vals = t.fields.map((x) => (TEXT.has(x.props.type) ? (i: number) => `@p${i}` : (i: number) => `CAST(@p${i} AS ${x.props.type === 'autoNumber' ? 'int' : msColumnType(x.props)})`));
  const tuples = Array.from({ length: rows }, (_, r) => `(${vals.map((v, i) => v(r * vals.length + i)).join(', ')})`);
  const insert = `INSERT INTO ${tableSql(t)} (${t.fields.map((x) => msIdent(x.name)).join(', ')}) VALUES ${tuples.join(', ')}`;
  return t.fields.some((x) => x.props.type === 'autoNumber') ? `SET IDENTITY_INSERT ${tableSql(t)} ON; ${insert}; SET IDENTITY_INSERT ${tableSql(t)} OFF` : insert;
}

/** An index of `t`. A unique one on nullable fields is `filtered` by default (WHERE … IS NOT NULL: several Nulls allowed, as
 *  Access and SQLite; SQL Server's plain unique index takes one Null). A foreign key cannot reference a filtered index (1776):
 *  the driver rebuilds a referenced one unfiltered (msUnfiltered). */
export function msCreateIndex(t: ServerTable, ix: ServerIndex, filtered = true): string {
  const nullable = ix.fields.filter((f) => {
    const p = t.fields.find((x) => x.name === f.name)?.props;
    return !(p?.required || p?.primaryKey || t.key.includes(f.name));
  });
  const where = ix.unique && filtered && nullable.length ? ` WHERE ${nullable.map((f) => `${msIdent(f.name)} IS NOT NULL`).join(' AND ')}` : '';
  return `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${msIdent(ix.name)} ON ${tableSql(t)} (${ix.fields.map((x) => `${msIdent(x.name)}${x.desc ? ' DESC' : ''}`).join(', ')})${where}`;
}

/** A filtered unique index of `t` dropped and created again without its filter, so a foreign key can reference it. */
export const msUnfiltered = (t: ServerTable, ix: ServerIndex): string => `DROP INDEX ${msIdent(ix.name)} ON ${tableSql(t)}; ${msCreateIndex(t, ix, false)}`;

/** R8: the identity reseeded so the next number is nextId (DBCC CHECKIDENT: after a row was inserted the next is the reseed
 *  value + 1, before any the reseed value itself), then each index (index names are per table on SQL Server). */
export function msFinishTable(t: ServerTable): string[] {
  const auto = t.fields.some((x) => x.props.type === 'autoNumber');
  const next = t.nextId === undefined ? undefined : int(t.nextId, 1, 1, 2 ** 31 - 1);
  return [
    ...(auto && next !== undefined ? [`DBCC CHECKIDENT (N'${tableSql(t).replace(/'/g, "''")}', RESEED, ${t.rows > 0 ? next - 1 : next})`] : []),
    ...t.indexes.map((ix) => msCreateIndex(t, ix)),
  ];
}

const ACTION = { cascade: 'CASCADE', noAction: 'NO ACTION' } as const;
/** R7: an enforced relation as a foreign key with its cascades. */
export function msForeignKey(fk: ServerForeignKey): string {
  return `ALTER TABLE ${tableSql({ schema: fk.schema, name: fk.child })} ADD CONSTRAINT ${msIdent(fk.name)} FOREIGN KEY (${fk.childFields.map(msIdent).join(', ')}) `
    + `REFERENCES ${tableSql({ schema: fk.schema, name: fk.parent })} (${fk.parentFields.map(msIdent).join(', ')}) ON DELETE ${ACTION[fk.onDelete]} ON UPDATE ${ACTION[fk.onUpdate]}`;
}

/** R7: the foreign keys with each one that would make a second cascading path (or a cycle) turned to NO ACTION on both actions.
 *  In relation order, a cascading key parent → child is kept when no table reaching the parent (the parent included) already
 *  reaches the child or a table the child reaches, and the child does not reach the parent (a cycle; a self-reference is one).
 *  ponytail: update and delete cascades count together (SQL Server's 1785 rule), stricter than needed when only one cascades. */
export function msCascadeDowngrades(fks: ServerForeignKey[]): ServerForeignKey[] {
  const edges = new Map<string, Set<string>>(); // parent → children, over the cascading keys kept
  const below = (from: string): Set<string> => { // every table `from` reaches (itself excluded unless in a cycle, which is never kept)
    const seen = new Set<string>();
    const walk = (n: string) => { for (const c of edges.get(n) ?? []) if (!seen.has(c)) { seen.add(c); walk(c); } };
    walk(from);
    return seen;
  };
  return fks.map((fk) => {
    if (fk.onDelete === 'noAction' && fk.onUpdate === 'noAction') return fk;
    const up = [fk.parent, ...[...edges.keys()].filter((n) => below(n).has(fk.parent))];
    const down = new Set([fk.child, ...below(fk.child)]);
    if (up.some((n) => down.has(n) || [...below(n)].some((d) => down.has(d)))) return { ...fk, onDelete: 'noAction', onUpdate: 'noAction' };
    edges.set(fk.parent, new Set([...(edges.get(fk.parent) ?? []), fk.child]));
    return fk;
  });
}
