import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { RiskProbe } from '../db/location-risk';
import { Session } from '../session';
import { createTable } from '../db/schema';
import { defaultExportSpec } from '../../shared/exchange';
import { localeInfo } from '../../shared/locale-format';
import en from '../../shared/i18n/en.json';
import { f, t } from '../../shared/test-fixtures';
import type { ImportTexts } from '../import/text-import';
import { seedSales } from '../query/test-db';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const fr = localeInfo('fr-FR');
const words = { yes: 'Vrai', no: 'Faux' };
const importTexts: ImportTexts = {
  fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_ErreursImportation',
  errorFields: { error: 'Erreur', field: 'Champ', line: 'Ligne' }, messages: en.fieldError, log: en.importText.log,
};
let dir: string;
let session: Session;
let db: DatabaseSync;
const out = () => path.join(dir, 'out.csv');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcexp-'));
  session = Session.create(path.join(dir, 'test.basecraft'), { appVersion: '0.0.0', region: 'fr-FR', probe, sessionId: 'a' });
  db = (session as unknown as { db: DatabaseSync }).db;
});
afterEach(() => {
  session.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// The importer (and the write layer) trim text, as Access does: a value stored with spaces (raw SQL here) comes back trimmed.
const rowsOf = (table: string) => db.prepare(`SELECT "Texte", "Long", "Montant", "Quand", "Ok" FROM "${table}" ORDER BY rowid`).all()
  .map((r) => ({ ...r, Texte: String(r.Texte).trim() }));

it('round trip through the importer', async () => {
  createTable(db, t('T', [f('Texte', 'shortText'), f('Long', 'longText'), f('Montant', 'currency'), f('Quand', 'dateTime'), f('Ok', 'yesNo')]));
  const ins = db.prepare('INSERT INTO "T" ("Texte", "Long", "Montant", "Quand", "Ok") VALUES (?, ?, ?, ?, ?)');
  ins.run('Il a dit "oui"', 'ligne1\r\nligne2', 0.1, '2026-10-23 09:05:00', 1);
  ins.run(' espaces ', null, 1234.56, '2026-10-24 00:00:00', 0);
  ins.run('a;b', 'x', null, null, 1);
  const r = await session.exportText({ ref: { kind: 'table', name: 'T' } }, defaultExportSpec(fr), out(), words);
  expect(r).toMatchObject({ ok: true, rows: 3, warnings: { unmappable: 0, truncated: 0, ambiguous: 0 } });
  const raw = fs.readFileSync(out());
  expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(raw.toString('utf8').split('\r\n')[0]).toBe('\ufeff"Texte";"Long";"Montant";"Quand";"Ok"');

  expect(raw.toString('utf8')).toContain('\r\n" espaces ";'); // the spaces are exported (the importer trims them back)
  const pv = session.importPreview(out(), null, 'Champ');
  const res = await session.importRun(out(), { spec: pv.spec, target: { kind: 'new', table: 'T2', primaryKey: { kind: 'none' } } }, importTexts);
  expect(res).toMatchObject({ ok: true, imported: 3, errors: 0 });
  expect(rowsOf('T2')).toEqual(rowsOf('T'));
});

it('query export gives the query rows with parameters', async () => {
  seedSales(db);
  session.saveObject('query', 'QVille', { formatVersion: '1.0', sql: 'PARAMETERS [Quelle ville] Text; SELECT Nom, Ville FROM Clients WHERE Ville = [Quelle ville] ORDER BY Nom' }, null);
  const r = await session.exportText({ ref: { kind: 'query', name: 'QVille' }, params: { 'Quelle ville': 'Lyon' } }, { ...defaultExportSpec(fr), encoding: 'utf-8' }, out(), words);
  expect(r).toMatchObject({ ok: true, rows: 2 });
  expect(fs.readFileSync(out(), 'utf8')).toBe('"Nom";"Ville"\r\n"Dupont";"Lyon"\r\n"Martin";"LYON"\r\n');
});

it('sort and filter of the datasheet are honoured; windows-1252 counts what it cannot write', async () => {
  seedSales(db);
  db.prepare('INSERT INTO "Clients" ("Nom", "Ville") VALUES (?, ?)').run('Zoé 😀', 'Nice');
  const spec = { ...defaultExportSpec(fr), encoding: 'windows-1252' as const, hasHeader: false };
  const r = await session.exportText({ ref: { kind: 'table', name: 'Clients' }, sort: [{ field: 'Nom', dir: 'desc' }], filter: [{ field: 'Ville', criteria: '"Nice"' }] }, spec, out(), words);
  expect(r).toMatchObject({ ok: true, rows: 1, warnings: { unmappable: 1 } });
  expect([...fs.readFileSync(out())]).toEqual([...Buffer.from('5;"Zo\xe9 ?";"Nice"\r\n', 'latin1')]);
});

it('no rows and no header still writes the BOM; the unqualified ambiguous cells are counted', async () => {
  createTable(db, t('V', [f('A', 'shortText')]));
  expect(await session.exportText({ ref: { kind: 'table', name: 'V' } }, { ...defaultExportSpec(fr), hasHeader: false }, out(), words)).toMatchObject({ ok: true, rows: 0 });
  expect([...fs.readFileSync(out())]).toEqual([0xef, 0xbb, 0xbf]);
  db.prepare('INSERT INTO "V" ("A") VALUES (?)').run('a;b');
  expect(await session.exportText({ ref: { kind: 'table', name: 'V' } }, { ...defaultExportSpec(fr), qualifier: '' }, out(), words))
    .toMatchObject({ ok: true, warnings: { ambiguous: 1 } });
});

it('failure leaves no temp file and the old file intact', async () => {
  createTable(db, t('V', [f('A', 'shortText')]));
  fs.writeFileSync(out(), 'old');
  fs.mkdirSync(`${out()}.bc-tmp`); // the temp file cannot be created
  await expect(session.exportText({ ref: { kind: 'table', name: 'V' } }, defaultExportSpec(fr), out(), words)).rejects.toThrow('bc:writeFailed');
  expect(fs.readFileSync(out(), 'utf8')).toBe('old');
  fs.rmdirSync(`${out()}.bc-tmp`);
  // a source error in the middle: nothing left behind either
  await expect(session.exportText({ ref: { kind: 'table', name: 'Nope' } }, defaultExportSpec(fr), out(), words)).rejects.toThrow('bc:notFound');
  expect(fs.existsSync(`${out()}.bc-tmp`)).toBe(false);
  expect(fs.readFileSync(out(), 'utf8')).toBe('old');
});

it('reports progress between pages', async () => {
  createTable(db, t('V', [f('A', 'number')]));
  const ins = db.prepare('INSERT INTO "V" ("A") VALUES (?)');
  db.exec('BEGIN');
  for (let i = 0; i < 5200; i++) ins.run(i);
  db.exec('COMMIT');
  const ticks: [number, number][] = [];
  const r = await session.exportText({ ref: { kind: 'table', name: 'V' } }, defaultExportSpec(fr), out(), words, async (d, tot) => { ticks.push([d, tot]); });
  expect(r).toMatchObject({ ok: true, rows: 5200 });
  expect(ticks).toEqual([[5000, 5200], [5200, 5200]]);
  expect(fs.readFileSync(out(), 'utf8').split('\r\n')).toHaveLength(5202); // header + 5200 rows + the empty rest after the last CRLF
});
