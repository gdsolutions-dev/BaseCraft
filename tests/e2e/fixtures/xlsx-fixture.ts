// Test workbooks: a writer for fixtures (the binaries are not versioned) and a reader for the files the app exports.
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'node:fs';
import { openXlsx, type XValue } from '../../../src/main/exchange/xlsx-read';

export type FixtureCell = string | number | boolean | Date | null | { error: string } | { formula: string; result?: number };
export interface FixtureSheet { name: string; rows: FixtureCell[][]; merges?: string[] }

const col = (i: number) => String.fromCharCode(65 + i); // fixtures stay under 27 columns
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cell(ref: string, v: FixtureCell): string {
  if (v === null) return '';
  if (typeof v === 'string') return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  if (v instanceof Date) return `<c r="${ref}" s="1"><v>${(v.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000}</v></c>`;
  if ('error' in v) return `<c r="${ref}" t="e"><v>${v.error}</v></c>`;
  return `<c r="${ref}"><f>${esc(v.formula)}</f>${v.result === undefined ? '' : `<v>${v.result}</v>`}</c>`;
}

/** A row `[]` is an empty line; a `Date` shows as `m/d/yy h:mm`. */
export async function writeXlsx(path: string, sheets: FixtureSheet[]): Promise<void> {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('xl/workbook.xml', `<workbook ${ns} xmlns:r="${rel}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
  zip.file('xl/styles.xml', `<styleSheet ${ns}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>`);
  sheets.forEach((s, i) => {
    const rows = s.rows.map((r, n) => `<row r="${n + 1}">${r.map((v, c) => cell(`${col(c)}${n + 1}`, v)).join('')}</row>`).join('');
    const merges = s.merges?.length ? `<mergeCells count="${s.merges.length}">${s.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet ${ns}><sheetData>${rows}</sheetData>${merges}</worksheet>`);
  });
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
}

/** The first sheet of a workbook the app wrote: values by A1 reference, row values, raw XML of the sheet and the styles. */
export async function sheetOf(path: string) {
  const sheet = (await openXlsx(path))[0]!;
  const rows = await sheet.rows();
  const zip = await JSZip.loadAsync(readFileSync(path));
  return {
    name: sheet.name,
    rows,
    /** Number of rows up to the last one with a value (what Excel calls the used range). */
    rowCount: rows.at(-1)?.line ?? 0,
    cell(ref: string): XValue | undefined { return rows.find((r) => r.line === Number(ref.replace(/\D/g, '')))?.cells[ref.charCodeAt(0) - 65]; },
    row(line: number): (XValue | undefined)[] { return rows.find((r) => r.line === line)?.cells ?? []; },
    sheetXml: await zip.file('xl/worksheets/sheet1.xml')!.async('string'),
    stylesXml: await zip.file('xl/styles.xml')!.async('string'),
  };
}
