// Enregistrements d'un formulaire en mode Formulaire (module pur) : lecture par pages de la source, enregistrement courant,
// nouvel enregistrement, écritures par rows.* sur keyTable avec les noms origin.field (contrat A3/A4/A5, section 1.2).
// Les trois vues (formulaire unique, continu, feuille de données) partagent ce contrôleur.
import type { DeleteResult, FieldFilter, RowPage, RowWriteResult } from '../../shared/api';
import type { CellInput, FieldErrorCode, SqlValue } from '../../shared/coerce';
import { defaultProps, sameName } from '../../shared/field-types';
import { toOrigin, type RecordSourceRef, type SortSpec, type SourceField, type SourceInfo, type SourcePage, type SourcePageRequest } from '../../shared/record-source';
import { selectionCriteria } from '../datasheet/filter-model';
import { PageCache } from '../datasheet/page-cache';

export interface FormDataApi {
  describe(ref: RecordSourceRef): Promise<SourceInfo>;
  page(ref: RecordSourceRef, req: SourcePageRequest): Promise<SourcePage>;
  insert(table: string, values: Record<string, CellInput>): Promise<RowWriteResult>;
  update(table: string, rowid: number, changes: Record<string, CellInput>): Promise<RowWriteResult>;
  delete(table: string, rowids: number[]): Promise<DeleteResult>;
}
export interface FormRecordOptions {
  ref: RecordSourceRef | null;   // null = formulaire indépendant : aucun enregistrement, aucune barre de navigation
  locale: string; readOnly: boolean;
  allowAdditions: boolean; allowEdits: boolean; allowDeletions: boolean;
  link?: { childFields: string[]; values: SqlValue[] | null };   // null = maître vide : aucun enregistrement, pas d'ajout
  newRecordValues?: () => Promise<Record<string, CellInput>>;    // valeurs par défaut des contrôles (tâche 7)
  params?: Record<string, CellInput>;                            // valeurs des paramètres de la source, envoyées avec chaque page
  now?: () => Date;
}
export type RecordError = { field: string; code: FieldErrorCode | 'controlValidation' | 'noMaster'; message?: string; table?: string };
export interface RecordSnapshot {
  status: 'loading' | 'ready' | 'error'; error?: unknown;        // rejet de describe/page (la vue l'affiche avec errorMessage)
  info: SourceInfo | null; total: number;
  index: number;                 // 0..total-1 ; total = nouvel enregistrement
  isNew: boolean; values: SqlValue[]; pending: Record<string, CellInput>; dirty: boolean;
  errors: RecordError[]; editable: boolean; canAdd: boolean; canDelete: boolean;
  busy: boolean;                 // un déplacement ou une suppression en cours : rien n'est modifiable entre-temps
  writeError?: unknown;          // dernier rejet de insert/update/delete (la vue l'affiche avec useErrorDialog)
  refused: boolean;              // une écriture rejetée bc:readOnly (verrou perdu) : plus aucune écriture, comme `refused` de DatasheetView
  saves: number;                 // écritures réussies du formulaire lui-même (ses listes sont relues après chacune)
  sort: SortSpec[]; filter: FieldFilter[];
}

type Row = RowPage['rows'][number];

/** The child fields' criteria for a subform: each equal to the master's value (Access's Link Child/Master Fields). */
export function linkFilter(childFields: SourceField[], values: SqlValue[]): FieldFilter[] {
  return childFields.map((f, i) => ({ field: f.name, criteria: selectionCriteria('equals', f, values[i] ?? null) }));
}

/** A field the form can write: it maps to a field of the key table (a computed column cannot). */
export function writableField(f: SourceField, info: SourceInfo): boolean {
  return toOrigin(info, { [f.name]: null }) !== null;
}

/** A typed value that leaves the stored one as it is (blank on null, Yes/No on a number, a number typed as text). */
const same = (a: CellInput, b: SqlValue): boolean =>
  b === null ? a === null || a === '' : typeof a === 'boolean' ? (b !== 0) === a : a !== null && String(a) === String(b);

