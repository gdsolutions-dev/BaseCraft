import type { RowWriteResult } from '../../shared/api';
import { RowBuffer } from './row-buffer';

const deferred = () => {
  let resolve!: (r: RowWriteResult) => void;
  const promise = new Promise<RowWriteResult>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('RowBuffer', () => {
  it('lookedUp shows the parent values without making them pending, and drops pending edits of those fields (B4 R4)', () => {
    const b = new RowBuffer(vi.fn());
    b.edit(0, 3, 'Nom', 'x'); b.edit(0, 3, 'Client', 2);
    b.lookedUp(0, { Nom: 'Martin' });
    expect(b.pending).toEqual({ rowIndex: 0, rowid: 3, changes: { Client: 2 } });
    expect(b.looked).toEqual({ Nom: 'Martin' });
    b.lookedUp(1, { Nom: 'Durand' }); // another row: ignored
    expect(b.looked).toEqual({ Nom: 'Martin' });
    b.edit(0, 3, 'Nom', 'Martin SA'); // typed after the lookup: pending again, shown over the looked-up value
    expect(b.pending?.changes).toEqual({ Client: 2, Nom: 'Martin SA' });
    b.discard();
    expect(b.looked).toEqual({}); // the row goes, its looked-up values too
  });

  it('lookedUp keeps an edit typed while the lookup was in flight (only the edits sent with it go)', () => {
    const b = new RowBuffer(vi.fn());
    b.edit(0, 3, 'Nom', 'x'); b.edit(0, 3, 'Client', 2);
    const sent = b.pending!.changes; // when the lookup is asked
    b.edit(0, 3, 'Nom', 'y'); b.edit(0, 3, 'Ville', 'Nice'); // typed before its answer
    b.lookedUp(0, { Nom: 'Martin', Ville: 'LYON' }, sent);
    expect(b.pending?.changes).toEqual({ Client: 2, Nom: 'y', Ville: 'Nice' });
  });

  it('row buffer saves when leaving a modified row', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, rowid: 7, values: [] }); const b = new RowBuffer(save);
    b.edit(3, null, 'Nom', 'A'); b.edit(3, null, 'Ville', 'B');
    expect(await b.leaveRow(3)).toEqual({ status: 'none' });
    expect(await b.leaveRow(4)).toMatchObject({ status: 'saved', rowid: 7 });
    expect(save).toHaveBeenCalledWith(null, { Nom: 'A', Ville: 'B' }); expect(b.pending).toBeNull();
  });

  it('failed save keeps pending; discard clears', async () => {
    const b = new RowBuffer(vi.fn().mockResolvedValue({ ok: false, errors: [{ field: 'Nom', code: 'required' }] }));
    b.edit(0, null, 'Nom', '');
    expect(await b.leaveRow(1)).toEqual({ status: 'failed', errors: [{ field: 'Nom', code: 'required' }] });
    expect(b.pending).not.toBeNull(); b.discard(); expect(b.pending).toBeNull();
  });

  it('an existing row is updated with its rowid; nothing pending commits nothing', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, rowid: 12, values: [12, 'X'] });
    const b = new RowBuffer(save);
    expect(await b.commit()).toEqual({ status: 'none' });
    b.edit(5, 12, 'Nom', 'X');
    expect(await b.commit()).toEqual({ status: 'saved', rowid: 12, values: [12, 'X'] });
    expect(save).toHaveBeenCalledWith(12, { Nom: 'X' });
  });

  it('commits are serialized: a fast double Enter saves the row once', async () => {
    const d = deferred();
    const save = vi.fn().mockReturnValue(d.promise);
    const b = new RowBuffer(save);
    b.edit(3, null, 'Nom', 'A');
    const first = b.leaveRow(4);
    const second = b.leaveRow(5);
    const third = b.commit();
    d.resolve({ ok: true, rowid: 9, values: [] });
    expect(await first).toMatchObject({ status: 'saved', rowid: 9 });
    expect(await second).toBe(await first);
    expect(await third).toBe(await first);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await b.commit()).toEqual({ status: 'none' }); // after the save: nothing left, no second insert
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('an edit made during the save stays pending, as an update of the new row', async () => {
    const d = deferred();
    const save = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue({ ok: true, rowid: 9, values: [] });
    const b = new RowBuffer(save);
    b.edit(3, null, 'Nom', 'A');
    const out = b.commit();
    b.edit(3, null, 'Ville', 'B');
    b.edit(3, null, 'Nom', 'A2'); // the field just sent, typed again
    expect(b.pending?.changes).toEqual({ Nom: 'A2', Ville: 'B' });
    d.resolve({ ok: true, rowid: 9, values: [] });
    await out;
    expect(b.pending).toEqual({ rowIndex: 3, rowid: 9, changes: { Nom: 'A2', Ville: 'B' } });
    await b.commit();
    expect(save).toHaveBeenLastCalledWith(9, { Nom: 'A2', Ville: 'B' });
    expect(b.pending).toBeNull();
  });

  it('a rejected save keeps everything pending and rejects', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('bc:readOnly')).mockResolvedValue({ ok: true, rowid: 1, values: [] });
    const b = new RowBuffer(save);
    b.edit(0, null, 'Nom', 'A');
    await expect(b.commit()).rejects.toThrow('bc:readOnly');
    expect(b.pending).toEqual({ rowIndex: 0, rowid: null, changes: { Nom: 'A' } });
    expect(await b.commit()).toMatchObject({ status: 'saved' }); // a retry is a new commit
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('a failed row can be fixed and saved with all its changes', async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, errors: [{ field: 'Nom', code: 'required' }] }).mockResolvedValue({ ok: true, rowid: 4, values: [] });
    const b = new RowBuffer(save);
    b.edit(2, null, 'Ville', 'Lyon');
    expect(await b.commit()).toMatchObject({ status: 'failed' });
    b.edit(2, null, 'Nom', 'Durand');
    expect(await b.commit()).toMatchObject({ status: 'saved', rowid: 4 });
    expect(save).toHaveBeenLastCalledWith(null, { Ville: 'Lyon', Nom: 'Durand' });
  });

  it('refuses an edit of another row while one is pending (the caller leaves the row first)', () => {
    const b = new RowBuffer(vi.fn());
    b.edit(1, 5, 'Nom', 'A');
    expect(() => b.edit(2, 6, 'Nom', 'B')).toThrow();
    expect(b.pending).toEqual({ rowIndex: 1, rowid: 5, changes: { Nom: 'A' } });
  });

  it('fields named like object-prototype keys (__proto__, constructor) are kept as ordinary own keys', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, rowid: 1, values: [] });
    const b = new RowBuffer(save);
    b.edit(0, null, '__proto__', 'P');
    b.edit(0, null, 'constructor', 'C');
    const changes = b.pending!.changes;
    expect(Object.keys(changes)).toEqual(['__proto__', 'constructor']);
    expect([Object.hasOwn(changes, '__proto__'), changes.__proto__ as unknown, changes.constructor as unknown]).toEqual([true, 'P', 'C']);
    expect(Object.hasOwn(changes, 'toString')).toBe(false);
    await b.commit();
    const sent = save.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.getPrototypeOf(sent)).toBe(Object.prototype); // what the main process's argument check accepts
    expect(Object.entries(sent)).toEqual([['__proto__', 'P'], ['constructor', 'C']]);
    expect(b.pending).toBeNull();
  });
});
