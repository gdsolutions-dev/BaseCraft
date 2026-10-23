import { beforeEach, describe, expect, it } from 'vitest';
import type { DeleteResult, RowWriteResult } from '../../shared/api';
import type { CellInput, SqlValue } from '../../shared/coerce';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import type { RecordSourceRef, SourceField, SourceInfo, SourcePageRequest } from '../../shared/record-source';
import { FormRecords, linkFilter, writableField, type FormDataApi, type FormRecordOptions } from './record-controller';

type WriteError = Extract<RowWriteResult, { ok: false }>['errors'][number];

const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField =>
  ({ name, type, props: { ...defaultProps(type), ...props } as FieldProps });
const sfo = (name: string, type: FieldType, table: string, field: string): SourceField => ({ ...sf(name, type), origin: { table, field } });
const infoOf = (table: string, fields: SourceField[]): SourceInfo =>
  ({ fields: fields.map((f) => ({ ...f, origin: f.origin ?? { table, field: f.name } })), updatable: true, keyTable: table, parameters: [] });

const clients = infoOf('Clients', [sf('N°', 'autoNumber'), sf('Nom', 'shortText'), sf('Ville', 'shortText')]);
/** A single-table query: an alias of Clients.Nom, a field of its own name, and a computed column. */
const totaux = (): SourceInfo => ({ fields: [sfo('Client', 'shortText', 'Clients', 'Nom'), sfo('Ville', 'shortText', 'Clients', 'Ville'),
  { name: 'Total', type: 'number', props: defaultProps('number') }], updatable: true, keyTable: 'Clients', parameters: [] });
const queryRows = (): SqlValue[][] => [['Dupont', 'Paris', 10], ['Martin', 'Lyon', 20]];
const commandes = infoOf('Commandes', [sf('N°', 'autoNumber'), sf('Client', 'number'), sf('Qté', 'number'), sf('Montant', 'currency')]);

function fakeApi() {
  let next: { fail?: WriteError; reject?: unknown } | null = null;
  const a = {
    info: clients,
    tables: { Clients: clients } as Record<string, SourceInfo>, // what describe answers for a table ref other than the form's own
    describes: [] as RecordSourceRef[],
    rows: [[1, 'Dupont', 'Paris'], [2, 'Martin', 'Lyon'], [3, 'Durand', 'Nantes']] as SqlValue[][],
    rowids: [1, 2, 3] as (number | null)[],
    calls: [] as string[],
    pages: [] as SourcePageRequest[],
    updates: [] as [string, number, Record<string, CellInput>][],
    inserts: [] as [string, Record<string, CellInput>][],
    deletes: [] as [string, number[]][],
    describeError: undefined as unknown,
    deleteResult: undefined as DeleteResult | undefined,
    get lastPage() { return a.pages[a.pages.length - 1]; },
    failNext(e: WriteError) { next = { fail: e }; },
    rejectNext(e: unknown) { next = { reject: e }; },
  };
  const outcome = (): RowWriteResult | null => {
    const n = next; next = null;
    if (n?.reject) throw n.reject;
    return n?.fail ? { ok: false, errors: [n.fail] } : null;
  };
  const api: FormDataApi = {
    async describe(ref) {
      a.calls.push('describe'); a.describes.push(ref); if (a.describeError) throw a.describeError;
      // The first describe is the form's (open); later ones are the key table's (values read back from a query source).
      return a.describes.length === 1 || ref.kind !== 'table' ? a.info : a.tables[ref.name] ?? a.info;
    },
    async page(_ref, req) {
      a.calls.push('page'); a.pages.push(req);
      return { rows: a.rows.slice(req.offset, req.offset + req.limit), rowids: a.rowids.slice(req.offset, req.offset + req.limit), total: a.rows.length };
    },
    async insert(table, values) {
      a.calls.push('insert'); a.inserts.push([table, values]);
      const r = outcome() ?? { ok: true as const, rowid: 99, values: a.info.fields.map((f) => (values[f.origin?.field ?? f.name] ?? null) as SqlValue) };
      if (r.ok) { a.rows.push(r.values); a.rowids.push(r.rowid); } // the server now counts it
      return r;
    },
    async update(table, rowid, changes) {
      a.calls.push('update'); a.updates.push([table, rowid, changes]);
      const i = a.rowids.indexOf(rowid);
      return outcome() ?? { ok: true, rowid, values: a.info.fields.map((f, j) => (changes[f.origin?.field ?? f.name] ?? a.rows[i]?.[j] ?? null) as SqlValue) };
    },
    async delete(table, rowids) {
      a.calls.push('delete'); a.deletes.push([table, rowids]);
      if (a.deleteResult) return a.deleteResult;
      for (const id of rowids) { const i = a.rowids.indexOf(id); if (i >= 0) { a.rows.splice(i, 1); a.rowids.splice(i, 1); } } // the server forgets them
      return { ok: true, count: rowids.length };
    },
  };
  return Object.assign(a, api);
}

