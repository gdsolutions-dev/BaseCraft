import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { existsSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { acquireExclusive, joinPresence, othersPresent, presenceEntry, sharedRefusal } from './presence';

let dir: string;
let data: string;
let now = Date.parse('2026-10-29T10:00:00.000Z');
const deps = () => ({ now: () => now, settleMs: 0 });
const entry = (id: string, host: string) => JSON.stringify({ user: 'u', host, pid: 1, sessionId: id, heartbeatAt: new Date(now).toISOString() });

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcpresence-')));
  data = join(dir, 'data.basecraft');
  writeFileSync(data, '');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('presence directory (R2, R4, R5, R6)', () => {
  it('an entry is a lock file in <data>.users, one per session', () => {
    expect(presenceEntry(data, 'a')).toBe(join(`${data}.users`, 'a'));
    const a = joinPresence(data, 'a', deps())!;
    joinPresence(data, 'b', deps());
    expect(readdirSync(`${data}.users`).sort()).toEqual(['a.lock', 'b.lock']);
    expect(othersPresent(data, 'a', deps()).map((u) => u.sessionId)).toEqual(['b']);
    expect(othersPresent(data, '', deps()).map((u) => u.sessionId).sort()).toEqual(['a', 'b']);
    a.release();
    expect(readdirSync(`${data}.users`)).toEqual(['b.lock']);
  });

  it('no directory: nobody present', () => expect(othersPresent(data, 'a', deps())).toEqual([]));

  it('a read-only data file gets no entry', () => {
    fs.chmodSync(data, 0o444);
    try { expect(joinPresence(data, 'a', deps())).toBeNull(); } finally { fs.chmodSync(data, 0o644); }
  });

  it("another host's entry stops counting 30 s after it was first seen, and is removed then", () => {
    fs.mkdirSync(`${data}.users`);
    writeFileSync(join(`${data}.users`, 'z.lock'), entry('z', 'B'));
    writeFileSync(join(`${data}.users`, 'junk.txt'), 'not an entry');
    expect(othersPresent(data, 'a', deps()).map((u) => u.host)).toEqual(['B']);
    now += 31_000;
    expect(othersPresent(data, 'a', deps())).toEqual([]);
    expect(readdirSync(`${data}.users`)).toEqual(['junk.txt']);
  });

  it('acquireExclusive: alone keeps the lock, with others present releases it and names them', () => {
    joinPresence(data, 'b', deps());
    const r = acquireExclusive(data, 'a', deps());
    expect(r).toMatchObject({ status: 'inUse', users: [{ sessionId: 'b' }] });
    expect(existsSync(`${data}.lock`)).toBe(false);
    joinPresence(data, 'a', deps()); // its own entry does not count
    fs.rmSync(join(`${data}.users`, 'b.lock'));
    const alone = acquireExclusive(data, 'a', deps());
    expect(alone.status).toBe('acquired');
    expect(existsSync(`${data}.lock`)).toBe(true);
  });

  it('acquireExclusive waits the settle time between the lock and the listing', () => {
    joinPresence(data, 'b', deps());
    const order: string[] = [];
    acquireExclusive(data, 'x', { now: () => now, settleMs: 7, sleep: (ms) => order.push(`sleep ${ms}`),
      writeExclusive: (p, d) => { writeFileSync(p, d, { flag: 'wx' }); order.push('lock'); }, readDir: (d) => { order.push('list'); return readdirSync(d); } });
    expect(order).toEqual(['lock', 'sleep 7', 'list']);
  });

  it('an unsupported client on a network location, or any synchronized folder, is refused', () => {
    expect(sharedRefusal('network', 'darwin')).toBe('unsupportedClient'); expect(sharedRefusal('local', 'darwin')).toBeNull();
    expect(sharedRefusal('network', 'linux')).toBe('unsupportedClient'); expect(sharedRefusal('local', 'linux')).toBeNull(); // G1
    expect(sharedRefusal('network', 'win32')).toBeNull();
    expect(sharedRefusal('synced', 'win32')).toBe('syncedFolder');
  });
});
