// Save As and Compact and Repair (data process): one copy primitive, VACUUM INTO a temporary file checked by
// PRAGMA integrity_check, then renamed into place. The original is never modified before the copy has passed the check,
// and Compact makes a backup first (spec 6, data safety).
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { CompactResult } from '../../shared/api';
import { backupCopy } from './file-format';

export type { CompactResult };

/** Test seams: the rename into place, and the integrity check (its problems; none when PRAGMA integrity_check says `ok`). */
export interface CopyDeps {
  rename?: (from: string, to: string) => void;
  check?: (db: DatabaseSync) => string[];
  /** Just before the target is touched (journal removed, rename): throws to keep it as it is (Save As: its lock re-checked). */
  beforeReplace?: () => void;
}

function integrityProblems(db: DatabaseSync): string[] {
  const rows = (db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check);
  return rows.length === 1 && rows[0] === 'ok' ? [] : rows;
}

/** A `bc:` error stays; anything else (disk full, permission, locked file) becomes `bc:copyFailed|<errno>|<message>`. */
function typed(e: unknown): Error {
  if (e instanceof Error && e.message.startsWith('bc:')) return e;
  const code = (e as NodeJS.ErrnoException)?.code ?? 'error';
  return new Error(`bc:copyFailed|${code}|${e instanceof Error ? e.message : String(e)}`);
}
const remove = (f: string) => { try { fs.rmSync(f, { force: true }); } catch (e) { console.error(e); } };

/** A consistent copy of the open base at `target`: written to `${target}.bc-tmp`, checked, then renamed over `target`
 *  (an existing target is replaced only then). The temporary file is removed on any failure. */
export function vacuumInto(db: DatabaseSync, target: string, deps: CopyDeps = {}): void {
  const rename = deps.rename ?? fs.renameSync;
  const check = deps.check ?? integrityProblems;
  const tmp = `${target}.bc-tmp`;
  try {
    fs.rmSync(tmp, { force: true }); // left by a crash: VACUUM INTO refuses an existing file
    db.setAuthorizer(null); // A3's authorizer (which denies VACUUM) acts only inside authorizedPrepare: never here
    db.prepare('VACUUM INTO ?').run(tmp);
    const copy = new DatabaseSync(tmp, { readOnly: true });
    let problems: string[];
    try { problems = check(copy); } finally { copy.close(); }
    if (problems.length) throw new Error('bc:copyCorrupt');
    deps.beforeReplace?.(); // a target locked meanwhile keeps its hot journal: never removed under a live instance
    // A journal left beside the target (a crash of an older file there) would be rolled back into the new copy: corruption.
    fs.rmSync(`${target}-journal`, { force: true });
    rename(tmp, target);
  } catch (e) {
    remove(tmp);
    throw typed(e);
  }
}

/**
 * Compact and Repair: checks the open base, backs it up, writes a compacted copy beside it (`<path>.compact`), then closes
 * the session's handle (Windows cannot rename over an open file), renames the copy over the base and reopens it. The write
 * lock file is never touched. A base whose copy fails while it has problems: `corrupt`, the original untouched. The backup stays
 * after a repair, a corrupt result or any failure, except when the swap itself is refused (the original then unchanged and
 * reopened): the backup would repeat it, and is removed.
 */
export async function compactBase(
  s: { db(): DatabaseSync; path: string; reopen(): void; close(): void }, deps: CopyDeps & { now?: Date } = {},
): Promise<CompactResult> {
  const rename = deps.rename ?? fs.renameSync;
  const problems = (deps.check ?? integrityProblems)(s.db());
  let sizeBefore: number;
  let backupPath: string;
  try {
    sizeBefore = fs.statSync(s.path).size;
    backupPath = backupCopy(s.path, deps.now);
  } catch (e) {
    throw typed(e);
  }
  const tmp = `${s.path}.compact`;
  try {
    vacuumInto(s.db(), tmp, deps);
  } catch (e) {
    if (problems.length) return { ok: false, reason: 'corrupt', problems, backupPath };
    throw e;
  }
  s.close();
  try {
    rename(tmp, s.path);
  } catch (e) {
    remove(tmp);
    try {
      s.reopen(); // the original, untouched; the rename's error is the one told
      remove(backupPath); // swap refused before anything changed and the base opens again: the backup only repeats it (O1 G5)
    } catch (e2) { console.error(e2); }
    throw typed(e);
  }
  try {
    s.reopen();
  } catch (e) {
    throw new Error(`bc:reopenFailed|${(e as NodeJS.ErrnoException)?.code ?? 'error'}|${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: true, backupPath, sizeBefore, sizeAfter: fs.statSync(s.path).size, repaired: problems };
}
