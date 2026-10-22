import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ExprRuntimeError, type Expr } from './ast';
import { evaluate, fromStored, truthy, type EvalEnv } from './evaluate';
import { fail, infoOf } from './library';
import { parseCanonical } from './parser';
import { compileSql, type SqlCompileCtx } from './sql';
import { createBaseFile, openBaseFile } from '../../main/db/file-format';
import { createTable, reconcile, tableDesign } from '../../main/db/schema';
import { quoteIdent, sameName, type TableDesign } from '../field-types';
import { f, t } from '../test-fixtures';

const LOCALE = 'fr-FR';
const T = t('T', [
  f('id', 'autoNumber'), f('txt', 'shortText'), f('n', 'number', { numberSize: 'double' }), f('i', 'number'),
  f('d', 'dateTime'), f('b', 'yesNo'),
]);
// txt, n, i, d, b : Null, accents, casse, apostrophe, %, ;, texte numérique
const DATA: [string | null, number | string | null, number | null, string | null, number][] = [
  ['Dupont', 1, 1, '2026-10-01 00:00:00', 1],
  ['dupont', 2.5, 2, '2026-11-15 00:00:00', 0],
  [null, null, null, null, 0],
  ['été', 3, 3, '2025-12-31 00:00:00', 1],
  ["O'Brien", 1.5, -4, '2026-09-30 23:59:59', 0],
  ['50%', 0, 0, '2026-10-02 12:00:00', 1],
  ['a;b', -2, 10, null, 0],
  ['Été', 2, null, '2026-01-01 00:00:00', 1],
  ['12', 0.1, 7, '2026-10-31 06:00:00', 0],
  ['x', '1,5', 5, '2026-10-31', 1], // valeurs mal formées écrites par un outil externe : texte dans REAL, date sans heure
];
// Table adoptée, créée hors de BaseCraft : colonne INT sans CHECK (texte, BLOB), entiers au-delà de 2^53.
const BIG = 2n ** 60n;
const BLOB = new Uint8Array([1, 2, 3]);
const EXT_DATA: Cell[][] = [
  [1, 1, 1.5, 'a'], [2, 10, '1,5', 'b'], [3, 'abc', null, null], [4, '1,5', 2, 'c'], [5, null, 0, ''],
  [6, BLOB, BLOB, BLOB], [BIG, BIG, 1e300, '12'],
];

type Cell = number | bigint | string | Uint8Array | null;
interface Src { design: TableDesign; ctx: SqlCompileCtx; rows: Record<string, Cell>[] }
let dir: string;
let db: DatabaseSync;
let src: Src; // table T
let ext: Src; // table X adoptée

const load = (name: string): Src => {
  const design = tableDesign(db, name);
  const ctx = { fields: design.fields.map((x) => ({ name: x.name, type: x.props.type, numberSize: x.props.numberSize })), locale: LOCALE };
  const rows = db.prepare(`SELECT * FROM ${quoteIdent(name)} ORDER BY "id"`);
  rows.setReadBigInts(true);
  return { design, ctx, rows: rows.all() as Record<string, Cell>[] };
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcsql-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, T);
  const ins = db.prepare('INSERT INTO "T" ("txt", "n", "i", "d", "b") VALUES (?, ?, ?, ?, ?)');
  for (const r of DATA) ins.run(...r);
  db.exec('CREATE TABLE "X" ("id" INTEGER PRIMARY KEY, "n" INT, "r" REAL, "s" TEXT)');
  const insX = db.prepare('INSERT INTO "X" VALUES (?, ?, ?, ?)');
  for (const r of EXT_DATA) insX.run(...r);
  reconcile(db);
  [src, ext] = [load('T'), load('X')];
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const viaSql = (e: Expr, s: Src = src, c: SqlCompileCtx = s.ctx): number[] => {
  const { sql, params } = compileSql(e, c);
  const q = db.prepare(`SELECT "id" FROM ${quoteIdent(s.design.name)} WHERE ${sql} ORDER BY "id"`);
  q.setReadBigInts(true);
  return (q.all(...params) as { id: bigint }[]).map((r) => Number(r.id));
};

/** Résultat d'une ligne : vrai, faux, Null, ou code de l'erreur d'exécution. */
type Outcome = boolean | null | string;
const outcome = (run: () => boolean | null): Outcome => {
  try {
    return run();
  } catch (err) {
    if (err instanceof ExprRuntimeError) return err.code;
    throw err;
  }
};

