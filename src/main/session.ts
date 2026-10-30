// Une base ouverte = fichier + verrou d'écriture + mode lecture seule.
// Elle vit dans le processus de données (db-host/host.ts, un utilityProcess) : le processus principal l'appelle par
// db-host/client.ts, une file par session, chaque méthode devenant asynchrone.
import { randomUUID } from 'node:crypto';
import { realpathSync, renameSync } from 'node:fs';
import { basename } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  ActionResult, CascadeChild, CompactResult, DeleteResult, QueryRef, RunActionOptions, FieldFilter, LinkFileInfo, LinkInfo, LinkResult, LookupRow, ObjectKind, ObjectSummary, OpResult, Relation,
  RelationResult, RelationsLayout, SaveTableRequest, SaveTableResult, SessionState, SplitResult,
} from '../shared/api';
import type { RecordSourceRef, SourceInfo, SourcePage, SourcePageRequest, SourceSaveRequest, SourceSaveResult } from '../shared/record-source';
import type { CellInput, SqlValue } from '../shared/coerce';
import { defaultProps, quoteIdent, sameName, validateDesign, type FieldProps, type TableDesign } from '../shared/field-types';
import type { ImportPlan, ImportResult, ImportSpec, TextPreview } from '../shared/import-text';
import { localeInfo, type LocaleInfo } from '../shared/locale-format';
import { alterTable } from './db/alter';
import { compactBase, vacuumInto, type CopyDeps } from './db/copy-file';
import { backupCopy, BaseFileError, createBaseFile, openBaseFile } from './db/file-format';
import { copyObject, deleteObject, getObject, listObjects, renameObject, saveObject, setObjectDescription } from './db/objects';
import { acquireLock, peekLock, takeOverStaleLock, type HeldLock, type LockDeps, type LockInfo } from './db/lock';
import { detectLocationRisk, type LocationRisk, type RiskProbe } from './db/location-risk';
import { acquireExclusive, dataFileInUse, joinPresence, othersPresent, presenceEntry, sharedRefusal, type ExclusiveResult, type PresenceDeps } from './db/presence';
import { countRows, lookupRows, readRows, type PageRequest, type RowPage } from './db/rows';
import {
  cascadeChildren, createTable, DanglingKeyError, DesignValidationError, dataDesign, dropTable, hasRealRowid, isQueryName, isTableName, listTables, NameExistsError, reconcile, renameTable,
  setTableDescription, tableDesign, ViewBrokenError, type TableSummary,
} from './db/schema';
import { splitDatabase } from './db/split';
import { copyRows, deleteRows, insertRow, updateRow, type RowWriteResult } from './db/write-layer';
import { inTransaction, inTransactionAsync } from './db/tx';
import { countViolations } from './db/rules';
import { deleteRelation, listRelations, relationsLayout, saveRelation, saveRelationsLayout } from './db/relations';
import { peekStartup, saveStartupOptions, startupOptions } from './db/startup';
import type { StartupOptions } from '../shared/startup';
import { writeTextExport } from './exchange/export-text';
import { writeExcelExport } from './exchange/export-excel';
import { EXCEL_SPEC, type ExcelPreview, type ExportResult, type ExportSource, type ExportTextSpec } from '../shared/exchange';
import { deleteSpec, loadSpecs, saveSpec } from './import/specs';
import { previewText, runImport, type ImportTexts } from './import/text-import';
import { excelSource, previewExcel, readSheet } from './exchange/excel-read';
import { checkQueryDefinition, queryCatalog, describeQuerySource, pageQuerySource, resolve, type QueryConn, type QueryCtx } from './query/source';
import { LOCAL_SOURCE } from '../shared/query/bind';
import { bracket } from '../shared/expr/lexer';
import { autoLookup, saveSourceRow } from './query/join-write';
import { actionCount, runAction } from './query/action';
import { activeContent, type ActiveContent } from './db/active-content';
import { isWritable, LinkedSources, type SourceConn } from './links/connections';
import { addLinks, findLink, isLinkName, linkRows, relinkRows, removeLink, resolveSourcePath, setLinkDescription, sourceRows, type LinkRow } from './links/store';
import { fold } from '../shared/expr/sql';

export interface SessionDeps {
  appVersion: string;
  region: string;
  probe: RiskProbe;
  lockDeps?: LockDeps;
  sessionId?: string;
  onStateChanged?: (s: SessionState) => void; // lock lost, holder changed, taken over
  openFile?: typeof openBaseFile; // test seam
  migrate?: boolean; // false: a base of an older format is refused (needsDesigner), never migrated (the Runtime); default true
  openMode?: 'shared' | 'exclusive'; // a data file opened directly (C3 R3); default shared
  presence?: Pick<PresenceDeps, 'settleMs' | 'sleep' | 'readDir'>; // merged with lockDeps: one now/hostname
  origin?: string; // the original of a local copy (C3 R14): links resolve against its folder, fileName is its name
  runtime?: boolean; // BaseCraft Runtime: a front-end's local tables are read-only (C3 R15)
}

export class ReadOnlyError extends Error {
  constructor() {
    super('read-only base');
    this.name = 'ReadOnlyError';
  }
}

// Stands for "no lock file": takeOverStaleLock then simply acquires.
const NO_LOCK: LockInfo = { user: '?', host: '?', pid: 0, sessionId: '?', heartbeatAt: new Date(0).toISOString() };
const isPlaceholder = (i: LockInfo) => i.pid === 0 && i.sessionId === '?';

export class Session {
  private db: DatabaseSync | null = null;
  private lock: HeldLock | null = null;
  /** A data file open in shared mode: this session's presence entry (C3 R2), instead of the exclusive lock. */
  private presence: HeldLock | null = null;
  private readonly dataFile: boolean;
  /** R15: a front-end in the Runtime, whose local tables are read-only. */
  private readonly localReadOnly: boolean;
  /** Where links resolve: the original of a local copy (R14), else the base itself. */
  private readonly frontEndPath: string;
  private readonly presenceDeps: PresenceDeps;
  private observed: LockInfo | null = null; // exact object from the lock module: takeOverStaleLock needs it back
  private refused = false; // take-over refused on an unreadable lock: do not offer it again while it stays unreadable
  private closed = false;
  private _state!: SessionState;
  private readonly sessionId: string;
  private readonly risk: LocationRisk;
  private readonly info: LocaleInfo;
  private readonly openFile: typeof openBaseFile;
  /** Write sequence of the cached query totals and sorted-order snapshots (readRows): moved by writeDb(), by another connection's commit, by a new connection. */
  private seq = 0;
  private seen: [DatabaseSync | null, string] = [null, ''];
  /** The active content the main process enabled (trust.ts), by its fingerprint ('' : a base with none); null: disabled, until
   *  the main process says otherwise. */
  private enabledContent: string | null = null;
  private readonly links: LinkedSources;

