import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newBase } from './new-base';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-')), 'x.basecraft');

describe('newBase', () => {
  it('creates a BaseCraft file with its format metadata', () => {
    const p = tmp();
    newBase(p, '0.3.1');
    const db = new DatabaseSync(p);
    expect(db.prepare("SELECT value FROM bc_meta WHERE key='app_version'").get()).toEqual({ value: '0.3.1' });
    db.close();
  });
  it('refuses an existing file and does not overwrite it', () => {
    const p = tmp();
    newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    expect(() => newBase(p, '0.3.1')).toThrow(/exists/);
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
  it('refuses a path not ending in .basecraft', () => {
    expect(() => newBase(tmp().replace(/\.basecraft$/, '.db'), '0.3.1')).toThrow(/\.basecraft/);
  });
});