/** Champs lus à la demande, comme bc_val : un BLOB n'échoue que si l'expression lit ce champ. */
const envFor = (s: Src, row: Record<string, Cell>, subject?: string): EvalEnv => {
  const field = (name: string) => {
    const fd = s.design.fields.find((x) => sameName(x.name, name)) ?? fail('unknownField');
    return fromStored(fd, row[fd.name]);
  };
  return { field, get subject() { return subject === undefined ? undefined : field(subject); }, now: () => new Date(), locale: LOCALE };
};

async function evalOutcomes(e: Expr, s: Src, subject?: string): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const row of s.rows) {
    let v: Awaited<ReturnType<typeof evaluate>>;
    try {
      v = await evaluate(e, envFor(s, row, subject));
    } catch (err) {
      if (err instanceof ExprRuntimeError) { out.push(err.code); continue; }
      throw err;
    }
    out.push(outcome(() => truthy(v, infoOf(LOCALE))));
  }
  return out;
}

/** Mode 'throw', ligne par ligne : 1/0/NULL ou l'erreur levée par bc_truth. */
function sqlOutcomes(e: Expr, s: Src, c: SqlCompileCtx): Outcome[] {
  const { sql, params } = compileSql(e, c, { onError: 'throw' });
  const q = db.prepare(`SELECT ${sql} AS r FROM ${quoteIdent(s.design.name)} WHERE "id" = ?`);
  q.setReadBigInts(true);
  return s.rows.map((row) => outcome(() => {
    const r = (q.get(...params, row.id) as { r: number | bigint | null }).r;
    return r === null ? null : Number(r) !== 0;
  }));
}

/** Mode 'null' (WHERE) : mêmes lignes que l'évaluateur ; mode 'throw' : même résultat ou même erreur, ligne par ligne. */
async function check(e: Expr, s: Src = src, subject?: string, msg?: string): Promise<Outcome[]> {
  const c = { ...s.ctx, subject };
  const ev = await evalOutcomes(e, s, subject);
  expect(viaSql(e, s, c), msg).toEqual(s.rows.filter((_, k) => ev[k] === true).map((r) => Number(r.id)));
  expect(sqlOutcomes(e, s, c), msg).toEqual(ev);
  return ev;
}

const CASES = ['[txt] = "dupont"', '[txt] Like "D*"', '[txt] & "x" = "Dupontx"', '[n] > 1.5', '[n] Between 1 And 3', '[n] In (1, 2)',
  '[d] >= #2026-10-01#', '[d] + 30 > #2026-11-01#', '[b] = True', 'Not [b]', '[txt] Is Null', 'Len([txt]) > 3', 'IIf([n] > 2, "a", "b") = "a"',
  'Year([d]) = 2026', '[txt] = "O\'Brien"', '[txt] = "50%"', '[txt] Like "*;*"', 'UCase([txt]) = "ÉTÉ"',
  // entiers et logique à trois valeurs
  '[i] > 1', '[i] >= -4 And [i] < 3', '[i] = 2 Or [i] Is Null', 'Not ([i] > 2)', '[i] Is Not Null And Not [i] = 7', '[i] <> [id]',
  '[i] > 2 Or [txt] = "été"', 'Null And [i] > 2', 'Null Or [i] > 2', '[b] Xor [i] > 2', 'Not ([txt] Like "d*")',
  // Empty, texte numérique, erreurs de ligne
  'Nz([n]) = 0', 'Nz([txt]) = ""', '[txt] * 2 > 0', '[txt]', '[n]', '1 / [n] > 1', '[n] In (0, 1 / [n])', '[d] = "31/10/2026 06:00:00"',
  '[b] = -1', '[b] = 1', '([txt] Is Null) & "" = "True"', '[n] & "" = "2,5"', 'True', 'Null',
];
const EXT_CASES = ['[n] > 5', '[n] < 5', '[n] = 1', '[n] + 0 > 5', '[n] In (1, 10)', '[n] Is Not Null', 'Not [n] Is Null', '[n] Is Null Or [n] > 5',
  '[r] > 0', '[s] Is Null', '[s] Is Not Null', '[s] & "" = ""', '[s] Like "*"', '[id] > 100', '[n] = [id]', '[id] Is Not Null'];