  static create(path: string, deps: SessionDeps): Session {
    createBaseFile(path, deps.appVersion);
    return new Session(path, deps);
  }
  static open(path: string, deps: SessionDeps): Session {
    return new Session(path, deps);
  }

  private constructor(private readonly path: string, private readonly deps: SessionDeps) {
    this.sessionId = deps.sessionId ?? randomUUID();
    this.risk = detectLocationRisk(path, deps.probe); // once: the Windows drive probe can block ~0.5 s
    this.info = localeInfo(deps.region);
    this.openFile = deps.openFile ?? openBaseFile;
    this.frontEndPath = deps.origin ?? path;
    this.links = new LinkedSources(() => this.conn(), {
      frontEnd: this.frontEndPath, appVersion: deps.appVersion, sessionId: this.sessionId, ...(deps.lockDeps ? { lockDeps: deps.lockDeps } : {}), probe: deps.probe,
    });
    this.presenceDeps = { ...deps.lockDeps, ...deps.presence };
    const startup = peekStartup(path);
    this.dataFile = startup?.dataFile === true;
    this.localReadOnly = deps.runtime === true && startup?.frontEnd === true;
    if (!this.dataFile) {
      this.apply(acquireLock(path, this.sessionId, deps.lockDeps));
      return;
    }
    const refusal = sharedRefusal(this.risk, deps.probe.platform); // R6: no entry, no lock
    if (!refusal) this.openData();
    else {
      this._state = { ...this.readOnlyState(), readOnlyReason: refusal };
      this.db = this.openReadOnly();
    }
  }

  /** A data file (C3 R3): the workstation's open mode, exclusive (and alone, R4) or shared. */
  private openData(): void {
    if (this.deps.openMode === 'exclusive') this.apply(acquireExclusive(this.path, this.sessionId, this.presenceDeps));
    else this.openShared();
  }

  /** R2, R5: the entry is written before the exclusive lock is checked. Write mode with no migration and no reconcile; an older
   *  format is migrated only by a session alone, which then keeps the exclusive lock (never by the Runtime). */
  private openShared(): void {
    const entry = joinPresence(this.path, this.sessionId, this.presenceDeps);
    if (!entry) return this.apply({ status: 'cannotLock', reason: 'EACCES' });
    const held = peekLock(this.path, this.deps.lockDeps);
    if (held) {
      entry.release();
      // our own session id: the data process restarted (Stop) after this session went exclusive: adopted, as acquireLock does
      return this.apply(held.info.sessionId === this.sessionId ? acquireLock(this.path, this.sessionId, this.deps.lockDeps) : held);
    }
    let db: DatabaseSync;
    try {
      db = this.openFile(this.path, 'write', this.deps.appVersion, { migrate: false }).db; // rolls a hot journal back
    } catch (e) {
      entry.release();
      if (!(e instanceof BaseFileError && e.code === 'needsDesigner') || this.deps.migrate === false) throw e;
      const r = acquireExclusive(this.path, this.sessionId, this.presenceDeps);
      if (r.status === 'inUse') throw dataFileInUse(r.users);
      return this.apply(r);
    }
    this.db?.close();
    this.db = db;
    this.presence = entry;
    this.observed = null;
    this.refused = false;
    this._state = { ...this.readOnlyState(), readOnly: false, shared: true };
    this.syncLinkedLocks();
  }

  get state(): SessionState { return this._state; }

  private readOnlyState(): SessionState {
    return { path: this.path, fileName: basename(this.frontEndPath), ...(this.deps.origin ? { origin: this.deps.origin } : {}), readOnly: true, locationRisk: this.risk, ...(this.dataFile ? { dataFile: true as const } : {}) };
  }

  private openReadOnly(): DatabaseSync { return this.openFile(this.path, 'readOnly', this.deps.appVersion, { migrate: this.deps.migrate }).db; }

  /** Write mode when the lock is ours and the file writable (reconciled: under the exclusive lock only); read-only otherwise, with the reason. */
  private apply(r: ExclusiveResult): void {
    if (r.status === 'acquired' && !isWritable(this.path)) {
      r.lock.release();
      r = { status: 'cannotLock', reason: 'EACCES' };
    }
    if (r.status === 'acquired') {
      let db: DatabaseSync | undefined;
      try {
        const o = this.openFile(this.path, 'write', this.deps.appVersion, { migrate: this.deps.migrate }); // rolls a hot journal back, migrates
        db = o.db;
        const report = reconcile(db); // write mode only
        const s: SessionState = { ...this.readOnlyState(), readOnly: false };
        if (Object.values(report).some((a) => a.length > 0)) s.reconcileReport = report;
        if (o.backupPath) s.migratedBackupPath = o.backupPath;
        this._state = s;
      } catch (e) {
        db?.close();
        r.lock.release();
        throw e;
      }
      this.db?.close();
      this.db = db;
      this.lock = r.lock;
      this.observed = null;
      this.refused = false;
      return;
    }
    if (r.status === 'heldByOther') {
      // The same object back means the lock could not be read: offering the take-over again would loop forever.
      this.refused = r.info === this.observed;
      this._state = { ...this.readOnlyState(), readOnlyReason: 'heldByOther', lockHolder: r.info, lockStale: r.stale && !this.refused };
      this.observed = r.info;
    } else if (r.status === 'inUse') this._state = { ...this.readOnlyState(), readOnlyReason: 'inUse', users: r.users };
    else this._state = { ...this.readOnlyState(), readOnlyReason: 'fileReadOnly' };
    if (this.db) return;
    try {
      this.db = this.openReadOnly();
    } catch (e) {
      // Crashed base (hot journal) or pending migration behind a dead holder: only the write open of a take-over fixes it.
      const recoverable = r.status === 'heldByOther' && r.stale && e instanceof BaseFileError && (e.code === 'cannotOpen' || e.code === 'needsMigration');
      if (!recoverable) throw e;
      this._state.needsRecovery = true;
    }
  }

  /** Re-reads the lock of a read-only session (holder gone or no longer beating). Returns true if the state changed. */
  private peek(): boolean {
    const v = peekLock(this.path, this.deps.lockDeps);
    if (v && this.refused && isPlaceholder(v.info)) return false;
    this.refused = false;
    this.observed = v?.info ?? NO_LOCK;
    const before = JSON.stringify([this._state.lockHolder, this._state.lockStale]);
    const next: SessionState = { ...this._state, lockStale: v ? v.stale : true };
    if (v) next.lockHolder = v.info;
    else delete next.lockHolder;
    if (JSON.stringify([next.lockHolder, next.lockStale]) === before) return false;
    this._state = next;
    return true;
  }

