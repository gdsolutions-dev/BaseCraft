// Banc des requêtes (A3 Task 12) : 10 000 Clients, 100 000 Commandes, chaque requête avec et sans chemin natif (fastPath).
// La jointure sans chemin natif est une boucle imbriquée de 10^9 paires, chacune 4 appels JS : en entier, elle épuise le tas
// (node:sqlite garde chaque résultat de fonction jusqu'à la fin de l'instruction : ~4 Go vers 10^7 paires). Elle est mesurée
// sur 10 Clients (10^6 paires) et extrapolée x1000, au nombre de paires. La page (d) sans chemin natif compte cette jointure :
// au moins (a), non mesurée.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { createBaseFile, openBaseFile } from '../../src/main/db/file-format';
import { createTable, isTableName, tableDesign } from '../../src/main/db/schema';
import { authorizedPrepare } from '../../src/main/query/authorizer';
import { compileSelect } from '../../src/main/query/compile';
import { bindQuery, type QueryCatalog } from '../../src/shared/query/bind';
import { parseSql } from '../../src/shared/query/sql-parser';
import { f, t } from '../../src/shared/test-fixtures';
import { assertUnder } from './thresholds';

const CLIENTS = 10_000;
const ORDERS = 100_000;
const SMALL = 10; // Clients of the extrapolated join
const VILLES = ['Lyon', 'LYON', 'Paris', 'Lyôn', 'Marseille', 'lyon', 'Nantes', 'Lille'];
const JOIN = 'FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client';
const Q = {
  a: `SELECT Count(*) ${JOIN}`,
  aSmall: 'SELECT Count(*) FROM Petits INNER JOIN Commandes ON Petits.[N°] = Commandes.Client',
  b: 'SELECT * FROM Commandes WHERE [N°] = 5000',
  c: 'SELECT * FROM Clients WHERE Ville = "Lyon"',
  d: `SELECT Nom, Ville, Montant ${JOIN}`,
};

let dir: string, db: DatabaseSync;
const catalog: QueryCatalog = { table: (name) => (isTableName(db, name) ? tableDesign(db, name) : null), query: () => null };
const compiled = (sql: string, fastPath: boolean) => compileSelect(bindQuery(parseSql(sql), catalog), {}, { locale: 'fr-FR', fastPath });
const all = (sql: string, params: unknown[]) => authorizedPrepare(db, sql).all(...(params as never[]));
/** (d): what pageQuerySource runs for a page, the count and the rows at offset 90 000. */
const page = (fastPath: boolean) => {
  const c = compiled(Q.d, fastPath);
  all(`SELECT count(*) FROM (${c.sql})`, c.params);
  return all(`SELECT * FROM (${c.sql}) AS "bcx_q" LIMIT ? OFFSET ?`, [...c.params, 200, 90_000]);
};
const RUNS: Record<string, (fp: boolean) => unknown> = {
  a: (fp) => { const c = compiled(Q.a, fp); return all(c.sql, c.params); },
  aSmall: (fp) => { const c = compiled(Q.aSmall, fp); return all(c.sql, c.params); },
  b: (fp) => { const c = compiled(Q.b, fp); return all(c.sql, c.params); },
  c: (fp) => { const c = compiled(Q.c, fp); return all(c.sql, c.params); },
  d: page,
};

const times: Record<string, number[]> = {};
const timed = (k: string, fn: () => unknown): void => { const t0 = performance.now(); fn(); (times[k] ??= []).push(performance.now() - t0); };
const median = (a: number[] = []) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'basecraft-qbench-'));
  const file = join(dir, 'Ventes.basecraft');
  createBaseFile(file, '0.0.0');
  ({ db } = openBaseFile(file, 'write', '0.0.0'));
  const clients = (name: string) => t(name, [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText')]);
  createTable(db, clients('Clients'));
  createTable(db, clients('Petits'));
  createTable(db, t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }), f('Montant', 'currency')]));
  db.exec('BEGIN');
  const c = db.prepare('INSERT INTO "Clients" ("Nom", "Ville") VALUES (?, ?)');
  for (let i = 1; i <= CLIENTS; i++) c.run(`Client ${i}`, VILLES[i % VILLES.length]);
  db.exec(`INSERT INTO "Petits" SELECT * FROM "Clients" WHERE rowid <= ${SMALL}`);
  const o = db.prepare('INSERT INTO "Commandes" ("Client", "Montant") VALUES (?, ?)');
  for (let i = 0; i < ORDERS; i++) o.run(i % 50 === 0 ? null : 1 + ((i * 7919) % CLIENTS), (i % 10_000) / 100);
  db.exec('COMMIT');
}, 300_000);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  const ms = (k: string) => median(times[k]);
  const aUdf = ms('aSmall/udf') * (CLIENTS / SMALL);
  const line = (k: string, udf: number) => `${k} : sans ${udf.toFixed(1)} ms, natif ${ms(`${k}/native`).toFixed(2)} ms, x${(udf / ms(`${k}/native`)).toFixed(0)}`;
  console.log([
    `BENCH requêtes ${CLIENTS} Clients x ${ORDERS} Commandes (médianes, ms)`,
    `${line('a', aUdf)} (sans : ${SMALL} Clients ${ms('aSmall/udf').toFixed(0)} ms x${CLIENTS / SMALL}, extrapolé ; natif sur ${SMALL} Clients ${ms('aSmall/native').toFixed(2)} ms)`,
    line('b', ms('b/udf')), line('c', ms('c/udf')),
    `d : sans >= (a) sans (la page compte la jointure entière), natif ${ms('d/native').toFixed(1)} ms`,
  ].join('\n'));
  assertUnder('page (d) 90 000 x 200', ms('d/native'), 100); // the only strict threshold here: nothing for it to hide
});

const run = { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 };
const once = { iterations: 1, warmupIterations: 0, time: 0, warmupTime: 0 };
describe(`${CLIENTS} Clients x ${ORDERS} Commandes`, () => {
  for (const [k, label] of [['a', '(a) jointure + Count(*)'], ['aSmall', `(a) jointure sur ${SMALL} Clients`], ['b', '(b) WHERE [N°] = 5000'],
    ['c', '(c) WHERE Ville = "Lyon"'], ['d', '(d) page 90 000 de la feuille de (a)']] as const) {
    for (const fp of [true, false]) {
      if ((k === 'a' || k === 'd') && !fp) continue; // 10^9 appels JS : (a) extrapolé depuis aSmall, (d) compte (a) en entier
      const name = `${label} ${fp ? 'natif' : 'sans chemin natif'}`;
      test(name, async ({ bench }) => {
        await bench(name, () => timed(`${k}/${fp ? 'native' : 'udf'}`, () => RUNS[k](fp))).run(k === 'aSmall' && !fp ? once : run);
      }, 600_000);
    }
  }
});
