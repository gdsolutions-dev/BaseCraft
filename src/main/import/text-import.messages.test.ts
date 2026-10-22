// The import against the write layer announced by A2 (asynchronous insertRow, errors carrying their own message).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import en from '../../shared/i18n/en.json';
import { localeInfo } from '../../shared/locale-format';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { previewText, runImport, type ImportTexts } from './text-import';

vi.mock('../db/write-layer', async (original) => {
  const m = await original<typeof import('../db/write-layer')>();
  return {
    ...m,
    insertRow: async (...args: Parameters<typeof m.insertRow>) => {
      const [, design, values] = args;
      if (design.name === 'M' && values.Nom === 'bad') {
        return { ok: false, errors: [{ field: 'Nom', code: 'invalidNumber', message: 'Le nom doit commencer par une majuscule' }] };
      }
      return m.insertRow(...args);
    },
  };
});

const fr = localeInfo('fr-FR');
const texts: ImportTexts = {
  fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_ErreursImportation',
  errorFields: { error: 'Erreur', field: 'Champ', line: 'Ligne' }, messages: en.fieldError, log: en.importText.log,
};
let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bctm-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('awaits insertRow and logs the message an error carries (validation text), not only its code', async () => {
  const p = path.join(dir, 'm.csv');
  fs.writeFileSync(p, 'Nom;N\nok;1\nbad;2\n');
  const spec = previewText(p, null, fr, 'Champ').spec;
  const r = await runImport(db, p, { spec, target: { kind: 'new', table: 'M', primaryKey: { kind: 'auto' } } }, fr, texts);
  expect(r).toMatchObject({ imported: 1, errors: 1 });
  expect(db.prepare('SELECT * FROM "M_ErreursImportation"').all()).toEqual([{ Erreur: 'Le nom doit commencer par une majuscule', Champ: 'Nom', Ligne: 3 }]);
});