  /** Heartbeat for the holder; lock re-check for read-only sessions. A lost lock switches to read-only. */
  tick(): void {
    if (this.closed) return;
    let changed = false;
    if (!this._state.readOnly) {
      if (!this.beat()) {
        // this.lock is kept: close() releases it only if it is still ours (transient write failure)
        let ro: DatabaseSync | null = null;
        try { ro = this.openReadOnly(); } catch (e) { console.error(e); } // retried by the next tick
        try { this.db?.close(); } catch { /* already unusable */ }
        this.db = ro;
        const { shared: _shared, ...rest } = this._state;
        this._state = { ...rest, readOnly: true, readOnlyReason: 'lockLost' };
        this.links.close(); // a read-only front-end writes no linked file: its links reopen read-only on next use
        changed = true;
      }
    } else if (!this.db && !this._state.needsRecovery) {
      try { this.db = this.openReadOnly(); } catch { /* still unreadable: next tick */ }
    }
    if (this._state.readOnlyReason === 'heldByOther' || this._state.readOnlyReason === 'lockLost') changed = this.peek() || changed;
    this.links.tick();
    if (this.syncLinkedLocks() || changed) this.deps.onStateChanged?.(this._state);
  }

  /** The exclusive lock's heartbeat, or the presence entry's: an entry someone removed is written again (C3 R2). */
  private beat(): boolean {
    if (!this.presence) return !this.lock || this.lock.heartbeat() === 'ok';
    if (this.presence.heartbeat() === 'ok') return true;
    this.presence.release(); // only if still ours (a failed write)
    this.presence = joinPresence(this.path, this.sessionId, this.presenceDeps);
    if (!this.presence) return false;
    // R5, as at open: written first, then the exclusive lock checked (taken while this entry was gone: a sleep past 30 s)
    const held = peekLock(this.path, this.deps.lockDeps);
    if (!held || held.info.sessionId === this.sessionId) return true;
    this.presence.release();
    this.presence = null;
    return false;
  }

  /** _state.linkedLocks follows the locks the links hold (R4) and the presence entry (C3 R2); true when it changed. */
  private syncLinkedLocks(): boolean {
    const held = [...(this.presence ? [presenceEntry(this.path, this.sessionId)] : []), ...this.links.heldLockPaths()];
    if (JSON.stringify(held) === JSON.stringify(this._state.linkedLocks ?? [])) return false;
    const { linkedLocks: _old, ...rest } = this._state;
    this._state = held.length ? { ...rest, linkedLocks: held } : rest;
    return true;
  }

  /** Takes over a stale lock; the lock module refuses a live one, so this also refreshes the holder's state. */
  takeOverLock(): SessionState {
    if (this.closed || !this.observed) return this._state;
    const r = takeOverStaleLock(this.path, this.observed, this.sessionId, this.deps.lockDeps);
    if (this.dataFile && r.status === 'acquired') {
      r.lock.release(); // the stale exclusive lock removed: the data file opens as at first (C3 R3)
      this.openData();
    } else this.apply(r);
    if (!this._state.readOnly) this.links.close(); // opened read-only meanwhile: writable on next use
    this.deps.onStateChanged?.(this._state);
    return this._state;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.links.close();
    try { this.db?.close(); } catch { /* already unusable */ } finally { this.lock?.release(); this.presence?.release(); }
    this.db = null;
  }

  private conn(): DatabaseSync {
    if (!this.db) throw new Error(this._state.needsRecovery ? 'bc:needsRecovery' : 'bc:cannotOpen');
    return this.db;
  }

  private writeDb(): DatabaseSync {
    this.tick();
    if (this._state.readOnly) throw new ReadOnlyError();
    this.seq++;
    return this.conn();
  }

  /** C3 R4: a structure call. In shared mode it first takes the exclusive lock, kept until close (newcomers then open
   *  read-only), refused while anyone else is present: bc:dataFileInUse||<user (host), ...>. */
  private structureDb(): DatabaseSync {
    const db = this.writeDb();
    if (!this.presence) return db;
    const r = acquireExclusive(this.path, this.sessionId, this.presenceDeps);
    if (r.status === 'inUse') throw dataFileInUse(r.users);
    if (r.status === 'heldByOther') throw dataFileInUse([r.info]); // another one's structure change, during its settle wait
    if (r.status === 'cannotLock') throw new ReadOnlyError();
    this.lock = r.lock;
    this.presence.release();
    this.presence = null;
    const { shared: _shared, ...rest } = this._state;
    this._state = rest;
    this.syncLinkedLocks();
    this.deps.onStateChanged?.(this._state);
    return db;
  }

  /** The current write sequence; PRAGMA data_version changes when another connection (another BaseCraft) commits, to the
   *  front-end or to a linked file (one key with the links' versions). */
  private writeSeq(): number {
    const db = this.conn();
    const v = this.dataStamp();
    if (this.seen[0] !== db || this.seen[1] !== v) {
      this.seen = [db, v];
      this.seq++;
    }
    return this.seq;
  }
  /** The writeSeq key: the front-end's PRAGMA data_version and links.dataVersions(), as one string. Reads only (C3 R10: the
   *  main process's refresh timer compares it; own commits leave it unchanged). '' with no connection (needsRecovery, a failed
   *  read-only reopen): asked every interval, it must not throw then. */
  dataStamp(): string {
    if (!this.db) return '';
    return JSON.stringify([(this.conn().prepare('PRAGMA data_version').get() as { data_version: number }).data_version, ...this.links.dataVersions()]);
  }
  private queryCtx(): QueryCtx { return { info: this.info, writeSeq: () => this.writeSeq() }; }

  /** The session's own design (never the renderer's); rowid-based access needs a real, unshadowed rowid. */
  private dataDesign(table: string): TableDesign { return dataDesign(this.conn(), table); }

