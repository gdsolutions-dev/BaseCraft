import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { seedSales } from '../query/test-db';
import { defaultSpec, type ImportPlan } from '../../shared/import-text';
import { localeInfo } from '../../shared/locale-format';
import en from '../../shared/i18n/en.json';
import type { ImportTexts } from '../import/text-import';
import { ReadOnlyError } from '../session';
import { createDispatcher, openSession } from './host';
import { HOST_METHODS, READ_METHODS, type HostEvent, type HostReply, type HostRequest } from './protocol';

const req = (id: number, method: string, ...args: unknown[]): HostRequest => ({ id, method, args });
const opened = (target: object) => {
  const out: (HostReply | HostEvent)[] = [];
  const d = createDispatcher(() => target, (m) => out.push(m), new Set(Object.keys(target)));
  return { d, out, ready: d(req(0, 'open', {})) };
};
const reply = (out: (HostReply | HostEvent)[], id: number) => out.find((m) => 'id' in m && m.id === id) as HostReply;

it('serializes every call', async () => {
  const log: string[] = [];
  const target = {
    async slow() { log.push('slow:start'); await new Promise((r) => setImmediate(r)); log.push('slow:end'); },
    fast() { log.push('fast'); },
  };
  const { d } = opened(target);
  await Promise.all([d(req(1, 'slow')), d(req(2, 'fast'))]);
  expect(log).toEqual(['slow:start', 'slow:end', 'fast']);
});

it('errors keep their name; replies carry the value; a call before open rejects bc:noBase', async () => {
  const out: (HostReply | HostEvent)[] = [];
  const d = createDispatcher(() => ({ state: { s: 1 }, w() { throw new ReadOnlyError(); }, v: (a: number) => a + 1 }), (m) => out.push(m), new Set(['w', 'v', 'nope']));
  await d(req(1, 'w'));
  await d(req(2, 'open', {}));
  await d(req(3, 'w'));
  await d(req(4, 'v', 41));
  await d(req(5, 'nope'));
  expect(out).toEqual([
    { id: 1, ok: false, name: 'Error', message: 'bc:noBase' },
    { id: 2, ok: true, value: { s: 1 } },
    { id: 3, ok: false, name: 'ReadOnlyError', message: 'read-only base' },
    { id: 4, ok: true, value: 42 },
    { id: 5, ok: false, name: 'Error', message: 'bc:invalidArgument' },
  ]);
});

it('only the session methods the main process uses can be called, with an array of arguments', async () => {
  const out: (HostReply | HostEvent)[] = [];
  const d = createDispatcher(() => ({ ok: () => 1, secret: () => 2 }), (m) => out.push(m), new Set(['ok']));
  await d(req(1, 'open', {}));
  await d(req(2, 'secret'));
  await d(req(3, 'constructor'));
  await d({ id: 4, method: 'ok', args: 'x' as unknown as unknown[] });
  await d({ id: 5, method: 1 as unknown as string, args: [] });
  await d(req(6, 'ok'));
  expect(out.slice(1).map((m) => ('id' in m && m.ok ? m.value : 'id' in m && m.message))).toEqual(['bc:invalidArgument', 'bc:invalidArgument', 'bc:invalidArgument', 'bc:invalidArgument', 1]);
});