let api: ReturnType<typeof fakeApi>;
beforeEach(() => { api = fakeApi(); });

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
/** The next page read at offset fails once. */
function failPage(offset: number): void {
  const real = api.page;
  api.page = async (ref, req) => { if (req.offset !== offset) return real(ref, req); api.page = real; throw new Error('bc:cannotOpen'); };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** The next call of api[k] waits until the returned function is called (the write is recorded then); later calls answer at once. */
function hold(k: 'update' | 'insert'): () => void {
  const gate = deferred();
  const real = api[k] as (...a: unknown[]) => Promise<RowWriteResult>;
  (api as Record<string, unknown>)[k] = async (...args: unknown[]) => { (api as Record<string, unknown>)[k] = real; await gate.promise; return real(...args); };
  return gate.resolve;
}

async function opened(o: Partial<FormRecordOptions> & { info?: SourceInfo; rows?: SqlValue[][]; rowids?: (number | null)[] } = {}): Promise<FormRecords> {
  const { info, rows, rowids, ...opts } = o;
  if (info) api.info = info;
  if (rows) { api.rows = rows; api.rowids = rows.map((_, i) => i + 1); }
  if (rowids) api.rowids = rowids;
  const ref: RecordSourceRef | null = opts.ref === undefined ? { kind: 'table', name: api.info.keyTable ?? 'T' } : opts.ref;
  const r = new FormRecords(api, { locale: 'fr', readOnly: false, allowAdditions: true, allowEdits: true, allowDeletions: true, ...opts, ref });
  await r.open();
  return r;
}

describe('FormRecords', () => {
  it('opens on first record', async () => { const r = await opened(); expect(r.snapshot).toMatchObject({ status: 'ready', index: 0, total: 3, isNew: false, dirty: false }); });
  it('empty source opens on new record', async () => expect((await opened({ rows: [] })).snapshot).toMatchObject({ index: 0, total: 0, isNew: true }));
  it('empty source without additions shows nothing', async () =>
    expect((await opened({ rows: [], allowAdditions: false })).snapshot).toMatchObject({ index: 0, total: 0, isNew: false, values: [] }));
  it('unbound form', async () => { const r = await opened({ ref: null }); expect(r.snapshot).toMatchObject({ status: 'ready', total: 0, canAdd: false }); expect(api.calls).toEqual([]); });
  it('edit + leave saves', async () => { const r = await opened(); r.edit('Nom', 'Durand'); expect(r.snapshot.dirty).toBe(true);
    expect(await r.goTo(1)).toBe(true); expect(api.updates).toEqual([['Clients', 1, { Nom: 'Durand' }]]); expect(r.snapshot.index).toBe(1); });
  it('saves counts the form own successful writes (lists read again after them)', async () => {
    const r = await opened();
    expect(r.snapshot.saves).toBe(0);
    expect(await r.save()).toBe(true);   // nothing to write
    expect(r.snapshot.saves).toBe(0);
    r.edit('Nom', 'Durand'); expect(await r.next()).toBe(true);
    expect(r.snapshot.saves).toBe(1);
    api.failNext({ field: 'Ville', code: 'validation' });
    r.edit('Ville', 'Zzz'); expect(await r.save()).toBe(false);
    expect(r.snapshot.saves).toBe(1);
    r.undoRecord(); await r.newRecord(); r.edit('Nom', 'Zola'); expect(await r.save()).toBe(true);
    expect(r.snapshot.saves).toBe(2);
  });
  it('failed save stays, keeps pending, exposes errors', async () => { api.failNext({ field: 'Ville', code: 'validation', message: 'Ville connue' });
    const r = await opened(); r.edit('Ville', 'Zzz'); expect(await r.next()).toBe(false);
    expect(r.snapshot).toMatchObject({ index: 0, pending: { Ville: 'Zzz' }, errors: [{ field: 'Ville', code: 'validation', message: 'Ville connue' }] }); });
  it('escape levels', async () => { const r = await opened(); r.edit('Nom', 'x'); r.edit('Ville', 'y'); r.undoField('Nom'); expect(r.snapshot.pending).toEqual({ Ville: 'y' });
    r.undoRecord(); expect(r.snapshot.dirty).toBe(false); });
  it('untouched new record is never inserted', async () => { const r = await opened(); await r.newRecord(); await r.goTo(0); expect(api.inserts).toEqual([]); });
  it('insert merges defaults, link values, pending', async () => { const r = await opened({ info: commandes, rows: [], link: { childFields: ['Client'], values: [2] }, newRecordValues: async () => ({ Qté: '1' }) });
    await r.newRecord(); r.edit('Montant', '10'); await r.save(); expect(api.inserts).toEqual([['Commandes', { Qté: '1', Client: 2, Montant: '10' }]]); });
  it('writes use origin names, computed columns are read-only', async () => {
    const r = await opened({ info: { fields: [sfo('Client', 'shortText', 'Clients', 'Nom'), { name: 'Total', type: 'number', props: defaultProps('number') }], updatable: true, keyTable: 'Clients', parameters: [] } });
    r.edit('Total', '3'); expect(r.snapshot.pending).toEqual({}); r.edit('Client', 'X'); await r.save(); expect(api.updates).toEqual([['Clients', 1, { Nom: 'X' }]]); });
  it("the link values a new record shows (by source field), those of the master's current record", async () => {
    const r = await opened({ info: commandes, rows: [], link: { childFields: ['client'], values: [2] } });
    expect(r.linkDefaults).toEqual({ Client: 2 });
    await r.setLink([3]); expect(r.linkDefaults).toEqual({ Client: 3 });
    await r.setLink(null); expect(r.linkDefaults).toEqual({});
    expect((await opened()).linkDefaults).toEqual({}); });
  it('link filter and null master', async () => { const r = await opened({ info: commandes, link: { childFields: ['Client'], values: null } }); expect(r.snapshot).toMatchObject({ total: 0, canAdd: false });
    await r.setLink([2]); expect(api.lastPage.filter).toContainEqual({ field: 'Client', criteria: '2' }); });
  it('a child record is saved under the master values it was typed for: refused, the old values stay until it is saved', async () => {
    const r = await opened({ info: commandes, rows: [], link: { childFields: ['Client'], values: [1] } });
    await r.newRecord(); r.edit('Montant', '-5');
    api.failNext({ field: 'Montant', code: 'validation' });
    expect(await r.setLink([2])).toBe(false);
    expect(r.snapshot.dirty).toBe(true);
    r.edit('Montant', '5');
    expect(await r.save()).toBe(true);
    expect(api.inserts.map(([, v]) => v.Client)).toEqual([1, 1]);
    expect(await r.setLink([2])).toBe(true);   // then the new values (called again by the view)
    expect(api.lastPage.filter).toContainEqual({ field: 'Client', criteria: '2' });
  });
  it('the master values going to none: the pending child record is saved under the old ones first', async () => {
    const r = await opened({ info: commandes, rows: [], link: { childFields: ['Client'], values: [1] } });
    await r.newRecord(); r.edit('Montant', '5');
    expect(await r.setLink(null)).toBe(true);
    expect(api.inserts.map(([, v]) => v.Client)).toEqual([1]);
    expect(r.snapshot).toMatchObject({ total: 0, canAdd: false, isNew: false });
  });
  it('a new child record with no master values is refused with its reason (a typed error, for the message box)', async () => {
    const r = await opened({ info: commandes, rows: [], link: { childFields: ['Client'], values: [1] } });
    await r.newRecord(); r.edit('Montant', '5');
    (r as unknown as { link: FormRecordOptions['link'] }).link = { childFields: ['Client'], values: null };   // defensive guard: no public path
    expect(await r.save()).toBe(false);
    expect(r.snapshot.errors).toEqual([{ field: 'Client', code: 'noMaster' }]);
    expect(api.inserts).toEqual([]);
  });
  it('a master read again in place (reload) saves its subforms first, under the record they were typed for', async () => {
    const master = await opened();   // Clients 1 Dupont, 2 Martin, 3 Durand
    const capi = fakeApi();
    capi.info = commandes; capi.rows = []; capi.rowids = [];
    const child = new FormRecords(capi, { ref: { kind: 'table', name: 'Commandes' }, locale: 'fr', readOnly: false, allowAdditions: true, allowEdits: true,
      allowDeletions: true, link: { childFields: ['Client'], values: [1] } });
    await child.open();
    await child.newRecord(); child.edit('Montant', '7');
    let shown: unknown;
    master.addLeaveHook(async () => { shown = master.snapshot.values[0]; return child.save(); });
    api.rows.shift(); api.rowids.shift();   // Dupont deleted elsewhere: the same place is now Martin
    expect(await master.reload()).toBe(true);
    expect(shown).toBe(1);
    expect(capi.inserts.map(([, v]) => v.Client)).toEqual([1]);
    expect(master.snapshot.values[1]).toBe('Martin');
  });
  it('a reload refused by a subform stays where it is', async () => {
    const master = await opened();
    master.addLeaveHook(async () => false);
    api.rows.shift(); api.rowids.shift();
    expect(await master.reload()).toBe(false);
    expect(master.snapshot.values[1]).toBe('Dupont');
  });
  it('link filter literals', () => { expect(linkFilter([sf('Client', 'number')], [2])).toEqual([{ field: 'Client', criteria: '2' }]);
    expect(linkFilter([sf('Code', 'shortText')], ["O'Brien \"x\""])).toEqual([{ field: 'Code', criteria: '"O\'Brien ""x"""' }]); });
  it('leave hooks run first and can veto', async () => { const r = await opened(); r.addLeaveHook(async () => false); expect(await r.goTo(1)).toBe(false); expect(r.snapshot.index).toBe(0); });
  it('rights', async () => { expect((await opened({ allowEdits: false })).snapshot.editable).toBe(false); expect((await opened({ readOnly: true })).snapshot.canAdd).toBe(false);
    const r = await opened({ allowEdits: false }); r.edit('Nom', 'x'); expect(r.snapshot.dirty).toBe(false); });
  it('autonumber not editable', async () => { const r = await opened(); r.edit('N°', '9'); expect(r.snapshot.pending).toEqual({}); });
  it('delete related refusal is returned', async () => { api.deleteResult = { ok: false, reason: 'related', table: 'Commandes' };
    expect(await (await opened()).deleteCurrent()).toEqual({ ok: false, reason: 'related', table: 'Commandes' }); });
  it('describe failure = error status', async () => { api.describeError = new Error('bc:notImplemented'); const s = (await opened()).snapshot;
    expect(s.status).toBe('error'); expect(String(s.error)).toContain('bc:notImplemented'); });
  it('concurrent saves share one call', async () => { const r = await opened(); r.edit('Nom', 'x');
    expect(await Promise.all([r.save(), r.save()])).toEqual([true, true]); expect(api.updates).toHaveLength(1); });
  it('requery saves first, then reads again from the start', async () => { const r = await opened(); await r.goTo(1); r.edit('Nom', 'x'); api.pages.length = 0;
    expect(await r.requery()).toBe(true); expect(api.updates).toEqual([['Clients', 2, { Nom: 'x' }]]);
    expect(api.pages[0]).toMatchObject({ offset: 0 }); expect(r.snapshot.index).toBe(0); });
  it('a rejected write keeps the entry; bc:readOnly stops writes', async () => { const r = await opened(); api.rejectNext(new Error('bc:readOnly')); r.edit('Nom', 'x');
    expect(await r.save()).toBe(false);
    expect(r.snapshot).toMatchObject({ pending: { Nom: 'x' }, refused: true, editable: false, canAdd: false, canDelete: false });
    expect(String(r.snapshot.writeError)).toContain('bc:readOnly'); });
  it('a row without rowid (A3) is read-only', async () => { const r = await opened({ rowids: [null, 2, 3] }); expect(r.snapshot.editable).toBe(false);
    r.edit('Nom', 'x'); expect(r.snapshot.dirty).toBe(false); });

  // Beyond the brief's list: the paths the brief describes and the list above does not reach.
  it('a saved update shows the values read back and clears the entry', async () => { const r = await opened(); r.edit('Nom', 'Leroy');
    expect(await r.save()).toBe(true); expect(r.snapshot).toMatchObject({ values: [1, 'Leroy', 'Paris'], pending: {}, dirty: false }); });
  it('an insert lands at the end and counts one more record', async () => { const r = await opened(); await r.newRecord();
    expect(r.snapshot).toMatchObject({ index: 3, isNew: true, values: [null, null, null] });
    r.edit('Nom', 'Petit'); expect(await r.save()).toBe(true);
    expect(api.inserts).toEqual([['Clients', { Nom: 'Petit' }]]); expect(r.snapshot).toMatchObject({ index: 3, total: 4, isNew: false, values: [null, 'Petit', null] }); });
  it('write errors name the source field, not the origin field', async () => {
    const r = await opened({ info: { fields: [sfo('N°', 'autoNumber', 'Clients', 'N°'), sfo('Client', 'shortText', 'Clients', 'Nom')], updatable: true, keyTable: 'Clients', parameters: [] } });
    api.failNext({ field: 'Nom', code: 'required' }); r.edit('Client', ''); expect(await r.save()).toBe(false);
    expect(r.snapshot.errors).toEqual([{ field: 'Client', code: 'required' }]); });
  it('control errors block the save without a call', async () => { const r = await opened(); r.edit('Nom', 'x');
    r.setControlErrors([{ field: 'Nom', code: 'controlValidation', message: 'non' }]); expect(await r.save()).toBe(false); expect(api.updates).toEqual([]);
    r.undoField('Nom'); expect(r.snapshot.errors).toEqual([]); });
  it('delete moves to the next record, then the previous one, then the new record', async () => { const r = await opened();
    await r.goTo(1);
    expect(await r.deleteCurrent()).toEqual({ ok: true, count: 1 }); expect(api.deletes).toEqual([['Clients', [2]]]);
    expect(r.snapshot).toMatchObject({ index: 1, total: 2, values: [3, 'Durand', 'Nantes'] });
    await r.deleteCurrent(); expect(r.snapshot).toMatchObject({ index: 0, total: 1, values: [1, 'Dupont', 'Paris'] });
    await r.deleteCurrent(); expect(r.snapshot).toMatchObject({ index: 0, total: 0, isNew: true }); });
  it('nothing to delete on a new record', async () => { const r = await opened(); await r.newRecord(); expect(await r.deleteCurrent()).toBeNull(); expect(api.deletes).toEqual([]); });
  it('a rejected delete sets writeError and refused', async () => { const r = await opened(); api.delete = async () => { throw new Error('bc:readOnly'); };
    expect(await r.deleteCurrent()).toBeNull(); expect(r.snapshot).toMatchObject({ refused: true, canDelete: false }); });
  it('sort and filter are sent with the pages, bounded navigation', async () => { const r = await opened();
    await r.setSort([{ field: 'Nom', dir: 'desc' }]); await r.setFilter([{ field: 'Ville', criteria: '"Lyon"' }]);
    expect(api.lastPage).toMatchObject({ offset: 0, limit: 50, sort: [{ field: 'Nom', dir: 'desc' }], filter: [{ field: 'Ville', criteria: '"Lyon"' }] });
    expect(await r.previous()).toBe(false); expect(await r.last()).toBe(true); expect(r.snapshot.index).toBe(2);
    expect(await r.next()).toBe(true); expect(r.snapshot.isNew).toBe(true); expect(await r.first()).toBe(true); expect(r.snapshot.index).toBe(0); });
  it('row() serves cached rows for continuous views', async () => { const r = await opened(); expect(r.row(2)).toEqual([3, 'Durand', 'Nantes']); expect(r.row(3)).toBeUndefined(); });
  it('a page failure after opening = error status', async () => { const r = await opened(); api.page = async () => { throw new Error('bc:notFound'); };
    expect(await r.requery()).toBe(false); expect(String(r.snapshot.error)).toContain('bc:notFound'); });
  it('a source that is not updatable is read-only', async () => {
    const r = await opened({ ref: { kind: 'query', name: 'Totaux' }, info: { ...clients, updatable: false } });
    expect(r.snapshot).toMatchObject({ editable: false, canAdd: false }); r.edit('Nom', 'x'); expect(r.snapshot.dirty).toBe(false); });
  it('an aliased single-table query writes the origin field', async () => {
    const r = await opened({ ref: { kind: 'query', name: 'Clients Q' }, info: { fields: [sfo('Client', 'shortText', 'Clients', 'Nom')], updatable: true, keyTable: 'Clients', parameters: [] } });
    r.edit('Client', 'X'); expect(await r.save()).toBe(true); expect(api.updates).toEqual([['Clients', 1, { Nom: 'X' }]]); });
  it('a row with a null rowid from a query is read-only', async () => {
    const r = await opened({ ref: { kind: 'sql', sql: 'SELECT Nom FROM Clients' }, rowids: [null, null, null] });
    expect(r.snapshot.editable).toBe(false); });
  it('params go with every page', async () => { const r = await opened({ params: { 'Saisir le client :': '2' } }); await r.setSort([{ field: 'Nom', dir: 'asc' }]);
    expect(api.pages.length).toBeGreaterThan(1); expect(api.pages.every((p) => p.params?.['Saisir le client :'] === '2')).toBe(true); });
  it('requery with new params saves first, then reads from index 0', async () => { const r = await opened({ params: { p: '1' } }); await r.goTo(1); r.edit('Nom', 'x'); api.pages.length = 0;
    expect(await r.requery({ p: '2' })).toBe(true); expect(api.updates).toHaveLength(1);
    expect(api.pages[0]).toMatchObject({ offset: 0, params: { p: '2' } }); expect(r.snapshot.index).toBe(0); });
  it('open asks the source parameters once, before the first page; declined: no rows, no additions, no page', async () => {
    api.info = { ...clients, parameters: [{ name: 'p', type: 'number' }] };
    const ask = async (ps: SourceInfo['parameters']) => { api.calls.push(`ask ${ps.map((x) => x.name).join()}`); return { p: '1' }; };
    const r = new FormRecords(api, { ref: { kind: 'query', name: 'Q' }, locale: 'fr', readOnly: false, allowAdditions: true, allowEdits: true, allowDeletions: true });
    expect(await r.open(ask)).toBe(true);
    expect(api.calls).toEqual(['describe', 'ask p', 'page']); expect(api.lastPage.params).toEqual({ p: '1' });
    api.calls.length = 0;
    const d = new FormRecords(api, { ref: { kind: 'query', name: 'Q' }, locale: 'fr', readOnly: false, allowAdditions: true, allowEdits: true, allowDeletions: true, link: { childFields: ['Nom'], values: null } });
    expect(await d.open(async () => null)).toBe(false);
    await d.setLink(['Dupont']);
    expect(d.snapshot).toMatchObject({ status: 'ready', total: 0, isNew: false, canAdd: false, editable: false });
    expect(api.calls).toEqual(['describe']);
    expect(await d.newRecord()).toBe(false);
  });
  it('no parameters: open never asks', async () => {
    const r = new FormRecords(api, { ref: { kind: 'table', name: 'Clients' }, locale: 'fr', readOnly: false, allowAdditions: true, allowEdits: true, allowDeletions: true });
    expect(await r.open(async () => { throw new Error('asked'); })).toBe(true); expect(r.snapshot.total).toBe(3); expect(api.lastPage.params).toBeUndefined(); });
  it('writableField follows toOrigin', () => { expect(writableField(clients.fields[1], clients)).toBe(true);
    expect(writableField({ name: 'Total', type: 'number', props: defaultProps('number') }, clients)).toBe(false); });
});

describe('FormRecords: races (fix round 1)', () => {
  it('a save that ends after Esc and a move does not write into the next record', async () => {
    const r = await opened(); const release = hold('update'); r.edit('Nom', 'x');
    const s = r.save(); r.undoRecord(); const n = r.next(); release();
    expect(await s).toBe(true); expect(await n).toBe(true);
    expect(r.snapshot).toMatchObject({ index: 1, values: [2, 'Martin', 'Lyon'] });
    r.edit('Ville', 'Lille'); await r.save(); expect(api.updates).toEqual([['Clients', 1, { Nom: 'x' }], ['Clients', 2, { Ville: 'Lille' }]]);
  });
  it('a delete waits for the save in flight', async () => {
    const r = await opened(); const release = hold('update'); r.edit('Nom', 'x');
    const s = r.save(); const d = r.deleteCurrent(); release(); await s;
    expect(await d).toEqual({ ok: true, count: 1 }); expect(api.calls.slice(2)).toEqual(['update', 'delete', 'page']);
    expect(r.snapshot).toMatchObject({ index: 0, total: 2, values: [2, 'Martin', 'Lyon'] });
  });
  it('an insert that ends after Esc and a move counts the new record, not the record shown', async () => {
    const r = await opened(); await r.newRecord(); const release = hold('insert'); r.edit('Nom', 'Petit');
    const s = r.save(); r.undoRecord(); const g = r.goTo(0); release(); await s; expect(await g).toBe(true);
    expect(r.snapshot).toMatchObject({ index: 0, total: 4, isNew: false, values: [1, 'Dupont', 'Paris'] });
  });
  it('an edit typed during the save of a move is saved too before moving', async () => {
    const r = await opened(); const release = hold('update'); r.edit('Nom', 'x');
    const g = r.goTo(1); await tick(); r.edit('Ville', 'y'); release();
    expect(await g).toBe(true); expect(api.updates).toEqual([['Clients', 1, { Nom: 'x' }], ['Clients', 1, { Ville: 'y' }]]); expect(r.snapshot.index).toBe(1);
  });
  it('an edit typed while a move reads its page is refused, never taken then dropped', async () => {
    const r = await opened(); const gate = deferred(); const real = api.page;
    api.page = async (...a: Parameters<typeof real>) => { await gate.promise; return real(...a); };
    const m = r.setSort([{ field: 'Nom', dir: 'asc' }]); await tick();
    expect(r.edit('Nom', 'x')).toBe(false); expect(r.snapshot.pending).toEqual({});
    gate.resolve(); expect(await m).toBe(true); expect(r.snapshot).toMatchObject({ index: 0, pending: {}, dirty: false });
    expect(r.edit('Nom', 'x')).toBe(true);
  });
  it('a page reply sent before an insert does not bring back the old count', async () => {
    const r = await opened(); const gate = deferred(); const real = api.page;
    api.page = async (ref, req) => { const p = await real(ref, req); if (req.offset === 50) await gate.promise; return p; }; // counted before the insert
    r.row(50); await r.newRecord(); r.edit('Nom', 'Petit'); expect(await r.save()).toBe(true);
    gate.resolve(); await tick();
    expect(r.edit('Nom', 'Grand')).toBe(true); expect(r.snapshot).toMatchObject({ index: 3, total: 4, isNew: false, editable: true });
  });
  it('a rejected newRecordValues is a write error, nothing is inserted', async () => {
    const r = await opened({ newRecordValues: async () => { throw new Error('bc:invalidArgument'); } });
    await r.newRecord(); r.edit('Nom', 'x'); expect(await r.save()).toBe(false);
    expect(api.inserts).toEqual([]); expect(r.snapshot).toMatchObject({ pending: { Nom: 'x' }, refused: false });
    expect(String(r.snapshot.writeError)).toContain('bc:invalidArgument');
  });
  it('values read back fall back to the entry when the key table cannot be described', async () => {
    const r = await opened({ ref: { kind: 'query', name: 'Q' }, info: totaux(), rows: queryRows() });
    api.describe = async () => { throw new Error('bc:notFound'); };
    api.update = async (_t, rowid) => ({ ok: true, rowid, values: [1, 'X', 'Paris'] });
    r.edit('Client', 'X'); expect(await r.save()).toBe(true);
    expect(r.snapshot).toMatchObject({ values: ['X', 'Paris', 10], dirty: false });
  });
  it('a requery describes the key table again (its design may have changed)', async () => {
    const r = await opened({ ref: { kind: 'query', name: 'Q' }, info: totaux(), rows: queryRows() });
    api.update = async (_t, rowid) => ({ ok: true, rowid, values: [1, 'X', 'Paris'] });
    r.edit('Client', 'X'); await r.save(); expect(r.snapshot.values).toEqual(['X', 'Paris', 10]);
    api.tables.Clients = infoOf('Clients', [sf('Ville', 'shortText'), sf('Nom', 'shortText'), sf('N°', 'autoNumber')]); // fields reordered
    api.update = async (_t, rowid) => ({ ok: true, rowid, values: ['Lyon', 'Y', 1] });
    expect(await r.requery()).toBe(true); r.edit('Client', 'Y'); await r.save();
    expect(r.snapshot.values).toEqual(['Y', 'Lyon', 10]); expect(api.describes.filter((d) => d.kind === 'table')).toHaveLength(2);
  });
  it('a failed page no longer blocks moves once the cache is invalidated', async () => {
    const r = await opened(); failPage(50);
    r.row(50); await tick(); expect(r.snapshot.status).toBe('error');
    r.edit('Nom', 'x'); expect(await r.save()).toBe(true);
    expect(await r.goTo(1)).toBe(true); expect(r.snapshot).toMatchObject({ status: 'ready', index: 1 });
  });
  it('a failed page no longer blocks moves once another page loads', async () => {
    const r = await opened(); failPage(50);
    r.row(50); await tick(); expect(r.snapshot.status).toBe('error');
    r.row(100); await tick(); expect(await r.goTo(1)).toBe(true); expect(r.snapshot).toMatchObject({ status: 'ready', index: 1 });
  });
});

describe('FormRecords: API calls (fix round 1)', () => {
  it('edit + leave: describe, page, update, page', async () => { const r = await opened(); r.edit('Nom', 'x'); await r.goTo(1);
    expect(api.calls).toEqual(['describe', 'page', 'update', 'page']); });
  it('new record + save: one insert', async () => { const r = await opened(); await r.newRecord(); r.edit('Nom', 'x'); await r.save();
    expect(api.calls).toEqual(['describe', 'page', 'insert']); });
  it('read-only: no write call', async () => { const r = await opened({ readOnly: true }); r.edit('Nom', 'x');
    expect(await r.save()).toBe(true); expect(await r.next()).toBe(true); expect(await r.deleteCurrent()).toBeNull(); expect(await r.newRecord()).toBe(false);
    expect(api.calls).toEqual(['describe', 'page']); });
  it('refused: no further write call', async () => { const r = await opened(); api.rejectNext(new Error('bc:readOnly')); r.edit('Nom', 'x'); await r.save();
    expect(await r.save()).toBe(false); expect(await r.next()).toBe(false); expect(await r.deleteCurrent()).toBeNull();
    expect(api.calls).toEqual(['describe', 'page', 'update']); });
  it('a query source: the written row is mapped back through the key table, a computed column keeps its value', async () => {
    const r = await opened({ ref: { kind: 'query', name: 'Q' }, info: totaux(), rows: queryRows() });
    api.update = async (t, rowid, changes) => { api.updates.push([t, rowid, changes]); return { ok: true, rowid, values: [1, 'X', 'Paris'] }; };
    r.edit('Client', 'X'); expect(await r.save()).toBe(true);
    expect(api.updates).toEqual([['Clients', 1, { Nom: 'X' }]]);
    expect(api.describes).toEqual([{ kind: 'query', name: 'Q' }, { kind: 'table', name: 'Clients' }]);
    expect(r.snapshot.values).toEqual(['X', 'Paris', 10]);
    api.update = async (_t, rowid) => ({ ok: true, rowid, values: [1, 'X', 'Lyon'] });
    r.edit('Ville', 'Lyon'); await r.save(); expect(r.snapshot.values).toEqual(['X', 'Lyon', 10]); expect(api.describes).toHaveLength(2); // described once
  });
});

describe('FormRecords: moves (fix round 2)', () => {
  /** A move that does not wait for the save in flight (no public one can): the record token is what protects the save then. */
  const priv = (r: FormRecords) => r as unknown as { place(i: number): Promise<boolean>; invalidate(): void };
  it('busy during a move or a delete: nothing is editable meanwhile', async () => {
    const r = await opened(); const gate = deferred(); const real = api.page;
    api.page = async (...a: Parameters<typeof real>) => { await gate.promise; return real(...a); };
    const m = r.requery(); await tick(); expect(r.snapshot).toMatchObject({ busy: true, editable: false });
    gate.resolve(); expect(await m).toBe(true); expect(r.snapshot).toMatchObject({ busy: false, editable: true });
    const del = deferred(); const realDelete = api.delete; api.delete = async (...a: Parameters<typeof realDelete>) => { await del.promise; return realDelete(...a); };
    const d = r.deleteCurrent(); await tick(); expect(r.snapshot).toMatchObject({ busy: true, editable: false });
    del.resolve(); await d; expect(r.snapshot).toMatchObject({ busy: false, editable: true });
  });
  it('a delete asked for one record (its token) deletes nothing once another is current, or while a move is under way', async () => {
    const r = await opened(); const asked = r.currentRecord;
    await r.goTo(1); expect(await r.deleteCurrent(asked)).toBeNull(); expect(api.deletes).toEqual([]);
    const gate = deferred(); const real = api.page;
    api.page = async (...a: Parameters<typeof real>) => { await gate.promise; return real(...a); };
    const tok = r.currentRecord; const m = r.requery(); await tick();
    expect(await r.deleteCurrent(tok)).toBeNull(); expect(api.deletes).toEqual([]);
    gate.resolve(); await m; api.page = real;
    expect(await r.deleteCurrent(r.currentRecord)).toEqual({ ok: true, count: 1 }); expect(api.deletes).toEqual([['Clients', [1]]]);
  });
  it('a failed move keeps the record token: the save in flight still lands on its record', async () => {
    const r = await opened(); const release = hold('update'); r.edit('Nom', 'x'); const s = r.save(); await tick();
    priv(r).invalidate(); failPage(0); expect(await priv(r).place(1)).toBe(false);
    release(); expect(await s).toBe(true);
    expect(r.snapshot).toMatchObject({ index: 0, values: [1, 'x', 'Paris'], pending: {}, dirty: false });
  });
  it('a write rejected after another record became current sets neither writeError nor refused', async () => {
    const r = await opened(); api.rejectNext(new Error('bc:readOnly')); const release = hold('update'); r.edit('Nom', 'x'); const s = r.save(); await tick();
    expect(await priv(r).place(1)).toBe(true); release(); expect(await s).toBe(false);
    expect(r.snapshot).toMatchObject({ index: 1, refused: false, writeError: undefined });
  });
});

describe('reload (back on the tab)', () => {
  it('reads the rows again and places the same index; nothing is saved', async () => {
    const r = await opened(); await r.goTo(1);
    api.rows.splice(1, 0, [4, 'Arnaud', 'Lille']); api.rowids.splice(1, 0, 4);   // added elsewhere
    expect(await r.reload()).toBe(true);
    expect(r.snapshot).toMatchObject({ index: 1, total: 4, values: [4, 'Arnaud', 'Lille'], dirty: false });
    expect(api.updates).toEqual([]);
  });
  it('clamps the index to the last record when rows went', async () => {
    const r = await opened(); await r.goTo(2);
    api.rows.splice(2, 1); api.rowids.splice(2, 1);
    expect(await r.reload()).toBe(true);
    expect(r.snapshot).toMatchObject({ index: 1, total: 2, isNew: false, values: [2, 'Martin', 'Lyon'] });
  });
  it('the new record stays the new record', async () => {
    const r = await opened(); await r.newRecord();
    expect(await r.reload()).toBe(true);
    expect(r.snapshot).toMatchObject({ isNew: true, index: 3, total: 3 });
  });
  it('a record being edited stays as it is, its entry kept and unsaved; the count follows', async () => {
    const r = await opened(); r.edit('Nom', 'X');
    api.rows.push([4, 'Arnaud', 'Lille']); api.rowids.push(4);
    expect(await r.reload()).toBe(true);
    expect(r.snapshot).toMatchObject({ index: 0, total: 4, pending: { Nom: 'X' }, dirty: true, values: [1, 'Dupont', 'Paris'] });
    expect(api.updates).toEqual([]);
    await r.save();
    expect(api.updates).toEqual([['Clients', 1, { Nom: 'X' }]]);
  });
});

describe('type-ahead (keys typed while a move asked by the user is under way)', () => {
  const results = (r: FormRecords) => { const got: { text: string; applied: boolean }[] = []; r.setTypeAheadHandler((x) => got.push(x)); return got; };
  it('nothing is taken outside a user move', async () => {
    const r = await opened(); const got = results(r);
    expect(r.typeAhead('a')).toBe(false);
    await r.requery(); expect(got).toEqual([]);
  });
  it('kept for the record reached: the new record, the next record (while the record left is saved)', async () => {
    const r = await opened(); const got = results(r); let release = hold('update'); r.edit('Nom', 'x');
    const g = r.newRecord(); await tick();
    expect(r.typeAhead('D')).toBe(true); expect(r.typeAhead('u')).toBe(true); release();
    expect(await g).toBe(true); expect(got).toEqual([{ text: 'Du', applied: true }]); expect(r.snapshot.isNew).toBe(true);
    expect(r.typeAhead('z')).toBe(false);   // over once the move ends
    await r.goTo(0); release = hold('update'); r.edit('Nom', 'y');
    const n = r.next(); await tick(); r.typeAhead('M'); release();
    expect(await n).toBe(true); expect(got[1]).toEqual({ text: 'M', applied: true }); expect(r.snapshot.index).toBe(1);
  });
  it('dropped when the move is refused, overtaken by another move, or stopped (Enter, Tab, Escape, a click)', async () => {
    const r = await opened(); const got = results(r);
    r.addLeaveHook(async () => false);
    const refused = r.goTo(1); r.typeAhead('a'); expect(await refused).toBe(false);
    expect(got).toEqual([{ text: 'a', applied: false }]);
    const r2 = await opened(); const got2 = results(r2); const release = hold('update'); r2.edit('Nom', 'x');
    const first = r2.goTo(1); await tick(); r2.typeAhead('b');
    const second = r2.goTo(2); release(); await Promise.all([first, second]);
    expect(got2).toEqual([{ text: 'b', applied: false }]); expect(r2.snapshot.index).toBe(2);
    const g = r2.next(); r2.typeAhead('c'); r2.cancelTypeAhead(); expect(r2.typeAhead('d')).toBe(false); await g;
    expect(got2).toEqual([{ text: 'b', applied: false }, { text: 'c', applied: false }]);
  });
  it('a move overtaken by a non-user move (requery) drops its keys', async () => {
    const r = await opened(); const got = results(r); const release = hold('update'); r.edit('Nom', 'x');
    const g = r.goTo(1); await tick(); r.typeAhead('e');
    const q = r.requery(); release(); await Promise.all([g, q]);
    expect(got).toEqual([{ text: 'e', applied: false }]);
  });
  it('expected by the view before the move begins: kept for it, or dropped when it never begins', async () => {
    const r = await opened(); const got = results(r);
    r.expectMove(); expect(r.typeAhead('Z')).toBe(true);
    await r.newRecord(); expect(got).toEqual([{ text: 'Z', applied: true }]);
    r.endExpected(); expect(got).toHaveLength(1);   // already handed over
    r.expectMove(); r.typeAhead('Y'); r.endExpected();
    expect(got[1]).toEqual({ text: 'Y', applied: false }); expect(r.typeAhead('X')).toBe(false);
  });
  it('at most 64 characters are kept', async () => {
    const r = await opened(); const got = results(r);
    const g = r.newRecord(); for (let i = 0; i < 70; i++) r.typeAhead('x'); await g;
    expect(got[0].text).toHaveLength(64);
  });
});