  /** A link's source, opened on first use (R3), writable when the front-end is (PF5); linkedLocks follows. */
  private source(sourceId: string): SourceConn {
    const c = this.links.open(sourceId, !this._state.readOnly);
    if (this.syncLinkedLocks()) this.deps.onStateChanged?.(this._state);
    return c;
  }
  /** A local table or query of a link's name wins (an older BaseCraft may have made one): that link is unusable until the local
   *  object is renamed. */
  private shadowed(front: DatabaseSync, name: string): boolean { return isTableName(front, name) || isQueryName(front, name); }
  /** The link `name` stands for, unless a local object of that name wins. */
  private linkOf(name: string): LinkRow | undefined {
    const front = this.conn();
    return this.shadowed(front, name) ? undefined : findLink(front, name);
  }
  /** Where `name` lives: the front-end (a local table, or a name that is neither: the front-end's own errors stand), or a link's
   *  source, where it is `table`. bc:linkUnavailable|<state>|<path> when its source cannot be read or no longer holds the table.
   *  `write` (R8): ReadOnlyError when the front-end or the source is read-only; the write sequence moves (PF6). */
  private where(name: string, write = false): { db: DatabaseSync; table: string; link?: LinkRow; writable: boolean } {
    const front = write ? this.writeDb() : this.conn(); // ReadOnlyError for a read-only front-end; moves the sequence
    const link = this.shadowed(front, name) ? undefined : findLink(front, name);
    if (!link) {
      if (write && this.localReadOnly) throw new ReadOnlyError();
      return { db: front, table: name, writable: !this._state.readOnly && !this.localReadOnly };
    }
    const c = this.sourceDb(link.sourceId, write);
    if (!isTableName(c.db, link.remote)) throw new Error(`bc:linkUnavailable|missingTable|${c.path}`);
    return { db: c.db, table: link.remote, link, writable: c.writable };
  }
  /** A link source's open connection (bc:linkUnavailable|<state>|<path>); `write`: ReadOnlyError when it is read-only. */
  private sourceDb(sourceId: string, write: boolean): SourceConn & { db: DatabaseSync } {
    const c = this.source(sourceId);
    if (!c.db) throw new Error(`bc:linkUnavailable|${c.state}|${c.path}`);
    if (write && !c.writable) throw new ReadOnlyError();
    return c as SourceConn & { db: DatabaseSync };
  }
  /** Queries (R10): saved queries in the front-end, tables local or linked (a link's design is its source's), each tagged with
   *  its source; a bound query runs on its source's connection (where()'s rules: write needs a writable front-end too). */
  private qc(): QueryConn {
    const front = this.conn();
    return {
      front,
      catalog: {
        table: (name) => {
          if (isTableName(front, name)) return tableDesign(front, name);
          if (!this.linkOf(name)) return null;
          const at = this.where(name);
          return tableDesign(at.db, at.table);
        },
        query: queryCatalog(front).query,
        sourceOf: (name) => this.linkOf(name)?.sourceId ?? LOCAL_SOURCE,
      },
      dbOf: (source, write) => {
        if (source === LOCAL_SOURCE) {
          if (write && this.localReadOnly) throw new ReadOnlyError();
          return write ? this.writeDb() : front;
        }
        if (write) this.writeDb(); // a read-only front-end writes no linked file; the write sequence moves (PF6)
        return this.sourceDb(source, write).db;
      },
      writable: (source) => (source === LOCAL_SOURCE ? !this.localReadOnly : this.source(source).writable), // a local query: as a local table's (describeSource)
    };
  }
  /** R7: a linked table without a real rowid is read, read-only, as the query `SELECT *` over it (no rowids); null otherwise. */
  private noRowidLink(name: string): QueryRef | null {
    const at = this.where(name);
    return at.link && !hasRealRowid(at.db, tableDesign(at.db, at.table)) ? { kind: 'sql', sql: `SELECT * FROM ${bracket(name)}` } : null;
  }
  /** R8: a linked table's structure belongs to its file. */
  private noLink(name: string): void {
    if (this.linkOf(name)) throw new Error('bc:linkedTable');
  }

  /** Local tables, then links (no source opened), sorted together as liveTableNames sorts (bc_fold, then name). */
  listTables(): TableSummary[] {
    const front = this.conn();
    const local = listTables(front);
    const sources = sourceRows(front);
    const links = linkRows(front).filter((l) => !this.shadowed(front, l.name)).map((l): TableSummary => {
      const s = sources.find((x) => x.id === l.sourceId);
      const link = { kind: s?.kind ?? '', path: s ? resolveSourcePath(s, this.frontEndPath) : '' };
      return { name: l.name, ...(l.description !== undefined ? { description: l.description } : {}), link };
    });
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return [...local, ...links].sort((a, b) => cmp(fold(a.name), fold(b.name)) || cmp(a.name, b.name));
  }
  tableDesign(name: string): TableDesign {
    const { db, table } = this.where(name);
    return tableDesign(db, table);
  }

  async saveTable(req: SaveTableRequest): Promise<SaveTableResult> {
    if (req.originalName !== null) this.noLink(req.originalName);
    const db = this.structureDb();
    try {
      if (req.originalName === null) {
        createTable(db, req.design);
        return { ok: true };
      }
      return await alterTable(db, req.originalName, req.design, req.mapping, {
        allowDataLoss: req.allowDataLoss, info: this.info, acceptExistingViolations: req.acceptExistingViolations === true,
      });
    } catch (e) {
      if (e instanceof DesignValidationError) return { ok: false, reason: 'design', errors: e.errors };
      if (e instanceof NameExistsError) return { ok: false, reason: 'nameExists' };
      if (e instanceof DanglingKeyError) return { ok: false, reason: 'danglingKey', table: e.table };
      throw e;
    }
  }

  renameTable(oldName: string, newName: string): OpResult {
    this.noLink(oldName);
    const db = this.structureDb();
    try {
      renameTable(db, oldName, newName);
      return { ok: true };
    } catch (e) {
      if (e instanceof DesignValidationError) return { ok: false, reason: 'nameInvalid' };
      if (e instanceof NameExistsError) return { ok: false, reason: 'nameExists' };
      if (e instanceof DanglingKeyError) return { ok: false, reason: 'danglingKey', table: e.table };
      if (e instanceof ViewBrokenError) return { ok: false, reason: 'viewBroken', view: e.view };
      throw e;
    }
  }

