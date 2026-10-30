// Connections to the linked files of a front-end (C1 R3, R4, R7): one SQLite connection and one lock per source, opened on first
// use and kept until close. Lives in the data process with the Session: lock observation (R13) is per process.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LinkState } from '../../shared/api';
import { isReservedName } from '../../shared/field-types';
import { APPLICATION_ID, BaseFileError, openBaseFile, registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { acquireLock, peekLock, releaseIfOurs, takeOverStaleLock, type HeldLock, type LockDeps, type LockInfo, type LockResult } from '../db/lock';
import { detectLocationRisk, type LocationRisk, type RiskProbe } from '../db/location-risk';
import { joinPresence, presenceEntry, sharedRefusal } from '../db/presence';
import { peekStartup } from '../db/startup';
import { inspectAccess, loadAccessCache, openAccess } from './access';
import { linkRows, resolveSourcePath, sourceRows, type SourceKind } from './store';

/** shared: a data file written in shared mode, through this session's presence entry (C3 R3). */
export interface SourceConn { db: DatabaseSync | null; writable: boolean; state: LinkState; path: string; holder?: LockInfo; stale?: boolean; risk: LocationRisk; shared?: true }
export interface LinkedDeps { frontEnd: string; appVersion: string; sessionId: string; lockDeps?: LockDeps; probe: RiskProbe }

export const isWritable = (p: string): boolean => {
  try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; }
};

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const ACCESS_HEADERS = ['Standard Jet DB', 'Standard ACE DB'].map((h) => Buffer.from(h, 'latin1')); // at offset 4 (.mdb, .accdb)

/** R7, from the header: a BaseCraft file (its application_id), any other SQLite file, an Access file (C2 R2), else BaseFileError
 *  cannotOpen. The extension is never trusted. */
export function sourceKindOf(p: string): SourceKind {
  const buf = Buffer.alloc(100);
  let n = 0;
  try {
    const fd = fs.openSync(p, 'r');
    try { n = fs.readSync(fd, buf, 0, 100, 0); } finally { fs.closeSync(fd); }
  } catch { throw new BaseFileError('cannotOpen'); }
  if (ACCESS_HEADERS.some((h) => buf.subarray(4, 4 + h.length).equals(h))) return 'access';
  if (n < 100 || !buf.subarray(0, 16).equals(SQLITE_HEADER)) throw new BaseFileError('cannotOpen');
  return buf.readUInt32BE(68) === APPLICATION_ID ? 'basecraft' : 'sqlite';
}

/** The bc_* catalog as empty TEMP tables, so tableDesign, readRows and the write layer find it without writing to the file:
 *  every table for a plain SQLite file, the missing ones for an older minor of a BaseCraft file (PF3). */
function tempCatalog(db: DatabaseSync, missingOnly: boolean): void {
  for (const ddl of SYSTEM_DDL) {
    const name = /^CREATE TABLE (\w+)/.exec(ddl)![1];
    if (missingOnly && db.prepare(`SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?`).get(name)) continue;
    db.exec(ddl.replace(/^CREATE TABLE /, 'CREATE TEMP TABLE '));
  }
}

