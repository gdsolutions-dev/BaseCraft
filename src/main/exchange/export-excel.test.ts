import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
import { sheetOf } from '../../../tests/e2e/fixtures/xlsx-fixture';

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
const readBack = () => sheetOf(out());
const iso = (v: unknown) => (v as Date).toISOString();
const col = (ws: { sheetXml: string }, n: number) => new RegExp(`<col min="${n}" max="${n}" width="([^"]*)"`).exec(ws.sheetXml)?.[1];
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
  expect(ws.cell('A2')).toBe('=1+1');
  expect(ws.sheetXml).not.toContain('<f>'); // a text stays a text, never a formula
  expect(ws.cell('A3')).toBe('+33 6');
  expect(ws.cell('C2')).toBe(0.1);
  expect(ws.stylesXml).toContain('formatCode="#,##0.00\\ &quot;€&quot;"');
  expect(ws.stylesXml).toContain('formatCode="dd/mm/yyyy hh:mm:ss"');
  expect(ws.stylesXml).toContain('formatCode="dd/mm/yyyy"');
  expect(ws.sheetXml).toContain('<c r="C2" s="2">'); // currency
  expect(ws.sheetXml).toContain('<c r="D2" s="4">'); // date and time
  expect(ws.sheetXml).toContain('<c r="D3" s="3">'); // date only
  expect(iso(ws.cell('D2'))).toBe('2026-10-23T09:05:00.000Z');
  expect(iso(ws.cell('D3'))).toBe('2026-10-24T00:00:00.000Z');
  expect(ws.cell('E2')).toBe(true);
  expect(ws.cell('E3')).toBe(false);
  expect(ws.cell('F2')).toBe(2.5);
  expect(ws.cell('G2')).toBe(12.5);
  expect(ws.cell('G3')).toBe('0.1234567890123456789'); // would lose digits as a number
  expect(ws.cell('B3')).toBeUndefined();
  expect(ws.cell('C3')).toBeUndefined();
});

it('dates before 1900-03-01 (the 1900 leap-year bug) are written as text, as the text export writes them', async () => {
  createTable(db, t('D', [f('Quand', 'dateTime')]));
  const ins = db.prepare('INSERT INTO "D" ("Quand") VALUES (?)');
  for (const v of ['1850-01-01 00:00:00', '1900-02-15 00:00:00', '0050-06-01 10:00:00', '1900-03-01 00:00:00', '2026-10-23 09:05:00']) ins.run(v);
  expect(await exportT('D')).toMatchObject({ ok: true, rows: 5 });
  const ws = await readBack();
  expect(ws.cell('A2')).toBe('01/01/1850');
  expect(ws.cell('A3')).toBe('15/02/1900');
  expect(ws.cell('A4')).toBe('01/06/0050 10:00:00');
  expect(iso(ws.cell('A5'))).toBe('1900-03-01T00:00:00.000Z');
  expect(iso(ws.cell('A6'))).toBe('2026-10-23T09:05:00.000Z');
});

it('header: bold, frozen, filtered; widths from the content', async () => {
  seed();
  await exportT();
  const ws = await readBack();
  expect(ws.cell('A1')).toBe('Texte');
  expect(ws.sheetXml).toContain('<c r="A1" s="1"'); // style 1 = bold
  expect(ws.sheetXml).not.toContain('<c r="A2" s="1"');
  expect(ws.stylesXml).toMatch(/<font><b\/>/);
  expect(ws.sheetXml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
  expect(ws.sheetXml).toContain('<autoFilter ref="A1:G1"/>');
  expect(col(ws, 1)).toBe('7'); // '+33 6' = 5, header 'Texte' = 5, plus 2
  expect(col(ws, 7)).toBe('23'); // 21 chars + 2
});

it('long text is cut and counted', async () => {
  createTable(db, t('L', [f('Id', 'shortText'), f('Long', 'longText')]));
  db.prepare('INSERT INTO "L" ("Id", "Long") VALUES (?, ?)').run('1', 'x'.repeat(40000));
  const r = await exportT('L');
  expect(r).toMatchObject({ ok: true, warnings: { truncated: 1 } });
  expect(String((await readBack()).cell('B2'))).toHaveLength(32767);
});

it('too many rows: refused, nothing written', async () => {
  createTable(db, t('V', [f('A', 'shortText')]));
  expect(await session.exportRowCount({ ref: { kind: 'table', name: 'V' } })).toBe(0);
  const page = vi.fn(async () => ({ rows: [], rowids: [], total: 1_048_576 }));
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
  expect((await readBack()).cell('A1')).toBe('A');
});

// A stream that fails on its n-th write (disk full): the export must end with bc:writeFailed, not hang.
it.each([[1, 12], [3, 12_000]])('stream failing on write %i of a %i-row export: rejected, temp removed, old file kept', async (failOn, count) => {
  fs.writeFileSync(out(), 'old');
  const field = { name: 'A', type: 'shortText', props: {} } as never;
  const page = async (offset: number, limit: number) => ({
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
