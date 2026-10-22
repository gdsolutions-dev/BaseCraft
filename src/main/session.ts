// Une base ouverte = fichier + verrou d'écriture + mode lecture seule.
// ponytail: SQLite tourne dans le processus principal, ce qui suffit pour A1. Le lot A3 le déplace dans un
// utilityProcess quand des requêtes longues apparaîtront.
import { randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { DeleteResult, OpResult, Relation, RelationResult, RelationsLayout, SaveTableRequest, SaveTableResult, SessionState } from '../shared/api';
import type { CellInput } from '../shared/coerce';
import type { TableDesign } from '../shared/field-types';
import type { ImportPlan, ImportResult, ImportSpec, TextPreview } from '../shared/import-text';
import { localeInfo, type LocaleInfo } from '../shared/locale-format';
import { alterTable } from './db/alter';
import { BaseFileError, createBaseFile, openBaseFile } from './db/file-format';
import { acquireLock, peekLock, takeOverStaleLock, type HeldLock, type LockDeps, type LockInfo, type LockResult } from './db/lock';
import { detectLocationRisk, type LocationRisk, type RiskProbe } from './db/location-risk';
import { countRows, readRows, type PageRequest, type RowPage } from './db/rows';
import {
  cascadeChildren, createTable, DanglingKeyError, DesignValidationError, dropTable, listTables, NameExistsError, reconcile, renameTable, tableDesign,
  ViewBrokenError, type TableSummary,
} from './db/schema';
import { deleteRows, insertRow, updateRow, type RowWriteResult } from './db/write-layer';
import { deleteRelation, listRelations, relationsLayout, saveRelation, saveRelationsLayout } from './db/relations';
import { deleteSpec, loadSpecs, saveSpec } from './import/specs';
import { previewText, runImport, type ImportTexts } from './import/text-import';

export interface SessionDeps {
  appVersion: string;
  region: string;
  probe: RiskProbe;
  lockDeps?: LockDeps;
  sessionId?: string;
  onStateChanged?: (s: SessionState) => void; // lock lost, holder changed, taken over
  openFile?: typeof openBaseFile; // test seam
}

export class ReadOnlyError extends Error {
  constructor() {
    super('read-only base');
    this.name = 'ReadOnlyError';
  }
}

const ROWID_NAMES = ['rowid', 'oid', '_rowid_'];
const isWritable = (p: string): boolean => {
  try { accessSync(p, constants.W_OK); return true; } catch { return false; }
};
// Stands for "no lock file": takeOverStaleLock then simply acquires.
const NO_LOCK: LockInfo = { user: '?', host: '?', pid: 0, sessionId: '?', heartbeatAt: new Date(0).toISOString() };
const isPlaceholder = (i: LockInfo) => i.pid === 0 && i.sessionId === '?';

export class Session {
  private db: DatabaseSync | null = null;
  private lock: HeldLock | null = null;
  private observed: LockInfo | null = null; // exact object from the lock module: takeOverStaleLock needs it back
  private refused = false; // take-over refused on an unreadable lock: do not offer it again while it stays unreadable
  private closed = false;
  private _state!: SessionState;
  private readonly sessionId: string;
  private readonly risk: LocationRisk;
  private readonly info: LocaleInfo;
  private readonly openFile: typeof openBaseFile;

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
    this.apply(acquireLock(path, this.sessionId, deps.lockDeps));
  }

  get state(): SessionState { return this._state; }

  private readOnlyState(): SessionState {
    return { path: this.path, fileName: basename(this.path), readOnly: true, locationRisk: this.risk };
  }

  private openReadOnly(): DatabaseSync { return this.openFile(this.path, 'readOnly', this.deps.appVersion).db; }

  /** Write mode when the lock is ours and the file writable; read-only otherwise, with the reason. */
  private apply(r: LockResult): void {
    if (r.status === 'acquired' && !isWritable(this.path)) {
      r.lock.release();
      r = { status: 'cannotLock', reason: 'EACCES' };
    }
    if (r.status === 'acquired') {
      let db: DatabaseSync | undefined;
      try {
        const o = this.openFile(this.path, 'write', this.deps.appVersion); // rolls a hot journal back, migrates
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
    } else this._state = { ...this.readOnlyState(), readOnlyReason: 'fileReadOnly' };
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
      if (!this.lock || this.lock.heartbeat() === 'ok') return;
      // this.lock is kept: close() releases it only if it is still ours (transient write failure)
      let ro: DatabaseSync | null = null;
      try { ro = this.openReadOnly(); } catch (e) { console.error(e); } // retried by the next tick
      try { this.db?.close(); } catch { /* already unusable */ }
      this.db = ro;
      this._state = { ...this._state, readOnly: true, readOnlyReason: 'lockLost' };
      changed = true;
    } else if (!this.db && !this._state.needsRecovery) {
      try { this.db = this.openReadOnly(); } catch { /* still unreadable: next tick */ }
    }
    if (this._state.readOnlyReason === 'heldByOther' || this._state.readOnlyReason === 'lockLost') changed = this.peek() || changed;
    if (changed) this.deps.onStateChanged?.(this._state);
  }

  /** Takes over a stale lock; the lock module refuses a live one, so this also refreshes the holder's state. */
  takeOverLock(): SessionState {
    if (this.closed || !this.observed) return this._state;
    this.apply(takeOverStaleLock(this.path, this.observed, this.sessionId, this.deps.lockDeps));
    this.deps.onStateChanged?.(this._state);
    return this._state;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.db?.close(); } catch { /* already unusable */ } finally { this.lock?.release(); }
    this.db = null;
  }

  private conn(): DatabaseSync {
    if (!this.db) throw new Error(this._state.needsRecovery ? 'bc:needsRecovery' : 'bc:cannotOpen');
    return this.db;
  }

  private writeDb(): DatabaseSync {
    this.tick();
    if (this._state.readOnly) throw new ReadOnlyError();
    return this.conn();
  }

  /** The session's own design (never the renderer's); rowid-based access needs a real, unshadowed rowid. */
  private dataDesign(table: string): TableDesign {
    const db = this.conn();
    const d = tableDesign(db, table);
    const noRowid = db.prepare(`SELECT 1 FROM pragma_table_list WHERE schema = 'main' AND name = ? AND wr = 1`).get(d.name);
    if (noRowid || d.fields.some((x) => ROWID_NAMES.includes(x.name.toLowerCase()))) throw new Error('bc:unsupportedTable');
    return d;
  }

  listTables(): TableSummary[] { return listTables(this.conn()); }
  tableDesign(name: string): TableDesign { return tableDesign(this.conn(), name); }

  async saveTable(req: SaveTableRequest): Promise<SaveTableResult> {
    const db = this.writeDb();
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
    const db = this.writeDb();
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

  dropTable(name: string): OpResult { return dropTable(this.writeDb(), name); }

  count(table: string): number { return countRows(this.conn(), this.dataDesign(table).name); }
  page(table: string, req: PageRequest): RowPage { return readRows(this.conn(), this.dataDesign(table), req); }

  async insert(table: string, values: Record<string, CellInput>): Promise<RowWriteResult> {
    const db = this.writeDb();
    return insertRow(db, this.dataDesign(table), values, this.info, undefined, { enforceMask: true }); // datasheet entry: masked
  }
  async update(table: string, rowid: number, changes: Record<string, CellInput>): Promise<RowWriteResult> {
    const db = this.writeDb();
    return updateRow(db, this.dataDesign(table), rowid, changes, this.info, undefined, { enforceMask: true });
  }
  delete(table: string, rowids: number[]): DeleteResult {
    const db = this.writeDb();
    return deleteRows(db, this.dataDesign(table).name, rowids);
  }

  listRelations(): Relation[] { return listRelations(this.conn()); }
  saveRelation(rel: Relation, originalName: string | null): RelationResult { return saveRelation(this.writeDb(), rel, originalName, this.info); }
  deleteRelation(name: string): OpResult { return deleteRelation(this.writeDb(), name, this.info); }
  relationsLayout(): RelationsLayout { return relationsLayout(this.conn()); }
  saveRelationsLayout(layout: RelationsLayout): void { saveRelationsLayout(this.writeDb(), layout); }
  cascadeChildren(table: string): string[] { return cascadeChildren(this.conn(), table); }

  importPreview(path: string, spec: ImportSpec | null, fieldPrefix: string): TextPreview {
    this.conn();
    return previewText(path, spec, this.info, fieldPrefix);
  }
  importRun(path: string, plan: ImportPlan, texts: ImportTexts, tick?: (done: number, total: number) => Promise<void>): Promise<ImportResult> {
    return runImport(this.writeDb(), path, plan, this.info, texts, tick);
  }
  importSpecs(): Record<string, ImportSpec> { return loadSpecs(this.conn()); }
  saveImportSpec(name: string, spec: ImportSpec): void { saveSpec(this.writeDb(), name, spec); }
  deleteImportSpec(name: string): void { deleteSpec(this.writeDb(), name); }
}
