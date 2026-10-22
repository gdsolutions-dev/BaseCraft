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

function create(basePath: string, sessionId: string, deps: LockDeps): LockResult | 'exists' {
  const now = deps.now ?? Date.now;
  const writeExclusive = deps.writeExclusive ?? defaultWriteExclusive;
  const lockPath = lockPathFor(basePath);
  const info: LockInfo = { user: os.userInfo().username, host: os.hostname(), pid: process.pid, sessionId, heartbeatAt: new Date(now()).toISOString() };
  try { writeExclusive(lockPath, JSON.stringify(info)); } catch (e) {
    const code = errCode(e);
    if (code === 'EEXIST') return 'exists';
    if (code && CANNOT_LOCK.has(code)) return { status: 'cannotLock', reason: code };
    throw e;
  }
  const lock: HeldLock = {
    info,
    heartbeat() {
      const cur = readLock(lockPath, deps);
      if (!cur || cur.info.sessionId !== sessionId) return 'lost';
      const next = { ...info, heartbeatAt: new Date(now()).toISOString() };
      try { (deps.writeInPlace ?? defaultWriteInPlace)(lockPath, JSON.stringify(next)); } catch { return 'lost'; }
      lock.info = next;
      return 'ok';
    },
    release() {
      try {
        const cur = readLock(lockPath, deps);
        if (cur && cur.info.sessionId === sessionId) fs.unlinkSync(lockPath);
      } catch { /* already gone or inaccessible: nothing to release */ }
    },
  };
  return { status: 'acquired', lock };
}

/** Current holder as seen from outside (null when there is no lock file); the info object is valid for takeOverStaleLock. */
export function peekLock(basePath: string, deps: LockDeps = {}): Extract<LockResult, { status: 'heldByOther' }> | null {
  const cur = readLock(lockPathFor(basePath), deps);
  if (!cur) return null;
  const now = (deps.now ?? Date.now)();
  const stale = !cur.readable || now - Date.parse(cur.info.heartbeatAt) > STALE_AFTER_MS;
  return { status: 'heldByOther', info: cur.info, stale };
}

export function acquireLock(basePath: string, sessionId: string, deps: LockDeps = {}): LockResult {
  for (let i = 0; i < 3; i++) {
    const r = create(basePath, sessionId, deps);
    if (r !== 'exists') return r;
    const other = peekLock(basePath, deps);
    if (other) return other;
    // lock vanished between EEXIST and read: retry
  }
  return { status: 'cannotLock', reason: 'EEXIST' };
}

export function takeOverStaleLock(basePath: string, observed: LockInfo, sessionId: string, deps: LockDeps = {}): LockResult {
  const lockPath = lockPathFor(basePath);
  const cur = readLock(lockPath, deps);
  if (cur) {
    const now = (deps.now ?? Date.now)();
    // Could not read it: it may be live, never remove what we cannot see.
    if (cur.readError) return { status: 'heldByOther', info: observed, stale: now - Date.parse(observed.heartbeatAt) > STALE_AFTER_MS };
    const same = rawOf.has(observed)
      ? cur.raw === rawOf.get(observed)
      : cur.info.sessionId === observed.sessionId && cur.info.heartbeatAt === observed.heartbeatAt;
    if (!same) return peekLock(basePath, deps) ?? acquireLock(basePath, sessionId, deps);
    // The holder may have heartbeated since we observed it.
    if (cur.readable && now - Date.parse(cur.info.heartbeatAt) <= STALE_AFTER_MS) return { status: 'heldByOther', info: cur.info, stale: false };
    // ponytail: check-then-unlink is not atomic. A concurrent take-over can slip in between; the loser's next
    // heartbeat() returns 'lost', so two holders overlap for at most one heartbeat interval (HEARTBEAT_MS).
    try { fs.unlinkSync(lockPath); } catch (e) { if (errCode(e) !== 'ENOENT') throw e; }
  }
  return acquireLock(basePath, sessionId, deps);
}
