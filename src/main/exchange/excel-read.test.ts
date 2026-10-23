import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { EXCEL_SPEC } from '../../shared/exchange';
import en from '../../shared/i18n/en.json';
import { localeInfo } from '../../shared/locale-format';
import { makeA6Xlsx } from '../../../tests/e2e/fixtures/make-a6-xlsx';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { tableDesign } from '../db/schema';
import { runImport, type ImportTexts } from '../import/text-import';
import { cellText, excelSource, previewExcel, readSheet } from './excel-read';

const fr = localeInfo('fr-FR');
const texts: ImportTexts = {
  fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_ErreursImportation',
  errorFields: { error: 'Erreur', field: 'Champ', line: 'Ligne' }, messages: en.fieldError, log: en.importText.log,
};
let dir: string;
let xlsx: string;
let db: DatabaseSync;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcxl-'));
  xlsx = path.join(dir, 'a6.xlsx');
  await makeA6Xlsx(xlsx);
  const p = path.join(dir, 't.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const design = (t: string) => tableDesign(db, t);
const rows = (t: string) => (db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all() as Record<string, unknown>[]).map((r) => Object.values(r).slice(1));

async function importSheet(sheet: string, table = sheet) {
  const pv = await previewExcel(xlsx, sheet, null, fr, 'Champ');
  const { records } = await readSheet(xlsx, sheet);
  const spec = { ...EXCEL_SPEC, fields: pv.fields };
  return runImport(db, excelSource(records, pv.hasHeader), { spec, target: { kind: 'new', table, primaryKey: { kind: 'auto' } } }, fr, texts);
}

describe('excel import', () => {
  it('canonical cell text', () => {
    expect(cellText(new Date(Date.UTC(2026, 9, 23)))).toBe('2026-10-23');
    expect(cellText(new Date(Date.UTC(2026, 9, 23, 9, 5)))).toBe('2026-10-23 09:05:00');
    expect(cellText({ formula: 'A1*2', result: 4 })).toBe('4');
    expect(cellText({ formula: 'A1*2' })).toBe('');
    expect(cellText({ error: '#DIV/0!' })).toBe('#DIV/0!');
    expect(cellText({ richText: [{ text: 'a' }, { text: 'b' }] })).toBe('ab');
    expect(cellText({ text: 'lien', hyperlink: 'http://x' })).toBe('lien');
    expect(cellText(true)).toBe('true');
    expect(cellText(12.5)).toBe('12.5');
    expect(cellText(null)).toBe('');
  });

  it('sheets, empty rows, merged cells', async () => {
    const r = await readSheet(xlsx, 'Clients');
    expect(r.sheets).toEqual(['Clients', 'Vide', 'Produits']);
    expect(r.records.map((x) => x.line)).toEqual([1, 2, 3, 5, 6, 7]); // row 4 empty
    expect(r.records[2].slice(0, 2)).toEqual(['Fusion', '']);
    expect((await readSheet(xlsx, null)).sheet).toBe('Clients');
  });

  it('imports with types, error log and row numbers', async () => {
    const res = await importSheet('Clients');
    expect(res).toMatchObject({ ok: true, imported: 4, errors: 1 });
    expect(design('Clients').fields.slice(1).map((f) => f.props.type)).toEqual(['shortText', 'shortText', 'number', 'dateTime', 'dateTime']);
    expect(rows('Clients')[0]).toEqual(['Dupont', '01000', 12.5, '2026-10-23 00:00:00', '2026-10-23 09:05:00']);
    expect(rows('Clients').map((r) => r[2])).toEqual([12.5, 7, 25, 3]); // the formula gives its cached value
    expect(Object.values(db.prepare('SELECT * FROM "Clients_ErreursImportation"').get()!)).toEqual([expect.any(String), 'Montant', 5]);
  });

  it('reports progress as records are read', async () => {
    const { records } = await readSheet(xlsx, 'Produits');
    const seen: [number, number][] = [];
    [...excelSource(records, true).records((d, t) => seen.push([d, t]))];
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });

  it('header-only sheet creates an empty table', async () => {
    expect(await importSheet('Vide')).toMatchObject({ ok: true, imported: 0 });
  });

  it('rejects xls, damaged and large files', async () => {
    const xls = path.join(dir, 'old.xls');
    fs.writeFileSync(xls, 'x');
    await expect(readSheet(xls, null)).rejects.toThrow('bc:excelUnsupported');
    const bad = path.join(dir, 'bad.xlsx');
    fs.writeFileSync(bad, 'not a zip');
    await expect(readSheet(bad, null)).rejects.toThrow('bc:excelUnsupported');
  });
});