/** R7: a SQLite file BaseCraft did not make, used as it is: journal mode, schema and bc_* absence kept (data writes only). */
export function openPlainSqlite(p: string, mode: 'write' | 'readOnly'): DatabaseSync {
  const db = new DatabaseSync(p, { readOnly: mode === 'readOnly', timeout: 5000 });
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('PRAGMA busy_timeout=5000');
    registerFunctions(db);
    tempCatalog(db, false);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

const STATES: Partial<Record<string, LinkState>> = { newerMajor: 'newerMajor', needsDesigner: 'needsMigration', needsMigration: 'needsMigration' };
/** needsPassword: openAccess's bc:linkUnavailable|needsPassword|<path> (C2 R7). */
const stateOf = (e: unknown): LinkState =>
  (e instanceof BaseFileError && STATES[e.code]) || (e instanceof Error && e.message.startsWith('bc:linkUnavailable|needsPassword|') ? 'needsPassword' : 'cannotOpen');

/** A source file's connection: a linked file is never migrated (PF3): an older minor is used as it is, its missing bc_* tables TEMP. */
function openSource(kind: SourceKind, p: string, mode: 'write' | 'readOnly', appVersion: string): DatabaseSync {
  if (kind === 'sqlite') return openPlainSqlite(p, mode);
  const db = openBaseFile(p, mode, appVersion, { olderMinorAsIs: true }).db;
  try { tempCatalog(db, true); } catch (e) { db.close(); throw e; }
  return db;
}

/** A table of a file to link; an Access table (C2 R6) can have skipped columns, or be unsupported (not linkable). */
export interface SourceTable { name: string; skipped?: string[]; unsupported?: string }

/** R7: a file's kind and its linkable tables (real tables of the main schema, not reserved: no view, no virtual table), read
 *  read-only with no lock, then closed; an Access file's every user table (C2 R6). bc:linkUnavailable|<state>|<path> when it
 *  cannot be linked (needsPassword: a protected Access file opened without its right `password`). */
export function inspectSource(p: string, appVersion: string, password?: string): { kind: SourceKind; tables: SourceTable[] } {
  let db: DatabaseSync;
  let kind: SourceKind;
  try {
    kind = sourceKindOf(p);
    if (kind === 'access') {
      const tables = inspectAccess(openAccess(p, password)).map(({ name, skipped, unsupported }) =>
        ({ name, ...(skipped.length ? { skipped } : {}), ...(unsupported ? { unsupported } : {}) }));
      return { kind, tables };
    }
    db = openSource(kind, p, 'readOnly', appVersion);
  } catch (e) { throw new Error(`bc:linkUnavailable|${stateOf(e)}|${p}`); }
  try {
    const rows = db.prepare(`SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' ORDER BY bc_fold(name), name`).all() as { name: string }[];
    return { kind, tables: rows.map((r) => r.name).filter((n) => !isReservedName(n)).map((name) => ({ name })) };
  } finally { db.close(); }
}
const samePath = (a: string, b: string) => {
  const k = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return k(a) === k(b);
};

/** The real path (Windows ignores case), the path itself when it is gone: the key of an Access password. */
const realKey = (p: string) => {
  let r: string;
  try { r = fs.realpathSync.native(p); } catch { r = path.resolve(p); }
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/** stamp (C2 R4): an Access source's file size, modification time and linked names when its copy was built. lockBase: the
 *  lock.ts base path of `lock` when it is a presence entry (C3 R2), else the file itself. */
type Entry = SourceConn & { lock?: HeldLock; lockBase?: string; kind: SourceKind; stamp?: string };

export class LinkedSources {
  private conns = new Map<string, Entry>();
  private opens = 0;
  /** C2 R7: Access passwords by real path, for this session only: never written, logged or returned. */
  private readonly passwords = new Map<string, string>();
  /** Replaced Access copies, kept open until the next tick() or close(): a caller of this request may still hold one (m1). */
  private retired: DatabaseSync[] = [];

  constructor(private readonly front: () => DatabaseSync, private readonly deps: LinkedDeps) {}

  private connect(kind: SourceKind, p: string, mode: 'write' | 'readOnly'): DatabaseSync { return openSource(kind, p, mode, this.deps.appVersion); }

  private connectSource(sourceId: string, write: boolean, takeOver: boolean): SourceConn {
    const row = sourceRows(this.front()).find((s) => s.id === sourceId);
    const p = row ? resolveSourcePath(row, this.deps.frontEnd) : '';
    const risk = detectLocationRisk(p, this.deps.probe);
    const failed = (state: LinkState): SourceConn => ({ db: null, writable: false, state, path: p, risk });
    if (!row) return failed('cannotOpen');
    if (row.kind !== 'basecraft' && row.kind !== 'sqlite' && row.kind !== 'access') return failed('unsupportedKind');
    const kind = row.kind;
    if (!fs.existsSync(p)) return failed('missingFile');
    // the front-end itself: acquireLock would adopt its lock (same session id), and close() would release it
    if (samePath(p, this.deps.frontEnd)) return failed('cannotOpen');
    try {
      if (sourceKindOf(p) !== kind) return failed('cannotOpen');
    } catch (e) { return failed(stateOf(e)); }
    if (kind === 'access') {
      try { return this.connectAccess(sourceId, p, risk); } catch (e) { return failed(stateOf(e)); }
    }
    if (kind === 'basecraft' && write) {
      let dataFile: boolean;
      try { dataFile = peekStartup(p)?.dataFile === true; } catch (e) { return failed(stateOf(e)); } // busy or unreadable: fail closed
      if (dataFile) return this.connectShared(sourceId, p, risk, takeOver);
    }
    let r: LockResult | null = null;
    if (write) {
      r = acquireLock(p, this.deps.sessionId, this.deps.lockDeps);
      if (r.status === 'heldByOther' && r.stale && takeOver) r = takeOverStaleLock(p, r.info, this.deps.sessionId, this.deps.lockDeps);
      if (r.status === 'acquired' && !isWritable(p)) { r.lock.release(); r = null; }
    }
    const lock = r?.status === 'acquired' ? r.lock : undefined;
    let db: DatabaseSync;
    try {
      // Lock first, then the write open: it rolls a hot journal back (a crashed writer of this file), and refuses an older
      // major or a newer one before writing anything.
      db = this.connect(kind, p, lock ? 'write' : 'readOnly');
    } catch (e) {
      lock?.release();
      return failed(stateOf(e));
    }
    this.opens++;
    const e: Entry = { db, writable: !!lock, state: lock ? 'ok' : 'readOnly', path: p, risk, kind, ...(lock ? { lock } : {}) };
    if (r?.status === 'heldByOther') Object.assign(e, { holder: r.info, stale: r.stale });
    this.conns.set(sourceId, e);
    return e;
  }

  /** C3 R3, R6: every link to a data file from a writable front-end is shared: the entry written before `${p}.lock` is checked
   *  (R5); the designer's exclusive lock (R4) makes it read-only, with its holder (a stale one taken over on Refresh). */
  private connectShared(sourceId: string, p: string, risk: LocationRisk, takeOver: boolean): SourceConn {
    const readOnly = (state: LinkState, extra: Partial<Entry> = {}): SourceConn => {
      let db: DatabaseSync;
      try { db = this.connect('basecraft', p, 'readOnly'); } catch (e) { return { db: null, writable: false, state: stateOf(e), path: p, risk }; }
      this.opens++;
      const e: Entry = { db, writable: false, state, path: p, risk, kind: 'basecraft', ...extra };
      this.conns.set(sourceId, e);
      return e;
    };
    const refusal = sharedRefusal(risk, this.deps.probe.platform);
    if (refusal) return readOnly(refusal); // no entry
    const entry = joinPresence(p, this.deps.sessionId, this.deps.lockDeps);
    if (!entry) return readOnly('readOnly');
    // our own session id: left by this session before a data-process restart (nothing beats it any more): removed
    releaseIfOurs(p, this.deps.sessionId, this.deps.lockDeps);
    let held = peekLock(p, this.deps.lockDeps);
    if (held && held.stale && takeOver) {
      const r = takeOverStaleLock(p, held.info, this.deps.sessionId, this.deps.lockDeps);
      if (r.status === 'acquired') { r.lock.release(); held = null; } else if (r.status === 'heldByOther') held = r;
    }
    if (held) {
      entry.release();
      return readOnly('readOnly', { holder: held.info, stale: held.stale });
    }
    let db: DatabaseSync;
    try { db = this.connect('basecraft', p, 'write'); } catch (e) { // never migrated, never stamped (C1 PF3)
      entry.release();
      return { db: null, writable: false, state: stateOf(e), path: p, risk };
    }
    this.opens++;
    const e: Entry = { db, writable: true, state: 'ok', path: p, risk, kind: 'basecraft', lock: entry, lockBase: presenceEntry(p, this.deps.sessionId), shared: true };
    this.conns.set(sourceId, e);
    return e;
  }

  /** C2 R4: the file's size and modification time, and the remote names the front-end links from this source. */
  private stampOf(sourceId: string, p: string): { stamp: string; names: string[] } {
    const st = fs.statSync(p);
    const names = linkRows(this.front()).filter((l) => l.sourceId === sourceId).map((l) => l.remote);
    return { stamp: JSON.stringify([st.size, st.mtimeMs, names]), names };
  }

  /** C2 R3: an Access source is an in-memory copy of its linked tables (query_only): never writable, no lock, nothing written
   *  beside the file. Throws when it cannot be read; a linked name gone from the file is missingTable (where()). */
  private connectAccess(sourceId: string, p: string, risk: LocationRisk): Entry {
    const { stamp, names } = this.stampOf(sourceId, p); // before the read: a save during it is seen by the next use
    const r = openAccess(p, this.passwords.get(realKey(p))); // its errors carry the path only, never the password
    let db: DatabaseSync;
    try { ({ db } = loadAccessCache(r, names)); } catch (e) { console.error(e); throw e; } // m3: cannotOpen, with a trace
    const e: Entry = { db, writable: false, state: 'ok', path: p, risk, kind: 'access', stamp };
    this.opens++; // a new copy: dataVersions() changes, so cached totals and snapshots go
    this.conns.set(sourceId, e);
    return e;
  }
  private fresh(sourceId: string, c: Entry): boolean {
    try { return this.stampOf(sourceId, c.path).stamp === c.stamp; } catch { return false; }
  }

  /** Opened once and cached; never throws (state says why; a failure is not cached: the next use tries again). `write`: try the
   *  lock; false: read-only, no lock. A cached source whose file is gone (renamed or deleted under it) is closed and reported.
   *  An Access source whose file or linked names changed is rebuilt (C2 R4; ponytail: one stat per use, a minimum interval if a
   *  share makes it slow); the old copy is retired, not closed: this request may still be reading it. */
  open(sourceId: string, write: boolean): SourceConn {
    const c = this.conns.get(sourceId);
    if (c && fs.existsSync(c.path) && (c.kind !== 'access' || this.fresh(sourceId, c))) return c;
    if (c?.kind === 'access') {
      this.conns.delete(sourceId);
      if (c.db) this.retired.push(c.db);
    } else if (c) this.drop(sourceId);
    return this.connectSource(sourceId, write, false);
  }

  /** C2 R7: `password` kept for the session when the Access file at `p` accepts it (true), false when it refuses it. `p` must be
   *  an Access source of the front-end or `picked` (the file the link dialog returned), else bc:invalidArgument. */
  unlockAccess(p: string, password: string, picked: boolean): boolean {
    const isSource = sourceRows(this.front()).some((s) => s.kind === 'access' && samePath(resolveSourcePath(s, this.deps.frontEnd), p));
    if (!picked && !isSource) throw new Error('bc:invalidArgument');
    try { openAccess(p, password); } catch (e) {
      if (stateOf(e) === 'needsPassword') return false;
      throw e;
    }
    this.passwords.set(realKey(p), password);
    return true;
  }

  /** inspectSource with this session's password for `p` (C2 R7). */
  inspect(p: string): { kind: SourceKind; tables: SourceTable[] } {
    return inspectSource(p, this.deps.appVersion, this.passwords.get(realKey(p)));
  }

  /** Close, then open; takes a stale lock over (R4: the user's Refresh is the confirmation). An Access copy is rebuilt. */
  refresh(sourceId: string, write: boolean): SourceConn {
    this.drop(sourceId);
    return this.connectSource(sourceId, write, true);
  }

  /** Closes a source (its lock released); its next use opens it again. */
  drop(sourceId: string): void {
    const c = this.conns.get(sourceId);
    if (!c) return;
    this.conns.delete(sourceId);
    try { c.db?.close(); } catch { /* already unusable */ } finally { c.lock?.release(); }
  }

  /** Heartbeats; a lost lock makes that source read-only (reopened so, with its holder). True when a lock was lost. A presence
   *  entry is written again first (C3 R2, as Session.beat()): a transient share error does not leave the link read-only. */
  tick(): boolean {
    this.closeRetired();
    let lost = false;
    for (const [id, c] of this.conns) {
      if (!c.lock || c.lock.heartbeat() === 'ok' || (c.lockBase && this.rejoin(c))) continue;
      lost = true;
      try { c.db?.close(); } catch { /* already unusable */ }
      let db: DatabaseSync | null = null;
      try { db = this.connect(c.kind, c.path, 'readOnly'); } catch (e) { console.error(e); }
      const v = peekLock(c.path, this.deps.lockDeps);
      const next: Entry = { db, writable: false, state: db ? 'readOnly' : 'cannotOpen', path: c.path, risk: c.risk, kind: c.kind };
      if (v) Object.assign(next, { holder: v.info, stale: v.stale });
      if (db) { this.conns.set(id, next); this.opens++; } // a new connection: dataVersions() changes
      else this.conns.delete(id);
    }
    return lost;
  }

  /** R2, R5: the entry released (only if still ours), written again, then the exclusive lock checked; held by another session
   *  (the designer's structure change while this entry was gone): the new entry released, false. */
  private rejoin(c: Entry): boolean {
    c.lock!.release();
    const entry = joinPresence(c.path, this.deps.sessionId, this.deps.lockDeps);
    if (!entry) return false;
    if (!peekLock(c.path, this.deps.lockDeps)) { c.lock = entry; return true; }
    entry.release();
    return false;
  }

  heldLockPaths(): string[] { return [...this.conns.values()].filter((c) => c.lock).map((c) => c.lockBase ?? c.path); }

  /** The count of connections opened, then PRAGMA data_version of each open one: another process's commit, or a new connection,
   *  changes the list. */
  dataVersions(): number[] {
    const out = [this.opens];
    for (const c of this.conns.values()) if (c.db) out.push((c.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version);
    return out;
  }

  private closeRetired(): void {
    for (const db of this.retired.splice(0)) try { db.close(); } catch { /* already unusable */ }
  }

  close(): void {
    for (const id of [...this.conns.keys()]) this.drop(id);
    this.closeRetired();
  }
}
