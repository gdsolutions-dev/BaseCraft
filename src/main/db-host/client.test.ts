import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
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
const opened = { path: 'x.basecraft', create: false, appVersion: '0', region: 'fr-FR', sessionId: 's', shared: { openMode: 'shared' as const, updateRetries: 2, updateRetryMs: 250 } };
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

it('interrupt goes out while a call is in flight; its reply does not send the call again', async () => {
  const child = fakeChild();
  const h = DbHost.attach(child, opened, () => {}, () => {});
  const page = h.session.page('Clients', { offset: 0, limit: 1 });
  const next = h.session.count('Clients');
  const stop = h.interrupt();
  expect(child.sent.map((m) => m.method)).toEqual(['page', 'interrupt']); // at once, out of the one-call-in-flight rule
  const id = h.pendingCall(new Set(['page']))!;
  child.reply('interrupt', true);
  await expect(stop).resolves.toBe(true);
  expect(child.sent.map((m) => m.method)).toEqual(['page', 'interrupt']); // F20: neither page again nor the count
  const settled = h.settles(id, 1000);
  child.emit('message', { id, ok: false, name: 'Error', message: 'bc:cancelled' });
  await expect(settled).resolves.toBe(true);
  await expect(page).rejects.toThrow('bc:cancelled');
  expect(child.sent.map((m) => m.method)).toEqual(['page', 'interrupt', 'count']);
  child.reply('count', 3);
  await expect(next).resolves.toBe(3);
});

it('settles is false when the call has not answered in time; interrupt is false when unanswered or after exit', async () => {
  vi.useFakeTimers();
  try {
    const child = fakeChild();
    const h = DbHost.attach(child, opened, () => {}, () => {});
    void h.session.pageSource({ kind: 'query', name: 'Q' }, { offset: 0, limit: 0 }).catch(() => {});
    const id = h.pendingCall(new Set(['pageSource']))!;
    const settled = h.settles(id, 5000);
    const stop = h.interrupt(); // a data process busy in SQLite (synchronous) never reads it
    await vi.advanceTimersByTimeAsync(5000);
    await expect(stop).resolves.toBe(false);
    await expect(settled).resolves.toBe(false);
    const k = h.kill();
    await vi.runAllTimersAsync();
    await k;
    await expect(h.interrupt()).resolves.toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

describe('stop (R12: cancelCall\'s sequence)', () => {
  const setup = () => {
    const child = fakeChild();
    const kill = vi.spyOn(child, 'kill');
    const h = DbHost.attach(child, opened, () => {}, () => {});
    const query = h.session.pageSource({ kind: 'query', name: 'Q' }, { offset: 0, limit: 0 });
    query.catch(() => {});
    return { child, kill, h, query, id: h.pendingCall(new Set(['pageSource']))! };
  };

  it('interrupt false (nothing remote running): the kill', async () => {
    const { child, kill, h, query, id } = setup();
    const stop = h.stop(id, 5000);
    await tick();
    child.reply('interrupt', false);
    await expect(stop).resolves.toBe(true);
    expect(kill).toHaveBeenCalledTimes(1);
    await expect(query).rejects.toThrow('bc:cancelled');
  });

  it('interrupt true and the call settles: no kill', async () => {
    const { child, kill, h, query, id } = setup();
    const stop = h.stop(id, 5000);
    child.reply('interrupt', true);
    await tick();
    child.emit('message', { id, ok: false, name: 'Error', message: 'bc:cancelled' });
    await expect(stop).resolves.toBe(false);
    expect(kill).not.toHaveBeenCalled();
    await expect(query).rejects.toThrow('bc:cancelled');
  });

  it('interrupt true but the call does not settle in time: the kill', async () => {
    vi.useFakeTimers();
    try {
      const { child, kill, h, id } = setup();
      const stop = h.stop(id, 5000);
      child.reply('interrupt', true);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync(); // the fake child's exit
      await expect(stop).resolves.toBe(true);
      expect(kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the call answers while the interrupt is pending: the save sent next is not killed and reports success', async () => {
    const { child, kill, h, query, id } = setup();
    const save = h.session.insert('Clients', { Nom: 'Zoé' });
    const stop = h.stop(id, 5000);
    child.reply('pageSource', 'rows'); // a local query ends before the data process reads the interrupt
    await expect(query).resolves.toBe('rows');
    expect(child.sent.map((m) => m.method)).toEqual(['pageSource', 'interrupt', 'insert']);
    child.reply('interrupt', false);
    await expect(stop).resolves.toBe(false);
    expect(kill).not.toHaveBeenCalled();
    child.reply('insert', { ok: true });
    await expect(save).resolves.toEqual({ ok: true });
  });

  it('the base closed meanwhile (current() false): no kill', async () => {
    const { child, kill, h, id } = setup();
    const stop = h.stop(id, 5000, () => false);
    child.reply('interrupt', false);
    await expect(stop).resolves.toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });
});

it('a timed-out settles leaves no waiter behind', async () => {
  vi.useFakeTimers();
  try {
    const child = fakeChild();
    const h = DbHost.attach(child, opened, () => {}, () => {});
    void h.session.count('A');
    const settled = h.settles(1, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(settled).resolves.toBe(false);
    expect((h as unknown as { headMoved: unknown[] }).headMoved).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
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
