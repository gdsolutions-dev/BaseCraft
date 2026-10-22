import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, lockPathFor, peekLock, takeOverStaleLock, type HeldLock, type LockInfo, type LockResult } from './lock';

type HeldByOther = Extract<LockResult, { status: 'heldByOther' }>;

let dir: string;
let p: string;
let t = 0;
const now = () => t;
const held = (r: LockResult): HeldLock => {
  if (r.status !== 'acquired') throw new Error('not acquired: ' + r.status);
  return r.lock;
};
const overwriteLock = (basePath: string, info: Partial<LockInfo>) =>
  writeFileSync(lockPathFor(basePath), JSON.stringify(info), 'utf8');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bclock-'));
  p = path.join(dir, 'test.basecraft');
  t = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('lock', () => {
  it('acquires and records holder', () => { const r = acquireLock(p, 's1', { now }); expect(r.status).toBe('acquired'); expect(JSON.parse(readFileSync(lockPathFor(p), 'utf8'))).toMatchObject({ sessionId: 's1', pid: process.pid }); });
  it('second acquirer sees fresh holder', () => { acquireLock(p, 's1', { now }); t = 5_000; expect(acquireLock(p, 's2', { now })).toMatchObject({ status: 'heldByOther', stale: false, info: { sessionId: 's1' } }); });
  it('stale after 30 s without heartbeat', () => { acquireLock(p, 's1', { now }); t = 31_000; expect(acquireLock(p, 's2', { now })).toMatchObject({ stale: true }); });
  it('heartbeat keeps it fresh', () => { const l = held(acquireLock(p, 's1', { now })); t = 20_000; l.heartbeat(); t = 40_000; expect(acquireLock(p, 's2', { now })).toMatchObject({ stale: false }); });
  it('take-over only replaces the observed lock', () => {
    acquireLock(p, 's1', { now }); t = 31_000; const r = acquireLock(p, 's2', { now }) as HeldByOther;
    overwriteLock(p, { ...r.info, sessionId: 's3' });
    expect(takeOverStaleLock(p, r.info, 's2', { now }).status).toBe('heldByOther');
  });
  it('take-over succeeds on the observed stale lock', () => {
    acquireLock(p, 's1', { now }); t = 31_000; const r = acquireLock(p, 's2', { now }) as HeldByOther;
    const l = held(takeOverStaleLock(p, r.info, 's2', { now }));
    expect(l.info.sessionId).toBe('s2');
    expect(JSON.parse(readFileSync(lockPathFor(p), 'utf8')).sessionId).toBe('s2');
  });
  it('heartbeat detects loss; release keeps foreign lock', () => {
    const l = held(acquireLock(p, 's1', { now })); overwriteLock(p, { sessionId: 's9' });
    expect(l.heartbeat()).toBe('lost'); l.release(); expect(existsSync(lockPathFor(p))).toBe(true);
  });
  it('release removes own lock', () => {
    const l = held(acquireLock(p, 's1', { now })); l.release(); expect(existsSync(lockPathFor(p))).toBe(false); l.release();
  });
  it('read-only location gives cannotLock', () => {
    const writeExclusive = () => { throw Object.assign(new Error('ro'), { code: 'EROFS' }); };
    expect(acquireLock(p, 's1', { now, writeExclusive })).toMatchObject({ status: 'cannotLock', reason: 'EROFS' });
  });
  it.each(['', 'not json{'])('unreadable lock %j is stale and can be taken over', (content) => {
    writeFileSync(lockPathFor(p), content);
    const r = acquireLock(p, 's2', { now }) as HeldByOther;
    expect(r).toMatchObject({ status: 'heldByOther', stale: true });
    expect(takeOverStaleLock(p, r.info, 's2', { now }).status).toBe('acquired');
    expect(JSON.parse(readFileSync(lockPathFor(p), 'utf8')).sessionId).toBe('s2');
  });
  it('heartbeat returns ok and refreshes the file', () => {
    const l = held(acquireLock(p, 's1', { now })); t = 10_000;
    expect(l.heartbeat()).toBe('ok');
    expect(JSON.parse(readFileSync(lockPathFor(p), 'utf8')).heartbeatAt).toBe(new Date(10_000).toISOString());
  });
  it('heartbeat returns lost when the write fails', () => {
    const writeInPlace = () => { throw Object.assign(new Error('io'), { code: 'EIO' }); };
    const l = held(acquireLock(p, 's1', { now, writeInPlace }));
    expect(l.heartbeat()).toBe('lost');
  });
  it('take-over refused when the holder heartbeats after the observation', () => {
    const l = held(acquireLock(p, 's1', { now })); t = 31_000;
    const r = acquireLock(p, 's2', { now }) as HeldByOther; expect(r.stale).toBe(true);
    l.heartbeat();
    expect(takeOverStaleLock(p, r.info, 's2', { now })).toMatchObject({ status: 'heldByOther', stale: false });
    expect(JSON.parse(readFileSync(lockPathFor(p), 'utf8')).sessionId).toBe('s1');
  });
  it('take-over refused on a lock that cannot be read', () => {
    acquireLock(p, 's1', { now }); t = 31_000;
    const r = acquireLock(p, 's2', { now }) as HeldByOther;
    const readText = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
    expect(takeOverStaleLock(p, r.info, 's2', { now, readText }).status).toBe('heldByOther');
    expect(existsSync(lockPathFor(p))).toBe(true);
  });
  it('take-over with a copied info on a fresh lock is refused', () => {
    acquireLock(p, 's1', { now }); t = 5_000;
    const r = acquireLock(p, 's2', { now }) as HeldByOther;
    expect(takeOverStaleLock(p, { ...r.info }, 's2', { now })).toMatchObject({ status: 'heldByOther', stale: false });
    expect(JSON.parse(readFileSync(lockPathFor(p), 'utf8')).sessionId).toBe('s1');
  });
  it('peekLock shows the holder without touching the lock', () => {
    expect(peekLock(p, { now })).toBeNull();
    acquireLock(p, 's1', { now });
    expect(peekLock(p, { now })).toMatchObject({ status: 'heldByOther', stale: false, info: { sessionId: 's1' } });
    t = 31_000;
    const v = peekLock(p, { now })!;
    expect(v.stale).toBe(true);
    expect(takeOverStaleLock(p, v.info, 's2', { now }).status).toBe('acquired');
  });
});