  /**
   * Copy of a table: structure and data (Access's "Structure and Data"), under a new name in the tables' namespace. The copy
   * is a managed table (no external flag). A table BaseCraft cannot address by rowid, or data the copy's constraints refuse
   * (an external table holding text in an INTEGER column), rejects bc:unsupportedTable and creates nothing. ponytail: only
   * INTEGER columns get a range CHECK; text in an inferred REAL or untyped column is copied as it is.
   */
  copyTable(name: string, newName: string, mode: 'structure' | 'data' = 'data'): OpResult {
    this.noLink(name);
    const db = this.structureDb();
    if (!listTables(db).some((x) => sameName(x.name, name))) return { ok: false, reason: 'notFound' };
    if (this.linkOf(newName)) return { ok: false, reason: 'nameExists' }; // links share the namespace
    const to = newName.normalize('NFC');
    if (validateDesign({ name: to, fields: [{ name: 'x', props: defaultProps('longText') }] }).length) return { ok: false, reason: 'nameInvalid' };
    const source = this.dataDesign(name); // bc:unsupportedTable: WITHOUT ROWID, or a field that shadows the rowid
    const fields = source.fields.map(({ name: n, props: { external: _external, ...props } }) => ({ name: n, props: props as FieldProps }));
    try {
      inTransaction(db, () => {
        createTable(db, { ...source, name: to, fields });
        if (mode === 'data') copyRows(db, source, to);
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof NameExistsError) return { ok: false, reason: 'nameExists' };
      // SQLITE_CONSTRAINT (primary code 19): data the copy's CHECK, NOT NULL or UNIQUE refuses. Any other error passes through.
      const constraint = ((e as { errcode?: number }).errcode ?? 0) % 256 === 19;
      if (e instanceof DesignValidationError || constraint) throw new Error('bc:unsupportedTable');
      throw e;
    }
  }

  /**
   * Access's "Append Data to Existing Table": the source's rows go into `to`, fields matched by name; target fields without a
   * source (AutoNumber included) get their default or a new number. Each row goes through insertRow (rules, keys, conversions)
   * in one transaction; a refused row is skipped and counted. Appending a table to itself is refused as 0 rows.
   */
  async appendTable(from: string, to: string): Promise<{ appended: number; refused: number }> {
    this.noLink(to);
    const db = this.writeDb();
    const at = this.where(from); // a linked table is read on its own connection
    const src = dataDesign(at.db, at.table);
    const dst = this.dataDesign(to);
    if (!at.link && sameName(src.name, dst.name)) return { appended: 0, refused: 0 };
    const map = dst.fields.filter((d) => d.props.type !== 'autoNumber').flatMap((d) => {
      const s = src.fields.find((x) => sameName(x.name, d.name));
      return s ? [{ from: s.name, to: d.name }] : [];
    });
    if (map.length === 0) return { appended: 0, refused: 0 };
    const stmt = at.db.prepare(`SELECT ${map.map((m) => quoteIdent(m.from)).join(', ')} FROM ${quoteIdent(src.name)} ORDER BY rowid`);
    stmt.setReturnArrays(true);
    // readBigInts is off: an integer beyond 2^53 makes all() throw (ERR_OUT_OF_RANGE), never a rounded number
    const rows = stmt.all() as unknown as (string | number | null)[][];
    let appended = 0;
    await inTransactionAsync(db, async () => {
      for (const row of rows) {
        const values: Record<string, CellInput> = {};
        map.forEach((m, i) => { values[m.to] = row[i]!; });
        if ((await insertRow(db, dst, values, this.info)).ok) appended++;
      }
    });
    this.seq++;
    return { appended, refused: rows.length - appended };
  }

  /** A link's Delete deletes the link only (R8, as Access). */
  dropTable(name: string): OpResult {
    const link = this.linkOf(name);
    if (!link) return dropTable(this.structureDb(), name);
    removeLink(this.writeDb(), link.name);
    this.closeUnused([link.sourceId]);
    return { ok: true };
  }

  // Link operations (C1 Task 5). A link is named after its remote table (R2): tables, queries and links share one namespace.
  private usableLinks(): LinkRow[] {
    const front = this.conn();
    return linkRows(front).filter((l) => !this.shadowed(front, l.name));
  }
  /** `names` as usable links, in that order; bc:notFound for any other name. */
  private linksNamed(names: string[]): LinkRow[] {
    const links = this.usableLinks();
    return names.map((n) => {
      const l = links.find((x) => sameName(x.name, n));
      if (!l) throw new Error('bc:notFound');
      return l;
    });
  }
  private linkInfo(l: LinkRow, c: SourceConn): LinkInfo {
    const kind = sourceRows(this.conn()).find((x) => x.id === l.sourceId)?.kind ?? '';
    const state = c.db && !isTableName(c.db, l.remote) ? 'missingTable' : c.state;
    return { name: l.name, sourceId: l.sourceId, kind, path: c.path, state, ...(c.holder ? { holder: c.holder, stale: c.stale ?? false } : {}), risk: c.risk,
      ...(c.shared ? { shared: true as const } : {}) };
  }
  /** Closes the sources of `ids` no link uses any more (their locks released); linkedLocks follows. */
  private closeUnused(ids: string[]): void {
    const left = new Set(sourceRows(this.conn()).map((x) => x.id));
    for (const id of ids) if (!left.has(id)) this.links.drop(id);
    if (this.syncLinkedLocks()) this.deps.onStateChanged?.(this._state);
  }
  /** The front-end itself (its real path; Windows ignores case): never a source. */
  private isSelf(p: string): boolean {
    const key = (x: string) => { const r = realpathSync.native(x); return process.platform === 'win32' ? r.toLowerCase() : r; };
    try { return key(p) === key(this.path); } catch { return false; } // gone: inspectSource says so
  }

  /** The link dialog: `path`'s kind and linkable tables (R7), opened read-only with no lock, then closed; the front-end itself refused. */
  inspectLinkFile(path: string): LinkFileInfo {
    const front = this.conn();
    if (this.isSelf(path)) throw new Error(`bc:linkUnavailable|self|${path}`); // said before any table is ticked
    const { kind, tables } = this.links.inspect(path);
    return { kind, tables: tables.map((x) => ({ ...x, taken: this.shadowed(front, x.name) || isLinkName(front, x.name) })) };
  }
  /** Links `names`, tables of `path`, each under its own name (R2): a name the front-end uses refuses them all (nameExists). */
  createLinks(path: string, names: string[]): LinkResult {
    const front = this.writeDb();
    if (this.isSelf(path)) return { ok: false, reason: 'self', names: [] };
    const { kind, tables } = this.links.inspect(path);
    const wanted = names.filter((n, i) => names.findIndex((m) => sameName(m, n)) === i);
    const taken = wanted.filter((n) => this.shadowed(front, n) || isLinkName(front, n));
    if (taken.length) return { ok: false, reason: 'nameExists', names: taken };
    const missing = wanted.filter((n) => !tables.some((x) => !x.unsupported && x.name === n)); // an unsupported Access table (C2 R6) too
    if (missing.length) return { ok: false, reason: 'missingTables', names: missing };
    addLinks(front, this.frontEndPath, kind, path, wanted);
    return { ok: true };
  }
  /** The Linked Table Manager (R9): every usable link, its source opened as a read would (R4: writable when the front-end is). */
  listLinks(): LinkInfo[] {
    return this.usableLinks().map((l) => this.linkInfo(l, this.source(l.sourceId)));
  }
  /** Refresh Link (R4): each distinct source of `names` closed and reopened once; a stale lock is taken over. */
  refreshLinks(names: string[]): LinkInfo[] {
    const links = this.linksNamed(names);
    const conns = new Map<string, SourceConn>();
    for (const l of links) if (!conns.has(l.sourceId)) conns.set(l.sourceId, this.links.refresh(l.sourceId, !this._state.readOnly));
    if (this.syncLinkedLocks()) this.deps.onStateChanged?.(this._state);
    return links.map((l) => this.linkInfo(l, conns.get(l.sourceId)!));
  }
  /** Change source / relocate (R9): `names` move to `path`, which must hold each one's table (else nothing changes). The names
   *  stay the remote names (R2). Sources left without links are deleted and closed. */
  relink(names: string[], path: string): LinkResult {
    const front = this.writeDb();
    const links = this.linksNamed(names);
    if (this.isSelf(path)) return { ok: false, reason: 'self', names: [] };
    const { kind, tables } = this.links.inspect(path);
    const missing = links.filter((l) => !tables.some((t) => !t.unsupported && sameName(t.name, l.remote))).map((l) => l.name);
    if (missing.length) return { ok: false, reason: 'missingTables', names: missing };
    relinkRows(front, this.frontEndPath, links.map((l) => l.name), kind, path);
    this.closeUnused(links.map((l) => l.sourceId));
    return { ok: true };
  }
  /** C2 R7: an Access file's password, kept in the data process's memory for this session when the file accepts it (true).
   *  `path` must be an Access source of this front-end or the file the link dialog returned (`picked`), else bc:invalidArgument. */
  unlockAccess(path: string, password: string, picked: boolean): boolean { return this.links.unlockAccess(path, password, picked); }
  /** Convert to Local Table (R12), one front-end transaction: the link removed first (PF16: createTable refuses a link's name),
   *  a local table of its design (`external` dropped), its rows copied as stored in rowid order (AutoNumber values kept). Rows
   *  the local table refuses: bc:unsupportedTable, nothing changed (as copyTable). The data file's relations are not copied. */
  convertLink(name: string): OpResult {
    const link = this.linkOf(name);
    if (!link) return { ok: false, reason: 'notFound' };
    const front = this.writeDb();
    const at = this.where(link.name);
    const source = dataDesign(at.db, at.table); // bc:unsupportedTable: WITHOUT ROWID
    const fields = source.fields.map(({ name: n, props: { external: _external, ...props } }) => ({ name: n, props: props as FieldProps }));
    const cols = source.fields.map((x) => quoteIdent(x.name)).join(', ');
    const read = at.db.prepare(`SELECT ${cols} FROM ${quoteIdent(source.name)} ORDER BY rowid`);
    read.setReturnArrays(true);
    read.setReadBigInts(true); // values as stored: an integer beyond 2^53 too
    try {
      inTransaction(front, () => {
        removeLink(front, link.name);
        createTable(front, { ...source, name: link.name, fields });
        const ins = front.prepare(`INSERT INTO ${quoteIdent(link.name)} (${cols}) VALUES (${source.fields.map(() => '?').join(', ')})`);
        for (const row of read.iterate()) ins.run(...(row as unknown as SQLInputValue[]));
      });
    } catch (e) {
      const constraint = ((e as { errcode?: number }).errcode ?? 0) % 256 === 19; // as copyTable
      if (e instanceof DesignValidationError || constraint) throw new Error('bc:unsupportedTable');
      throw e;
    }
    this.closeUnused([link.sourceId]);
    return { ok: true };
  }

  async testRules(table: string): Promise<{ field: string; rows: number }[]> {
    this.noLink(table);
    const db = this.conn();
    const design = tableDesign(db, table);
    const out: { field: string; rows: number }[] = [];
    for (const field of [...design.fields.map((fd) => fd.name), '']) { // '': the table's rule, its own line
      const rows = await countViolations(db, design, field, this.info);
      if (rows) out.push({ field, rows });
    }
    return out;
  }

  // Data methods are routed (R8): a link's rows are read and written on its source's connection, by that file's rules (R6).
  count(table: string, filter?: FieldFilter[]): number {
    const q = this.noRowidLink(table);
    if (q) return this.pageSource(q, { offset: 0, limit: 0, ...(filter ? { filter } : {}) }).total;
    const { db, table: t } = this.where(table);
    return countRows(db, dataDesign(db, t).name, filter, this.info.locale);
  }
  page(table: string, req: PageRequest): RowPage {
    const q = this.noRowidLink(table);
    if (q) {
      const { offset, limit, filter, sort } = req;
      const p = this.pageSource(q, { offset, limit, ...(filter ? { filter } : {}), ...(sort ? { sort: [sort] } : {}) });
      return { rows: p.rows.map((values) => ({ rowid: NaN, values })) }; // no rowid: nothing to write back (R7)
    }
    const { db, table: t } = this.where(table);
    return readRows(db, dataDesign(db, t), req, this.info.locale, undefined, this.writeSeq());
  }

  async insert(table: string, values: Record<string, CellInput>): Promise<RowWriteResult> {
    const { db, table: t } = this.where(table, true);
    return insertRow(db, dataDesign(db, t), values, this.info, undefined, { enforceMask: true }); // datasheet entry: masked
  }
  /** expected: the record as read when editing began, by field name (C3 R8). */
  async update(table: string, rowid: number, changes: Record<string, CellInput>, expected?: Record<string, SqlValue>): Promise<RowWriteResult> {
    const { db, table: t } = this.where(table, true);
    return updateRow(db, dataDesign(db, t), rowid, changes, this.info, undefined, { enforceMask: true, expected });
  }
  delete(table: string, rowids: number[]): DeleteResult {
    const { db, table: t } = this.where(table, true);
    return deleteRows(db, dataDesign(db, t).name, rowids);
  }
  /** A table-field lookup resolves its Row Source in the file that owns the field (R6). */
  lookup(table: string, field: string): ReturnType<typeof lookupRows> {
    const { db, table: t } = this.where(table);
    return lookupRows(db, tableDesign(db, t), field, this.info);
  }

  /** R11: the front-end's relations, then, for each source that opens, its relations between two tables linked from it (a
   *  failing source contributes none). `localOnly` (the Relationships window): the front-end's only, no linked file opened. */
  listRelations(opts: { localOnly?: boolean } = {}): Relation[] {
    const front = this.conn();
    const out = listRelations(front);
    if (opts.localOnly) return out;
    const links = this.usableLinks();
    const access = new Set(sourceRows(front).filter((x) => x.kind === 'access').map((x) => x.id)); // C2 R8: no relations, not loaded for them
    for (const id of new Set(links.map((l) => l.sourceId))) {
      if (access.has(id)) continue;
      try {
        const c = this.source(id);
        if (!c.db) continue;
        const named = (remote: string) => links.find((l) => l.sourceId === id && sameName(l.remote, remote))?.name;
        for (const r of listRelations(c.db)) {
          const parentTable = named(r.parentTable);
          const childTable = named(r.childTable);
          if (parentTable && childTable) out.push({ ...r, parentTable, childTable, linked: true });
        }
      } catch (e) { console.error(e); }
    }
    return out;
  }
  saveRelation(rel: Relation, originalName: string | null): RelationResult { return saveRelation(this.structureDb(), rel, originalName, this.info); }
  deleteRelation(name: string): OpResult { return deleteRelation(this.structureDb(), name, this.info); }
  relationsLayout(): RelationsLayout { return relationsLayout(this.conn()); }
  saveRelationsLayout(layout: RelationsLayout): void { saveRelationsLayout(this.writeDb(), layout); }
  cascadeChildren(table: string): CascadeChild[] {
    const { db, table: t } = this.where(table);
    return cascadeChildren(db, t);
  }

  importPreview(path: string, spec: ImportSpec | null, fieldPrefix: string): TextPreview {
    this.conn();
    return previewText(path, spec, this.info, fieldPrefix);
  }
  importRun(path: string, plan: ImportPlan, texts: ImportTexts, tick?: (done: number, total: number) => Promise<void>): Promise<ImportResult> {
    this.noLink(plan.target.table);
    // it yields between blocks (tick): a total cached meanwhile must not outlive the import
    return runImport(this.structureDb(), path, plan, this.info, texts, tick).finally(() => { this.seq++; });
  }
  importExcelPreview(path: string, sheet: string | null, hasHeader: boolean | null, fieldPrefix: string): Promise<ExcelPreview> {
    this.conn();
    return previewExcel(path, sheet, hasHeader, this.info, fieldPrefix);
  }
  /** The plan carries the user's fields and target; its spec is replaced by EXCEL_SPEC (the sheet's header row is dropped by the source). */
  async importExcelRun(path: string, sheet: string, hasHeader: boolean, plan: ImportPlan, texts: ImportTexts, tick?: (done: number, total: number) => Promise<void>): Promise<ImportResult> {
    this.noLink(plan.target.table);
    const db = this.structureDb();
    const { records } = await readSheet(path, sheet);
    const spec = { ...EXCEL_SPEC, fields: plan.spec.fields };
    return runImport(db, excelSource(records, hasHeader), { ...plan, spec }, this.info, texts, tick).finally(() => { this.seq++; });
  }
  importSpecs(): Record<string, ImportSpec> { return loadSpecs(this.conn()); }

  listObjects(kind?: ObjectKind): ObjectSummary[] { return listObjects(this.conn(), kind); }
  getObject(kind: ObjectKind, name: string): { name: string; definition: unknown } {
    const o = getObject(this.conn(), kind, name);
    if (!o) throw new Error('bc:notFound');
    return o;
  }
  /** A query is checked and bound first (bc:invalidQuery|…, bc:queryBind|…, cycle included): nothing is written then. */
  saveObject(kind: ObjectKind, name: string, definition: unknown, originalName: string | null): OpResult {
    const db = this.writeDb();
    if (kind === 'query') checkQueryDefinition(this.qc(), name.normalize('NFC'), definition);
    return saveObject(db, kind, name, definition, originalName);
  }
  renameObject(kind: ObjectKind, oldName: string, newName: string): OpResult { return renameObject(this.writeDb(), kind, oldName, newName); }
  deleteObject(kind: ObjectKind, name: string): OpResult { return deleteObject(this.writeDb(), kind, name); }
  copyObject(kind: ObjectKind, name: string, newName: string): OpResult { return copyObject(this.writeDb(), kind, name, newName); }
  /** Properties dialog: a table keeps it in its metadata, an object in bc_objects. */
  setDescription(kind: ObjectKind | 'table', name: string, description: string | null): OpResult {
    const db = this.writeDb();
    if (kind !== 'table') return setObjectDescription(db, kind, name, description);
    const link = this.linkOf(name);
    if (link) { setLinkDescription(db, link.name, description); return { ok: true }; } // R8: bc_links.props.description
    return setTableDescription(db, name, description) ? { ok: true } : { ok: false, reason: 'notFound' };
  }

  /** A table record source: where it lives, and its data design (bc:notFound for neither a table nor a link of that name). */
  private sourceTable(name: string): { db: DatabaseSync; d: TableDesign } {
    const at = this.where(name);
    if (!at.link && !listTables(at.db).some((x) => sameName(x.name, name))) throw new Error('bc:notFound');
    return { db: at.db, d: dataDesign(at.db, at.table) };
  }
  /** `query` and `sql`: src/main/query/source.ts (A3). A link is updatable when its source is writable and its table has a real
   *  rowid (R7: a WITHOUT ROWID table links read-only). */
  describeSource(ref: RecordSourceRef, params?: Record<string, CellInput> /* a crosstab's (B4 R11) */): SourceInfo {
    if (ref.kind !== 'table') return describeQuerySource(this.qc(), ref, this.info, params);
    const at = this.where(ref.name);
    const d = at.link ? tableDesign(at.db, at.table) : this.sourceTable(ref.name).d;
    const updatable = at.link ? at.writable && hasRealRowid(at.db, d) : !this.localReadOnly;
    const fields = d.fields.map((x) => ({ name: x.name, type: x.props.type, props: x.props, origin: { table: d.name, field: x.name } }));
    return { fields, updatable, keyTable: d.name, parameters: [] };
  }
  /** Filtered as rows.page filters (compileFilter), and by `req.where`; `total` counts the kept rows. Contract 1.2: a sort or filter field the
   *  table lacks rejects bc:notFound, a criterion compileFilter refuses rejects bc:invalidArgument (rows.page keeps
   *  bc:invalidArgument for an unknown sort field and bc:invalidFilter). A table has no params. */
  pageSource(ref: RecordSourceRef, req: SourcePageRequest): SourcePage {
    if (ref.kind !== 'table') return pageQuerySource(this.qc(), ref, req, this.queryCtx());
    const q = this.noRowidLink(ref.name);
    if (q) return this.pageSource(q, req);
    const { db, d } = this.sourceTable(ref.name);
    const filter = req.filter ?? [];
    const missing = (name: string) => !d.fields.some((x) => sameName(x.name, name));
    if (filter.some((f) => missing(f.field)) || (req.sort ?? []).some((s) => missing(s.field))) throw new Error('bc:notFound');
    try {
      const { where } = req;
      const { rows } = readRows(db, d, { offset: req.offset, limit: req.limit, filter, ...(where !== undefined ? { where } : {}) }, this.info.locale, req.sort ?? [], this.writeSeq());
      return { rows: rows.map((r) => r.values), rowids: rows.map((r) => r.rowid), total: countRows(db, d.name, filter, this.info.locale, where) };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('bc:invalidFilter')) throw new Error('bc:invalidArgument');
      throw e;
    }
  }
  /** B4: a record of an updatable query (src/main/query/join-write.ts); a read-only base: ReadOnlyError. */
  async saveSource(ref: QueryRef, req: SourceSaveRequest): Promise<SourceSaveResult> {
    this.writeDb(); // a read-only front-end: ReadOnlyError before anything is bound
    const qc = this.qc();
    const b = resolve(qc, ref);
    return saveSourceRow(qc.dbOf(b.source, true), b, req, this.info);
  }
  /** B4 R4: AutoLookup; reads only. */
  autoLookup(ref: QueryRef, values: Record<string, CellInput>): Record<string, SqlValue> {
    const qc = this.qc();
    const b = resolve(qc, ref);
    return autoLookup(qc.dbOf(b.source, false), b, values, this.info);
  }
  private exportPager(src: ExportSource): (offset: number, limit: number) => SourcePage {
    const { ref, params, sort, filter, where } = src;
    return (offset, limit) => this.pageSource(ref, { offset, limit, ...(sort ? { sort } : {}), ...(filter ? { filter } : {}), ...(params ? { params } : {}), ...(where !== undefined ? { where } : {}) });
  }
  /** Writes the source (the datasheet's pages: pageSource, with its parameters, sort and filter) to `path`, a path the main
   *  process got from a save dialog. Reads only: allowed on a read-only base. Throws bc:writeFailed; the old file is kept. */
  async exportText(src: ExportSource, spec: ExportTextSpec, path: string, texts: { yes: string; no: string },
    tick?: (done: number, total: number) => Promise<void>): Promise<ExportResult> {
    const { fields } = this.describeSource(src.ref, src.params);
    return writeTextExport({ fields, spec, path, tick, texts: { ...texts, info: this.info }, page: this.exportPager(src) });
  }
  /** The rows an export of `src` holds (the main process refuses an Excel export above the sheet limit before asking where). */
  exportRowCount(src: ExportSource): number { return this.exportPager(src)(0, 0).total; }
  /** As exportText, to an .xlsx workbook with one sheet named `sheet`: typed cells, never formulas. A source above the Excel row
   *  limit resolves { ok: false, reason: 'tooManyRows' } and writes nothing. */
  async exportExcel(src: ExportSource, path: string, sheet: string, tick?: (done: number, total: number) => Promise<void>): Promise<ExportResult> {
    const { fields } = this.describeSource(src.ref, src.params);
    return writeExcelExport({ fields, path, sheet, tick, info: this.info, page: this.exportPager(src) });
  }
  saveImportSpec(name: string, spec: ImportSpec): void { saveSpec(this.writeDb(), name, spec); }

