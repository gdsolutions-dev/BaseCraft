// C7b: a query's text comparisons, grouping, DISTINCT, Min/Max follow the base's sort order (legacy: as before).
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { createTable, isTableName, tableDesign } from '../db/schema';
import { bindQuery, type QueryCatalog } from '../../shared/query/bind';
import { parseSql } from '../../shared/query/sql-parser';
import { f, t } from '../../shared/test-fixtures';
import { authorizedPrepare } from './authorizer';
import { compileSelect } from './compile';
import type { SortOrderId } from '../../shared/sort-orders';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 15_000 });
const dirs: string[] = [];
const dbs: DatabaseSync[] = [];
afterEach(() => { for (const d of dbs.splice(0)) d.close(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function base(order: SortOrderId): (sql: string) => string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bctord-'));
  dirs.push(dir);
  const p = path.join(dir, 't.basecraft');
  createBaseFile(p, '0.0.0', order);
  const db = openBaseFile(p, 'write', '0.0.0').db;
  dbs.push(db);
  createTable(db, t('M', [f('id', 'autoNumber'), f('mot', 'shortText')]));
  for (const m of ['zebra', 'åker', 'ÅKER', 'ägg', 'apa', 'chata', 'hrad']) db.prepare('INSERT INTO "M" ("mot") VALUES (?)').run(m);
  const catalog: QueryCatalog = { table: (n) => (isTableName(db, n) ? tableDesign(db, n) : null), query: () => null };
  return (sql) => {
    const c = compileSelect(bindQuery(parseSql(sql), catalog), {}, { locale: 'fr-FR' });
    const stmt = authorizedPrepare(db, c.sql);
    stmt.setReturnArrays(true);
    return (stmt.all(...c.params) as unknown as unknown[][]).map((r) => r.map(String).join('|').replace(/^\d+\|(?=.*\|)?/, ''));
  };
}

describe.each([['legacy', false], ['general', false], ['swedish', true]] as const)('%s order', (order, aaRing) => {
  it('> < >= <= Between In on a text criterion', () => {
    const run = base(order);
    const gt = run('SELECT M.mot FROM M WHERE M.mot > "z" ORDER BY M.mot;');
    expect(gt.filter((x) => x !== 'zebra')).toEqual(aaRing ? ['åker', 'ÅKER', 'ägg'] : []); // å and ä are letters after z in Swedish
    expect(run('SELECT M.mot FROM M WHERE M.mot < "b" And M.mot >= "a";').length).toBe(aaRing ? 1 : 4);
    expect(run('SELECT M.mot FROM M WHERE M.mot <= "apa" And M.mot >= "apa";')).toEqual(['apa']);
    expect(run('SELECT M.mot FROM M WHERE M.mot Between "x" And "ö";').length).toBe(aaRing ? 4 : 0);
    expect(run('SELECT M.mot FROM M WHERE M.mot In ("ÅKER", "APA") ORDER BY M.mot;').sort()).toEqual(['apa', 'ÅKER', 'åker']);
    expect(run('SELECT M.mot FROM M WHERE M.mot = "AKER";')).toEqual([]); // accents significant
  });
  it('GROUP BY, DISTINCT, Min and Max of a text', () => {
    const run = base(order);
    expect(run('SELECT M.mot, Count(*) FROM M GROUP BY M.mot ORDER BY M.mot;').filter((r) => /^[åÅ]/.test(r))).toHaveLength(1);
    expect(run('SELECT DISTINCT M.mot FROM M;')).toHaveLength(6);
    expect(run('SELECT Max(M.mot), Min(M.mot) FROM M;')).toEqual(aaRing ? ['ägg|apa'] : ['zebra|ägg']);
  });
});
