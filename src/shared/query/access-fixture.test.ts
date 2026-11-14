import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSql } from './sql-parser';

const DIR = join(__dirname, '../../../tests/fixtures/access/Ventes-complet.export/queries');

describe('the queries of the Ventes-complet export parse', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql'));
  it('has two queries', () => expect(files).toHaveLength(2));
  for (const f of files) {
    it(f, () => expect(() => parseSql(readFileSync(join(DIR, f), 'utf8'))).not.toThrow());
  }
});
