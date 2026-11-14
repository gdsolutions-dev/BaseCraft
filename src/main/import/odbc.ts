// External Data › Import › ODBC Database (C4). No native module: Windows reads through PowerShell and System.Data.Odbc
// (resources/odbc.ps1, as the Access export), Linux and macOS through unixODBC's `isql`. Both give the same thing: the tables of a
// source, and one table's columns (a coarse kind each) with every value as text, which the text-import pipeline (runImport) then
// converts, validates and writes. User text is never put on a shell command line: the login and connection string travel on the
// script's stdin (PowerShell) or as one argv item (isql, which has no other way: the password is visible to the user's own
// processes while it runs).
import { spawn } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { defaultSpec, sanitizeName, type ImportField, type ImportFieldType, type ImportPlan, type ImportResult } from '../../shared/import-text';
import type { LocaleInfo } from '../../shared/locale-format';
import type { OdbcRequest } from '../../shared/odbc';
import { powershellPath } from './access-export';
import { runImport, type ImportSource, type ImportTexts } from './text-import';
import type { Rec } from './text-parse';

export type OdbcKind = 'int' | 'float' | 'bool' | 'date' | 'text' | 'longText' | 'other';
export interface OdbcTable { name: string; schema: string }
export interface OdbcColumn { name: string; kind: OdbcKind; size: number }
export interface OdbcRunner {
  dsns(): Promise<string[]>;
  tables(connection: string): Promise<OdbcTable[]>;
  /** Every value as text (null: NULL, or a column of kind `other`, which BaseCraft cannot hold). */
  read(connection: string, t: OdbcTable): Promise<{ columns: OdbcColumn[]; rows: (string | null)[][] }>;
}

/** A value of an ODBC connection string: braced when it holds `;`, `{`, `}`, `=` or edge spaces (`}` doubled). */
const value = (v: string): string => (/[;{}=]|^\s|\s$/.test(v) ? `{${v.replace(/}/g, '}}')}}` : v);
/** The connection string of a request: its DSN or string, then the login when given. */
export function connectionString(r: OdbcRequest): string {
  const base = r.dsn !== '' ? `DSN=${value(r.dsn)}` : r.connection.replace(/[;\s]+$/, '');
  return [base, r.user && `UID=${value(r.user)}`, r.password && `PWD=${value(r.password)}`].filter(Boolean).join(';');
}
/** What a source is called in messages: its DSN, or its string without any login. */
export const odbcLabel = (r: OdbcRequest): string =>
  r.dsn !== '' ? r.dsn : r.connection.replace(/\b(PWD|UID|Password|User ?ID)\s*=\s*(\{(?:[^}]|}})*}|[^;]*)/gi, '$1=***');

const secretOf = (connection: string): string => {
  const v = /(?:^|;)\s*PWD=(\{(?:[^}]|}})*}|[^;]*)/i.exec(connection)?.[1] ?? '';
  return v.startsWith('{') ? v.slice(1, -1).replace(/}}/g, '}') : v;
};
const PWD = /(^|;)\s*PWD=(\{(?:[^}]|}})*}|[^;]*)/i;
/** D1: a connection string with its PWD value taken out (a link stores the string, never a password), and that value. */
export function splitPassword(connection: string): { base: string; password: string } {
  return { base: connection.replace(PWD, '').replace(/^;+|;+$/g, ''), password: secretOf(connection) };
}
/** D1: the connection string of a stored link source (`base`, its user) and the login typed for this session. */
export const linkConnection = (base: string, user: string, password: string): string => connectionString({ dsn: '', connection: base, user, password });
const failed = (detail: string, secret: string): Error =>
  new Error(`bc:odbc|failed|${(secret ? detail.split(secret).join('***') : detail).slice(0, 400)}`);

/** A child run to its end, `input` on stdin. A missing program is `bc:odbc|unavailable|<program>`; a failure carries the first line the
 *  child wrote, the password masked. */
