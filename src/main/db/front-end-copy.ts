// BaseCraft Runtime (C3 R14): a front-end opened from a share runs from a local copy, as Access users copy theirs to each PC.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { vacuumInto } from './copy-file';
import { detectLocationRisk, type RiskProbe } from './location-risk';
import { peekLock, type LockDeps } from './lock';
import { peekStartup } from './startup';

const under = (p: string, d: string) => { const r = relative(d, p); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };

/** R14: the path the Runtime opens — `original` itself unless it is a front-end on a network location, then its local copy in
 *  `<cacheDir>/<db_uuid>/<file name>`, (re)made by VACUUM INTO when absent or when the original's size or mtime differs from
 *  `<copy>.origin.json`, never replaced while a live session holds the copy's lock. Any failure: `original`. */
export function localFrontEnd(original: string, cacheDir: string, probe: RiskProbe, deps: { lockDeps?: LockDeps;
  networkDirs?: string[] /* e2e only: originals under them count as on a share; read by localFrontEnd alone, never by
                            detectLocationRisk, so R6 still sees the data file beside them as local (Linux CI keeps shared mode) */ } = {}): string {
  try {
    if (peekStartup(original)?.frontEnd !== true) return original;
    if (detectLocationRisk(original, probe) !== 'network' && !deps.networkDirs?.some((d) => under(original, d))) return original;
    const st = statSync(original); // before the snapshot: a change during the copy is taken at the next opening
    // the original named too: two originals of one db_uuid and name (a test share and a prod share) never share a copy
    const stamp = JSON.stringify({ original, size: st.size, mtimeMs: st.mtimeMs });
    const db = new DatabaseSync(original, { readOnly: true, timeout: 5000 });
    try {
      const uuid = (db.prepare(`SELECT value FROM bc_meta WHERE key = 'db_uuid'`).get() as { value?: unknown } | undefined)?.value;
      if (typeof uuid !== 'string' || !/^[\w-]+$/.test(uuid)) return original; // a file's content names a folder: no path in it
      const copy = join(cacheDir, uuid, basename(original));
      const meta = `${copy}.origin.json`;
      const live = () => { const l = peekLock(copy, deps.lockDeps); return !!l && !l.stale; };
      if (existsSync(copy)) {
        let text = '';
        let prev: { original?: unknown } | null = null;
        try { text = readFileSync(meta, 'utf8'); prev = JSON.parse(text) as { original?: unknown }; } catch { /* no stamp: copied again */ }
        if (text === stamp) return copy;
        // another Runtime window has it open: kept, the next opening takes the new version; another original's: in place
        if (live()) return prev?.original === original ? copy : original;
      }
      mkdirSync(join(cacheDir, uuid), { recursive: true });
      // checked again before the rename: a window that opened the copy during VACUUM INTO keeps it (the catch: the original)
      vacuumInto(db, copy, { beforeReplace: () => { if (live()) throw new Error('bc:targetInUse'); } });
      writeFileSync(meta, stamp);
      return copy;
    } finally { db.close(); }
  } catch (e) {
    console.error(e);
    return original;
  }
}