export class FormRecords {
  private info: SourceInfo | null = null;
  private status: RecordSnapshot['status'] = 'loading';
  private error: unknown;
  private cache: PageCache | null = null;
  private total = 0;
  private counted = false;                // total known: the first page of the current cache has come back
  private pageError: unknown;
  private waiters: { ok: () => void; ko: (e: unknown) => void }[] = [];
  private index = 0;
  private isNew = false;
  private rowid = NaN;
  private values: SqlValue[] = [];
  private pending = Object.create(null) as Record<string, CellInput>; // no prototype: a field may be named __proto__
  private errors: RecordError[] = [];
  private controlErrors: RecordError[] = [];
  private writeError: unknown;
  private refused = false;
  private sort: SortSpec[] = [];
  private filter: FieldFilter[] = [];
  private link: FormRecordOptions['link'];
  private params: FormRecordOptions['params'];
  private declined = false;               // the source's parameters were not given: no rows, no additions
  private hooks: (() => Promise<boolean>)[] = [];
  private listeners = new Set<() => void>();
  private snap: RecordSnapshot | null = null;
  private saving: Promise<boolean> | null = null;
  private writes = 0;                     // inserts and deletes done: a page counted before one has an old total
  private moving = 0;                     // moves under way (place, delete): edits are refused meanwhile
  private nav = 0;                        // the latest move: an earlier one that ends after it changes nothing
  private record = 0;                     // changes each time another record becomes current (a failed move leaves it)
  private keyNames: string[] | null = null;
  private saves = 0;
  private ahead: { keys: string; claimed: boolean } | null = null;   // the user move asked for or under way: keys typed meanwhile
  private aheadDone: ((r: { text: string; applied: boolean }) => void) | null = null;

  constructor(private readonly api: FormDataApi, private readonly opts: FormRecordOptions) {
    this.link = opts.link;
    this.params = opts.params;
  }

  /** `ask`: the source's parameters, asked once before the first page when it has some and no `params` were given. False:
   *  declined (null), the records stay empty with no additions (the view closes, or a subform shows an empty frame). */
  async open(ask?: (p: SourceInfo['parameters']) => Promise<Record<string, CellInput> | null>): Promise<boolean> {
    const ref = this.opts.ref;
    if (!ref) { this.status = 'ready'; this.emit(); return true; }
    try { this.info = await this.api.describe(ref); } catch (e) { this.status = 'error'; this.error = e; this.emit(); return true; }
    if (!this.params && ask && this.info.parameters.length) {
      const values = await ask(this.info.parameters);
      if (values) this.params = values; else this.declined = true;
    }
    this.rebuild();
    await this.place(0);
    return !this.declined;
  }

  /** A subform's link values, by source field: what its new record shows at once (Access), written on insert. */
  get linkDefaults(): Record<string, SqlValue> {
    const l = this.link;
    return l?.values ? Object.fromEntries(l.childFields.map((n, i) => [this.field(n)?.name ?? n, l.values![i] ?? null])) : {};
  }

  /** The parameter values the pages are read with (a filter checked against the source needs them too). */
  get sourceParams(): Record<string, CellInput> | undefined { return this.params; }