function run(file: string, args: string[], input: string, secret: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true });
    let out = ''; let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { err += d; });
    child.on('error', (e) => reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new Error(`bc:odbc|unavailable|${file}`) : e));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(failed((err || out).trim().split(/\r?\n/)[0] ?? `exit ${code}`, secret))));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

/** Windows: resources/odbc.ps1 (`script`: its path). One JSON value per output line. */
export function powershellRunner(script: string): OdbcRunner {
  const call = async (req: object, secret: string): Promise<unknown[]> =>
    (await run(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], `${JSON.stringify(req)}\n`, secret))
      .split(/\r?\n/).filter((l) => l !== '').map((l) => JSON.parse(l) as unknown);
  return {
    dsns: async () => (await call({ op: 'dsns' }, ''))[0] as string[],
    tables: async (connection) => (await call({ op: 'tables', connection }, secretOf(connection)))[0] as OdbcTable[],
    read: async (connection, t) => {
      const [head, ...rows] = await call({ op: 'read', connection, schema: t.schema, table: t.name }, secretOf(connection));
      return { columns: (head as { columns: OdbcColumn[] }).columns, rows: rows as (string | null)[][] };
    },
  };
}

// --- unixODBC's isql (Linux, macOS) ---
const SEP = '\x1f';
/** An ODBC SQL data type (sql.h, sqlext.h) as a kind. */
export function kindOfSqlType(type: number, size: number): OdbcKind {
  if ([-6, 4, 5].includes(type)) return 'int';
  if ([-5, 2, 3, 6, 7, 8].includes(type)) return 'float';
  if (type === -7) return 'bool';
  if ([9, 10, 11, 91, 92, 93].includes(type)) return 'date';
  if ([1, 12, -8, -9, -11].includes(type)) return size > 0 && size <= 255 ? 'text' : 'longText';
  if ([-1, -10].includes(type)) return 'longText';
  return 'other';
}
/** isql's output with `-c` (names first) and a one-character separator: the names, then the rows. A row that does not have as many
 *  values as the names (a value holding a line break or the separator) refuses the whole read. */
export function parseIsql(out: string): { header: string[]; rows: string[][] } {
  const [head, ...rest] = out.split(/\r?\n/).filter((l) => l !== '');
  const header = head === undefined ? [] : head.split(SEP);
  const rows = rest.map((l) => l.split(SEP));
  if (rows.some((r) => r.length !== header.length)) throw failed('a value holds a line break', '');
  return { header, rows };
}
/** Linux and macOS: `isql -k <connection string>` and `odbcinst`; the tables and columns from isql's `help`, the rows from SELECT *.
 *  ponytail: not run against a real unixODBC in this repo's CI (no ODBC driver on its runners); parseIsql and the SQL types are unit
 *  tested. */
export function isqlRunner(): OdbcRunner {
  const isql = (connection: string, sql: string) => run('isql', ['-b', '-c', '-x0x1f', '-k', connection], `${sql}\n`, secretOf(connection));
  return {
    dsns: async () => (await run('odbcinst', ['-q', '-s'], '', '')).split(/\r?\n/).map((l) => /^\[(.+)]$/.exec(l)?.[1]).filter((n): n is string => !!n).sort(),
    tables: async (connection) => {
      const p = parseIsql(await isql(connection, 'help'));
      const [n, s, t] = ['TABLE_NAME', 'TABLE_SCHEM', 'TABLE_TYPE'].map((k) => p.header.indexOf(k));
      return p.rows.filter((r) => ['TABLE', 'VIEW', 'BASE TABLE'].includes(r[t!]!)).map((r) => ({ name: r[n!]!, schema: r[s!] ?? '' }));
    },
    read: async (connection, t) => {
      // the name is one `tables` listed (checked by importOdbcTables): quoted unless a plain identifier, a `"` refused
      if (t.name.includes('"') || t.schema.includes('"')) throw failed('table name', '');
      const q = (x: string) => (/^[A-Za-z_]\w*$/.test(x) ? x : `"${x}"`);
      const meta = parseIsql(await isql(connection, `help ${t.name}`));
      const [n, ty, sz] = ['COLUMN_NAME', 'DATA_TYPE', 'COLUMN_SIZE'].map((k) => meta.header.indexOf(k));
      const columns = meta.rows.map((r): OdbcColumn => ({ name: r[n!]!, kind: kindOfSqlType(Number(r[ty!]), Number(r[sz!])), size: Number(r[sz!]) }));
      const data = parseIsql(await isql(connection, `SELECT * FROM ${t.schema ? `${q(t.schema)}.` : ''}${q(t.name)}`));
      return { columns, rows: data.rows.map((r) => r.map((v, i) => {
        const kind = columns[i]?.kind;
        return kind === 'other' || v === '' ? null : kind === 'bool' ? (/^(true|1)$/i.test(v) ? '1' : '0') : v;
      })) };
    },
  };
}
export const defaultRunner = (script: string): OdbcRunner => (process.platform === 'win32' ? powershellRunner(script) : isqlRunner());

