import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { DbHost } from './client';
import type { HostRequest } from './protocol';

/** A data process that answers only when told to (reply), and exits when killed. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    sent: [] as HostRequest[],
    postMessage(m: HostRequest) { child.sent.push(m); },
    kill() { setImmediate(() => child.emit('exit', 1)); return true; },
    reply(method: string, value: unknown = null) {
      const r = child.sent.find((m) => m.method === method && !answered.has(m.id))!;
      answered.add(r.id);
      child.emit('message', { id: r.id, ok: true, value });
    },
  });
  const answered = new Set<number>();
  return child;
}
const opened = { path: 'x.basecraft', create: false, appVersion: '0', region: 'fr-FR', sessionId: 's' };
const tick = () => new Promise((r) => setImmediate(r));

it('Stop targets the query call: a row write executing before it finishes first, and is never cancelled', async () => {
  const child = fakeChild();
  const h = DbHost.attach(child, opened, () => {}, () => {});
  const write = h.session.insert('Clients', {});
  const query = h.session.pageSource({ kind: 'query', name: 'Q' }, { offset: 0, limit: 0 });
  const queued = h.session.update('Clients', 1, {});
  const id = h.pendingCall(new Set(['pageSource']))!;
  expect(h.isExecuting(id)).toBe(false); // the write is at the head
  let executing: boolean | undefined;
  void h.whenExecuting(id).then((v) => { executing = v; });
  await tick();
  expect(executing).toBeUndefined();
  child.reply('insert', { ok: true });
  await expect(write).resolves.toEqual({ ok: true });
  await tick();
  expect(executing).toBe(true);
  expect(h.isExecuting(id)).toBe(true);
  await h.kill();
  await expect(query).rejects.toThrow('bc:cancelled');
  await expect(queued).rejects.toThrow('bc:cancelled'); // never executed: safe to save again
});

it('whenExecuting is false when the call ended first; pendingCall is null without a matching call', async () => {
  const child = fakeChild();
  const h = DbHost.attach(child, opened, () => {}, () => {});
  expect(h.pendingCall(new Set(['pageSource']))).toBeNull();
  void h.session.insert('Clients', {});
  const q = h.session.pageSource({ kind: 'query', name: 'Q' }, { offset: 0, limit: 0 });
  const id = h.pendingCall(new Set(['pageSource']))!;
  const w = h.whenExecuting(id);
  child.reply('insert');
  child.reply('pageSource', 'rows');
  await q;
  await expect(w).resolves.toBe(false); // it ended before it could be stopped
  await expect(h.whenExecuting(id)).resolves.toBe(false);
});

it('an unexpected exit rejects pending calls bc:hostCrashed and calls onExit once', async () => {
  const child = fakeChild();
  const exits: number[] = [];
  const h = DbHost.attach(child, opened, () => {}, (c) => exits.push(c));
  const p = h.session.listTables();
  child.emit('exit', 7);
  await expect(p).rejects.toThrow('bc:hostCrashed');
  expect(exits).toEqual([7]);
});

it('one call in flight: a call queued behind the query never reaches the data process, even when Stop lands as the query answers', async () => {
  const child = fakeChild();
  const h = DbHost.attach(child, opened, () => {}, () => {});
  const query = h.session.pageSource({ kind: 'query', name: 'Q' }, { offset: 0, limit: 0 });
  const write = h.session.insert('Clients', { Nom: 'Zoé' });
  expect(child.sent.map((m) => m.method)).toEqual(['pageSource']); // the insert waits in the main process
  // the data process has answered the query, but its reply is still in transit when Stop kills it
  const id = h.pendingCall(new Set(['pageSource']))!;
  expect(h.isExecuting(id)).toBe(true);
  await h.kill();
  expect(child.sent.map((m) => m.method)).toEqual(['pageSource']); // the insert was never sent: it cannot have run
  await expect(query).rejects.toThrow('bc:cancelled');
  await expect(write).rejects.toThrow('bc:cancelled');
});

it('the next call is sent when the previous one answers', async () => {
  const child = fakeChild();
  const h = DbHost.attach(child, opened, () => {}, () => {});
  const a = h.session.count('A');
  const b = h.session.count('B');
  expect(child.sent.map((m) => m.args[0])).toEqual(['A']);
  child.reply('count', 1);
  expect(child.sent.map((m) => m.args[0])).toEqual(['A', 'B']);
  child.reply('count', 2);
  expect([await a, await b]).toEqual([1, 2]);
});