  get snapshot(): RecordSnapshot {
    return (this.snap ??= {
      status: this.status, error: this.error, info: this.info, total: this.total, index: this.index, isNew: this.isNew,
      values: this.values, pending: { ...this.pending }, dirty: this.dirty, errors: [...this.errors, ...this.controlErrors],
      editable: this.editable, busy: this.moving > 0, canAdd: this.canAdd, canDelete: this.canDelete, writeError: this.writeError, refused: this.refused, saves: this.saves,
      sort: this.sort, filter: this.filter,
    });
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  row(index: number): SqlValue[] | undefined {
    return this.cache?.get(index)?.values;
  }

  /** False when refused, with no effect; also while busy (the entry would go to the record being left). */
  edit(field: string, input: CellInput): boolean {
    const f = this.field(field);
    if (!f || !this.info || !this.editable || f.type === 'autoNumber' || !writableField(f, this.info)) return false;
    this.pending[f.name] = input;
    this.emit();
    return true;
  }

  undoField(field: string): void {
    const name = this.field(field)?.name ?? field;
    delete this.pending[name];
    const other = (e: RecordError): boolean => !sameName(e.field, name);
    this.errors = this.errors.filter(other);
    this.controlErrors = this.controlErrors.filter(other);
    this.emit();
  }

  undoRecord(): void {
    this.pending = Object.create(null) as Record<string, CellInput>;
    this.errors = [];
    this.controlErrors = [];
    this.emit();
  }

  async goTo(index: number): Promise<boolean> {
    if (!this.info || index < 0 || index > (this.canAdd ? this.total : this.total - 1)) return false;
    return this.userMove(index);
  }
  first(): Promise<boolean> { return this.goTo(0); }
  previous(): Promise<boolean> { return this.goTo(this.index - 1); }
  next(): Promise<boolean> { return this.goTo(this.index + 1); }
  last(): Promise<boolean> { return this.goTo(this.total - 1); }

  async newRecord(): Promise<boolean> {
    if (!this.canAdd) return false;
    return this.userMove(this.total);
  }

  /** Type-ahead (Access): while a move the user asked for (navigation, new record) is under way, the keys typed are kept here
   *  (at most 64 characters), then handed over when it ends: `applied` when the record it was going to is current, else dropped.
   *  False: no such move, the key is not taken. */
  typeAhead(text: string): boolean {
    if (!this.ahead) return false;
    this.ahead.keys = (this.ahead.keys + text).slice(0, 64);
    return true;
  }
  /** Enter, Tab, Escape, a click or another focus: the keys kept so far are dropped and no more are taken for this move. */
  cancelTypeAhead(): void {
    const a = this.ahead;
    this.ahead = null;
    if (a?.keys) this.aheadDone?.({ text: a.keys, applied: false });
  }
  /** The user asked for a move (the view says so at once, before its own checks): keys typed from now on are kept for it. */
  expectMove(): void { this.ahead ??= { keys: '', claimed: false }; }
  /** The move asked for did not begin (refused before it): its keys are dropped. */
  endExpected(): void { if (this.ahead && !this.ahead.claimed) this.cancelTypeAhead(); }
  setTypeAheadHandler(cb: ((r: { text: string; applied: boolean }) => void) | null): void { this.aheadDone = cb; }

  private async userMove(i: number): Promise<boolean> {
    if (this.ahead?.claimed) this.cancelTypeAhead();   // an earlier move overtaken: its keys are dropped
    const ahead = (this.ahead ??= { keys: '', claimed: true });
    ahead.claimed = true;
    let placed: { ok: boolean; tok: number } | null = null;
    try {
      if (await this.leave()) placed = await this.placeAt(i);
      return placed?.ok ?? false;
    } finally {
      if (this.ahead === ahead) {
        this.ahead = null;
        const reached = !!placed?.ok && this.nav === placed.tok && (i < this.total ? this.index === i : this.isNew);
        if (ahead.keys) this.aheadDone?.({ text: ahead.keys, applied: reached });
      }
    }
  }

  /** One save at a time: a call made while one is in flight gets its outcome (never a second insert). */
  save(): Promise<boolean> {
    return (this.saving ??= this.write().finally(() => { this.saving = null; }));
  }

  /** Which record is current: another value each time another record becomes current (a delete asked for one passes it). */
  get currentRecord(): number { return this.record; }

  /** `rec` (currentRecord when the delete was asked for): nothing is deleted once another record is current, or while a move is under way. */
  async deleteCurrent(rec?: number): Promise<DeleteResult | null> {
    if (this.saving) await this.saving; // the save in flight ends on the record it was made for
    if (rec !== undefined && (rec !== this.record || this.moving)) return null;
    if (this.isNew) { this.undoRecord(); return null; }
    const table = this.info?.keyTable;
    if (!table || !this.canDelete) return null;
    this.writeError = undefined;
    this.begin();
    try {
      let r: DeleteResult;
      try { r = await this.api.delete(table, [this.rowid]); } catch (e) { this.rejected(e); return null; }
      if (!r.ok) return r;
      this.total--;
      this.writes++;
      this.invalidate();
      await this.place(Math.max(0, Math.min(this.index, this.total - 1))); // the next record, else the previous one, else the new record
      return r;
    } finally {
      this.end();
    }
  }

  setSort(sort: SortSpec[]): Promise<boolean> { return this.reread(() => { this.sort = sort; }); }
  setFilter(filter: FieldFilter[]): Promise<boolean> { return this.reread(() => { this.filter = filter; }); }
  /** The master's values: the pending record is saved first, under the values it was typed for; refused, they stay (and setLink
   *  is called again once it is saved or undone). */
  setLink(values: SqlValue[] | null): Promise<boolean> {
    return this.reread(() => { this.link = { childFields: this.link?.childFields ?? [], values }; });
  }
  /** Saves first, then reads again from the start; `params`: new parameter values (kept from then on). */
  requery(params?: Record<string, CellInput>): Promise<boolean> {
    return this.reread(() => { if (params) { this.params = params; this.declined = false; } });
  }

  /** The rows read again where the form stands (back on its tab): nothing is saved. A record being edited stays current as it
   *  is, its entry kept (never moved onto another row), and only the count follows; otherwise the same index is placed again,
   *  clamped to the last record (the new record stays the new record). */
  async reload(): Promise<boolean> {
    if (!this.info) return false;
    if (this.saving) await this.saving;
    if (this.dirty) {
      this.rebuild();
      try { await this.rowAt(0); } catch { return false; }   // the count (a failed page shows as the form's error)
      if (this.isNew) this.index = this.total;
      this.emit();
      return true;
    }
    // the same place may now be another record: the subforms are saved first, under the record they were typed for
    for (const h of [...this.hooks]) if (!(await h())) return false;
    const at = this.isNew ? this.total : this.index;
    const isNew = this.isNew;
    this.rebuild();
    return this.place(isNew ? Number.MAX_SAFE_INTEGER : at, !isNew);
  }

  addLeaveHook(fn: () => Promise<boolean>): () => void {
    this.hooks.push(fn);
    return () => { this.hooks = this.hooks.filter((h) => h !== fn); };
  }

  /** The control errors the view set (its controls' own checks), apart from the write's. */
  getControlErrors(): RecordError[] { return this.controlErrors; }

  setControlErrors(errs: RecordError[]): void {
    this.controlErrors = errs;
    this.emit();
  }

  // ---- rights ----

  private get ro(): boolean { return this.opts.readOnly || this.refused; }
  /** A record that exists: not the new record, nor the blank of a source with no records and no additions. */
  private get onRow(): boolean { return !this.isNew && this.index < this.total; }
  private get editable(): boolean {
    const i = this.info;
    return !!i && !this.ro && !this.moving && i.updatable && (this.isNew ? this.opts.allowAdditions : this.opts.allowEdits && this.onRow && !Number.isNaN(this.rowid));
  }
  private get canAdd(): boolean {
    return !!this.info && !this.ro && !this.declined && this.info.updatable && this.opts.allowAdditions && this.link?.values !== null;
  }
  private get canDelete(): boolean {
    return !!this.info && !this.ro && this.info.updatable && this.opts.allowDeletions && this.onRow && !Number.isNaN(this.rowid);
  }
  private get dirty(): boolean {
    return Object.entries(this.pending).some(([k, v]) => !same(v, this.values[this.fieldIndex(k)] ?? null));
  }

  // ---- internals ----

  private emit(): void {
    this.snap = null;
    this.listeners.forEach((cb) => cb());
  }

  private fieldIndex(name: string): number { return this.info?.fields.findIndex((f) => sameName(f.name, name)) ?? -1; }
  private field(name: string): SourceField | undefined { return this.info?.fields[this.fieldIndex(name)]; }

  /** Leave hooks (subforms), then the save of a modified record; false at the first failure, and the record stays current. */
  private async leave(): Promise<boolean> {
    if (this.saving) await this.saving; // even after Esc: it ends on the record it was made for
    for (const h of [...this.hooks]) if (!(await h())) return false;
    while (this.dirty) if (!(await this.save())) return false; // again for what was typed during the save
    return true;
  }

  private async reread(change: () => void): Promise<boolean> {
    if (!(await this.leave())) return false;
    change();
    this.rebuild();
    return this.place(0);
  }

  /** A new page cache for the current source, sort, filter and link (none for an empty master). */
  private rebuild(): void {
    this.flush(); // waiters look again, at the new cache
    this.cache = null;
    this.pageError = undefined;
    this.keyNames = null; // a requery reads the key table's design again
    this.total = 0;
    this.counted = false;
    const ref = this.opts.ref;
    const info = this.info;
    if (!ref || !info) return;
    if (this.link?.values === null || this.declined) { this.counted = true; return; }
    const children = this.link?.childFields.map((n) => this.field(n) ?? { name: n, type: 'shortText' as const, props: defaultProps('shortText') }) ?? [];
    const filter = [...this.filter, ...(this.link?.values ? linkFilter(children, this.link.values) : [])];
    const sort = this.sort;
    const params = this.params;
    const cache: PageCache = new PageCache(async (offset, limit) => {
      const writes = this.writes;
      const p = await this.api.page(ref, { offset, limit, sort: sort.length ? sort : undefined, filter: filter.length ? filter : undefined, ...(params && { params }) });
      // A count made before an insert or a delete is out of date: the local one stands until a later reply.
      if (cache === this.cache && writes === this.writes) { this.total = p.total; this.counted = true; }
      // A row with no key-table rowid (A3) is carried with NaN: it is read-only.
      return { rows: p.rows.map((values, i) => ({ rowid: p.rowids[i] ?? NaN, values })) };
    }, 50);
    cache.onLoaded(() => { if (cache === this.cache) { this.pageError = undefined; this.flush(); this.emit(); } });
    cache.onError((e) => {
      if (cache !== this.cache) return;
      this.pageError = e; this.status = 'error'; this.error = e;
      this.flush(e); this.emit();
    });
    this.cache = cache;
  }

  /** Pages read again on demand, a failed one included (PageCache keeps a failed page until invalidate). */
  private invalidate(): void {
    this.pageError = undefined;
    this.cache?.invalidate();
  }

  private flush(...fail: [unknown?]): void {
    for (const w of this.waiters.splice(0)) if (fail.length) w.ko(fail[0]); else w.ok();
  }

  /** The row at index, read from its page when needed; undefined beyond the end. */
  private async rowAt(i: number): Promise<Row | undefined> {
    for (;;) {
      if (this.pageError !== undefined) throw this.pageError;
      const cache = this.cache;
      if (!cache) return undefined;
      const row = cache.get(i);
      if (cache.fresh(i)) return row;
      await new Promise<void>((ok, ko) => this.waiters.push({ ok, ko }));
    }
  }

  /** Makes the record at i current (from total on: the new record when additions are allowed, else the last one); clears the entry. */
  private async place(i: number, clamp = false): Promise<boolean> {
    return (await this.placeAt(i, clamp)).ok;
  }
  /** place, with the move's token: the record it made current is still current while `nav` is that token. */
  private async placeAt(i: number, clamp = false): Promise<{ ok: boolean; tok: number }> {
    const tok = ++this.nav;
    this.begin();
    try { return { ok: await this.move(tok, i, clamp), tok }; } finally { this.end(); }
  }

  private begin(): void { if (this.moving++ === 0) this.emit(); }
  private end(): void { if (--this.moving === 0) this.emit(); }

  /** clamp: beyond the end, the last record rather than the new record (the new record only when there are none). */
  private async move(tok: number, i: number, clamp = false): Promise<boolean> {
    const target = (): number => (i < this.total ? i : clamp && this.total > 0 ? this.total - 1 : this.canAdd ? this.total : this.total - 1);
    let at = -1;
    let row: Row | undefined;
    try {
      if (this.cache && !this.counted) await this.rowAt(0);
      at = target();
      if (at >= 0 && at < this.total) {
        row = await this.rowAt(at);
        if (!row) { i = this.total - 1; at = target(); row = at >= 0 && at < this.total ? await this.rowAt(at) : undefined; } // shrank meanwhile
      }
    } catch (e) {
      if (tok === this.nav) { this.status = 'error'; this.error = e; this.emit(); }
      return false;
    }
    if (tok !== this.nav) return false;
    this.record++;
    this.index = Math.max(at, 0);
    this.isNew = at >= 0 && at === this.total;
    this.rowid = row?.rowid ?? NaN;
    this.values = row ? row.values : this.isNew ? this.info!.fields.map(() => null) : [];
    this.pending = Object.create(null) as Record<string, CellInput>;
    this.errors = [];
    this.controlErrors = [];
    this.status = 'ready';
    this.error = undefined;
    this.emit();
    return true;
  }

  /** Values named by the source's fields, kept only for fields the form can write, under the source's spelling. */
  private own(values: Record<string, CellInput>): Record<string, CellInput> {
    const out: [string, CellInput][] = [];
    for (const [k, v] of Object.entries(values)) {
      const f = this.field(k);
      if (f && writableField(f, this.info!)) out.push([f.name, v]);
    }
    return Object.fromEntries(out);
  }

  private async write(): Promise<boolean> {
    const info = this.info;
    if (!info || !this.dirty) return true; // an untouched new record is never inserted
    if (this.controlErrors.length || this.ro) return false;
    if (this.isNew && this.link?.values === null) {   // a subform under a master with no values adds nothing: said why
      this.errors = [{ field: this.link.childFields[0] ?? '', code: 'noMaster' }];
      this.emit();
      return false;
    }
    const rec = this.record; // the record this save is for: if another one is current when it ends, it changes nothing shown
    const sent = { ...this.pending };
    const { isNew, rowid } = this;
    let values = sent;
    if (isNew) {
      const link = this.link?.values ? Object.fromEntries(this.link.childFields.map((n, i) => [n, this.link!.values![i] ?? null])) : {};
      let defaults: Record<string, CellInput>;
      try { defaults = (await this.opts.newRecordValues?.()) ?? {}; } catch (e) { if (rec === this.record) this.rejected(e); return false; }
      values = { ...this.own(defaults), ...this.own(link), ...sent };
    }
    const w = toOrigin(info, values);
    if (!w || rec !== this.record) return false;
    this.writeError = undefined;
    let r: RowWriteResult;
    try {
      r = isNew ? await this.api.insert(w.table, w.values) : await this.api.update(w.table, rowid, w.values);
    } catch (e) {
      if (rec === this.record) this.rejected(e); // not on a record that is no longer current
      return false;
    }
    if (rec !== this.record) { if (r.ok) this.done(isNew); this.invalidate(); return r.ok; }
    if (!r.ok) {
      this.errors = r.errors.map((e) => ({ ...e, field: this.sourceName(info, e.field) }));
      this.emit();
      return false;
    }
    const back = await this.readBack(info, r.values, values);
    if (rec !== this.record) { this.done(isNew); this.invalidate(); return true; }
    // Changes typed during the save stay pending, against the record that now exists.
    for (const k of Object.keys(sent)) if (Object.is(this.pending[k], sent[k])) delete this.pending[k];
    this.errors = [];
    this.rowid = r.rowid;
    this.values = back;
    if (isNew) { this.total++; this.isNew = false; } // at the end of the list, as in Access, until the next sort
    this.done(isNew);
    this.invalidate();
    this.cache?.set(this.index, { rowid: r.rowid, values: back });
    this.emit();
    return true;
  }

  /** A write that succeeded: counted (an insert also dates the page totals); emitted by the caller or here. */
  private done(isNew: boolean): void {
    if (isNew) this.writes++;
    this.saves++;
    this.emit();
  }

  /** The written row (the key table's fields, in its order) as the source's values; a computed column keeps its value.
   *  `written`: the values sent, by source field (shown as typed when the key table cannot be described). */
  private async readBack(info: SourceInfo, row: SqlValue[], written: Record<string, CellInput>): Promise<SqlValue[]> {
    if (this.opts.ref?.kind === 'table') return row; // a table source lists the table's own fields, in order
    const keyTable = info.keyTable!;
    try {
      this.keyNames ??= (await this.api.describe({ kind: 'table', name: keyTable })).fields.map((f) => f.name);
    } catch {
      // The write is done: the values sent stand until the next read (a Yes/No as stored, 1 or 0).
      return info.fields.map((f, i) => {
        if (!Object.hasOwn(written, f.name)) return this.values[i] ?? null;
        const v = written[f.name];
        return typeof v === 'boolean' ? Number(v) : v;
      });
    }
    const names = this.keyNames;
    return info.fields.map((f, i) => {
      const j = f.origin && sameName(f.origin.table, keyTable) ? names.findIndex((n) => sameName(n, f.origin!.field)) : -1;
      return j >= 0 ? row[j] : this.values[i] ?? null;
    });
  }

  /** The source field written to a key-table field, for an error the write layer names by origin.field. */
  private sourceName(info: SourceInfo, field: string): string {
    return info.fields.find((f) => f.origin && sameName(f.origin.table, info.keyTable ?? '') && sameName(f.origin.field, field))?.name ?? field;
  }

  private rejected(e: unknown): void {
    this.writeError = e;
    if (/\bbc:readOnly\b/.test(String(e))) this.refused = true;
    this.emit();
  }
}
