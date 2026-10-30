import type { DatabaseSync } from 'node:sqlite';

let busyRetries = 2;
let busyRetryMs = 250;

/** R7: the retries of a busy BEGIN IMMEDIATE, for this data process (one session per process). Default 2 × 250 ms. */
export function setBusyRetry(count: number, intervalMs: number): void {
  busyRetries = count;
  busyRetryMs = intervalMs;
}

const cell = new Int32Array(new SharedArrayBuffer(4));
/** The one synchronous sleep of the data process (Atomics.wait): R7's retries and presence.ts's settle wait (R5). */
export function sleepSync(ms: number): void {
  if (ms > 0) Atomics.wait(cell, 0, 0, ms);
}

const isBusy = (e: unknown) => ((e as { errcode?: number })?.errcode ?? 0) % 256 === 5; // SQLITE_BUSY and its extended codes
/** A statement of the write that stayed busy past busy_timeout (another workstation's lock): bc:busy, as a busy BEGIN or COMMIT. */
const busyOr = (e: unknown) => (isBusy(e) ? new Error('bc:busy') : e);

/** BEGIN IMMEDIATE: the write lock is taken first (a busy file fails here, before any work). Busy after busy_timeout: retried
 *  busyRetries times busyRetryMs apart (the data process has nothing else to do meanwhile), then bc:busy. */
function begin(db: DatabaseSync): void {
  for (let i = 0; ; i++) {
    try {
      db.exec('BEGIN IMMEDIATE');
      return;
    } catch (e) {
      if (!isBusy(e)) throw e;
      if (i >= busyRetries) throw new Error('bc:busy');
      sleepSync(busyRetryMs);
    }
  }
}

function rollback(db: DatabaseSync): void {
  try { if (db.isTransaction) db.exec('ROLLBACK'); } catch { /* transaction déjà terminée, ou connexion fermée */ }
}

/** COMMIT; a failed one is rolled back (no transaction is left open), a busy one reported bc:busy. */
function commit(db: DatabaseSync): void {
  try {
    db.exec('COMMIT');
  } catch (e) {
    rollback(db);
    throw busyOr(e);
  }
}

/** Exécute fn atomiquement. Outside a transaction: BEGIN IMMEDIATE (busy after busy_timeout: retried, then bc:busy) … COMMIT
 *  (busy: ROLLBACK, bc:busy; fn failing busy too). Inside one: SAVEPOINT bcx_w, which only undoes its own work. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (!db.isTransaction) {
    begin(db);
    let r: T;
    try { r = fn(); } catch (e) { rollback(db); throw busyOr(e); }
    commit(db);
    return r;
  }
  db.exec('SAVEPOINT bcx_w');
  try {
    const r = fn();
    db.exec('RELEASE bcx_w');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK TO bcx_w; RELEASE bcx_w'); } catch { /* transaction déjà terminée par SQLite */ }
    throw e;
  }
}

/** inTransaction pour un travail qui rend la main (import long, avec progression) : la transaction reste ouverte entre deux
 *  étapes. Aucune autre écriture ne s'intercale : le processus de données exécute
 *  les appels de la session un à un (db-host/host.ts). */
export async function inTransactionAsync<T>(db: DatabaseSync, fn: () => Promise<T>): Promise<T> {
  if (!db.isTransaction) {
    begin(db);
    let r: T;
    try { r = await fn(); } catch (e) { rollback(db); throw busyOr(e); }
    commit(db);
    return r;
  }
  db.exec('SAVEPOINT bcx_w');
  try {
    const r = await fn();
    db.exec('RELEASE bcx_w');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK TO bcx_w; RELEASE bcx_w'); } catch { /* transaction déjà terminée, ou connexion fermée */ }
    throw e;
  }
}
