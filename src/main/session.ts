// Une base ouverte = fichier + verrou d'écriture + mode lecture seule.
// Elle vit dans le processus de données (db-host/host.ts, un utilityProcess) : le processus principal l'appelle par
// db-host/client.ts, une file par session, chaque méthode devenant asynchrone.
import { randomUUID } from 'node:crypto';
import { accessSync, constants, renameSync } from 'node:fs';
import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ActionResult, CascadeChild, CompactResult, DeleteResult, QueryRef, RunActionOptions, FieldFilter, LookupRow, ObjectKind, ObjectSummary, OpResult, Relation, RelationResult, RelationsLayout, SaveTableRequest,
  SaveTableResult, SessionState,
} from '../shared/api';
import type { RecordSourceRef, SourceInfo, SourcePage, SourcePageRequest } from '../shared/record-source';
import type { CellInput } from '../shared/coerce';
import { defaultProps, quoteIdent, sameName, validateDesign, type FieldProps, type TableDesign } from '../shared/field-types';
import type { ImportPlan, ImportResult, ImportSpec, TextPreview } from '../shared/import-text';
import { localeInfo, type LocaleInfo } from '../shared/locale-format';
import { alterTable } from './db/alter';
import { compactBase, vacuumInto, type CopyDeps } from './db/copy-file';
import { BaseFileError, createBaseFile, openBaseFile } from './db/file-format';
import { copyObject, deleteObject, getObject, listObjects, renameObject, saveObject, setObjectDescription } from './db/objects';
import { acquireLock, peekLock, takeOverStaleLock, type HeldLock, type LockDeps, type LockInfo, type LockResult } from './db/lock';
import { detectLocationRisk, type LocationRisk, type RiskProbe } from './db/location-risk';
import { countRows, lookupRows, readRows, type PageRequest, type RowPage } from './db/rows';
import {
  cascadeChildren, createTable, DanglingKeyError, DesignValidationError, dataDesign, dropTable, listTables, NameExistsError, reconcile, renameTable, setTableDescription, tableDesign,
  ViewBrokenError, type TableSummary,
} from './db/schema';
import { copyRows, deleteRows, insertRow, updateRow, type RowWriteResult } from './db/write-layer';
import { inTransaction, inTransactionAsync } from './db/tx';
import { countViolations } from './db/rules';
import { deleteRelation, listRelations, relationsLayout, saveRelation, saveRelationsLayout } from './db/relations';
import { writeTextExport } from './exchange/export-text';
import { writeExcelExport } from './exchange/export-excel';
import { EXCEL_SPEC, type ExcelPreview, type ExportResult, type ExportSource, type ExportTextSpec } from '../shared/exchange';
import { deleteSpec, loadSpecs, saveSpec } from './import/specs';
import { previewText, runImport, type ImportTexts } from './import/text-import';
import { excelSource, previewExcel, readSheet } from './exchange/excel-read';
import { checkQueryDefinition, describeQuerySource, pageQuerySource, type QueryCtx } from './query/source';
import { actionCount, runAction } from './query/action';

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
  /** Write sequence of the cached query totals and sorted-order snapshots (readRows): moved by writeDb(), by another connection's commit, by a new connection. */
  private seq = 0;
  private seen: [DatabaseSync | null, unknown] = [null, null];

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
    this.seq++;
    return this.conn();
  }

  /** The current write sequence; PRAGMA data_version changes when another connection (another BaseCraft) commits. */
  private writeSeq(): number {
    const db = this.conn();
    const v = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    if (this.seen[0] !== db || this.seen[1] !== v) {
      this.seen = [db, v];
      this.seq++;
    }
    return this.seq;
  }
  private queryCtx(): QueryCtx { return { info: this.info, writeSeq: () => this.writeSeq() }; }

  /** The session's own design (never the renderer's); rowid-based access needs a real, unshadowed rowid. */
  private dataDesign(table: string): TableDesign { return dataDesign(this.conn(), table); }

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

  /**
   * Copy of a table: structure and data (Access's "Structure and Data"), under a new name in the tables' namespace. The copy
   * is a managed table (no external flag). A table BaseCraft cannot address by rowid, or data the copy's constraints refuse
   * (an external table holding text in an INTEGER column), rejects bc:unsupportedTable and creates nothing. ponytail: only
   * INTEGER columns get a range CHECK; text in an inferred REAL or untyped column is copied as it is.
   */
  copyTable(name: string, newName: string, mode: 'structure' | 'data' = 'data'): OpResult {
    const db = this.writeDb();
    if (!listTables(db).some((x) => sameName(x.name, name))) return { ok: false, reason: 'notFound' };
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
    const db = this.writeDb();
    const src = this.dataDesign(from);
    const dst = this.dataDesign(to);
    if (sameName(src.name, dst.name)) return { appended: 0, refused: 0 };
    const map = dst.fields.filter((d) => d.props.type !== 'autoNumber').flatMap((d) => {
      const s = src.fields.find((x) => sameName(x.name, d.name));
      return s ? [{ from: s.name, to: d.name }] : [];
    });
    if (map.length === 0) return { appended: 0, refused: 0 };
    const stmt = db.prepare(`SELECT ${map.map((m) => quoteIdent(m.from)).join(', ')} FROM ${quoteIdent(src.name)} ORDER BY rowid`);
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

  dropTable(name: string): OpResult { return dropTable(this.writeDb(), name); }

  async testRules(table: string): Promise<{ field: string; rows: number }[]> {
    const db = this.conn();
    const design = tableDesign(db, table);
    const out: { field: string; rows: number }[] = [];
    for (const field of [...design.fields.map((fd) => fd.name), '']) { // '': the table's rule, its own line
      const rows = await countViolations(db, design, field, this.info);
      if (rows) out.push({ field, rows });
    }
    return out;
  }

  count(table: string, filter?: FieldFilter[]): number { return countRows(this.conn(), this.dataDesign(table).name, filter, this.info.locale); }
  page(table: string, req: PageRequest): RowPage { return readRows(this.conn(), this.dataDesign(table), req, this.info.locale, undefined, this.writeSeq()); }

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
  lookup(table: string, field: string): ReturnType<typeof lookupRows> {
    const db = this.conn();
    return lookupRows(db, tableDesign(db, table), field, this.info);
  }

  listRelations(): Relation[] { return listRelations(this.conn()); }
  saveRelation(rel: Relation, originalName: string | null): RelationResult { return saveRelation(this.writeDb(), rel, originalName, this.info); }
  deleteRelation(name: string): OpResult { return deleteRelation(this.writeDb(), name, this.info); }
  relationsLayout(): RelationsLayout { return relationsLayout(this.conn()); }
  saveRelationsLayout(layout: RelationsLayout): void { saveRelationsLayout(this.writeDb(), layout); }
  cascadeChildren(table: string): CascadeChild[] { return cascadeChildren(this.conn(), table); }

  importPreview(path: string, spec: ImportSpec | null, fieldPrefix: string): TextPreview {
    this.conn();
    return previewText(path, spec, this.info, fieldPrefix);
  }
  importRun(path: string, plan: ImportPlan, texts: ImportTexts, tick?: (done: number, total: number) => Promise<void>): Promise<ImportResult> {
    // it yields between blocks (tick): a total cached meanwhile must not outlive the import
    return runImport(this.writeDb(), path, plan, this.info, texts, tick).finally(() => { this.seq++; });
  }
  importExcelPreview(path: string, sheet: string | null, hasHeader: boolean | null, fieldPrefix: string): Promise<ExcelPreview> {
    this.conn();
    return previewExcel(path, sheet, hasHeader, this.info, fieldPrefix);
  }
  /** The plan carries the user's fields and target; its spec is replaced by EXCEL_SPEC (the sheet's header row is dropped by the source). */
  async importExcelRun(path: string, sheet: string, hasHeader: boolean, plan: ImportPlan, texts: ImportTexts, tick?: (done: number, total: number) => Promise<void>): Promise<ImportResult> {
    const db = this.writeDb();
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
    if (kind === 'query') checkQueryDefinition(db, name.normalize('NFC'), definition);
    return saveObject(db, kind, name, definition, originalName);
  }
  renameObject(kind: ObjectKind, oldName: string, newName: string): OpResult { return renameObject(this.writeDb(), kind, oldName, newName); }
  deleteObject(kind: ObjectKind, name: string): OpResult { return deleteObject(this.writeDb(), kind, name); }
  copyObject(kind: ObjectKind, name: string, newName: string): OpResult { return copyObject(this.writeDb(), kind, name, newName); }
  /** Properties dialog: a table keeps it in its metadata, an object in bc_objects. */
  setDescription(kind: ObjectKind | 'table', name: string, description: string | null): OpResult {
    const db = this.writeDb();
    if (kind !== 'table') return setObjectDescription(db, kind, name, description);
    return setTableDescription(db, name, description) ? { ok: true } : { ok: false, reason: 'notFound' };
  }

  private sourceTable(name: string): TableDesign {
    if (!listTables(this.conn()).some((x) => sameName(x.name, name))) throw new Error('bc:notFound');
    return this.dataDesign(name);
  }
  /** `query` and `sql`: src/main/query/source.ts (A3). */
  describeSource(ref: RecordSourceRef): SourceInfo {
    if (ref.kind !== 'table') return describeQuerySource(this.conn(), ref);
    const d = this.sourceTable(ref.name);
    const fields = d.fields.map((x) => ({ name: x.name, type: x.props.type, props: x.props, origin: { table: d.name, field: x.name } }));
    return { fields, updatable: true, keyTable: d.name, parameters: [] };
  }
  /** Filtered as rows.page filters (compileFilter); `total` counts the kept rows. Contract 1.2: a sort or filter field the
   *  table lacks rejects bc:notFound, a criterion compileFilter refuses rejects bc:invalidArgument (rows.page keeps
   *  bc:invalidArgument for an unknown sort field and bc:invalidFilter). A table has no params. */
  pageSource(ref: RecordSourceRef, req: SourcePageRequest): SourcePage {
    if (ref.kind !== 'table') return pageQuerySource(this.conn(), ref, req, this.queryCtx());
    const d = this.sourceTable(ref.name);
    const db = this.conn();
    const filter = req.filter ?? [];
    const missing = (name: string) => !d.fields.some((x) => sameName(x.name, name));
    if (filter.some((f) => missing(f.field)) || (req.sort ?? []).some((s) => missing(s.field))) throw new Error('bc:notFound');
    try {
      const { rows } = readRows(db, d, { offset: req.offset, limit: req.limit, filter }, this.info.locale, req.sort ?? [], this.writeSeq());
      return { rows: rows.map((r) => r.values), rowids: rows.map((r) => r.rowid), total: countRows(db, d.name, filter, this.info.locale) };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('bc:invalidFilter')) throw new Error('bc:invalidArgument');
      throw e;
    }
  }
  private exportPager(src: ExportSource): (offset: number, limit: number) => SourcePage {
    const { ref, params, sort, filter } = src;
    return (offset, limit) => this.pageSource(ref, { offset, limit, ...(sort ? { sort } : {}), ...(filter ? { filter } : {}), ...(params ? { params } : {}) });
  }
  /** Writes the source (the datasheet's pages: pageSource, with its parameters, sort and filter) to `path`, a path the main
   *  process got from a save dialog. Reads only: allowed on a read-only base. Throws bc:writeFailed; the old file is kept. */
  async exportText(src: ExportSource, spec: ExportTextSpec, path: string, texts: { yes: string; no: string },
    tick?: (done: number, total: number) => Promise<void>): Promise<ExportResult> {
    const { fields } = this.describeSource(src.ref);
    return writeTextExport({ fields, spec, path, tick, texts: { ...texts, info: this.info }, page: this.exportPager(src) });
  }
  /** The rows an export of `src` holds (the main process refuses an Excel export above the sheet limit before asking where). */
  exportRowCount(src: ExportSource): number { return this.exportPager(src)(0, 0).total; }
  /** As exportText, to an .xlsx workbook with one sheet named `sheet`: typed cells, never formulas. A source above the Excel row
   *  limit resolves { ok: false, reason: 'tooManyRows' } and writes nothing. */
  async exportExcel(src: ExportSource, path: string, sheet: string, tick?: (done: number, total: number) => Promise<void>): Promise<ExportResult> {
    const { fields } = this.describeSource(src.ref);
    return writeExcelExport({ fields, path, sheet, tick, info: this.info, page: this.exportPager(src) });
  }
  saveImportSpec(name: string, spec: ImportSpec): void { saveSpec(this.writeDb(), name, spec); }

  /** A3 action queries (src/main/query/action.ts). actionCount only reads; runAction on a read-only base: reason readOnly. */
  actionCount(ref: QueryRef, params: Record<string, CellInput>): { count: number; table: string } { return actionCount(this.conn(), ref, params, this.queryCtx()); }
  async runAction(ref: QueryRef, params: Record<string, CellInput>, opts: RunActionOptions): Promise<ActionResult> {
    let db: DatabaseSync;
    try { db = this.writeDb(); } catch (e) { if (e instanceof ReadOnlyError) return { ok: false, reason: 'readOnly' }; throw e; }
    // it yields between rows (the write layer is async): a total cached meanwhile must not outlive the run
    return runAction(db, ref, params, opts, { ...this.queryCtx(), now: () => new Date() }).finally(() => { this.seq++; });
  }
  deleteImportSpec(name: string): void { deleteSpec(this.writeDb(), name); }

  /** Save As (A6): a checked copy of the base at `target` (the main process then opens it). Reads only: allowed read-only. */
  async saveCopy(target: string, copyDeps: CopyDeps = {}): Promise<void> {
    const lockDeps = this.deps.lockDeps;
    const free = () => {
      const held = peekLock(target, lockDeps);
      if (held && !held.stale) throw new Error('bc:targetInUse'); // another BaseCraft has it open: never replaced under it
    };
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

  /** Compact and Repair (A6): needs the write lock, which it keeps; the handle is closed for the swap, then reopened. */
  async compact(): Promise<CompactResult> {
    this.writeDb();
    try {
      return await compactBase({
        db: () => this.conn(), path: this.path,
        close: () => { this.db?.close(); this.db = null; },
        reopen: () => {
          const db = this.openFile(this.path, 'write', this.deps.appVersion).db;
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
