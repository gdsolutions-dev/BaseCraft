// « Compacter lors de la fermeture » (O1 R8): closeBase() runs this before the data process closes the base. It is Compact and
// Repair itself (Session.compact → copy-file.ts compactBase: a backup first, a checked copy, an atomic rename, the original kept
// on any failure), not a second implementation.
import type { CompactResult, SessionState } from '../shared/api';
import type { StartupOptions } from '../shared/startup';

/** How long the options read may wait behind a call already running in the data process (a long query): as long as the close
 *  itself (DbHost.close), so a quit is never held longer than before by a base it was not going to compact. */
export const OPTIONS_READ_MS = 3000;

/**
 * Compacts the base being closed when its options ask for it. Never on a base this session cannot write (opened read-only,
 * another session's lock, to recover), nor on a data file open in shared mode, nor on one still busy after OPTIONS_READ_MS (skipped: the close goes on and kills the
 * data process as it always did). The backup (spec 6) is dropped only after a compact that succeeded and repaired nothing
 * (G5): it stays when the compact repaired something or failed — compactBase itself drops it when the swap was refused before
 * the rename (the original unchanged). Never throws: a close always goes on.
 */
export async function compactOnClose(
  s: { startup(): Promise<StartupOptions>; compact(): Promise<CompactResult> },
  state: Pick<SessionState, 'readOnly' | 'needsRecovery' | 'shared'>,
  unlink: (p: string) => void,
): Promise<'compacted' | 'skipped' | 'failed'> {
  if (state.readOnly || state.needsRecovery || state.shared) return 'skipped'; // shared (C3 R4): it would need everyone else gone
  try {
    let timer: NodeJS.Timeout | undefined;
    const options = await Promise.race([s.startup(), new Promise<null>((r) => { timer = setTimeout(r, OPTIONS_READ_MS, null); })])
      .finally(() => clearTimeout(timer));
    if (!options) {
      console.error(`compact on close skipped: the base is busy with a call that did not end within ${OPTIONS_READ_MS} ms`);
      return 'skipped';
    }
    if (!options.compactOnClose) return 'skipped';
    const r = await s.compact();
    if (!r.ok) {
      console.error(`compact on close: the base has problems the copy could not fix (${r.problems.join('; ')}); backup kept: ${r.backupPath}`);
      return 'failed';
    }
    if (r.repaired.length === 0) {
      try { unlink(r.backupPath); } catch (e) { console.error(e); } // the base is compacted; at worst a backup stays
    }
    return 'compacted';
  } catch (e) {
    console.error('compact on close failed (the original is kept, or replaced only by a checked copy; its backup stays):', e);
    return 'failed';
  }
}

/**
 * While a compact runs the base is already out of `host` (closeBase), so the main process's heartbeat skips it: beat its lock
 * here, or another workstation takes it over after 30 s, under the swap. After `after` ms, `notice` tells the user the close
 * is waiting (the window may be gone) and returns what ends it. Both calls are the caller's; a failure of either is logged.
 */
export async function whileCompacting<T>(
  run: Promise<T>, o: { beat(): void; notice(): () => void; every: number; after: number },
): Promise<T> {
  const log = (f: () => void) => { try { f(); } catch (e) { console.error(e); } };
  let end: (() => void) | undefined;
  log(o.beat);   // at once: the main process's last beat may be nearly 10 s old
  const beat = setInterval(() => log(o.beat), o.every);
  const notice = setTimeout(() => log(() => { end = o.notice(); }), o.after);
  try {
    return await run;
  } finally {
    clearInterval(beat);
    clearTimeout(notice);
    if (end) log(end);
  }
}
