// Une base ouverte = fichier + verrou d'écriture + mode lecture seule.
// Elle vit dans le processus de données (db-host/host.ts, un utilityProcess) : le processus principal l'appelle par
// db-host/client.ts, une file par session, chaque méthode devenant asynchrone.
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  ActionResult, AutoCorrectReport, PropertyItem, PropertyUpdate, CascadeChild, CompactResult, DeleteResult, QueryRef, RunActionOptions, FieldFilter, LinkFileInfo, LinkInfo, LinkResult, LinkState, LogLabels, LookupData, LookupRow, NameChange, ObjectKind, ObjectSummary, ObjRef, OpResult, Relation,
  RelationResult, RelationsLayout, RenameResult, RowRef, SaveTableRequest, SaveTableResult, ServerLinkInfo, SessionState, SplitResult,
} from '../shared/api';
import type { RecordSourceRef, SourceInfo, SourcePage, SourcePageRequest, SourceSaveRequest, SourceSaveResult } from '../shared/record-source';
import type { CellInput, SqlValue } from '../shared/coerce';
import { defaultProps, foldName, lookupOf, quoteIdent, sameName, serverComputed, shownColumns, validateDesign, type FieldDef, type FieldProps, type TableDesign } from '../shared/field-types';
import type { ImportPlan, ImportProgress, ImportResult, ImportSpec, TextPreview } from '../shared/import-text';
import type { MigrateRequest, MigrateResult, ServerImportResult } from '../shared/migrate';
import { localeInfo, type LocaleInfo } from '../shared/locale-format';
import { alterTable } from './db/alter';
import { applyAutoCorrect, applyPropertyUpdates } from './db/autocorrect';
import { planAutoCorrect, propertyTargets, type AutoCorrectPlan, type AutoCorrectWorld } from '../shared/autocorrect/plan';
import { saveTableChanges } from '../shared/autocorrect/sql';
import { compactBase, vacuumInto, type CopyDeps } from './db/copy-file';
import { backupCopy, BaseFileError, createBaseFile, openBaseFile } from './db/file-format';
import { clearThemeOverrides, copyObject, deleteObject, getObject, listObjects, renameObject, saveObject, setObjectDescription } from './db/objects';
import { acquireLock, peekLock, takeOverStaleLock, type HeldLock, type LockDeps, type LockInfo } from './db/lock';
import { detectLocationRisk, type LocationRisk, type RiskProbe } from './db/location-risk';
import { acquireExclusive, dataFileInUse, joinPresence, othersPresent, presenceEntry, sharedRefusal, type ExclusiveResult, type PresenceDeps } from './db/presence';
import { aggregateRows, countRows, fieldListRows, LOOKUP_MAX, lookupRows, NO_LIST, readRows, sourceListRows, type PageRequest, type RowPage } from './db/rows';
import {
  cascadeChildren, createTable, DanglingKeyError, DesignValidationError, dataDesign, dropTable, hasRealRowid, isQueryName, isTableName, listTables, NameExistsError, reconcile, renameTable,
  getDataMacros, sanitizeStoredProps, setColumnWidths, setDataMacros, setSheetLayout, setTableDescription, tableDesign, usableProps, ViewBrokenError, type TableSummary,
} from './db/schema';
import { splitDatabase } from './db/split';
import { importTables } from './migrate/import';
import { importAccess } from './import/access-import';
import { hasAccess, readAccessExport, runAccessExport } from './import/access-export';
import type { AccessExport } from '../shared/access-export';
import type { AccessImportInfo, AccessImportResult, AccessStructureSource } from '../shared/access-import';
import { copyRows, deleteRowsWithMacros, insertRow, updateRow, type RowWriteResult } from './db/write-layer';
import { inTransaction, inTransactionAsync } from './db/tx';
import { countViolations } from './db/rules';
import { deleteRelation, listRelations, relationsLayout, saveRelation, saveRelationsLayout } from './db/relations';
import { baseTheme, saveBaseTheme } from './db/theme';
import { addResource, getResources, listResources, removeResource, replaceResource, type ResourceInfo } from './db/resources';
import type { Theme } from '../shared/design/theme';
import { peekStartup, saveStartupOptions, startupOptions } from './db/startup';
import type { StartupOptions } from '../shared/startup';
import type { SheetLayout } from '../shared/sheet-layout';
import { writeTextExport } from './exchange/export-text';
import { writeExcelExport } from './exchange/export-excel';
import { writeMarkupExport } from './exchange/export-markup';
import { deleteSavedExport, loadSavedExports, saveSavedExport } from './exchange/saved';
import { EXCEL_SPEC, type ExcelPreview, type ExportResult, type ExportSource, type ExportTextSpec, type SavedExport } from '../shared/exchange';
import { deleteSpec, loadSpecs, saveSpec } from './import/specs';
import { previewText, runImport, type ImportTexts } from './import/text-import';
import { excelSource, previewExcel, readSheet } from './exchange/excel-read';
import { remoteExpandCrosstab } from './query/crosstab';
import { checkQueryDefinition, queryCatalog, describeQuerySource, pageQuerySource, paramValues, resolve, sourceHasValue, type QueryConn, type QueryCtx } from './query/source';
import { LOCAL_SOURCE, toSourceInfo, type BoundQuery } from '../shared/query/bind';
import type { PassThroughProps } from '../shared/query/ast';
import { parseQueryDefinition, passThroughOf } from '../shared/query/definition';
import { loadSnapshot, passThroughServers, PT_TABLE, runNative, snapshotDesign } from './query/pass-through';
import { autoLookup, saveSourceRow } from './query/join-write';
import { actionCount, runAction } from './query/action';
import { activeContent, type ActiveContent } from './db/active-content';
import { isWritable, LinkedSources, sourceKindOf, type SourceConn } from './links/connections';
import {
  addLinks, addServerLinks, findLink, isLinkName, linkRows, relinkRows, relinkServerRows, removeLink, resolveSourcePath, setLinkDescription, setServerDesign, serverSourceFor, sourceRows,
  type LinkRow, type SourceRow,
} from './links/store';
import { CONNECTORS, isServerKind, type ConnectorRegistry } from './connectors/registry';
import { linkedAs, type Connection, type Connector, type RemoteTable, type ServerKind } from './connectors/connector';
import { isLost, RemoteSources } from './connectors/remote-sources';
import {
  degradedSource, fieldNames, remoteAutoLookup, remoteDelete, remoteHasValue, remoteInsert, remotePageSource, remoteSaveSource, remoteTableRef, remoteUpdate, rowSourceOf,
  type RemoteCtx,
} from './connectors/remote-data';
import { remoteActionCount, remoteRunAction } from './connectors/remote-action';
import { inspectAccess } from './links/access';
import { withMetadata } from './links/meta';
import { refusedQueries, runMigration, switchLocal } from './migrate/run';
import { fold } from '../shared/expr/sql';
import { isModuleName, parseModuleDef } from '../shared/python/module-def';
import { dataMacrosIssue, type DataMacros } from '../shared/macro/data-macro';
import { chartData } from './chart-data';
import type { ChartData, ChartDataRequest } from '../shared/chart/query';

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
  connectors?: ConnectorRegistry; // test seam (C4 R1); default CONNECTORS
}

export class ReadOnlyError extends Error {
  constructor() {
    super('read-only base');
    this.name = 'ReadOnlyError';
  }
}

// Stands for "no lock file": takeOverStaleLock then simply acquires.
const NO_LOCK: LockInfo = { user: '?', host: '?', pid: 0, sessionId: '?', heartbeatAt: new Date(0).toISOString() };
/** A local table's row reference is a rowid; a connector token is refused (C4 R4). */
const localRowid = (r: RowRef): number => (typeof r === 'number' ? r : (() => { throw new Error('bc:invalidArgument'); })());
const isPlaceholder = (i: LockInfo) => i.pid === 0 && i.sessionId === '?';

/** A file above this size gets the import's size warning. Measured (E1): a 1.02 GiB file (800 000 rows, 6 fields) imported in 20 s with a
 *  peak of 1.4 GB, so 1 GiB, the largest size tried, is the ceiling. */