  /** Active content (R3) and the base's identity, for the main process's decision (trust.ts). */
  /** Startup options (B3): read-only allowed; a wrong key reads as its default (R12). */
  startup(): StartupOptions { return startupOptions(this.conn()); }
  /** The data file option changed is a structure call (C3 R4): turned off while others write shared, the next opener would take
   *  the plain-base path (exclusive lock, reconcile) beside them. */
  saveStartup(o: StartupOptions): void {
    saveStartupOptions(o.dataFile !== startupOptions(this.conn()).dataFile ? this.structureDb() : this.writeDb(), o);
  }
  activeContent(): ActiveContent { return activeContent(this.conn()); }
  dbUuid(): string {
    return (this.conn().prepare(`SELECT value FROM bc_meta WHERE key = 'db_uuid'`).get() as { value: string } | undefined)?.value ?? '';
  }
  setContentEnabled(fingerprint: string | null): void { this.enabledContent = fingerprint; }
  /** Read again at every call: content changed by another connection since it was enabled (an action query or a macro added
   *  or edited elsewhere) is not the content enabled, and is refused until approved. */
  private needContent(): void {
    if (this.enabledContent === null || activeContent(this.conn()).fingerprint !== this.enabledContent) throw new Error('bc:contentDisabled');
  }

  /** A3 action queries (src/main/query/action.ts), refused bc:contentDisabled while the active content is disabled.
   *  actionCount only reads; runAction on a read-only base: reason readOnly. */
  async actionCount(ref: QueryRef, params: Record<string, CellInput>): Promise<{ count: number; table: string }> {
    this.needContent();
    return actionCount(this.qc(), ref, params, this.queryCtx());
  }
  async runAction(ref: QueryRef, params: Record<string, CellInput>, opts: RunActionOptions): Promise<ActionResult> {
    this.needContent();
    // the front-end or the query's source read-only (dbOf, once bound): reason readOnly
    try {
      return await runAction(this.qc(), ref, params, opts, { ...this.queryCtx(), now: () => new Date() });
    } catch (e) {
      if (e instanceof ReadOnlyError) return { ok: false, reason: 'readOnly' };
      throw e;
    } finally {
      this.seq++; // it yields between rows (the write layer is async): a total cached meanwhile must not outlive the run
    }
  }
  deleteImportSpec(name: string): void { deleteSpec(this.writeDb(), name); }