it('the default allowlist names every session method the main process calls', async () => {
  const { HOST_METHODS } = await import('./protocol');
  const ipc = fs.readFileSync(path.join(__dirname, '../ipc.ts'), 'utf8');
  const used = new Set([...ipc.matchAll(/need\(\)\.(\w+)\(/g), ...ipc.matchAll(/session\.(\w+)\(/g)].map((m) => m[1]));
  for (const m of used) expect(HOST_METHODS.has(m), m).toBe(true);
  expect(HOST_METHODS.has('close')).toBe(true);
});

it('a reply that cannot be cloned rejects instead of hanging', async () => {
  const out: (HostReply | HostEvent)[] = [];
  const d = createDispatcher(() => ({ f: () => () => 1 }), (m) => { structuredClone(m); out.push(m); }, new Set(['f']));
  await d(req(1, 'open', {}));
  await d(req(2, 'f'));
  expect(reply(out, 2)).toMatchObject({ ok: false });
});

describe('R16: a transient malformed read', () => {
  const corrupt = () => Object.assign(new Error('database disk image is malformed'), { errcode: 11 });
  const pause = vi.fn(async (_ms: number) => {});
  beforeEach(() => pause.mockClear());
  const dispatcher = (target: object, wait: (ms: number) => Promise<void>) => {
    const out: (HostReply | HostEvent)[] = [];
    const d = createDispatcher(() => target, (m) => out.push(m), new Set(Object.keys(target)), wait);
    return { d, out };
  };
  const call = async ({ d, out }: ReturnType<typeof dispatcher>, method: string) => {
    await d(req(0, 'open', {}));
    await d(req(1, method));
    const { name: _name, ...r } = reply(out, 1) as HostReply & { name?: string };
    return (({ id: _id, ...rest }) => rest)(r);
  };

  it('a read that meets a transient malformed page is retried once after 250 ms', async () => {
    const page = vi.fn().mockImplementationOnce(() => { throw corrupt(); }).mockReturnValue({ rows: [] });
    expect(await call(dispatcher({ page }, pause), 'page')).toEqual({ ok: true, value: { rows: [] } });
    expect(page).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledWith(250);
  });
  it('a read malformed twice is reported bc:fileDamaged', async () => {
    const page = vi.fn(() => { throw corrupt(); });
    expect(await call(dispatcher({ page }, pause), 'page')).toEqual({ ok: false, message: 'bc:fileDamaged' });
    expect(page).toHaveBeenCalledTimes(2);
  });
  it('a write that meets it is reported at once, never retried', async () => {
    const update = vi.fn(() => { throw corrupt(); });
    expect(await call(dispatcher({ update }, pause), 'update')).toEqual({ ok: false, message: 'bc:fileDamaged' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });
  it('READ_METHODS are HOST_METHODS', () => {
    for (const m of READ_METHODS) expect(HOST_METHODS.has(m), m).toBe(true);
  });
});

it('an open error is a bc:<code> rejection (the host applies bcError)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bchost-'));
  try {
    const p = path.join(dir, 'x.basecraft');
    fs.writeFileSync(p, 'not a base');
    const out: (HostReply | HostEvent)[] = [];
    const d = createDispatcher(openSession, (m) => out.push(m));
    await d(req(1, 'open', { path: p, create: false, appVersion: '0.0.0', region: 'fr-FR', sessionId: 'a', shared: { openMode: 'shared', updateRetries: 2, updateRetryMs: 250 } }));
    expect(out).toEqual([{ id: 1, ok: false, name: 'Error', message: 'bc:notBasecraft' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('with a real session', () => {
  let dir: string;
  let p: string;
  let out: (HostReply | HostEvent)[];
  let d: (r: HostRequest) => Promise<void>;
  const value = <T>(id: number) => { const r = reply(out, id); if (!r.ok) throw new Error(r.message); return r.value as T; };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bchost-'));
    p = path.join(dir, 'test.basecraft');
    createBaseFile(p, '0.0.0');
    const { db } = openBaseFile(p, 'write', '0.0.0');
    seedSales(db);
    db.close();
    out = [];
    d = createDispatcher(openSession, (m) => out.push(m));
    await d(req(0, 'open', { path: p, create: false, appVersion: '0.0.0', region: 'fr-FR', sessionId: 'a', shared: { openMode: 'shared', updateRetries: 2, updateRetryMs: 250 } }));
    expect(value(0)).toMatchObject({ readOnly: false, fileName: 'test.basecraft' });
  });
  afterEach(async () => {
    await d(req(999, 'close'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a read issued during an import sees the committed result; progress arrives as events', async () => {
    const csv = path.join(dir, 'v.csv');
    fs.writeFileSync(csv, 'Nom,Qte\n' + Array.from({ length: 3000 }, (_, i) => `n${i},${i}`).join('\n') + '\n');
    const fr = localeInfo('fr-FR');
    const spec = { ...defaultSpec(fr), delimiter: ',', hasHeader: true, fields: [{ name: 'Nom', type: 'shortText' as const, skip: false, indexed: 'no' as const }, { name: 'Qte', type: 'longInteger' as const, skip: false, indexed: 'no' as const }] };
    const plan: ImportPlan = { spec, target: { kind: 'new', table: 'Ventes', primaryKey: { kind: 'auto' } } };
    const texts: ImportTexts = { fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_Err', errorFields: { error: 'E', field: 'F', line: 'L' }, messages: en.fieldError, log: en.importText.log };
    await Promise.all([d(req(1, 'importRun', csv, plan, texts)), d(req(2, 'count', 'Ventes'))]);
    expect(value(1)).toMatchObject({ ok: true, imported: 3000 });
    expect(value<number>(2)).toBe(3000);
    expect(out.findIndex((m) => 'id' in m && m.id === 1)).toBeLessThan(out.findIndex((m) => 'id' in m && m.id === 2));
    expect(out.filter((m) => 'event' in m && m.event === 'importProgress').length).toBeGreaterThan(0);
  });

  it('a write issued during an action query waits until it rolls back (it does not join its savepoint)', async () => {
    // 10.10 -> 9.10; 0.10 -> -0.90 breaks >0: the whole run rolls back
    await d(req(10, 'setContentEnabled', '')); // no active content
    const run = d(req(1, 'runAction', { kind: 'sql', sql: 'UPDATE Commandes SET Montant = Montant - 1 WHERE Client = 1' }, {}, { skipFailures: false, replaceTable: false }));
    const write = d(req(2, 'insert', 'Clients', { Nom: 'Zoé', Ville: 'Nice' }));
    await Promise.all([run, write]);
    expect(value(1)).toMatchObject({ ok: false, reason: 'rowErrors' });
    expect(value(2)).toMatchObject({ ok: true });
    await d(req(3, 'page', 'Clients', { offset: 0, limit: 10 }));
    expect(value<{ rows: { values: unknown[] }[] }>(3).rows.map((r) => r.values[1])).toEqual(['Dupont', 'Martin', 'Durand', 'Éric', 'Zoé']);
    await d(req(4, 'page', 'Commandes', { offset: 0, limit: 10 }));
    expect(value<{ rows: { values: unknown[] }[] }>(4).rows.map((r) => r.values[2])).toEqual([10.1, 0.1, 0.2, 99.99, 0.1]);
  });

  it('a write issued during an import waits until it commits', async () => {
    const csv = path.join(dir, 'w.csv');
    fs.writeFileSync(csv, 'Nom\n' + Array.from({ length: 3000 }, (_, i) => `n${i}`).join('\n') + '\n');
    const spec = { ...defaultSpec(localeInfo('fr-FR')), delimiter: ',', hasHeader: true, fields: [{ name: 'Nom', type: 'shortText' as const, skip: false, indexed: 'no' as const }] };
    const texts: ImportTexts = { fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_Err', errorFields: { error: 'E', field: 'F', line: 'L' }, messages: en.fieldError, log: en.importText.log };
    const plan: ImportPlan = { spec, target: { kind: 'new', table: 'W', primaryKey: { kind: 'auto' } } };
    await Promise.all([d(req(1, 'importRun', csv, plan, texts)), d(req(2, 'insert', 'Clients', { Nom: 'Zoé' }))]);
    expect(value(1)).toMatchObject({ ok: true, imported: 3000 });
    expect(value(2)).toMatchObject({ ok: true });
    expect(out.findIndex((m) => 'id' in m && m.id === 1)).toBeLessThan(out.findIndex((m) => 'id' in m && m.id === 2));
  });

  it('state changes and the close go through the queue', async () => {
    await d(req(1, 'tick'));
    await d(req(2, 'takeOverLock'));
    expect(value(2)).toMatchObject({ readOnly: false });
  });
});
