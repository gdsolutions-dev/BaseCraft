import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { aggregateRun, type AggregateSpec } from './aggregate';
import { TOTAL_FNS } from '../../shared/sheet-layout';

describe('aggregate', () => {
  it('every function over known values, nulls ignored; one row gives no StDev or Var; no row gives no value', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE t (n INTEGER, d TEXT, s TEXT)`);
    db.exec(`INSERT INTO t VALUES (2,'10.50','2024-01-05'),(4,'9','2024-03-01'),(4,NULL,NULL),(4,'1.25','2023-12-31'),(5,'x5',NULL),(5,'2','2024-02-01'),(7,'3','2024-02-02'),(9,'1','2024-01-01'),(NULL,NULL,NULL)`);
    const run = (specs: AggregateSpec[], where = '') => aggregateRun(db, specs, `t${where}`);
    const spec = (fn: (typeof TOTAL_FNS)[number], col = '"n"', numeric = true): AggregateSpec => ({ col, fn, numeric });
    // n over 8 values: 2 4 4 4 5 5 7 9 (mean 5, sample variance 32/7)
    const [sum, avg, count, max, min, stdev, variance] = run(TOTAL_FNS.map((fn) => spec(fn)));
    expect([sum, avg, count, max, min]).toEqual([40, 5, 8, 9, 2]);
    expect(variance).toBeCloseTo(32 / 7, 10);
    expect(stdev).toBeCloseTo(Math.sqrt(32 / 7), 10);
    // a decimal stored as text is compared as a number (10.50 > 9); a date as text
    expect(run([spec('max', '"d"'), spec('min', '"d"'), spec('count', '"d"')])).toEqual([10.5, 0, 7]);
    expect(run([spec('max', '"s"', false), spec('min', '"s"', false), spec('count', '"s"', false)])).toEqual(['2024-03-01', '2023-12-31', 6]);
    // one row: no StDev or Var; no row: Count 0, the others null
    expect(run([spec('stdev'), spec('var'), spec('sum'), spec('count')], ' WHERE n = 2')).toEqual([null, null, 2, 1]);
    expect(run(TOTAL_FNS.map((fn) => spec(fn)), ' WHERE n > 100')).toEqual([null, null, 0, null, null, null, null]);
  });
});