export const ACCESS_WARN_BYTES = 1024 * 1024 * 1024;

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
  private accessImporting = false;
  private stopAccessImport = false;
  private exportAbort: AbortController | null = null; // the running Access export, ended by interrupt()
  private readonly openFile: typeof openBaseFile;
  /** Write sequence of the cached query totals and sorted-order snapshots (readRows): moved by writeDb(), by another connection's commit, by a new connection. */
  private seq = 0;
  private seen: [DatabaseSync | null, string] = [null, ''];
  /** The active content the main process enabled (trust.ts), by its fingerprint ('' : a base with none); null: disabled, until
   *  the main process says otherwise. */
  private enabledContent: string | null = null;
  /** C6 Task 8 (main's trustsFile): the user trusts this file, its pass-throughs may use a stored credential. */
  private trusted = false;
  private readonly links: LinkedSources;
  /** C4: the server sources' connections and credentials. */
  private readonly remote: RemoteSources;
  /** R16: moves on every dataStamp() while a server connection is open. */
  private remoteTicks = 0;
  /** C6 R1, R7: each pass-through's last result, by foldName; dropped when the query is saved, renamed or deleted, and at close.
   *  A call is known by its request object (the ref of a describe, the request of a page): db-host's retry of a call (host.ts,
   *  SQLITE_CORRUPT) passes the same arguments, so it is the same call. ponytail: a snapshot a describe made and no page read
   *  (a design-only field list) serves the next open as is; a time or caller tag on describe if that staleness matters. */
  private readonly snapshots = new Map<string, { db: DatabaseSync; bound: BoundQuery; call: object /* the call that ran it */; byDescribe: boolean; pagedBy: object | null /* the last page call that read it */ }>();

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
    this.remote = new RemoteSources(() => this.conn(), deps.connectors ?? CONNECTORS, () => passThroughServers(this.conn()));
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

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.links.close();
    for (const k of [...this.snapshots.keys()]) this.dropSnapshot(k);
    try { this.db?.close(); } catch { /* already unusable */ } finally { this.lock?.release(); this.presence?.release(); }
    this.db = null;
    return this.remote.close();
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
    const v = this.localStamp();
    if (this.seen[0] !== db || this.seen[1] !== v) {
      this.seen = [db, v];
      this.seq++;
    }
    return this.seq;
  }
  /** The writeSeq key: the front-end's PRAGMA data_version and links.dataVersions(), as one string. Reads only (C3 R10: the
   *  main process's refresh timer compares it; own commits leave it unchanged). '' with no connection (needsRecovery, a failed
   *  read-only reopen): asked every interval, it must not throw then. */
  private localStamp(): string {
    if (!this.db) return '';
    return JSON.stringify([(this.conn().prepare('PRAGMA data_version').get() as { data_version: number }).data_version, ...this.links.dataVersions()]);
  }
  /** The refresh tick's key (C3 R10): the local stamp; while a server connection is open, a counter that moves on every call
   *  (C4 R16: a server has no cheap data version, so open views on server links refresh every interval). */
  dataStamp(): string {
    const local = this.localStamp();
    return this.remote.hasOpen() ? `${local}#${++this.remoteTicks}` : local;
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
    const server = this.serverRow(link.sourceId);
    if (server) throw new Error(`bc:serverNotSupported|other|${server.kind}`); // every caller not routed to the remote path (C4)
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
          const link = this.linkOf(name);
          if (!link) return null;
          const server = this.serverRow(link.sourceId);
          if (server) return this.remoteTable(link, server).design; // C4 R6: the cached design, no connection
          const at = this.where(name);
          return tableDesign(at.db, at.table);
        },
        query: queryCatalog(front).query,
        sourceOf: (name) => this.linkOf(name)?.sourceId ?? LOCAL_SOURCE,
      },
      dbOf: (source, write) => {
        const server = this.serverRow(source);
        if (server) throw new Error(`bc:serverNotSupported|other|${server.kind}`);
        if (source === LOCAL_SOURCE) {
          if (write && this.localReadOnly) throw new ReadOnlyError();
          return write ? this.writeDb() : front;
        }
        if (write) this.writeDb(); // a read-only front-end writes no linked file; the write sequence moves (PF6)
        return this.sourceDb(source, write).db;
      },
      // a local query: as a local table's (describeSource); a server source: when the front-end is writable (as a link's file, PF5)
      writable: (source) => (source === LOCAL_SOURCE ? !this.localReadOnly : this.serverRow(source) ? !this._state.readOnly : this.source(source).writable),
      remote: (source) => {
        const server = this.serverRow(source);
        return server && {
          kind: server.kind,
          table: (name: string) => {
            const r = this.remoteOf(name);
            if (r?.source.id !== source) throw new Error('bc:notFound');
            return this.remoteTable(r.link, r.source);
          },
        };
      },
    };
  }
  /** `sourceId`'s row when it is a server source (C4). */
  private serverRow(sourceId: string): (SourceRow & { kind: ServerKind }) | undefined {
    if (sourceId === LOCAL_SOURCE) return undefined;
    const s = sourceRows(this.conn()).find((x) => x.id === sourceId);
    return s && isServerKind(s.kind) ? (s as SourceRow & { kind: ServerKind }) : undefined;
  }
  /** The server link `name` stands for, with its source. */
  private remoteOf(name: string): { link: LinkRow; source: SourceRow & { kind: ServerKind } } | undefined {
    const link = this.linkOf(name);
    const source = link && this.serverRow(link.sourceId);
    return source && { link: link!, source };
  }
  /** A server link as its connector reads it (C4 R6: its cached design, with BaseCraft's metadata over it, C7 R11);
   *  bc:linkUnavailable|unsupportedKind|<label> when that design is damaged. */
  private remoteTable(l: LinkRow, s: SourceRow): RemoteTable {
    const fields = this.cachedFields(l);
    if (!fields || !l.server) throw new Error(`bc:linkUnavailable|unsupportedKind|${this.serverLabel(s) || l.name}`); // no label: the link's name (M9)
    const { schema, key, skipped, version, meta } = l.server;
    return { name: l.name, remote: l.remote, ...(schema !== undefined ? { schema } : {}), design: withMetadata({ name: l.name, fields }, meta), key, skipped,
      ...(version !== undefined ? { version } : {}) };
  }
  /** The server link `name` stands for, to write (R9: writable when the front-end is, the Runtime's included — only its local
   *  tables are read-only); ReadOnlyError otherwise, and the write sequence moves (PF6). */
  private remoteWritten(name: string): { sourceId: string; t: RemoteTable } | undefined {
    if (this._state.readOnly) return undefined; // the caller's where(name, true) refuses it (even when the file cannot be read)
    const r = this.remoteOf(name);
    if (!r) return undefined;
    this.writeDb();
    return { sourceId: r.source.id, t: this.remoteTable(r.link, r.source) };
  }
  /** `hasValue` (C7 R12): Limit To List of a server link's field reads its Row Source where that source is. */
  private remoteCtx(): RemoteCtx {
    const qc = this.qc();
    const ctx: RemoteCtx = { remote: this.remote, qc, info: this.info, now: () => new Date(), hasValue: async (ref, column, value) => {
      const b = resolve(qc, ref);
      return qc.remote!(b.source) ? remoteHasValue(ctx, b, column, value) : sourceHasValue(qc, ref, column, value, this.info);
    } };
    return ctx;
  }
  /** A server table's page (C4 R5): the query `SELECT *` over it on its connection. */
  private remoteTablePage(name: string, req: SourcePageRequest, withTotal = true): Promise<SourcePage> {
    const ctx = this.remoteCtx();
    return remotePageSource(ctx, resolve(ctx.qc, remoteTableRef(name)), req, withTotal);
  }
  /** R7: a linked table without a real rowid is read, read-only, as the query `SELECT *` over it (no rowids); null otherwise. */
  private noRowidLink(name: string): QueryRef | null {
    const at = this.where(name);
    return at.link && !hasRealRowid(at.db, tableDesign(at.db, at.table)) ? remoteTableRef(name) : null;
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
      const link = { kind: s?.kind ?? '', path: !s ? '' : isServerKind(s.kind) ? this.serverLabel(s) : resolveSourcePath(s, this.frontEndPath) };
      return { name: l.name, ...(l.description !== undefined ? { description: l.description } : {}), link };
    });
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return [...local, ...links].sort((a, b) => cmp(fold(a.name), fold(b.name)) || cmp(a.name, b.name));
  }
  tableDesign(name: string): TableDesign {
    const link = this.linkOf(name);
    const server = link && this.serverRow(link.sourceId);
    if (server) return this.remoteTable(link!, server).design; // C4 R6: the cached design, no connection
    const { db, table } = this.where(name);
    return tableDesign(db, table);
  }

  /** Name AutoCorrect (O4 R1–R3): the plan of `changes` against the base before them, read from every object and local table;
   *  null with Suivi off (or nothing renamed). Objects in the Navigation Pane's order; modules are never read.
   *  ponytail: reads every object and table per plan (R1), and a rename plans twice (its dependents, then the rename):
   *  ≈0.4–0.6 s a plan for 30 tables, 400 queries and 150 forms (planAutoCorrect's ceiling). */
  private autoCorrectPlan(changes: NameChange[]): { o: StartupOptions; plan: AutoCorrectPlan } | null {
    const o = startupOptions(this.conn());
    if (!o.trackNameAutoCorrect || !changes.length) return null;
    return { o, plan: planAutoCorrect(this.autoCorrectWorld(o), changes) };
  }
  private autoCorrectWorld(o: StartupOptions): AutoCorrectWorld {
    const db = this.conn();
    const world: AutoCorrectWorld = { objects: [], corrupt: [], tables: listTables(db).map((x) => tableDesign(db, x.name)), catalog: this.qc().catalog, startupForm: o.startupForm };
    for (const kind of ['query', 'form', 'report', 'macro'] as const) {
      for (const { name } of listObjects(db, kind)) {
        try { world.objects.push({ kind, name, definition: getObject(db, kind, name)!.definition }); } catch { world.corrupt.push({ kind, name }); }
      }
    }
    return world;
  }
  /** O4 R12: per field of `req` whose Format or Decimal Places changed (by the mapping), the bound controls with their own
   *  different value, in the base as saved. */
  private propertyUpdates(old: TableDesign, req: SaveTableRequest): PropertyUpdate[] {
    const changed: Omit<PropertyUpdate, 'targets'>[] = [];
    for (const m of req.mapping) {
      const was = old.fields.find((x) => m.sourceName !== null && sameName(x.name, m.sourceName));
      const now = req.design.fields.find((x) => x.name === m.name);
      if (!was || !now) continue;
      const fmt = now.props.format ?? '';
      if (fmt !== (was.props.format ?? '')) changed.push({ table: req.design.name, field: now.name, prop: 'Format', value: fmt });
      const dp = now.props.decimalPlaces;
      if (dp !== undefined && dp !== was.props.decimalPlaces) changed.push({ table: req.design.name, field: now.name, prop: 'DecimalPlaces', value: String(dp) });
    }
    if (!changed.length) return [];
    const world = this.autoCorrectWorld(startupOptions(this.conn()));
    return changed.map((c) => ({ ...c, targets: propertyTargets(world, c.table, c.field, c.prop, c.value) })).filter((u) => u.targets.length);
  }
  /** O4 R12: the values written to the controls in one transaction; a missing object or control is skipped. */
  applyProperties(items: PropertyItem[]): number {
    return applyPropertyUpdates(this.writeDb(), items);
  }
  /** R2: with Effectuer, `rename` and the plan's writes in one transaction (any throw rolls both back), logged with Historique;
   *  without it, the rename alone and the dependents listed `stale`. `rename` resolves a refusal (nothing written then). */
  private async autoCorrected(changes: NameChange[], labels: LogLabels | undefined, rename: (then?: (db: DatabaseSync) => Promise<void>) => Promise<OpResult | SaveTableResult>):
  Promise<{ r: OpResult | SaveTableResult; autoCorrect?: AutoCorrectReport }> {
    const p = this.autoCorrectPlan(changes);
    if (!p) return { r: await rename() };
    const { o, plan } = p;
    if (!o.performNameAutoCorrect) return { r: await rename(), autoCorrect: { corrected: [], failed: [], stale: [...plan.corrected, ...plan.failed] } };
    let log = {};
    const r = await rename(async (db) => { log = await applyAutoCorrect(db, plan, o.logNameAutoCorrect ? labels ?? null : null, this.info); });
    return { r, autoCorrect: { corrected: plan.corrected, failed: plan.failed, stale: [], ...log } };
  }
  /** R10: the objects a rename would correct or fail (names after it); [] with Suivi or Effectuer off (nothing rewritten). */
  autoCorrectDependents(changes: NameChange[]): ObjRef[] {
    if (!startupOptions(this.conn()).performNameAutoCorrect) return [];
    const p = this.autoCorrectPlan(changes);
    return p ? [...p.plan.corrected, ...p.plan.failed] : [];
  }

  /** `labels`: the log table's texts (O4 R9), in the UI language; without them nothing is logged (tests only; ipc always passes labels). */
  async saveTable(req: SaveTableRequest, labels?: LogLabels, offerPropertyUpdates = false): Promise<SaveTableResult> {
    if (req.originalName !== null) this.noLink(req.originalName);
    const db = this.structureDb();
    try {
      if (req.originalName === null) {
        createTable(db, req.design);
        return { ok: true };
      }
      const originalName = req.originalName;
      const old = offerPropertyUpdates ? tableDesign(db, originalName) : null;
      const changes = saveTableChanges(req);
      const { r, autoCorrect } = await this.autoCorrected(changes, labels, (beforeCommit) => alterTable(db, originalName, req.design, req.mapping, {
        allowDataLoss: req.allowDataLoss, info: this.info, acceptExistingViolations: req.acceptExistingViolations === true, ...(beforeCommit && { beforeCommit }),
      }));
      if (!r.ok) return r as SaveTableResult;
      const propertyUpdates = old ? this.propertyUpdates(old, req) : [];
      return autoCorrect || propertyUpdates.length ? { ok: true, ...(autoCorrect && { autoCorrect }), ...(propertyUpdates.length && { propertyUpdates }) } : { ok: true };
    } catch (e) {
      if (e instanceof DesignValidationError) return { ok: false, reason: 'design', errors: e.errors };
      if (e instanceof NameExistsError) return { ok: false, reason: 'nameExists' };
      if (e instanceof DanglingKeyError) return { ok: false, reason: 'danglingKey', table: e.table };
      throw e;
    }
  }

  async renameTable(oldName: string, newName: string, labels?: LogLabels): Promise<RenameResult> {
    this.noLink(oldName);
    const db = this.structureDb();
    try {
      const to = newName.normalize('NFC');
      const { r, autoCorrect } = await this.autoCorrected(oldName === to ? [] : [{ k: 'object', kind: 'table', from: oldName, to }], labels, (then) =>
        inTransactionAsync(db, async () => { renameTable(db, oldName, newName); await then?.(db); return { ok: true as const }; }));
      return r.ok && autoCorrect ? { ok: true, autoCorrect } : r as RenameResult;
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
  /** A server link's cached fields, their props checked as a local table's stored metadata (sanitizeStoredProps, usableProps);
   *  undefined when there is none or one field is unusable (a damaged design: the link reads as unsupportedKind). */
  private cachedFields(l: LinkRow): FieldDef[] | undefined {
    const fields = l.server?.fields.map((x) => ({ name: x.name, props: sanitizeStoredProps(x.props as unknown as Record<string, unknown>) }));
    return fields?.every((x) => usableProps(x.props)) ? (fields as FieldDef[]) : undefined;
  }
  /** A server source's params as its connector reads them, and its label (`connector.label`); null when this BaseCraft has no
   *  connector for its kind or cannot read its params. */
  private serverParams(s: SourceRow): { params: Record<string, unknown>; label: string } | null {
    const c = isServerKind(s.kind) ? (this.deps.connectors ?? CONNECTORS)[s.kind] : undefined;
    try {
      if (c) { const params = c.params(s.params); return { params: params as Record<string, unknown>, label: c.label(params) }; }
    } catch { /* unreadable params */ }
    return null;
  }
  private serverLabel(s: SourceRow): string { return this.serverParams(s)?.label ?? ''; }
  /** `conn`: the link's file source, opened only for a file link. A server link's info needs no connection (C4 R17): its label,
   *  `unsupportedKind` when this BaseCraft has no connector for its kind or cannot read its params or cached design. */
  private linkInfo(l: LinkRow, conn: () => SourceConn): LinkInfo {
    const s = sourceRows(this.conn()).find((x) => x.id === l.sourceId);
    const kind = s?.kind ?? '';
    if (s && isServerKind(kind)) { // no risk: C3's location risks are a file's (a share, a synchronized folder)
      const d = this.serverParams(s);
      return { name: l.name, sourceId: l.sourceId, kind, path: d?.label ?? '', state: d && this.cachedFields(l) ? 'ok' : 'unsupportedKind', ...(d ? { params: d.params } : {}) };
    }
    const c = conn();
    const state = c.db && !isTableName(c.db, l.remote) ? 'missingTable' : c.state;
    return { name: l.name, sourceId: l.sourceId, kind, path: c.path, state, ...(c.holder ? { holder: c.holder, stale: c.stale ?? false } : {}), risk: c.risk,
      ...(c.shared ? { shared: true as const } : {}) };
  }
  /** Closes the sources of `ids` no link uses any more (their locks released); linkedLocks follows. */
  private closeUnused(ids: string[]): void {
    const left = new Set(sourceRows(this.conn()).map((x) => x.id));
    for (const id of ids) {
      if (left.has(id)) continue;
      this.links.drop(id);
      void this.remote.drop(id); // a server source's connection
    }
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
    return this.usableLinks().map((l) => this.linkInfo(l, () => this.source(l.sourceId)));
  }
  /** Refresh Link (R4): each distinct source of `names` closed and reopened once; a stale lock is taken over. */
  async refreshLinks(names: string[]): Promise<LinkInfo[]> {
    const links = this.linksNamed(names);
    const conns = new Map<string, SourceConn>();
    const refresh = (id: string) => {
      let c = conns.get(id);
      if (!c) conns.set(id, (c = this.links.refresh(id, !this._state.readOnly)));
      return c;
    };
    const infos: LinkInfo[] = [];
    for (const l of links) infos.push(this.serverRow(l.sourceId) ? await this.refreshServer(l) : this.linkInfo(l, () => refresh(l.sourceId)));
    if (this.syncLinkedLocks()) this.deps.onStateChanged?.(this._state);
    return infos;
  }
  /** `l`'s table as its server holds it now (null: gone). */
  private serverTable(c: Connection, l: LinkRow): Promise<RemoteTable | null> {
    return c.table({ name: l.name, remote: l.remote, ...(l.server?.schema !== undefined ? { schema: l.server.schema } : {}) });
  }
  /** Refresh Link of a server link (C4): its table read again on its connection and that design cached (a read-only front-end
   *  keeps the old one; a design BaseCraft refuses is not cached: unsupportedKind); gone: missingTable; a server it cannot reach:
   *  that state, needsLogin too (the Linked Table Manager cannot show the login dialog over itself: opening the table asks it);
   *  another server error (a timeout, a refusal, a connection lost again): cannotConnect with that `error`, the other links still
   *  refreshed. Stop (bc:cancelled) ends the whole Refresh. */
  private async refreshServer(l: LinkRow): Promise<LinkInfo> {
    const info = () => this.linkInfo(findLink(this.conn(), l.name) ?? l, () => this.source(l.sourceId));
    let t: RemoteTable | null;
    try {
      t = await this.remote.run(l.sourceId, (c) => this.serverTable(c, l), true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const state = /^bc:linkUnavailable\|(\w+)\|/.exec(msg)?.[1];
      if (state) return { ...info(), state: state as LinkState };
      if (!msg.startsWith('bc:') || msg.startsWith('bc:cancelled')) throw e;
      return { ...info(), state: 'cannotConnect', error: msg };
    }
    if (!t) return { ...info(), state: 'missingTable' };
    const linked = linkedAs(t, l.name);
    if (linked.unsupported) return { ...info(), state: 'unsupportedKind' };
    if (!this._state.readOnly) setServerDesign(this.writeDb(), l.name, linked);
    return info();
  }
  /** Change source / relocate (R9): `names` move to `path`, which must hold each one's table (else nothing changes). The names
   *  stay the remote names (R2). Sources left without links are deleted and closed. */
  relink(names: string[], path: string): LinkResult {
    const front = this.writeDb();
    const links = this.linksNamed(names);
    if (links.some((l) => this.serverRow(l.sourceId))) throw new Error('bc:invalidArgument'); // a server link moves by relinkServer
    if (this.isSelf(path)) return { ok: false, reason: 'self', names: [] };
    const { kind, tables } = this.links.inspect(path);
    const missing = links.filter((l) => !tables.some((t) => !t.unsupported && sameName(t.name, l.remote))).map((l) => l.name);
    if (missing.length) return { ok: false, reason: 'missingTables', names: missing };
    relinkRows(front, this.frontEndPath, links.map((l) => l.name), kind, path);
    this.closeUnused(links.map((l) => l.sourceId));
    return { ok: true };
  }
  /** The connector of `kind` and `params` as it reads them; bc:invalidArgument otherwise. */
  private connectorOf(kind: ServerKind, params: unknown): { connector: Connector; p: unknown } {
    const connector = (this.deps.connectors ?? CONNECTORS)[kind];
    if (!connector) throw new Error('bc:invalidArgument');
    return { connector, p: connector.params(params) };
  }
  /** `tables` under the link names offered (C4 Task 12): R6's, else with 1, 2… appended as Access does (a valid name cut first so
   *  the result keeps 64 characters); never a name the front-end or an earlier table of the list uses (sameName: `public.compta_X`
   *  and `compta.X`, `Clients` and `clients`). */
  private offered(tables: RemoteTable[]): RemoteTable[] {
    const names = this.freeNames(tables.map((t) => t.name));
    return tables.map((t, i) => linkedAs(t, names[i]!));
  }
  /** `names` made free, in order: 1, 2… appended when the front-end, a link or an earlier name of the list uses one (cut to 64 characters). */
  private freeNames(names: string[]): string[] {
    const front = this.conn();
    const used: string[] = [];
    const free = (n: string) => !used.some((u) => sameName(u, n)) && !this.shadowed(front, n) && !isLinkName(front, n);
    return names.map((t) => {
      let name = t;
      const chars = [...t];
      const base = (n: number) => (chars.length <= 64 ? chars.slice(0, 64 - String(n).length).join('') : t); // too long: R6's refusal stays
      for (let i = 1; !free(name); i++) name = `${base(i)}${i}`;
      used.push(name);
      return name;
    });
  }
  /** The server link dialog (C4 Task 12): logs in to `params` with `user` and `password` (a refused login rejects
   *  bc:linkUnavailable|needsLogin|<key>, the key's credential left as it was; accepted, it becomes the key's credential) and lists its
   *  tables under the names offered. */
  async inspectServer(kind: ServerKind, params: unknown, user: string, password: string): Promise<ServerLinkInfo> {
    const { connector, p } = this.connectorOf(kind, params);
    const tables = this.offered(await this.remote.probe(connector, p, { user, password }, (c) => c.tables()));
    return { key: connector.key(p), label: connector.label(p), tables: tables.map((t) => ({
      name: t.name, remote: t.remote, ...(t.schema !== undefined ? { schema: t.schema } : {}), taken: false, readOnly: t.key.length === 0,
      ...(t.skipped.length ? { skipped: t.skipped } : {}), ...(t.unsupported ? { unsupported: t.unsupported } : {}),
    })) };
  }
  /** Links `names`, names inspectServer offered, of the server `params` with their designs (R6), on the key's credential. A name
   *  the front-end uses refuses them all (nameExists); one the server no longer offers: missingTables. */
  async createServerLinks(kind: ServerKind, params: unknown, names: string[]): Promise<LinkResult> {
    const front = this.writeDb();
    const { connector, p } = this.connectorOf(kind, params);
    const tables = this.offered(await this.remote.probe(connector, p, null, (c) => c.tables()));
    const wanted = names.filter((n, i) => names.findIndex((m) => sameName(m, n)) === i);
    const taken = wanted.filter((n) => this.shadowed(front, n) || isLinkName(front, n));
    if (taken.length) return { ok: false, reason: 'nameExists', names: taken };
    const picked = wanted.map((n) => tables.find((t) => !t.unsupported && t.name === n));
    const missing = wanted.filter((_, i) => !picked[i]);
    if (missing.length) return { ok: false, reason: 'missingTables', names: missing };
    addServerLinks(front, kind, p, picked as RemoteTable[]);
    return { ok: true };
  }
  /** Relink (R9) to the server `params`: `names` keep their names and move there with its designs, each one's table (same schema and
   *  name) required (missingTables) and linkable (unsupportedKind), else nothing changes. Sources left without links are deleted,
   *  their connections closed. */
  async relinkServer(names: string[], kind: ServerKind, params: unknown): Promise<LinkResult> {
    const front = this.writeDb();
    const links = this.linksNamed(names);
    if (links.some((l) => !this.serverRow(l.sourceId))) throw new Error('bc:invalidArgument'); // a file link moves by relink
    if (links.some((l) => this.serverRow(l.sourceId)!.kind !== kind)) throw new Error('bc:invalidArgument'); // never switch a link's engine
    const { connector, p } = this.connectorOf(kind, params);
    const found = await this.remote.probe(connector, p, null, async (c) => {
      const out: (RemoteTable | null)[] = [];
      for (const l of links) out.push(await this.serverTable(c, l));
      return out;
    });
    const tables = found.map((t, i) => t && linkedAs(t, links[i]!.name));
    const missing = links.filter((_, i) => !tables[i]).map((l) => l.name);
    if (missing.length) return { ok: false, reason: 'missingTables', names: missing };
    const unusable = links.filter((_, i) => tables[i]!.unsupported).map((l) => l.name);
    if (unusable.length) return { ok: false, reason: 'unsupportedKind', names: unusable };
    relinkServerRows(front, links.map((l) => l.name), kind, p, tables as RemoteTable[]);
    this.closeUnused(links.map((l) => l.sourceId));
    return { ok: true };
  }
  /** C2 R7: an Access file's password, kept in the data process's memory for this session when the file accepts it (true).
   *  `path` must be an Access source of this front-end or the file the link dialog returned (`picked`), else bc:invalidArgument. */
  unlockAccess(path: string, password: string, picked: boolean): boolean { return this.links.unlockAccess(path, password, picked); }
  /** C4 R10: the credential keys of the front-end's server sources; the main process sends the credentials it knows for them. */
  serverKeys(): string[] { return this.remote.keys(); }
  setCredential(key: string, user: string, password: string): void { this.remote.setCredential(key, { user, password }); }
  /** R10: the login dialog's answer: connects with it (true) or the server refuses it (false, forgotten). */
  login(key: string, user: string, password: string): Promise<boolean> { return this.remote.login(key, { user, password }); }
  /** The login dialog's defaults: the source's `user` param and the connector's label. */
  loginDefaults(key: string): { user: string; label: string } { return this.remote.loginDefaults(key); }
  /** R12 (Stop): called out of db-host's queue, while another call runs: cancels the running remote statement (true), never
   *  touches the base. False: nothing remote running (a local query is stopped by the kill). */
  async interrupt(): Promise<boolean> {
    if (this.accessImporting) { this.stopAccessImport = true; this.exportAbort?.abort(); return true; } // the flag is read between two pages of the import
    return this.remote.interrupt();
  }
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

  /** Datasheet column widths of a local table; a link's belong to its file. */
  // ponytail: Access saves a link's layout in the front-end; add with bc_links.props.meta later.
  saveColumnWidths(table: string, widths: Record<string, number>): void {
    this.noLink(table);
    setColumnWidths(this.writeDb(), table, widths);
  }

  /** The rest of a local table's datasheet layout (see setSheetLayout). */
  saveSheetLayout(table: string, layout: SheetLayout): void {
    this.noLink(table);
    if (!setSheetLayout(this.writeDb(), table, layout)) throw new Error('bc:notFound');
  }

  /** The table's data macros (T2). */
  dataMacros(table: string): DataMacros {
    this.noLink(table);
    return getDataMacros(this.conn(), tableDesign(this.conn(), table).name);
  }
  /** Replaces them: the caller's set is checked (dataMacrosIssue) before anything is written. */
  saveDataMacros(table: string, macros: DataMacros): void {
    this.noLink(table);
    if (dataMacrosIssue(macros) !== null) throw new Error('bc:invalidDefinition');
    if (!setDataMacros(this.writeDb(), table, macros)) throw new Error('bc:notFound');
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
  async count(table: string, filter?: FieldFilter[]): Promise<number> {
    if (this.remoteOf(table)) return (await this.remoteTablePage(table, { offset: 0, limit: 0, ...(filter ? { filter } : {}) })).total;
    const q = this.noRowidLink(table);
    if (q) return (await this.pageSource(q, { offset: 0, limit: 0, ...(filter ? { filter } : {}) })).total;
    const { db, table: t } = this.where(table);
    return countRows(db, dataDesign(db, t).name, filter, this.info.locale);
  }
  async page(table: string, req: PageRequest): Promise<RowPage> {
    if (this.remoteOf(table)) {
      const { offset, limit, filter, sort } = req;
      const p = await this.remoteTablePage(table, { offset, limit, ...(filter ? { filter } : {}), sort: sort ? [sort] : [] }, false); // the datasheet counts with count()
      return { rows: p.rows.map((values, i) => ({ rowid: p.rowids[i] ?? NaN, values })) }; // NaN: read-only (R4)
    }
    const q = this.noRowidLink(table);
    if (q) {
      const { offset, limit, filter, sort } = req;
      const p = await this.pageSource(q, { offset, limit, ...(filter ? { filter } : {}), ...(sort ? { sort: [sort] } : {}) });
      return { rows: p.rows.map((values) => ({ rowid: NaN, values })) }; // no rowid: nothing to write back (R7)
    }
    const { db, table: t } = this.where(table);
    return readRows(db, dataDesign(db, t), req, this.info.locale, undefined, this.writeSeq());
  }

  async insert(table: string, values: Record<string, CellInput>): Promise<RowWriteResult> {
    const r = this.remoteWritten(table);
    if (r) return remoteInsert(this.remoteCtx(), r.sourceId, r.t, values, { enforceMask: true });
    const { db, table: t } = this.where(table, true);
    return insertRow(db, dataDesign(db, t), values, this.info, undefined, { enforceMask: true }); // datasheet entry: masked
  }
  /** expected: the record as read when editing began, by field name (C3 R8). */
  async update(table: string, rowid: RowRef, changes: Record<string, CellInput>, expected?: Record<string, SqlValue>): Promise<RowWriteResult> {
    const r = this.remoteWritten(table);
    if (r) return remoteUpdate(this.remoteCtx(), r.sourceId, r.t, rowid, changes, { enforceMask: true, expected });
    const { db, table: t } = this.where(table, true);
    return updateRow(db, dataDesign(db, t), localRowid(rowid), changes, this.info, undefined, { enforceMask: true, expected });
  }
  async delete(table: string, rowids: RowRef[]): Promise<DeleteResult> {
    const r = this.remoteWritten(table);
    if (r) return remoteDelete(this.remoteCtx(), r.sourceId, r.t, rowids);
    const { db, table: t } = this.where(table, true);
    return deleteRowsWithMacros(db, dataDesign(db, t), rowids.map(localRowid), this.info);
  }
  /** A table-field lookup resolves its Row Source in the file that owns the field (R6); a server link's, as the front-end
   *  resolves its names (C7 R12), its first LOOKUP_MAX rows read through pageSource. */
  async lookup(table: string, field: string): Promise<LookupData> {
    const r = this.remoteOf(table);
    if (!r) {
      const { db, table: t } = this.where(table);
      return lookupRows(db, tableDesign(db, t), field, this.info);
    }
    const design = this.remoteTable(r.link, r.source).design;
    const fd = design.fields.find((x) => x.name === field);
    const l = fd && lookupOf(fd);
    if (!l || l.kind === 'values') return lookupRows(this.conn(), design, field, this.info); // a value list reads no table
    const qc = this.qc();
    if (l.kind === 'fieldList') return fieldListRows(l, fieldNames(qc, l.table));
    return degradedSource(async () => {
      const src = rowSourceOf(qc, l);
      if (!src || this.passThrough(src.ref)) return NO_LIST; // a pass-through is no Row Source (C6 R9), as a local lookup
      const { fields } = await this.describeSource(src.ref);
      const first = fields[shownColumns(src.lookup.columnWidths, Math.min(src.lookup.columnCount ?? 1, fields.length))[0]!];
      const sort = src.table && first ? [{ field: first.name, dir: 'asc' as const }] : [];
      const { rows } = await this.pageSource(src.ref, { offset: 0, limit: LOOKUP_MAX, sort });
      return sourceListRows(src.lookup, fields, rows, this.info);
    }, NO_LIST);
  }

  /** R11: the front-end's relations, then, for each source that opens, its relations between two tables linked from it (a
   *  failing source contributes none). `localOnly` (the Relationships window): the front-end's only, no linked file opened. */
  listRelations(opts: { localOnly?: boolean } = {}): Relation[] {
    const front = this.conn();
    const out = listRelations(front);
    if (opts.localOnly) return out;
    const links = this.usableLinks();
    // C2 R8: an Access file has no relations, not loaded for them; a server's are not read in C4
    const skip = new Set(sourceRows(front).filter((x) => x.kind === 'access' || isServerKind(x.kind)).map((x) => x.id));
    for (const id of new Set(links.map((l) => l.sourceId))) {
      if (skip.has(id)) continue;
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
    if (kind === 'module') { if (!isModuleName(name.normalize('NFC'))) return { ok: false, reason: 'badModuleName' }; parseModuleDef(definition); }
    if (kind === 'query') checkQueryDefinition(this.qc(), name.normalize('NFC'), definition, this.deps.connectors ?? CONNECTORS);
    if (kind === 'query') { this.dropSnapshot(name); if (originalName !== null) this.dropSnapshot(originalName); }
    return saveObject(db, kind, name, definition, originalName);
  }
  async renameObject(kind: ObjectKind, oldName: string, newName: string, labels?: LogLabels): Promise<RenameResult> {
    if (kind === 'query') this.dropSnapshot(oldName);
    const db = this.writeDb();
    const to = newName.normalize('NFC');
    if (kind === 'module' && !isModuleName(to)) return { ok: false, reason: 'badModuleName' };
    const { r, autoCorrect } = await this.autoCorrected(kind === 'module' || oldName === to ? [] : [{ k: 'object', kind, from: oldName, to }], labels, (then) =>
      inTransactionAsync(db, async () => {
        const x = renameObject(db, kind, oldName, newName);
        if (x.ok) await then?.(db);
        return x;
      }));
    return r.ok && autoCorrect ? { ok: true, autoCorrect } : r as RenameResult;
  }
  deleteObject(kind: ObjectKind, name: string): OpResult {
    if (kind === 'query') this.dropSnapshot(name);
    return deleteObject(this.writeDb(), kind, name);
  }
  copyObject(kind: ObjectKind, name: string, newName: string): OpResult {
    const db = this.writeDb();
    return kind === 'module' && !isModuleName(newName.normalize('NFC')) ? { ok: false, reason: 'badModuleName' } : copyObject(db, kind, name, newName);
  }
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
  async describeSource(ref: RecordSourceRef, params?: Record<string, CellInput> /* a crosstab's (B4 R11) */): Promise<SourceInfo> {
    const pt = this.passThrough(ref);
    if (pt) { // C6 R7: run when this window has no snapshot of it; its columns have no origin (PassThrough is no table of the front-end)
      const info = toSourceInfo((await this.snapshotOf(pt, ref, false, true)).bound);
      return { ...info, fields: info.fields.map(({ origin: _origin, ...f }) => f) };
    }
    if (ref.kind !== 'table') {
      const ctx = this.remoteCtx();
      const b = resolve(ctx.qc, ref);
      if (!b.crosstab || !ctx.qc.remote!(b.source)) return describeQuerySource(ctx.qc, ref, this.info, params, b);
      // C7 R15: a crosstab on a server source: headings read on the server
      if (b.crosstab.headings !== 'fixed' && b.params.length && !params) return { ...toSourceInfo(b), crosstab: { headings: 'needsParameters' } };
      return toSourceInfo(await remoteExpandCrosstab(ctx, b, b.crosstab.headings === 'fixed' ? {} : paramValues(b, params ?? {}, this.info)));
    }
    const r = this.remoteOf(ref.name);
    if (r) {
      const t = this.remoteTable(r.link, r.source);
      const fields = t.design.fields.map((x) => ({ name: x.name, type: x.props.type, props: x.props, origin: { table: t.name, field: x.name } }));
      const readOnly = t.design.fields.filter((x) => serverComputed(x.props)).map((x) => x.name); // M2: shown read-only, never refused at save
      return { fields, updatable: t.key.length > 0 && !this._state.readOnly, keyTable: t.name, parameters: [], // R9: keyless = read-only
        tables: [{ table: t.name, role: 'key', readOnly, lookupBy: [] }] };
    }
    const at = this.where(ref.name);
    const d = at.link ? tableDesign(at.db, at.table) : this.sourceTable(ref.name).d;
    const updatable = at.link ? at.writable && hasRealRowid(at.db, d) : !this.localReadOnly;
    const fields = d.fields.map((x) => ({ name: x.name, type: x.props.type, props: x.props, origin: { table: d.name, field: x.name } }));
    return { fields, updatable, keyTable: d.name, parameters: [] };
  }
  /** Filtered as rows.page filters (compileFilter), and by `req.where`; `total` counts the kept rows. Contract 1.2: a sort or filter field the
   *  table lacks rejects bc:notFound, a criterion compileFilter refuses rejects bc:invalidArgument (rows.page keeps
   *  bc:invalidArgument for an unknown sort field and bc:invalidFilter). A table has no params. */
  async pageSource(ref: RecordSourceRef, req: SourcePageRequest): Promise<SourcePage> {
    const pt = this.passThrough(ref);
    if (pt) { // C6 R1: sorted, filtered and counted on the snapshot; a pass-through takes no parameters
      const s = await this.snapshotOf(pt, req, req.fresh === true, false);
      return pageQuerySource(s.db, ref as QueryRef, { ...req, params: {} }, { info: this.info, writeSeq: () => 0 }, s.bound);
    }
    if (ref.kind !== 'table') {
      const ctx = this.remoteCtx();
      const b = resolve(ctx.qc, ref);
      if (!ctx.qc.remote!(b.source)) return pageQuerySource(ctx.qc, ref, req, this.queryCtx(), b);
      if (!b.crosstab) return remotePageSource(ctx, b, req);
      // C7 R15: headings read on the server; a heading gone: its sort and criteria go, the page brings the columns (as pageQuerySource, B4 R14)
      const x = await remoteExpandCrosstab(ctx, b, paramValues(b, req.params ?? {}, this.info));
      const shown = (field: string) => x.columns.some((c) => sameName(c.name, field));
      const page = await remotePageSource(ctx, x, { ...req, sort: (req.sort ?? []).filter((v) => shown(v.field)), filter: (req.filter ?? []).filter((v) => shown(v.field)) });
      return { ...page, columns: x.columns.map((c) => c.name) };
    }
    if (this.remoteOf(ref.name)) return this.remoteTablePage(ref.name, req);
    const q = this.noRowidLink(ref.name);
    if (q) return await this.pageSource(q, req);
    const { db, d } = this.sourceTable(ref.name);
    const filter = req.filter ?? [];
    const missing = (name: string) => !d.fields.some((x) => sameName(x.name, name));
    if (filter.some((f) => missing(f.field)) || (req.sort ?? []).some((s) => missing(s.field))) throw new Error('bc:notFound');
    try {
      const { where } = req;
      const { rows } = readRows(db, d, { offset: req.offset, limit: req.limit, filter, ...(where !== undefined ? { where } : {}) }, this.info.locale, req.sort ?? [], this.writeSeq());
      const aggregates = req.aggregates && aggregateRows(db, d, req.aggregates, filter, this.info.locale, where);
      return { rows: rows.map((r) => r.values), rowids: rows.map((r) => r.rowid), total: countRows(db, d.name, filter, this.info.locale, where), ...(aggregates ? { aggregates } : {}) };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('bc:invalidFilter')) throw new Error(e.message.startsWith('bc:invalidFilter|') ? e.message.replace('invalidFilter', 'invalidArgument') : 'bc:invalidArgument');   // R6: the unknown function's name stays
      throw e;
    }
  }
  /** F4: the grouped rows of a chart (src/main/chart-data.ts). Reads only, so it works on a read-only base. */
  chartData(req: ChartDataRequest): Promise<ChartData> {
    return chartData(this, req);
  }
  /** C6: the saved pass-through `ref` names, if it is one. */
  private passThrough(ref: RecordSourceRef): { name: string; sql: string; pt: PassThroughProps } | null {
    if (ref.kind !== 'query') return null;
    const o = getObject(this.conn(), 'query', ref.name);
    const pt = o && passThroughOf(o.definition);
    return pt ? { name: o.name, sql: parseQueryDefinition(o.definition).sql, pt } : null;
  }
  /** C6 R7: the pass-through's snapshot for `call`; it runs when there is none, or when `fresh` (an open, a Requery) unless
   *  the snapshot was made by a describe and no page has read it since (an open runs once, whatever else is read between). Returns Records No is no record source: bc:notSelectQuery, nothing sent (G1: Returns
   *  Records Yes is not active content, no needContent here).
   *  ponytail: one snapshot per query per window — a second view opening the same pass-through re-runs it and the first view's
   *  next pages read the new result; a snapshot id in the page request if it matters. */
  private async snapshotOf(q: { name: string; sql: string; pt: PassThroughProps }, call: object, fresh: boolean, byDescribe: boolean) {
    if (!q.pt.returnsRecords) throw new Error('bc:notSelectQuery');
    const key = foldName(q.name);
    const held = this.snapshots.get(key);
    // a fresh page does not re-run a snapshot a describe made that no page has read yet (an open: any number of describes first), nor
    // one this very call made or last read (db-host's retry of the call)
    if (held && (!fresh || (held.byDescribe && !held.pagedBy) || held.call === call || held.pagedBy === call)) { if (!byDescribe) held.pagedBy = call; return held; }
    // ponytail: the whole result in db-host's memory (pg buffers it), twice while it loads; a cursor (pg-cursor, a new dependency) if
    // results outgrow it — docs/postgresql.md says to filter on the server.
    const r = await runNative(this.remote, q.pt, q.sql, this.trusted);
    if (this.closed) throw new Error('bc:cannotOpen'); // closed during the run: no snapshot made (nothing would close it), as conn()
    const db = loadSnapshot(snapshotDesign(r.columns), r.rows);
    let bound: BoundQuery;
    try {
      bound = resolve(db, { kind: 'sql', sql: `SELECT * FROM [${PT_TABLE}]` });
    } catch (e) {
      db.close();
      throw e;
    }
    bound.updatable = false;
    this.snapshots.get(key)?.db.close();
    const s = { db, bound, call, byDescribe, pagedBy: byDescribe ? null : call };
    this.snapshots.set(key, s);
    return s;
  }
  private dropSnapshot(name: string): void {
    const key = foldName(name);
    this.snapshots.get(key)?.db.close();
    this.snapshots.delete(key);
  }
  /** B4: a record of an updatable query (src/main/query/join-write.ts); a read-only base: ReadOnlyError. */
  async saveSource(ref: QueryRef, req: SourceSaveRequest): Promise<SourceSaveResult> {
    this.writeDb(); // a read-only front-end: ReadOnlyError before anything is bound
    const ctx = this.remoteCtx();
    const qc = ctx.qc;
    const b = resolve(qc, ref);
    if (qc.remote!(b.source)) return remoteSaveSource(ctx, b, req, { enforceMask: true }); // R9, C5 R16
    return saveSourceRow(qc.dbOf(b.source, true), b, { ...req, rowid: req.rowid === null ? null : localRowid(req.rowid) }, this.info);
  }
  /** B4 R4: AutoLookup; reads only. On a server source, by the connector's find (C5 R16). */
  async autoLookup(ref: QueryRef, values: Record<string, CellInput>): Promise<Record<string, SqlValue>> {
    const ctx = this.remoteCtx();
    const b = resolve(ctx.qc, ref);
    if (ctx.qc.remote!(b.source)) return remoteAutoLookup(ctx, b, values);
    return autoLookup(ctx.qc.dbOf(b.source, false), b, values, this.info);
  }
  private exportPager(src: ExportSource): (offset: number, limit: number) => Promise<SourcePage> {
    const { ref, params, sort, filter, where } = src;
    return (offset, limit) => this.pageSource(ref, { offset, limit, ...(sort ? { sort } : {}), ...(filter ? { filter } : {}), ...(params ? { params } : {}), ...(where !== undefined ? { where } : {}) });
  }
  /** Writes the source (the datasheet's pages: pageSource, with its parameters, sort and filter) to `path`, a path the main
   *  process got from a save dialog. Reads only: allowed on a read-only base. Throws bc:writeFailed; the old file is kept. */
  async exportText(src: ExportSource, spec: ExportTextSpec, path: string, texts: { yes: string; no: string },
    tick?: (done: number, total: number) => Promise<void>): Promise<ExportResult> {
    const { fields } = await this.describeSource(src.ref, src.params);
    return writeTextExport({ fields, spec, path, tick, texts: { ...texts, info: this.info }, page: this.exportPager(src) });
  }
  /** The rows an export of `src` holds (the main process refuses an Excel export above the sheet limit before asking where). */
  async exportRowCount(src: ExportSource): Promise<number> { return (await this.exportPager(src)(0, 0)).total; }
  /** As exportText, to an .xlsx workbook with one sheet named `sheet`: typed cells, never formulas. A source above the Excel row
   *  limit resolves { ok: false, reason: 'tooManyRows' } and writes nothing. */
  async exportExcel(src: ExportSource, path: string, sheet: string, tick?: (done: number, total: number) => Promise<void>): Promise<ExportResult> {
    const { fields } = await this.describeSource(src.ref, src.params);
    return writeExcelExport({ fields, path, sheet, tick, info: this.info, page: this.exportPager(src) });
  }
  /** As exportText, to an XML file in Access's data format (`format` xml: `name`, the table or query, is the record element) or an
   *  HTML table (F1, F5). */
  async exportMarkup(src: ExportSource, format: 'xml' | 'html', name: string, path: string, texts: { yes: string; no: string },
    tick?: (done: number, total: number) => Promise<void>): Promise<ExportResult> {
    const { fields } = await this.describeSource(src.ref, src.params);
    return writeMarkupExport({ format, name, fields, path, tick, texts: { ...texts, info: this.info }, page: this.exportPager(src) });
  }
  /** F4: the saved exports (reads), saved and deleted by name (a read-only base: ReadOnlyError). */
  savedExports(): Record<string, SavedExport> { return loadSavedExports(this.conn()); }
  saveSavedExport(name: string, e: SavedExport): void { saveSavedExport(this.writeDb(), name, e); }
  deleteSavedExport(name: string): void { deleteSavedExport(this.writeDb(), name); }
  saveImportSpec(name: string, spec: ImportSpec): void { saveSpec(this.writeDb(), name, spec); }

  /** Active content (R3) and the base's identity, for the main process's decision (trust.ts). */
  /** Startup options (B3): read-only allowed; a wrong key reads as its default (R12). */
  startup(): StartupOptions { return startupOptions(this.conn()); }
  /** The data file option changed is a structure call (C3 R4): turned off while others write shared, the next opener would take
   *  the plain-base path (exclusive lock, reconcile) beside them. */
  saveStartup(o: StartupOptions): void {
    saveStartupOptions(o.dataFile !== startupOptions(this.conn()).dataFile ? this.structureDb() : this.writeDb(), o);
  }
  /** Default theme of the base (F2): read-only allowed; an invalid stored value reads as the built-in theme. */
  baseTheme(): Theme { return baseTheme(this.conn()); }
  saveBaseTheme(t: Theme): void { saveBaseTheme(this.writeDb(), t); }
  /** Shared image gallery (F3): reads work read-only; add, replace and remove need the write handle. */
  listResources(): ResourceInfo[] { return listResources(this.conn()); }
  getResources(names: string[]): Record<string, string> { return getResources(this.conn(), names); }
  addResource(name: string, dataUrl: string): string { return addResource(this.writeDb(), name, dataUrl); }
  replaceResource(name: string, dataUrl: string): void { replaceResource(this.writeDb(), name, dataUrl); }
  removeResource(name: string): void { removeResource(this.writeDb(), name); }
  /** Theme "all matching objects": the base default and the removal of every saved override of `kind`, in one transaction
   *  (the open documents in `skip` get the removal as an edit of their own). */
  applyThemeToAll(t: Theme, kind: 'form' | 'report', skip: string[]): { cleared: number } {
    const db = this.writeDb();
    return inTransaction(db, () => { saveBaseTheme(db, t); return { cleared: clearThemeOverrides(db, kind, skip) }; });
  }
  activeContent(): ActiveContent { return activeContent(this.conn()); }
  dbUuid(): string {
    return (this.conn().prepare(`SELECT value FROM bc_meta WHERE key = 'db_uuid'`).get() as { value: string } | undefined)?.value ?? '';
  }
  setContentEnabled(fingerprint: string | null, trusted = false): void { this.enabledContent = fingerprint; this.trusted = trusted; }
  /** Read again at every call: content changed by another connection since it was enabled (an action query or a macro added
   *  or edited elsewhere) is not the content enabled, and is refused until approved. */
  private needContent(): void {
    if (this.enabledContent === null || activeContent(this.conn()).fingerprint !== this.enabledContent) throw new Error('bc:contentDisabled');
  }

  /** A3 action queries (src/main/query/action.ts; on a server source C7 R14, src/main/connectors/remote-action.ts), refused
   *  bc:contentDisabled while the active content is disabled. actionCount only reads; runAction on a read-only base: reason readOnly. */
  async actionCount(ref: QueryRef, params: Record<string, CellInput>): Promise<{ count: number; table: string }> {
    if (this.passThrough(ref)) throw new Error('bc:invalidArgument'); // the count of a pass-through is unknown: the renderer never asks
    this.needContent();
    const ctx = this.remoteCtx();
    const b = resolve(ctx.qc, ref, true);
    return ctx.qc.remote!(b.source) ? remoteActionCount(ctx, b, params) : actionCount(ctx.qc, ref, params, this.queryCtx(), b);
  }
  async runAction(ref: QueryRef, params: Record<string, CellInput>, opts: RunActionOptions): Promise<ActionResult> {
    const q = this.passThrough(ref);
    if (q?.pt.returnsRecords) throw new Error('bc:invalidArgument'); // C6 G1: Yes is read through describeSource/pageSource, never checks content
    this.needContent();
    if (q) {
      // R11: allowed on a read-only front-end too (the file is not written)
      return { ok: true, count: (await runNative(this.remote, q.pt, q.sql, this.trusted)).affected };
    }
    // the front-end or the query's source read-only (dbOf, once bound): reason readOnly
    try {
      const ctx = this.remoteCtx();
      const b = resolve(ctx.qc, ref, true);
      if (!ctx.qc.remote!(b.source)) return await runAction(ctx.qc, ref, params, opts, { ...this.queryCtx(), now: () => new Date() }, b);
      this.writeDb(); // a read-only front-end writes no server table (R9); the write sequence moves (PF6)
      return await remoteRunAction(ctx, b, params, opts);
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

  /** Database Tools › Move Data › To a Server (C7 R1, R2, R8–R10): a structure call. The refusals first (readOnly, dataFile, noTables),
   *  then the run on its own connection (RemoteSources.once: Stop cancels its statement) with the login the wizard's connection
   *  step made the key's credential. */
  async migrateToServer(req: MigrateRequest, tick: (p: ImportProgress) => Promise<void> = async () => {}): Promise<MigrateResult> {
    if (this._state.readOnly) return { ok: false, reason: 'readOnly' };
    if (startupOptions(this.conn()).dataFile) return { ok: false, reason: 'dataFile' }; // its front-ends link these tables (R2)
    if (listTables(this.conn()).length === 0) return { ok: false, reason: 'noTables' }; // before connecting (the plan checks it again)
    let front: DatabaseSync;
    try { front = this.structureDb(); } catch (e) { if (e instanceof ReadOnlyError) return { ok: false, reason: 'readOnly' }; throw e; }
    const { connector, p } = this.connectorOf(req.kind, req.params);
    try {
      // no statement timeout on the run's connection (an index or a count on a GB-size table); Stop stays (R10). The links keep p's.
      const r = await this.remote.once(req.kind, { ...(p as object), timeout: 0 }, true, (c, caps) => runMigration({
        front, c, caps, kind: req.kind, params: p, label: connector.label(p), schema: req.schema, tick,
        backup: () => backupCopy(this.path),
        switchLocal: (tables, metas) => switchLocal(front, req.kind, p, tables, metas),
        queries: () => refusedQueries(this.remoteCtx(), c, caps, serverSourceFor(front, req.kind, p)),
      }));
      if (r.ok) this.closeUnused([]); // the linked locks follow, the state with them
      return r;
    } finally {
      this.seq++; // every table became a link
    }
  }

  /** External Data › Import › PostgreSQL / SQL Server (C7 R17): a structure call. `names` are names inspectServer offered (a name the
   *  front-end uses: nameExists; one the server no longer offers: missingTables, nothing created). The tables are read on a connection
   *  of their own (Stop cancels its statement) with the dialog's login, and created in one SQLite transaction. */
  async importServerTables(kind: ServerKind, params: unknown, names: string[], tick: (p: ImportProgress) => Promise<void> = async () => {}): Promise<ServerImportResult> {
    const front = this.structureDb();
    const { connector, p } = this.connectorOf(kind, params);
    try {
      return await this.remote.once<ServerImportResult>(kind, p, true, async (c) => {
        const tables = this.offered(await c.tables());
        const wanted = names.filter((n, i) => names.findIndex((m) => sameName(m, n)) === i);
        const taken = wanted.filter((n) => this.shadowed(front, n) || isLinkName(front, n));
        if (taken.length) return { ok: false, reason: 'nameExists', names: taken };
        const picked = wanted.map((n) => tables.find((t) => !t.unsupported && t.name === n));
        const missing = wanted.filter((_, i) => !picked[i]);
        if (missing.length) return { ok: false, reason: 'missingTables', names: missing };
        return importTables({ front, c, tables: picked as RemoteTable[], tick });
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'bc:cancelled') return { ok: false, reason: 'cancelled' };
      if (isLost(e)) throw new Error(`bc:linkUnavailable|cannotConnect|${connector.label(p)}`, { cause: e }); // rolled back with the connection
      throw e;
    } finally {
      this.seq++; // tables were created
    }
  }

  /** External Data › Import › Access (E1): the tables of the Access file `path` (a path the dialog picked) with the names they would take. */
  inspectAccessImport(path: string): AccessImportInfo {
    let kind: string | undefined;
    try { kind = sourceKindOf(path); } catch { /* not readable: cannotOpen below */ }
    if (kind !== 'access') throw new Error(`bc:linkUnavailable|cannotOpen|${path}`);
    const { r } = this.links.accessReader(path);
    const found = inspectAccess(r);
    const names = this.freeNames(found.map((t) => t.name));
    return {
      tables: found.map((t, i) => ({ name: names[i]!, remote: t.name, taken: false as const,
        ...(t.skipped.length ? { skipped: t.skipped } : {}), ...(t.unsupported ? { unsupported: t.unsupported } : {}) })),
      linked: r.getTableNames({ normalTables: false, linkedTables: true }),
      warnSize: statSync(path).size > ACCESS_WARN_BYTES,
      canExport: hasAccess(),
    };
  }

  /** Imports `remotes` (names inspectAccessImport offered) of the Access file `path` into local tables, in one transaction. One the
   *  file no longer holds, or BaseCraft cannot hold: missingTables, nothing created. Stop: interrupt() sets the flag read between pages
   *  and ends a running export. `structure` (batch E2): the exact structure from Microsoft Access (`script`: access-export.ps1's path, given
   *  by the main process; the export runs in a temporary folder, deleted on every path, and is copied to `keepDir` first when given) or
   *  from an export folder; a refusal is `export` and nothing is created. */
  async importAccessTables(path: string, remotes: string[], tick: (p: ImportProgress) => Promise<void> = async () => {},
    structure?: AccessStructureSource, keepDir?: string, script?: string): Promise<AccessImportResult> {
    const front = this.structureDb();
    const { r, jet3 } = this.links.accessReader(path);
    const found = inspectAccess(r);
    const wanted = remotes.filter((n, i) => remotes.findIndex((m) => sameName(m, n)) === i);
    const picked = wanted.map((n) => found.find((t) => !t.unsupported && t.name === n));
    const missing = wanted.filter((_, i) => !picked[i]);
    if (missing.length) return { ok: false, reason: 'missingTables', names: missing };
    const names = this.freeNames(wanted);
    this.stopAccessImport = false;
    this.accessImporting = true;
    let temp: string | undefined;
    try {
      let exported: AccessExport | undefined;
      if (structure?.kind === 'folder') {
        const read = readAccessExport(structure.dir, basename(path));
        if (!read.ok) return { ok: false, reason: 'export', failure: read.reason };
        exported = read.export;
      } else if (structure?.kind === 'access') {
        if (!script || !hasAccess()) return { ok: false, reason: 'export', failure: 'noAccess' };
        const kept = keepDir === undefined ? undefined : join(keepDir, `${basename(path)}.export`);
        if (kept !== undefined && existsSync(kept)) return { ok: false, reason: 'export', failure: 'badFolder' };
        temp = mkdtempSync(join(tmpdir(), 'basecraft-export-'));
        const out = join(temp, 'out');
        mkdirSync(out);
        this.exportAbort = new AbortController();
        const run = await runAccessExport({ script, source: path, out, password: this.links.accessPassword(path), signal: this.exportAbort.signal,
          tick: (done, total) => void tick({ done, total, label: 'import.access.exporting' }) });
        const stopped = this.exportAbort.signal.aborted;
        this.exportAbort = null;
        if (stopped) return { ok: false, reason: 'cancelled' };
        if (!run.ok) return { ok: false, reason: 'export', failure: run.reason };
        const read = readAccessExport(out, basename(path));
        if (!read.ok) return { ok: false, reason: 'export', failure: read.reason };
        exported = read.export;
        if (kept !== undefined) {
          try { cpSync(out, kept, { recursive: true, errorOnExist: true, force: false }); } catch {
            rmSync(kept, { recursive: true, force: true });
            return { ok: false, reason: 'export', failure: 'failed' }; // permissions, disk full: not the existing-folder case
          }
        }
      }
      return await importAccess({ front, r, jet3, source: basename(path), tables: wanted.map((remote, i) => ({ remote, name: names[i]! })),
        linked: r.getTableNames({ normalTables: false, linkedTables: true }), info: this.info, tick, stopped: () => this.stopAccessImport,
        ...(exported ? { structure: exported } : {}) });
    } finally {
      this.exportAbort = null;
      // Access may still hold its copy for a moment after being ended: the async rm retries (rmSync does not). Best effort.
      if (temp) await rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }).catch(() => undefined);
      this.accessImporting = false;
      this.seq++; // tables were created
    }
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
