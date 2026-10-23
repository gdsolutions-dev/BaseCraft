import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { DatabaseSync } from 'node:sqlite';
import type { RiskProbe } from '../db/location-risk';
import { Session } from '../session';
import { createTable } from '../db/schema';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import { writeExcelExport } from './export-excel';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
let dir: string;
let session: Session;
let db: DatabaseSync;
const out = () => path.join(dir, 'out.xlsx');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcxls-'));
  session = Session.create(path.join(dir, 'test.basecraft'), { appVersion: '0.0.0', region: 'fr-FR', probe, sessionId: 'a' });
  db = (session as unknown as { db: DatabaseSync }).db;
});
afterEach(() => {
  session.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const exportT = (table = 'T', sheet = 'Feuille') => session.exportExcel({ ref: { kind: 'table', name: table } }, out(), sheet);
async function readBack() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out());
  return wb.worksheets[0]!;
}
function seed() {
  createTable(db, t('T', [f('Texte', 'shortText'), f('Long', 'longText'), f('Montant', 'currency'), f('Quand', 'dateTime'), f('Ok', 'yesNo'), f('Nb', 'number', { numberSize: 'double' }), f('Dec', 'number', { numberSize: 'decimal' })]));
  const ins = db.prepare('INSERT INTO "T" ("Texte", "Long", "Montant", "Quand", "Ok", "Nb", "Dec") VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run('=1+1', 'a', 0.1, '2026-10-23 09:05:00', 1, 2.5, '12.5');
  ins.run('+33 6', null, null, '2026-10-24 00:00:00', 0, 3, '0.1234567890123456789');
}

it('typed cells', async () => {
  seed();
  expect(await exportT()).toMatchObject({ ok: true, rows: 2, warnings: { truncated: 0 } });
  const ws = await readBack();
  expect(ws.name).toBe('Feuille');
  expect(ws.getCell('A2').value).toBe('=1+1');
  expect(ws.getCell('A2').formula).toBeUndefined();
  expect(ws.getCell('A3').value).toBe('+33 6');
  expect(ws.getCell('C2').value).toBe(0.1);
  expect(ws.getCell('C2').numFmt).toBe('#,##0.00 "€"'); // exceljs drops the backslash when it reads; the file has it:
  const styles = await (await JSZip.loadAsync(fs.readFileSync(out()))).file('xl/styles.xml')!.async('string');
  expect(styles).toContain('formatCode="#,##0.00\\ &quot;€&quot;"');
  expect((ws.getCell('D2').value as Date).toISOString()).toBe('2026-10-23T09:05:00.000Z');
  expect(ws.getCell('D2').numFmt).toBe('dd/mm/yyyy hh:mm:ss');
  expect((ws.getCell('D3').value as Date).toISOString()).toBe('2026-10-24T00:00:00.000Z');
  expect(ws.getCell('D3').numFmt).toBe('dd/mm/yyyy');
  expect(ws.getCell('E2').value).toBe(true);
  expect(ws.getCell('E3').value).toBe(false);
  expect(ws.getCell('F2').value).toBe(2.5);
  expect(ws.getCell('G2').value).toBe(12.5);
  expect(ws.getCell('G3').value).toBe('0.1234567890123456789'); // would lose digits as a number
  expect(ws.getCell('B3').value).toBeNull();
  expect(ws.getCell('C3').value).toBeNull();
});

it('dates before 1900-03-01 (the 1900 leap-year bug) are written as text, as the text export writes them', async () => {
  createTable(db, t('D', [f('Quand', 'dateTime')]));
  const ins = db.prepare('INSERT INTO "D" ("Quand") VALUES (?)');
  for (const v of ['1850-01-01 00:00:00', '1900-02-15 00:00:00', '0050-06-01 10:00:00', '1900-03-01 00:00:00', '2026-10-23 09:05:00']) ins.run(v);
  expect(await exportT('D')).toMatchObject({ ok: true, rows: 5 });
  const ws = await readBack();
  expect(ws.getCell('A2').value).toBe('01/01/1850');
  expect(ws.getCell('A3').value).toBe('15/02/1900');
  expect(ws.getCell('A4').value).toBe('01/06/0050 10:00:00');
  expect((ws.getCell('A5').value as Date).toISOString()).toBe('1900-03-01T00:00:00.000Z');
  expect((ws.getCell('A6').value as Date).toISOString()).toBe('2026-10-23T09:05:00.000Z');
});

it('header: bold, frozen, filtered; widths from the content', async () => {
  seed();
  await exportT();
  const ws = await readBack();
  expect(ws.getCell('A1').value).toBe('Texte');
  expect(ws.getCell('A1').font?.bold).toBe(true);
  expect(ws.getCell('A2').font?.bold).toBeFalsy();
  expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  expect(ws.autoFilter).toBe('A1:G1');
  expect(ws.getColumn(1).width).toBe(7); // '+33 6' = 5, header 'Texte' = 5, plus 2
  expect(ws.getColumn(7).width).toBe(23); // 21 chars + 2
});

it('long text is cut and counted', async () => {
  createTable(db, t('L', [f('Id', 'shortText'), f('Long', 'longText')]));
  db.prepare('INSERT INTO "L" ("Id", "Long") VALUES (?, ?)').run('1', 'x'.repeat(40000));
  const r = await exportT('L');
  expect(r).toMatchObject({ ok: true, warnings: { truncated: 1 } });
  expect((await readBack()).getCell('B2').text).toHaveLength(32767);
});

it('too many rows: refused, nothing written', async () => {
  createTable(db, t('V', [f('A', 'shortText')]));
  expect(session.exportRowCount({ ref: { kind: 'table', name: 'V' } })).toBe(0);
  const page = vi.fn(() => ({ rows: [], rowids: [], total: 1_048_576 }));
  const r = await writeExcelExport({ fields: [], page, path: out(), sheet: 'S', info: localeInfo('fr-FR') });
  expect(r).toEqual({ ok: false, reason: 'tooManyRows', limit: 1_048_575 });
  expect(fs.existsSync(out())).toBe(false);
  expect(fs.existsSync(`${out()}.bc-tmp`)).toBe(false);
});

it('failure leaves no temp file and the old file intact', async () => {
  createTable(db, t('V', [f('A', 'shortText')]));
  fs.writeFileSync(out(), 'old');
  fs.mkdirSync(`${out()}.bc-tmp`);
  await expect(exportT('V')).rejects.toThrow('bc:writeFailed');
  expect(fs.readFileSync(out(), 'utf8')).toBe('old');
  fs.rmdirSync(`${out()}.bc-tmp`);
  await expect(exportT('Nope')).rejects.toThrow('bc:notFound');
  expect(fs.existsSync(`${out()}.bc-tmp`)).toBe(false);
  expect(fs.readFileSync(out(), 'utf8')).toBe('old');
});

it('an empty source still gives a sheet with its header', async () => {
  createTable(db, t('V', [f('A', 'shortText')]));
  expect(await exportT('V')).toMatchObject({ ok: true, rows: 0 });
  expect((await readBack()).getCell('A1').value).toBe('A');
});

// A stream that fails on its n-th write (disk full): the export must end with bc:writeFailed, not wait for exceljs forever.
it.each([[1, 12], [3, 12_000]])('stream failing on write %i of a %i-row export: rejected, temp removed, old file kept', async (failOn, count) => {
  fs.writeFileSync(out(), 'old');
  const field = { name: 'A', type: 'shortText', props: {} } as never;
  const page = (offset: number, limit: number) => ({
    rows: Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, i) => ['v' + (offset + i)]), rowids: [], total: count,
  });
  const openStream = (tmp: string) => {
    let n = 0;
    return new Writable({
      write(_chunk, _enc, cb) { cb(++n >= failOn ? new Error('ENOSPC') : null); },
      destroy(e, cb) { fs.rmSync(tmp, { force: true }); cb(e); },
    });
  };
  const r = writeExcelExport({ fields: [field], page, path: out(), sheet: 'S', info: localeInfo('fr-FR'), openStream, tick: async () => { await new Promise((ok) => setTimeout(ok, 20)); } });
  await expect(r).rejects.toThrow('bc:writeFailed');
  expect(fs.readFileSync(out(), 'utf8')).toBe('old');
  expect(fs.existsSync(`${out()}.bc-tmp`)).toBe(false);
});
