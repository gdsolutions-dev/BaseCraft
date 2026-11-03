import { describe, expect, it } from 'vitest';
import { ptProps } from '../connectors/postgres/types';
import { loadSnapshot, PT_TABLE, snapshotDesign } from './pass-through';
import { resolve } from './source';

describe('pass-through snapshot (C6 R1, R6)', () => {
  it('snapshotDesign renames what BaseCraft cannot hold', () => {
    const lt = ptProps(25, -1);
    expect(snapshotDesign([['?column?', lt], ['?column?', lt], ['', lt], ['rowid', lt], ['a.b', lt], ['x'.repeat(100), lt], ['Expr1000', lt], ['ok', lt]]
      .map(([name, props]) => ({ name, props }) as { name: string; props: typeof lt })).fields.map((f) => f.name))
      .toEqual(['?column?', 'Expr1001', 'Expr1002', 'Expr1003', 'Expr1004', 'Expr1005', 'Expr1000', 'ok']);
  });

  it('loadSnapshot holds the rows as stored, read-only', () => {
    const design = snapshotDesign([{ name: 'n', props: ptProps(23, -1) }, { name: 't', props: ptProps(25, -1) }]);
    expect(design.name).toBe(PT_TABLE);
    const db = loadSnapshot(design, [[1, 'a'], [2, null]]);
    try {
      expect(db.prepare('SELECT n, t FROM "PassThrough"').all().map((r) => Object.values(r))).toEqual([[1, 'a'], [2, null]]);
      expect(() => db.exec('DELETE FROM "PassThrough"')).toThrow();
      expect(resolve(db, { kind: 'sql', sql: 'SELECT * FROM [PassThrough]' }).columns.map((c) => c.name)).toEqual(['n', 't']);
    } finally {
      db.close();
    }
  });

  it('a NULL in a Yes/No column loads as No (0)', () => {
    const db = loadSnapshot(snapshotDesign([{ name: 'b', props: ptProps(16, -1) }, { name: 'v', props: ptProps(1043, -1) }]), [[null, null], [1, 'x']]);
    try {
      expect(db.prepare('SELECT b, v FROM "PassThrough"').all().map((r) => Object.values(r))).toEqual([[0, null], [1, 'x']]);
    } finally {
      db.close();
    }
  });
});
