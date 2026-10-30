// Database Tools › Split Database (C3 R12): the front-end's local tables move to a new data file, which the front-end then links.
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { addLinks } from '../links/store';
import { vacuumInto } from './copy-file';
import { openBaseFile } from './file-format';
import { listTables, removeTable } from './schema';
import { saveStartupOptions, startupOptions } from './startup';
import { inTransaction } from './tx';

/** R12 steps 2–4 (the caller made the backup). Returns the tables moved; throws, leaving the front-end unchanged and no target.
 *  The data file is a checked copy (VACUUM INTO): tables, rows, rules, relations, lookups and saved queries (a lookup's Row Source
 *  may name one, resolved in the file that owns the field, C1 R6); no forms, reports, macros, modules or links; a new db_uuid and
 *  `{ startup: { dataFile: true } }` as its only options. The front-end loses its tables and relations, and links the tables under
 *  the same names (relative path on one volume, C1 R5). */
export function splitDatabase(front: DatabaseSync, frontPath: string, target: string, appVersion: string,
  deps: { removeTable?: typeof removeTable /* test seam */; beforeReplace?: () => void /* the target checked again (Save As) */ } = {}): string[] {
  const remove = deps.removeTable ?? removeTable;
  const tables = listTables(front).map((x) => x.name);
  vacuumInto(front, target, { beforeReplace: deps.beforeReplace }); // refused there: the target is not ours, left as it is
  try {
    const d = openBaseFile(target, 'write', appVersion).db;
    try {
      inTransaction(d, () => {
        d.exec(`DELETE FROM bc_objects WHERE kind <> 'query'; DELETE FROM bc_links; DELETE FROM bc_sources`);
        const set = d.prepare('INSERT INTO bc_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        set.run('db_uuid', randomUUID());
        set.run('options', JSON.stringify({ startup: { dataFile: true } }));
      });
    } finally { d.close(); }
    inTransaction(front, () => {
      front.exec('PRAGMA defer_foreign_keys=ON; DELETE FROM bc_relations');
      for (const t of tables) remove(front, t);
      addLinks(front, frontPath, 'basecraft', target, tables);
      saveStartupOptions(front, { ...startupOptions(front), frontEnd: true, dataFile: false }); // a data file split again
    });
  } catch (e) {
    rmSync(target, { force: true });
    throw e;
  }
  return tables;
}
