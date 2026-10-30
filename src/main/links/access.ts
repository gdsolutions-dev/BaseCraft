// C2 R5-R7: an Access file (.mdb / .accdb) read with mdb-reader, never opened for writing, into a BaseCraft design and an
// in-memory SQLite copy of the rows. Nothing is written to the file or beside it; no password is stored, logged or returned.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import MDBReader from 'mdb-reader';
import type { Column, Table } from 'mdb-reader';
import { CANON, coerce } from '../../shared/coerce';
import { quoteIdent, validateDesign, type DesignErrorCode, type FieldDef, type FieldProps, type TableDesign } from '../../shared/field-types';
import { registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { createTable } from '../db/schema';
import { inTransaction } from '../db/tx';

export interface AccessTableInfo { name: string; skipped: string[]; unsupported?: DesignErrorCode }

/** Readers of a Jet 3 file (Access 97): its text sizes are in characters, not bytes (m2). */
const JET3 = new WeakSet<MDBReader>();

const unavailable = (state: 'needsPassword' | 'cannotOpen', path: string) => new Error(`bc:linkUnavailable|${state}|${path}`);

/** Reads the file once. bc:linkUnavailable|needsPassword|<path> (no or wrong password), |cannotOpen|<path> (anything else). */
export function openAccess(path: string, password?: string): MDBReader {
  let r: MDBReader;
  let format = 2;
  try {
    const buf = fs.readFileSync(path);
    format = buf[0x14]; // format byte of the header: 0 = Jet 3, 1 = Jet 4, 2 and more = Access 2007+ (.accdb)
    r = new MDBReader(buf, password === undefined ? undefined : { password });
    r.getTableNames(); // a file that is not Access can pass the constructor and fail here
  } catch (e) {
    throw unavailable(e instanceof Error && e.message === 'Wrong password' ? 'needsPassword' : 'cannotOpen', path);
  }
  // Jet 3/4 (.mdb): the password sits in the header and does not encrypt the data, so mdb-reader never refuses it. It is
  // obfuscation, not encryption: this comparison mirrors Access's prompt, it is not a security boundary. In memory only.
  // (.accdb: getPassword() is meaningless there; the encryption itself rejects a wrong password above.)
  const pw = format <= 1 ? r.getPassword() : null;
  if (pw && pw !== password) throw unavailable('needsPassword', path);
  if (format === 0) JET3.add(r);
  return r;
}

const NUMBER_SIZES: Partial<Record<Column['type'], 'byte' | 'integer' | 'longInteger' | 'single' | 'double' | 'decimal'>> = {
  byte: 'byte', integer: 'integer', long: 'longInteger', float: 'single', double: 'double', numeric: 'decimal'
};

/** The BaseCraft field of an Access column, or undefined when BaseCraft has no such type (attachment, OLE, binary, multivalued,
 *  Date/Time Extended). `jet3`: a Jet 3 text size is in characters (one byte each), a later one in bytes (2 per character). */
function fieldOf(c: Column, jet3: boolean): FieldDef | undefined {
  const base = { required: false, indexed: 'no', primaryKey: false } as const;
  const mk = (p: Partial<FieldProps> & Pick<FieldProps, 'type'>): FieldDef => ({ name: c.name, props: { ...base, ...p } });
  if (c.type === 'long' && c.autoLong) return mk({ type: 'autoNumber', primaryKey: true });
  switch (c.type) {
    case 'text': return mk({ type: 'shortText', size: Math.min(255, Math.max(1, jet3 ? c.size : c.size >> 1)) });
    case 'memo': return mk({ type: 'longText' });
    case 'boolean': return mk({ type: 'yesNo' });
    case 'datetime': return mk({ type: 'dateTime' });
    case 'currency': return mk({ type: 'currency' });
    case 'numeric': return mk({ type: 'number', numberSize: 'decimal', precision: c.precision, scale: c.scale });
    case 'bigint': return mk({ type: 'number', numberSize: 'decimal', precision: 19, scale: 0 }); // 64 bits: beyond a double
    case 'repid': return mk({ type: 'shortText', size: 38 }); // a GUID as mdb-reader gives it, {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}
    // datetimextended stays skipped (Ruling F1): mdb-reader 3.2.0 builds its year with the local-time getFullYear, so a value
    // near 1 January reads one year off outside UTC. Linked once mdb-reader reads it in UTC.
    default: return NUMBER_SIZES[c.type] ? mk({ type: 'number', numberSize: NUMBER_SIZES[c.type] }) : undefined;
  }
}

/** R5: the BaseCraft design of an Access table (skipped columns left out); `jet3`: the table is from a Jet 3 file (Access 97). */
export function accessDesign(t: Table, jet3 = false): { design: TableDesign; skipped: string[] } {
  const fields: FieldDef[] = [];
  const skipped: string[] = [];
  for (const c of t.getColumns()) {
    const fd = fieldOf(c, jet3);
    if (fd) fields.push(fd); else skipped.push(c.name);
  }
  return { design: { name: t.name, fields }, skipped };
}

/** R6: every user table, with its skipped columns, and unsupported when BaseCraft would refuse its design. Sorted as getTableNames. */
export function inspectAccess(r: MDBReader): AccessTableInfo[] {
  return r.getTableNames().map((name) => {
    const { design, skipped } = accessDesign(r.getTable(name), JET3.has(r));
    const bad = validateDesign(design)[0];
    return bad ? { name, skipped, unsupported: bad.code } : { name, skipped };
  });
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** mdb-reader gives the wall-clock time as a UTC Date: read it with the UTC getters, whatever the machine's time zone. */
const dateText = (d: Date) => `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

/** A value as the column stores it. Text is kept exactly (coerce would trim it); the rest goes through coerce. A value that does not fit is null. */
function stored(fd: FieldDef, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  const t = fd.props.type;
  if (t === 'autoNumber') return Number(v);
  if (t === 'shortText' || t === 'longText') return String(v);
  if (t === 'yesNo') return v ? 1 : 0;
  // A Single arrives widened to a double (0.1 as 0.10000000149011612): back to the 7 digits Access shows. A Large Number is a
  // bigint: its exact digits, as text (coerce takes no bigint).
  const input = t === 'dateTime' ? dateText(v as Date) : typeof v === 'bigint' ? String(v)
    : fd.props.numberSize === 'single' ? Number((v as number).toPrecision(7)) : (v as string | number);
  const c = coerce(fd, input, CANON);
  return c.ok ? c.value : null;
}

/** R3: an in-memory connection holding `names` (those still in the file; the others are reported missing), query_only. */
export function loadAccessCache(r: MDBReader, names: string[]): { db: DatabaseSync; missing: string[] } {
  const db = new DatabaseSync(':memory:');
  try {
    registerFunctions(db);
    for (const ddl of SYSTEM_DDL) db.exec(ddl);
    const inFile = r.getTableNames();
    const missing = names.filter((n) => !inFile.includes(n));
    inTransaction(db, () => {
      for (const name of names.filter((n) => inFile.includes(n))) {
        const t = r.getTable(name);
        const { design } = accessDesign(t, JET3.has(r));
        createTable(db, design);
        const insert = db.prepare(`INSERT INTO ${quoteIdent(design.name.normalize('NFC'))} (${design.fields.map((f) => quoteIdent(f.name)).join(', ')}) VALUES (${design.fields.map(() => '?').join(', ')})`);
        for (const row of t.getData({ columns: design.fields.map((f) => f.name) })) insert.run(...design.fields.map((f) => stored(f, row[f.name])));
      }
    });
    db.exec('PRAGMA query_only=ON');
    return { db, missing };
  } catch (e) {
    db.close();
    throw e;
  }
}
