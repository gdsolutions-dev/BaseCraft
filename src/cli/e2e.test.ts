import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { registerFunctions } from '../main/db/file-format';
import { listRelations } from '../main/db/relations';
import { listTables } from '../main/db/schema';
import { run } from './main';
import { tmp } from './test-tmp';

const sample = fileURLToPath(new URL('../../tests/cli/example-script.json', import.meta.url));

describe('end to end', () => {
  it('builds a two-table base with a relation from the sample script', async () => {
    const p = tmp();
    const err: string[] = [];
    const io = { out: () => {}, err: (s: string) => err.push(s) };
    expect(await run(['new', p], io)).toBe(0);
    expect(await run(['script', sample, p], io)).toBe(0);
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listTables(db).map((t) => t.name).sort()).toEqual(['Clients', 'Commandes']);
    expect(listRelations(db)).toHaveLength(1);
    db.close();
    const before = fs.readFileSync(p);
    expect(await run(['script', sample, p], io)).toBe(1);
    expect(err.join('\n')).toContain('Clients');
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
});

describe('format', () => {
  it('a fresh new base passes checkTarget at the current format (1.4)', async () => {
    const { checkTarget } = await import('./script');
    const p = tmp();
    expect(await run(['new', p], { out: () => {}, err: () => {} })).toBe(0);
    expect(() => checkTarget(p)).not.toThrow();
    const db = new DatabaseSync(p);
    expect((db.prepare("SELECT value FROM bc_meta WHERE key='format_minor'").get() as { value: string }).value).toBe('4');
    db.close();
  });
});