  /** Save As (A6): a checked copy of the base at `target` (the main process then opens it). Reads only: allowed read-only. */
  async saveCopy(target: string, copyDeps: CopyDeps = {}): Promise<void> {
    const lockDeps = this.deps.lockDeps;
    const free = () => this.targetFree(target);
    free();
    const rename = copyDeps.rename ?? renameSync;
    // Checked again just before the rename: the copy may take long, and on macOS/Linux an instance that opened the target
    // meanwhile would go on writing to the unlinked file.
    vacuumInto(this.conn(), target, { ...copyDeps, rename, beforeReplace: free });
    // A stale lock left there (a crashed instance) would open the copy read-only: taken over then released, never a live one.
    try {
      const stale = peekLock(target, lockDeps);
      if (stale?.stale) {
        const r = takeOverStaleLock(target, stale.info, randomUUID(), lockDeps);
        if (r.status === 'acquired') r.lock.release();
      }
    } catch (e) { console.error(e); } // the copy is made: at worst it opens read-only
  }

  /** Save As's and the split's target: bc:targetInUse when another BaseCraft has it open, never replaced under it. */
  private targetFree(target: string): void {
    const held = peekLock(target, this.deps.lockDeps);
    if (held && !held.stale) throw new Error('bc:targetInUse');
    if (othersPresent(target, '', this.deps.lockDeps).length) throw new Error('bc:targetInUse'); // a data file others use in shared mode (C3 R13)
  }