describe('compileSql: cross-check with the evaluator', () => {
  it.each(CASES)('%s', async (s) => { await check(parseCanonical(s)); });

  it.each(EXT_CASES)('adopted table without CHECK: %s', async (s) => { await check(parseCanonical(s), ext); });

  it('adopted table: text, BLOB and 2^60 rows behave like the evaluator', async () => {
    expect(await check(parseCanonical('[n] > 5'), ext)).toEqual([false, true, 'typeMismatch', false, null, 'typeMismatch', true]);
    expect(viaSql(parseCanonical('[id] > 100'), ext)).toEqual([Number(BIG)]);
  });

  it.each([['>2', 'n'], ['Like "d*"', 'txt'], ['Between 1 And 3', 'i'], ['Is Null', 'd']])('criteria %s on %s', async (s, subject) => {
    await check(parseCanonical(s, { criteria: true }), src, subject);
  });

  it('random expressions', async () => {
    const gen = generator(0x5eed);
    let nonTrivial = 0;
    for (let k = 0; k < RANDOM_COUNT; k++) {
      const s = gen();
      const ev = await check(parseCanonical(s), src, undefined, s);
      const kept = ev.filter((x) => x === true).length;
      if (kept > 0 && kept < ev.length) nonTrivial++;
    }
    expect(nonTrivial).toBeGreaterThan(RANDOM_COUNT / 4); // le générateur ne produit pas que des cas triviaux
  }, 60_000); // 3000 cas × deux modes : ~5 s, au-delà du délai par défaut
});

