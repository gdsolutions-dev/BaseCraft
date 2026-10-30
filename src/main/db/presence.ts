// C3 R2–R6: the presence directory of a shared data file. Each writing shared session holds its own entry
// `${data}.users/<sessionId>.lock`, a lock.ts lock (same JSON, heartbeat, staleness and release): no file is ever shared
// between workstations, so there is no read-modify-write over SMB.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import { acquireLock, peekLock, takeOverStaleLock, type HeldLock, type LockDeps, type LockInfo, type LockResult } from './lock';
import type { LocationRisk } from './location-risk';
import { sleepSync } from './tx';

// ponytail: G1 measured at most 200 ms of file-visibility lag (one PC, virtual network); 10 s covers Windows' default SMB
// directory cache. The knob if a real network proves slower or faster.
export const PRESENCE_SETTLE_MS = 10_000; // R5
/** G1: Linux's cifs client cannot upgrade SQLite's read lock to a write lock; darwin waits with macOS. */
export const SHARED_CLIENTS: readonly NodeJS.Platform[] = ['win32'];

export interface PresenceDeps extends LockDeps {
  settleMs?: number;
  sleep?: (ms: number) => void; // default tx.ts sleepSync
  readDir?: (dir: string) => string[]; // test seam, default fs.readdirSync
}

const dirOf = (base: string) => `${base}.users`;

/** The lock.ts base path of a session's entry. */
export function presenceEntry(base: string, sessionId: string): string { return join(dirOf(base), sessionId); }

/** Writes this session's entry (the directory made on first join, never removed); null: folder or file not writable. */
export function joinPresence(base: string, sessionId: string, deps: PresenceDeps = {}): HeldLock | null {
  try {
    fs.accessSync(base, fs.constants.W_OK);
    fs.mkdirSync(dirOf(base), { recursive: true });
  } catch { return null; }
  const r = acquireLock(presenceEntry(base, sessionId), sessionId, deps);
  return r.status === 'acquired' ? r.lock : null;
}

/** The live entries of the other sessions; a stale one is removed (byte-checked take-over, then release). */
export function othersPresent(base: string, sessionId: string, deps: PresenceDeps = {}): LockInfo[] {
  let names: string[];
  try { names = (deps.readDir ?? fs.readdirSync)(dirOf(base)); } catch { return []; } // no directory: nobody joined yet
  const out: LockInfo[] = [];
  for (const name of names) {
    if (!name.endsWith('.lock') || name === `${sessionId}.lock`) continue;
    const entry = join(dirOf(base), name.slice(0, -'.lock'.length));
    const seen = peekLock(entry, deps);
    if (!seen) continue;
    if (!seen.stale) { out.push(seen.info); continue; }
    const r = takeOverStaleLock(entry, seen.info, randomUUID(), deps);
    if (r.status === 'acquired') r.lock.release();
    else if (r.status === 'heldByOther' && !r.stale) out.push(r.info); // it beat meanwhile
  }
  return out;
}

export type ExclusiveResult = LockResult | { status: 'inUse'; users: LockInfo[] };

/** R4, R5: the exclusive lock, then the settle wait (an entry written just before is visible by then), then the listing:
 *  anyone else present releases the lock again. */
export function acquireExclusive(base: string, sessionId: string, deps: PresenceDeps = {}): ExclusiveResult {
  const r = acquireLock(base, sessionId, deps);
  if (r.status !== 'acquired') return r;
  (deps.sleep ?? sleepSync)(deps.settleMs ?? PRESENCE_SETTLE_MS);
  const users = othersPresent(base, sessionId, deps);
  if (!users.length) return r;
  r.lock.release();
  return { status: 'inUse', users };
}

/** R6: a synchronized folder copies half-written files; a network location needs a client in SHARED_CLIENTS. */
export function sharedRefusal(risk: LocationRisk, platform: NodeJS.Platform): 'syncedFolder' | 'unsupportedClient' | null {
  if (risk === 'synced') return 'syncedFolder';
  if (risk === 'network' && !SHARED_CLIENTS.includes(platform)) return 'unsupportedClient';
  return null;
}

/** R4: a structure change refused, with who is present (`bc:<code>|<sub-code>|<detail>`: no sub-code, the users as detail). */
export function dataFileInUse(users: LockInfo[]): Error {
  return new Error(`bc:dataFileInUse||${users.map((u) => `${u.user} (${u.host})`).join(', ')}`);
}