  /** Split Database (C3 R12, R13): a structure call; the refusals first (no exclusive lock, no settle wait for them), then the
   *  backup, then db/split.ts. A refusal changes nothing. */
  splitDatabase(target: string): SplitResult {
    if (this._state.readOnly) return { ok: false, reason: 'readOnly' };
    if (listTables(this.conn()).length === 0) return { ok: false, reason: 'noTables' };
    if (this.isSelf(target)) return { ok: false, reason: 'self' };
    this.targetFree(target);
    let front: DatabaseSync;
    try { front = this.structureDb(); } catch (e) { if (e instanceof ReadOnlyError) return { ok: false, reason: 'readOnly' }; throw e; }
    const backupPath = backupCopy(this.path);
    const tables = splitDatabase(front, this.path, target, this.deps.appVersion, { beforeReplace: () => this.targetFree(target) });
    return { ok: true, tables, dataFile: target, backupPath };
  }

  /** Compact and Repair (A6): needs the write lock, which it keeps; the handle is closed for the swap, then reopened. */
  async compact(): Promise<CompactResult> {
    this.structureDb();
    try {
      return await compactBase({
        db: () => this.conn(), path: this.path,
        close: () => { this.db?.close(); this.db = null; },
        reopen: () => {
          const db = this.openFile(this.path, 'write', this.deps.appVersion, { migrate: this.deps.migrate }).db;
          try { reconcile(db); } catch (e) { db.close(); throw e; }
          this.db = db;
        },
      });
    } catch (e) {
      // No connection left (the reopen failed): the main process closes the base (BaseLostError, kept across the host).
      if (!this.db && e instanceof Error) e.name = 'BaseLostError';
      throw e;
    } finally {
      this.seq++; // VACUUM may renumber rowids: nothing cached from before stays valid
    }
  }
}
