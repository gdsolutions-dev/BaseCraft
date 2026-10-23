// Bancs de la lecture paginée sur 100 000 lignes. Seuils bloquants seulement avec BASECRAFT_BENCH_STRICT=1 (recette de fin d'étape A, en A6).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { createBaseFile, openBaseFile } from '../../src/main/db/file-format';
import { countRows, readRows } from '../../src/main/db/rows';
import { createTable, reconcile } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { assertUnder, STRICT } from './thresholds';

const ROWS = 100_000;
const design = t('Mesures', [f('N°', 'autoNumber'), f('Libellé', 'shortText', { size: 50 }), f('Quantité', 'number'), f('Date', 'dateTime'), f('Prix', 'currency')]);

let dir: string, file: string, db: DatabaseSync;
const times: Record<string, number[]> = { page: [], cold: [], count: [], open: [] };
const timed = <T>(k: string, fn: () => T): T => { const t0 = performance.now(); const r = fn(); times[k].push(performance.now() - t0); return r; };
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'basecraft-bench-'));
  file = join(dir, 'Mesures.basecraft');
  createBaseFile(file, '0.0.0');
  ({ db } = openBaseFile(file, 'write', '0.0.0'));
  createTable(db, design);
  const info = localeInfo('fr-FR');
  db.exec('BEGIN'); // one commit: with synchronous=FULL, one per row would take ~40 ms each
  for (let i = 0; i < ROWS; i++) {
    const r = await insertRow(db, design, { 'Libellé': `Libellé ${(i * 7919) % ROWS}`, 'Quantité': i % 1000, Date: `2026-01-${String(1 + (i % 28)).padStart(2, '0')} 00:00:00`, Prix: (i % 10000) / 100 }, info);
    if (!r.ok) throw new Error('seed failed');
  }
  db.exec('COMMIT');
}, 300_000);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  const ms = { page: median(times.page), cold: median(times.cold), count: median(times.count), open: median(times.open) };
  console.log(`BENCH ${ROWS} lignes (médianes, ms) : page triée ${ms.page.toFixed(1)} (instantané présent), première page triée ${ms.cold.toFixed(1)} (instantané construit), comptage ${ms.count.toFixed(1)}, ouverture+réconciliation ${ms.open.toFixed(1)}`);
  const perf = join(__dirname, '../../test-results/perf-a1.json');
  const startup = existsSync(perf) ? (JSON.parse(readFileSync(perf, 'utf8')) as { startupMs: number }).startupMs : undefined;
  console.log(`BENCH démarrage (perf-a1.json) : ${startup ?? 'absent'} ms`);
  const failures: string[] = []; // every threshold checked: one failure does not hide the others
  const check = (label: string, median: number, limit: number) => { try { assertUnder(label, median, limit); } catch (e) { failures.push((e as Error).message); } };
  check('page triée', ms.page, 50);
  check('première page triée', ms.cold, 1500);
  check('comptage', ms.count, 20);
  check('ouverture', ms.open, 300);
  if (startup === undefined && STRICT) failures.push('perf-a1.json absent (lancer npm run e2e avant)');
  if (startup !== undefined) check('démarrage', startup, 3000);
  if (failures.length) throw new Error(failures.join('; '));
});

const run = { iterations: 15, warmupIterations: 2, time: 0, warmupTime: 0 };
describe('100 000 lignes', () => {
  // As the data process pages (Session.pageSource): with its write sequence, a text sort is served by a sorted-order snapshot.
  const page = (seq: number) => readRows(db, design, { offset: 50_000, limit: 200, sort: { field: 'Libellé', dir: 'asc' } }, 'fr-FR', undefined, seq);
  test('page 50 000 x 200 triée sur le texte (instantané présent)', async ({ bench }) => {
    page(0); // one warm-up request builds the snapshot
    await bench('page', () => { timed('page', () => page(0)); }).run({ ...run, warmupIterations: 0 });
  });
  let seq = 0;
  test('première page triée sur le texte (instantané construit)', async ({ bench }) => {
    await bench('première page', () => { timed('cold', () => page(++seq)); }).run({ ...run, iterations: 5, warmupIterations: 0 }); // a new write sequence each time
  });
  test('comptage', async ({ bench }) => {
    await bench('comptage', () => { timed('count', () => countRows(db, 'Mesures')); }).run(run);
  });
  test('ouverture + réconciliation', async ({ bench }) => {
    await bench('ouverture', () => {
      timed('open', () => {
        const o = openBaseFile(file, 'write', '0.0.0');
        try { reconcile(o.db); } finally { o.db.close(); }
      });
    }).run(run);
  });
});
