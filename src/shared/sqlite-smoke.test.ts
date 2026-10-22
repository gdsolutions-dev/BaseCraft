import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

it('node:sqlite works with UDF and authorizer', () => {
  const db = new DatabaseSync(':memory:');
  db.function('dbl', (v) => (v as number) * 2);
  expect(db.prepare('SELECT dbl(21) AS v').get()).toEqual({ v: 42 });
  expect(typeof db.setAuthorizer).toBe('function');
});
