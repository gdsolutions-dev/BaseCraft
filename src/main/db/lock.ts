import fs from 'node:fs';
import os from 'node:os';
import type { LockInfo } from '../../shared/api';
export type { LockInfo };

export const HEARTBEAT_MS = 10_000, STALE_AFTER_MS = 30_000;
export interface LockDeps {
  now?: () => number;
  writeExclusive?: (path: string, data: string) => void;
  writeInPlace?: (path: string, data: string) => void; // default: r+ (no truncate)
  readText?: (path: string) => string;
  hostname?: () => string; // default os.hostname(): who counts as "this host" for stale judging, and the host we write
}
export type LockResult =
  | { status: 'acquired'; lock: HeldLock }
  | { status: 'heldByOther'; info: LockInfo; stale: boolean }
  | { status: 'cannotLock'; reason: string };
export interface HeldLock { info: LockInfo; heartbeat(): 'ok' | 'lost'; release(): void }

const CANNOT_LOCK = new Set(['EACCES', 'EPERM', 'EROFS']);
const defaultWriteInPlace = (p: string, data: string) => fs.writeFileSync(p, data, { flag: 'r+' });
const defaultWriteExclusive = (p: string, data: string) => fs.writeFileSync(p, data, { flag: 'wx' });

// Raw file text behind each LockInfo we returned, so take-over compares bytes, not parsed fields
// (an empty or garbage lock file has no meaningful fields).
const rawOf = new WeakMap<LockInfo, string>();

export function lockPathFor(basePath: string): string { return `${basePath}.lock`; }

const errCode = (e: unknown) => (e as NodeJS.ErrnoException)?.code;

function readLock(lockPath: string, deps: LockDeps = {}): { raw: string; info: LockInfo; readable: boolean; readError: boolean } | null {
  let raw: string;
  let readError = false;
  try { raw = (deps.readText ?? ((p) => fs.readFileSync(p, 'utf8')))(lockPath); } catch (e) {
    if (errCode(e) === 'ENOENT') return null;
    raw = '';
    readError = true;
  }
  let readable = false;
  let info: LockInfo = { user: '?', host: '?', pid: 0, sessionId: '?', heartbeatAt: new Date(0).toISOString() };
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.sessionId === 'string' && typeof j.heartbeatAt === 'string' && !Number.isNaN(Date.parse(j.heartbeatAt))) {
      info = { user: String(j.user ?? '?'), host: String(j.host ?? '?'), pid: Number(j.pid) || 0, sessionId: j.sessionId, heartbeatAt: j.heartbeatAt };
      readable = true;
    }
  } catch { /* unparsable: keep placeholder */ }
  rawOf.set(info, raw);
  return { raw, info, readable, readError };
}

function newInfo(sessionId: string, deps: LockDeps): LockInfo {
  return { user: os.userInfo().username, host: (deps.hostname ?? os.hostname)(), pid: process.pid, sessionId, heartbeatAt: new Date((deps.now ?? Date.now)()).toISOString() };
}

function held(basePath: string, info: LockInfo, deps: LockDeps): HeldLock {
  const lockPath = lockPathFor(basePath);
  const now = deps.now ?? Date.now;
  const lock: HeldLock = {
    info,
    heartbeat() {
      const cur = readLock(lockPath, deps);
      if (!cur || cur.info.sessionId !== info.sessionId) return 'lost';
      const next = { ...lock.info, heartbeatAt: new Date(now()).toISOString() };
      try { (deps.writeInPlace ?? defaultWriteInPlace)(lockPath, JSON.stringify(next)); } catch { return 'lost'; }
      lock.info = next;
      return 'ok';
    },
    release() { releaseIfOurs(basePath, info.sessionId, deps); },
  };
  return lock;
}

function create(basePath: string, sessionId: string, deps: LockDeps): LockResult | 'exists' {
  const lockPath = lockPathFor(basePath);
  const info = newInfo(sessionId, deps);
  try { (deps.writeExclusive ?? defaultWriteExclusive)(lockPath, JSON.stringify(info)); } catch (e) {
    const code = errCode(e);
    if (code === 'EEXIST') return 'exists';
    if (code && CANNOT_LOCK.has(code)) return { status: 'cannotLock', reason: code };
    throw e;
  }
  return { status: 'acquired', lock: held(basePath, info, deps) };
}

// First sight, in this process, of the bytes of each lock another host wrote (see isStale).
// ponytail: one entry per lock path seen, never pruned (a few bytes each); prune on release if a long-running host ever sees thousands.
const seen = new Map<string, { raw: string; since: number }>();

/** R13. This host's lock: `now - heartbeatAt` (one clock). Another host's lock: its bytes unchanged for STALE_AFTER_MS of OUR clock,
 *  counted from the first time this process saw them (workstation clocks may disagree, so its heartbeatAt is never compared to ours).
 *  Unreadable: stale at once. */
