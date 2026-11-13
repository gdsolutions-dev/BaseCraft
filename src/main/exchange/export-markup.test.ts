import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { RiskProbe } from '../db/location-risk';
import { Session } from '../session';
import { createTable } from '../db/schema';
import { EXCEL_SPEC } from '../../shared/exchange';
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
  fieldPrefix: 'Champ', idName: 'Mon N', errorSuffix: '_ErreursImportation',
  errorFields: { error: 'Erreur', field: 'Champ', line: 'Ligne' }, messages: en.fieldError, log: en.importText.log,
};
let dir: string;
let session: Session;
let db: DatabaseSync;
const out = (ext = 'xml') => path.join(dir, `out.${ext}`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcexp-'));
  session = Session.create(path.join(dir, 'test.basecraft'), { appVersion: '0.0.0', region: 'fr-FR', probe, sessionId: 'a' });
  db = (session as unknown as { db: DatabaseSync }).db;
});
afterEach(() => {
  session.close();
  fs.rmSync(dir, { recursive: true, force: true });
});


it('XML export in the Access data format, read back through the Excel/text import path (new table)', async () => {
  createTable(db, t('Mes Clients', [f('Nom', 'shortText'), f('Mon N', 'number'), f('Montant', 'currency'), f('Quand', 'dateTime'), f('Ok', 'yesNo')]));
  const ins = db.prepare('INSERT INTO "Mes Clients" ("Nom", "Mon N", "Montant", "Quand", "Ok") VALUES (?, ?, ?, ?, ?)');
  ins.run('Dupont & <fils>', 1, 0.1, '2026-10-23 09:05:00', 1);
  ins.run('Zoé "z"', 2, 1234.5, '2026-10-24 00:00:00', 0);
  ins.run('Sans date', 3, null, null, 1);
  const r = await session.exportMarkup({ ref: { kind: 'table', name: 'Mes Clients' } }, 'xml', 'Mes Clients', out(), words);
  expect(r).toMatchObject({ ok: true, rows: 3 });
  const xml = fs.readFileSync(out(), 'utf8');
  expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\r\n<dataroot [^>]*generated="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}">\r\n<Mes_x0020_Clients>\r\n<Nom>Dupont &amp; &lt;fils&gt;<\/Nom>/);
  expect(xml).toContain('<Mon_x0020_N>1</Mon_x0020_N>');
  expect(xml).toContain('<Quand>2026-10-23T09:05:00</Quand>');
  expect(xml).toContain('<Ok>1</Ok>');
  expect(xml).toContain('<Mes_x0020_Clients>\r\n<Nom>Sans date</Nom>\r\n<Mon_x0020_N>3</Mon_x0020_N>\r\n<Ok>1</Ok>\r\n</Mes_x0020_Clients>'); // null: no element
  expect(xml.endsWith('</dataroot>\r\n')).toBe(true);

  const pv = await session.importExcelPreview(out(), null, null, 'Champ');
  expect(pv).toMatchObject({ sheets: ['Mes Clients'], sheet: 'Mes Clients', hasHeader: true, header: ['Nom', 'Mon N', 'Montant', 'Quand', 'Ok'] });
  expect(pv.fields.map((x) => x.type)).toEqual(['shortText', 'longInteger', 'double', 'dateTime', 'longInteger']);
  const res = await session.importExcelRun(out(), pv.sheet, true, { spec: { ...EXCEL_SPEC, hasHeader: true, fields: pv.fields }, target: { kind: 'new', table: 'T2', primaryKey: { kind: 'none' } } }, importTexts);
  expect(res).toMatchObject({ ok: true, imported: 3, errors: 0 });
  const back = db.prepare('SELECT "Nom", "Mon N", "Montant", "Quand" FROM "T2" ORDER BY rowid').all();
  expect(back.map((x) => x.Nom)).toEqual(['Dupont & <fils>', 'Zoé "z"', 'Sans date']);
  expect(back.map((x) => x.Montant)).toEqual([0.1, 1234.5, null]);
  expect(back[0]!.Quand).toBe('2026-10-23 09:05:00');
  expect(back[2]!.Quand).toBeNull();
});

it('HTML export is a table, every cell escaped, values formatted for the region', async () => {
  seedSales(db);
  db.prepare('INSERT INTO "Clients" ("Nom", "Ville") VALUES (?, ?)').run('<script>alert(1)</script>', 'A&B');
  const r = await session.exportMarkup({ ref: { kind: 'table', name: 'Clients' }, filter: [{ field: 'Ville', criteria: '"A&B"' }] }, 'html', 'Clients', out('html'), words);
  expect(r).toMatchObject({ ok: true, rows: 1 });
  const html = fs.readFileSync(out('html'), 'utf8');
  expect(html).toContain('<title>Clients</title>');
  expect(html).toContain('<th>Nom</th>');
  expect(html).toContain('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td><td>A&amp;B</td>');
  expect(html).not.toContain('<script>');
});

it('saved exports are stored in the base, validated, and deleted', () => {
  session.saveSavedExport('Clients XML', { format: 'xml', kind: 'table', name: 'Clients' });
  session.saveSavedExport('Texte', { format: 'text', kind: 'query', name: 'Q', spec: { delimiter: ';', qualifier: '"', hasHeader: true, encoding: 'utf-8' } });
  expect(Object.keys(session.savedExports())).toEqual(['Clients XML', 'Texte']);
  expect(() => session.saveSavedExport('x', { format: 'text', kind: 'table', name: 'T' })).toThrow('bc:invalidArgument'); // a text export needs its options
  expect(() => session.saveSavedExport(' bad', { format: 'xml', kind: 'table', name: 'T' })).toThrow('bc:invalidArgument');
  session.deleteSavedExport('Texte');
  expect(Object.keys(session.savedExports())).toEqual(['Clients XML']);
});

it('failure leaves no temp file and the old file intact', async () => {
  createTable(db, t('V', [f('A', 'shortText')]));
  fs.writeFileSync(out(), 'old');
  fs.mkdirSync(`${out()}.bc-tmp`);
  await expect(session.exportMarkup({ ref: { kind: 'table', name: 'V' } }, 'xml', 'V', out(), words)).rejects.toThrow('bc:writeFailed');
  expect(fs.readFileSync(out(), 'utf8')).toBe('old');
});