// --- import ---
const FIELD: Record<Exclude<OdbcKind, 'other'>, ImportFieldType> = { int: 'longInteger', float: 'double', bool: 'yesNo', date: 'dateTime', text: 'shortText', longText: 'longText' };
/** A table's columns as import fields (BaseCraft names; a column of a kind BaseCraft cannot hold is skipped and named). */
export function odbcFields(columns: OdbcColumn[]): { fields: ImportField[]; skipped: string[] } {
  const used: string[] = [];
  const fields = columns.map((c, i): ImportField => {
    const base = sanitizeName(c.name, `Field${i + 1}`);
    let name = base;
    for (let k = 2; used.some((u) => u.toLowerCase() === name.toLowerCase()); k++) name = `${base}_${k}`;
    used.push(name);
    return c.kind === 'other' ? { name, type: 'shortText', indexed: 'no', skip: true }
      : { name, type: FIELD[c.kind], indexed: 'no', skip: false, ...(c.kind === 'text' ? { size: Math.min(255, Math.max(1, c.size)) } : {}) };
  });
  return { fields, skipped: columns.filter((c) => c.kind === 'other').map((c) => c.name) };
}
const source = (rows: (string | null)[][]): ImportSource => ({
  size: rows.length,
  records: function* (progress) { for (let i = 0; i < rows.length; i++) { progress?.(i + 1, rows.length); yield Object.assign(rows[i]!.map((v) => v ?? ''), { line: i + 1 }) as Rec; } },
});
/** D1: texts of the in-memory copy of a link's tables: its error table is never shown. */
export const CACHE_TEXTS: ImportTexts = { fieldPrefix: 'Field', idName: 'ID', errorSuffix: '_ImportErrors', errorFields: { error: 'Error', field: 'Field', line: 'Line' },
  messages: {} as ImportTexts['messages'], log: { unclosed: 'unclosed', truncated: 'truncated' } };
/** Copies `t` as a new local table `name` (no primary key): the sources give ISO dates and `.` numbers. */
export async function importOdbcTable(db: DatabaseSync, runner: OdbcRunner, connection: string, t: OdbcTable, name: string, info: LocaleInfo, texts: ImportTexts,
  tick: (done: number, total: number) => Promise<void>): Promise<{ result: ImportResult; rows: number; skipped: string[] }> {
  const { columns, rows } = await runner.read(connection, t);
  const { fields, skipped } = odbcFields(columns);
  const spec = { ...defaultSpec(info), hasHeader: false, dateOrder: 'YMD' as const, dateSep: '-', thousandsSep: '', fields };
  const plan: ImportPlan = { spec, target: { kind: 'new', table: name, primaryKey: { kind: 'none' } } };
  return { result: await runImport(db, source(rows), plan, info, texts, tick), rows: rows.length, skipped };
}