describe('compileSql', () => {
  it('literals are parameters', () => {
    const { sql, params } = compileSql(parseCanonical('[txt] = "x\'); DROP TABLE T; --"'), src.ctx);
    expect(sql).not.toContain('DROP');
    expect(params).toContain("x'); DROP TABLE T; --");
  });
  it('unknown field', () => expect(() => compileSql(parseCanonical('[zz] = 1'), src.ctx)).toThrow(expect.objectContaining({ code: 'unknownField' })));
  it('missing subject', () => expect(() => compileSql(parseCanonical('>2', { criteria: true }), src.ctx)).toThrow(expect.objectContaining({ code: 'unknownField' })));
  it('subject', () => expect(compileSql(parseCanonical('>2', { criteria: true }), { ...src.ctx, subject: 'n' }).sql).toContain('"n"'));
  it('field names resolved like Access and quoted', () => {
    const c: SqlCompileCtx = { fields: [{ name: 'Prix "TTC" été', type: 'currency' }], locale: LOCALE };
    expect(compileSql(parseCanonical('[prix "ttc" ÉTÉ] > 1'), c).sql).toContain('"Prix ""TTC"" été"');
  });
  it('no native operator: the declared type does not guarantee the stored class', () => {
    for (const s of ['[i] > 2', '[id] Is Not Null']) expect(compileSql(parseCanonical(s), src.ctx).sql).toMatch(/^bc_truth\(/);
  });
  it('onError: a bad row excludes it, or fails the query on demand', () => {
    const e = parseCanonical('[txt] * 2 > 0');
    expect(viaSql(e)).toEqual([9]);
    const { sql, params } = compileSql(e, src.ctx, { onError: 'throw' });
    expect(() => db.prepare(`SELECT "id" FROM "T" WHERE ${sql}`).all(...params)).toThrow(expect.objectContaining({ code: 'typeMismatch' }));
  });
  it('SQLite limits: In lists and nesting over 900 are rejected with a typed error', () => {
    const list = (k: number) => parseCanonical(`[i] In (${Array.from({ length: k }, (_, j) => j).join(', ')})`);
    const sum = (k: number) => parseCanonical(`[i]${' + 1'.repeat(k)} > 0`);
    expect(viaSql(list(900))).toEqual([1, 2, 4, 6, 7, 9, 10]);
    expect(viaSql(sum(890))).toEqual([1, 2, 4, 5, 6, 7, 9, 10]);
    for (const e of [list(901), sum(900)]) expect(() => compileSql(e, src.ctx)).toThrow(expect.objectContaining({ name: 'ExprSyntaxError', code: 'tooComplex' }));
  });
  it('the schema never needs bc_* functions', () => {
    const p = path.join(dir, 'test.basecraft');
    const plain = new DatabaseSync(p);
    try {
      plain.prepare('INSERT INTO "T" ("txt", "n", "i", "d", "b") VALUES (?, ?, ?, ?, ?)').run('x', 1, 1, '2026-01-01 00:00:00', 1);
      plain.prepare('DELETE FROM "T" WHERE "txt" = ?').run('x');
      expect(() => plain.prepare('SELECT bc_truth(1)').get()).toThrow();
    } finally {
      plain.close();
    }
  });
});

// ---- Générateur d'expressions aléatoires bien typées ----

const RANDOM_COUNT = 3000;
type Ty = 'num' | 'str' | 'date' | 'bool';

function generator(seed: number): () => string {
  let s = seed >>> 0;
  const rnd = (): number => { // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <X>(xs: readonly X[]): X => xs[Math.floor(rnd() * xs.length)];
  const p = (x: string): string => `(${x})`;
  const quote = (x: string): string => `"${x.replace(/"/g, '""')}"`;
  const CMP = ['=', '<>', '<', '<=', '>', '>='];

  const leaf: Record<Ty, () => string> = {
    num: () => pick(['[n]', '[i]', '[id]', '0', '1', '2', '1.5', '-2', '3', '10', 'Null']),
    str: () => pick(['[txt]', '[txt]', quote(pick(['dupont', 'ÉTÉ', 'été', '', "O'Brien", '50%', ';', '12', 'a', 'Z', '2,5'])), 'Null']),
    date: () => pick(['[d]', '[d]', '#2026-10-01#', '#2026-01-01 12:00:00#', '#2025-12-31#', 'Null']),
    bool: () => pick(['[b]', '[b]', 'True', 'False', 'Null']),
  };
  const node: Record<Ty, (d: number) => string> = {
    num: (d) => pick([
      () => `${p(g('num', d))} ${pick(['+', '-', '*', '/'])} ${p(g('num', d))}`,
      () => `-${p(g('num', d))}`,
      () => `Len(${g('str', d)})`, () => `Year(${g('date', d)})`,
      () => `IIf(${g('bool', d)}, ${g('num', d)}, ${g('num', d)})`, () => `Nz(${g('num', d)}, ${g('num', d)})`, () => `Nz(${g('num', d)})`,
      () => `${p(g('date', d))} - ${p(g('date', d))}`,
    ])(),
    str: (d) => pick([
      () => `${p(g(pick(['str', 'str', 'num', 'date', 'bool'] as const), d))} & ${p(g('str', d))}`,
      () => `Left(${g('str', d)}, ${pick(['0', '1', '2', '[i]'])})`, () => `UCase(${g('str', d)})`,
      () => `IIf(${g('bool', d)}, ${g('str', d)}, ${g('str', d)})`, () => `Nz(${g('str', d)}, ${g('str', d)})`, () => `Nz(${g('str', d)})`,
    ])(),
    date: (d) => pick([
      () => `DateAdd(${quote(pick(['d', 'm', 'yyyy', 'h']))}, ${pick(['1', '-1', '30', '[i]'])}, ${g('date', d)})`,
      () => `${p(g('date', d))} + ${p(g('num', d))}`,
    ])(),
    bool: (d) => pick([
      () => { const ty = pick(['num', 'num', 'str', 'str', 'date', 'bool'] as const); return `${p(g(ty, d))} ${pick(CMP)} ${p(g(ty, d))}`; },
      () => `${p(g(pick(['num', 'str', 'date'] as const), d))} ${pick(CMP)} ${p(g(pick(['num', 'str', 'date'] as const), d))}`, // types mêlés
      () => `${p(g('str', d))} ${pick(['Like', 'Not Like'])} ${quote(pick(['d*', '*T*', '[a-e]*', '?????', '#*', '*;*', '*%', 'É*', '*']))}`,
      () => `${p(g('num', d))} ${pick(['In', 'Not In'])} (${g('num', d)}, ${g('num', d)})`,
      () => `${p(g('str', d))} In (${g('str', d)}, ${g('str', d)}, ${g('str', d)})`,
      () => { const ty = pick(['num', 'str', 'date'] as const); return `${p(g(ty, d))} ${pick(['Between', 'Not Between'])} ${p(g(ty, d))} And ${p(g(ty, d))}`; },
      () => `${p(g(pick(['num', 'str', 'date', 'bool'] as const), d))} ${pick(['Is Null', 'Is Not Null'])}`,
      () => `${p(g('bool', d))} ${pick(['And', 'Or', 'Xor'])} ${p(g('bool', d))}`,
      () => `Not ${p(g('bool', d))}`,
    ])(),
  };
  function g(ty: Ty, depth: number): string {
    return depth <= 0 || rnd() < 0.3 ? leaf[ty]() : node[ty](depth - 1);
  }
  return () => (rnd() < 0.9 ? g('bool', 4) : g(pick(['num', 'str', 'date'] as const), 3));
}
