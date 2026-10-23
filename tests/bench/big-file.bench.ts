// Banc du gros fichier (spec 6 : « un fichier de plusieurs gigaoctets reste utilisable »). Hors CI : seulement avec BASECRAFT_BENCH_BIG=1.
// Base de 10 millions de lignes (~2 Go) construite une fois dans le dossier temporaire par des INSERT bruts en une transaction
// (amorçage de banc, pas du code de l'application), supprimée à la fin sauf BASECRAFT_BENCH_KEEP=1.
// BASECRAFT_BENCH_BIG_ROWS réduit le nombre de lignes pour un essai rapide du banc lui-même.
import { mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { createBaseFile, openBaseFile } from '../../src/main/db/file-format';
import { countRows, readRows } from '../../src/main/db/rows';
import { createTable, reconcile } from '../../src/main/db/schema';
import { f, t } from '../../src/shared/test-fixtures';
import { assertUnder } from './thresholds';

const BIG = process.env.BASECRAFT_BENCH_BIG === '1';
const ROWS = Number(process.env.BASECRAFT_BENCH_BIG_ROWS ?? 10_000_000);
const BATCH = 500_000;
const design = t('Big', [f('N°', 'autoNumber'), f('Code', 'shortText', { size: 50, indexed: 'yesDuplicates' }), f('Libellé', 'shortText', { size: 255 }),
  f('Quantité', 'number'), f('Date', 'dateTime'), f('Prix', 'currency')]);

let dir = '', file = '', db: DatabaseSync;
const times: Record<string, number[]> = { open: [], page: [], count: [] };
const timed = <T>(k: string, fn: () => T): T => { const t0 = performance.now(); const r = fn(); times[k].push(performance.now() - t0); return r; };
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

beforeAll(() => {
  if (!BIG) return;
  dir = mkdtempSync(join(tmpdir(), 'basecraft-big-'));
  const need = ROWS * 250; // ~200 octets par ligne + index + marge
  const s = statfsSync(dir);
  if (s.bavail * s.bsize < need) throw new Error(`espace disque insuffisant dans ${dir} : ${(s.bavail * s.bsize / 1e9).toFixed(1)} Go libres, ${(need / 1e9).toFixed(1)} Go requis`);
  file = join(dir, 'Big.basecraft');
  createBaseFile(file, '0.0.0');
  ({ db } = openBaseFile(file, 'write', '0.0.0'));
  createTable(db, design);
  db.exec('BEGIN');
  for (let from = 0; from < ROWS; from += BATCH) {
    const to = Math.min(from + BATCH, ROWS);
    db.exec(`WITH RECURSIVE s(i) AS (SELECT ${from} UNION ALL SELECT i + 1 FROM s WHERE i + 1 < ${to})
      INSERT INTO "Big" ("Code", "Libellé", "Quantité", "Date", "Prix")
      SELECT 'C' || ((i * 7919) % ${ROWS}), 'Libellé ' || i || ' ' || hex(randomblob(80)), i % 1000,
        '2026-01-' || printf('%02d', 1 + (i % 28)) || ' 00:00:00', (i % 10000) / 100.0 FROM s`);
  }
  db.exec('COMMIT');
  db.close();
}, 3_600_000);

afterAll(() => {
  if (!BIG) return;
  if (process.env.BASECRAFT_BENCH_KEEP !== '1') rmSync(dir, { recursive: true, force: true });
  else console.log(`BENCH gros fichier conservé : ${file}`);
  const ms = { open: median(times.open), page: median(times.page), count: median(times.count) };
  console.log(`BENCH gros fichier ${ROWS} lignes (médianes, ms) : ouverture+réconciliation ${ms.open.toFixed(1)}, première page non triée ${ms.page.toFixed(1)}, comptage ${ms.count.toFixed(1)}`);
  assertUnder('gros fichier : ouverture', ms.open, 1000);
  assertUnder('gros fichier : première page', ms.page, 100);
  assertUnder('gros fichier : comptage', ms.count, 2000);
});

const run = { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 };
describe.skipIf(!BIG)('gros fichier', () => {
  test('ouverture + réconciliation', async ({ bench }) => {
    await bench('ouverture', () => {
      timed('open', () => {
        const o = openBaseFile(file, 'write', '0.0.0');
        try { reconcile(o.db); } finally { o.db.close(); }
      });
    }).run(run);
  }, 600_000);
  test('première page non triée', async ({ bench }) => {
    const o = openBaseFile(file, 'write', '0.0.0'); db = o.db;
    await bench('page', () => { timed('page', () => readRows(db, design, { offset: 0, limit: 200 })); }).run(run);
  }, 600_000);
  test('comptage', async ({ bench }) => {
    await bench('comptage', () => { timed('count', () => countRows(db, 'Big')); }).run(run);
    db.close();
  }, 600_000);
});
