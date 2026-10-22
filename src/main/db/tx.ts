import type { DatabaseSync } from 'node:sqlite';

/** Exécute fn atomiquement : valide seul hors transaction, sinon n'annule que son propre travail (savepoint). */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
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

/** inTransaction pour un travail qui rend la main (import long, avec progression) : le savepoint reste ouvert entre deux
 *  étapes. L'appelant garantit qu'aucune autre écriture ne s'intercale (assistant modal). */
export async function inTransactionAsync<T>(db: DatabaseSync, fn: () => Promise<T>): Promise<T> {
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
