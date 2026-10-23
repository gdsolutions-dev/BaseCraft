import { expect, it } from 'vitest';
import { constants, DatabaseSync } from 'node:sqlite';

it('node:sqlite works with UDF and authorizer', () => {
  const db = new DatabaseSync(':memory:');
  db.function('dbl', (v) => (v as number) * 2);
  expect(db.prepare('SELECT dbl(21) AS v').get()).toEqual({ v: 42 });
  expect(typeof db.setAuthorizer).toBe('function');
  expect(typeof constants.SQLITE_ATTACH).toBe('number');
  db.aggregate('total', { start: () => 0, step: (acc: number, v) => acc + Number(v) });
  expect(db.prepare('SELECT total(x) AS v FROM (SELECT 1 AS x UNION ALL SELECT 2)').get()).toEqual({ v: 3 });
});