function isStale(lockPath: string, cur: { raw: string; info: LockInfo; readable: boolean }, deps: LockDeps): boolean {
  if (!cur.readable) return true;
  const now = (deps.now ?? Date.now)();
  if (cur.info.host === (deps.hostname ?? os.hostname)()) return now - Date.parse(cur.info.heartbeatAt) > STALE_AFTER_MS;
  const first = seen.get(lockPath);
  if (first?.raw === cur.raw) return now - first.since > STALE_AFTER_MS;
  seen.set(lockPath, { raw: cur.raw, since: now });
  return false;
}

/** Main process heartbeat while the data process is busy: rewrites the heartbeat of the lock only if it is still ours. */
export function keepAlive(basePath: string, sessionId: string, deps: LockDeps = {}): 'ok' | 'lost' {
  const lockPath = lockPathFor(basePath);
  const cur = readLock(lockPath, deps);
  if (!cur || !cur.readable || cur.info.sessionId !== sessionId) return 'lost';
  // same fields, same length (fixed-length ISO date): an in-place write leaves no tail
  const next = { ...cur.info, heartbeatAt: new Date((deps.now ?? Date.now)()).toISOString() };
  try { (deps.writeInPlace ?? defaultWriteInPlace)(lockPath, JSON.stringify(next)); } catch { return 'lost'; }
  return 'ok';
}

/** Removes the lock if it carries our session id (after a close, a crash or a kill of the data process). */
export function releaseIfOurs(basePath: string, sessionId: string, deps: LockDeps = {}): void {
  const lockPath = lockPathFor(basePath);
  try {
    const cur = readLock(lockPath, deps);
    if (cur && cur.info.sessionId === sessionId) fs.unlinkSync(lockPath);
  } catch { /* already gone or inaccessible: nothing to release */ }
}

/** Current holder as seen from outside (null when there is no lock file); the info object is valid for takeOverStaleLock. */
export function peekLock(basePath: string, deps: LockDeps = {}): Extract<LockResult, { status: 'heldByOther' }> | null {
  const lockPath = lockPathFor(basePath);
  const cur = readLock(lockPath, deps);
  if (!cur) return null;
  return { status: 'heldByOther', info: cur.info, stale: isStale(lockPath, cur, deps) };
}

export function acquireLock(basePath: string, sessionId: string, deps: LockDeps = {}): LockResult {
  for (let i = 0; i < 3; i++) {
    const r = create(basePath, sessionId, deps);
    if (r !== 'exists') return r;
    const other = peekLock(basePath, deps);
    // our own session id: the data process restarted (Stop) under the same opening. Adopted, with a fresh heartbeat,
    // rewritten in place like a heartbeat (never emptied, even for an instant); a shorter pid is padded with spaces.
    if (other && other.info.sessionId === sessionId) {
      const info = newInfo(sessionId, deps);
      const text = JSON.stringify(info);
      const pad = Math.max(0, Buffer.byteLength(rawOf.get(other.info) ?? '') - Buffer.byteLength(text));
      try { (deps.writeInPlace ?? defaultWriteInPlace)(lockPathFor(basePath), text + ' '.repeat(pad)); } catch (e) {
        const code = errCode(e);
        if (code && CANNOT_LOCK.has(code)) return { status: 'cannotLock', reason: code };
        throw e;
      }
      return { status: 'acquired', lock: held(basePath, info, deps) };
    }
    if (other) return other;
    // lock vanished between EEXIST and read: retry
  }
  return { status: 'cannotLock', reason: 'EEXIST' };
}

export function takeOverStaleLock(basePath: string, observed: LockInfo, sessionId: string, deps: LockDeps = {}): LockResult {
  const lockPath = lockPathFor(basePath);
  const cur = readLock(lockPath, deps);
  if (cur) {
    // Could not read it: it may be live, never remove what we cannot see.
    if (cur.readError) return { status: 'heldByOther', info: observed, stale: isStale(lockPath, cur, deps) };
    const same = rawOf.has(observed)
      ? cur.raw === rawOf.get(observed)
      : cur.info.sessionId === observed.sessionId && cur.info.heartbeatAt === observed.heartbeatAt;
    if (!same) return peekLock(basePath, deps) ?? acquireLock(basePath, sessionId, deps);
    // The holder may have heartbeated since we observed it.
    if (cur.readable && !isStale(lockPath, cur, deps)) return { status: 'heldByOther', info: cur.info, stale: false };
    // ponytail: check-then-unlink is not atomic. A concurrent take-over can slip in between; the loser's next
    // heartbeat() returns 'lost', so two holders overlap for at most one heartbeat interval (HEARTBEAT_MS).
    try { fs.unlinkSync(lockPath); } catch (e) { if (errCode(e) !== 'ENOENT') throw e; }
  }
  return acquireLock(basePath, sessionId, deps);
}
