// Lecture d'un classeur Excel (.xlsx / .xlsm) pour l'import : chaque ligne d'une feuille devient un enregistrement de textes
// canoniques (EXCEL_SPEC : point décimal, dates ISO), que le moteur d'import du texte sait lire, typer et consigner.
import { statSync } from 'node:fs';
import { extname } from 'node:path';
import { EXCEL_SPEC, MAX_EXCEL_BYTES, type ExcelPreview } from '../../shared/exchange';
import { specLocale } from '../../shared/import-text';
import type { LocaleInfo } from '../../shared/locale-format';
import { detectHeader, inferFields, SAMPLE } from '../import/infer';
import type { ImportSource } from '../import/text-import';
import { tag, type Rec } from '../import/text-parse';
import { readFlatXml } from './xml-read';
import { openXlsx, type XSheet, type XValue } from './xlsx-read';

const PREVIEW_ROWS = 50;
const pad = (n: number) => String(n).padStart(2, '0');

/** Texte canonique d'une cellule. */
export function cellText(v: XValue | undefined): string {
  if (v === undefined) return '';
  if (v instanceof Date) { // the reader gives the UTC clock: read it as UTC, no time-zone shift
    const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    return v.getTime() % 86_400_000 === 0 ? d : `${d} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return v.error;
  return String(v);
}

// ponytail: whole-workbook read (100 MiB cap), one workbook kept; a streaming reader if larger files become common.
let loaded: { key: string; sheets: XSheet[] } | null = null;
async function load(path: string): Promise<XSheet[]> {
  if (!['.xlsx', '.xlsm'].includes(extname(path).toLowerCase())) throw new Error('bc:excelUnsupported');
  const st = statSync(path);
  if (st.size > MAX_EXCEL_BYTES) throw new Error('bc:fileTooLarge');
  const key = `${path}|${st.size}|${st.mtimeMs}`;
  if (loaded?.key === key) return loaded.sheets;
  let sheets: XSheet[];
  try { sheets = await openXlsx(path); } catch { throw new Error('bc:excelUnsupported'); } // not a zip, damaged
  loaded = { key, sheets };
  return sheets;
}

/** Enregistrements d'une feuille (la première si `sheet` est null), de la colonne 1 à la dernière utilisée ; `line` = numéro de ligne Excel. */
export async function readSheet(path: string, sheet: string | null): Promise<{ sheets: string[]; sheet: string; records: Rec[]; header?: true }> {
  if (extname(path).toLowerCase() === '.xml') { // F1: a flat XML file is one « sheet » named after its record element, its first record the element names
    const x = readFlatXml(path);
    return { sheets: [x.row], sheet: x.row, records: [tag(x.columns, 1), ...x.rows.map((r, i) => tag(r, i + 2))], header: true };
  }
  const all = await load(path);
  const sheets = all.map((w) => w.name);
  const ws = sheet === null ? all[0] : all.find((w) => w.name === sheet);
  if (!ws) throw new Error(sheet === null ? 'bc:excelUnsupported' : 'bc:invalidArgument');
  const rows: { line: number; cells: string[] }[] = [];
  let width = 0;
  for (const { line, cells: raw } of await ws.rows().catch(() => { throw new Error('bc:excelUnsupported'); })) {
    const cells: string[] = [];
    for (let i = 0; i < raw.length; i++) cells[i] = cellText(raw[i]);
    if (cells.every((x) => x === '')) continue; // fully empty row
    width = Math.max(width, cells.length);
    rows.push({ line, cells });
  }
  const records = rows.map((r) => { while (r.cells.length < width) r.cells.push(''); return tag(r.cells, r.line); });
  return { sheets, sheet: ws.name, records };
}

/** Source d'import : les enregistrements sans l'en-tête (le plan est alors exécuté avec `hasHeader` faux). */
export function excelSource(records: Rec[], hasHeader: boolean): ImportSource {
  const rows = hasHeader ? records.slice(1) : records;
  return { size: rows.length, records: function* (progress) { for (let i = 0; i < rows.length; i++) { progress?.(i + 1, rows.length); yield rows[i]; } } };
}

/** Cellules d'erreur (#DIV/0!…) : ignorées du seul échantillon de typage, pour qu'une colonne de nombres reste de nombres. */
const ERROR_CELL = /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!|GETTING_DATA)$/;
const blankErrors = (r: string[]) => r.map((x) => (ERROR_CELL.test(x) ? '' : x));

export async function previewExcel(path: string, sheet: string | null, hasHeader: boolean | null, region: LocaleInfo, prefix: string): Promise<ExcelPreview> {
  const { sheets, sheet: name, records, header: named } = await readSheet(path, sheet);
  const info = specLocale(EXCEL_SPEC, region);
  const sample = records.slice(0, SAMPLE + 1).map(blankErrors);
  // a header-only sheet is a header: detectHeader wants a row below it
  const header = hasHeader ?? named ?? detectHeader(sample.length === 1 ? [...sample, []] : sample, EXCEL_SPEC, info);
  const rows = header ? sample.slice(1) : sample;
  const columns = Math.max(1, records[0]?.length ?? 0);
  const fields = inferFields(header ? sample[0] ?? [] : null, rows, columns, EXCEL_SPEC, info, prefix);
  const shown = records.slice(0, PREVIEW_ROWS + 1);
  return {
    sheets, sheet: name, hasHeader: header, header: header ? [...(shown[0] ?? [])] : null,
    rows: (header ? shown.slice(1) : shown.slice(0, PREVIEW_ROWS)).map((r) => [...r]), columns, fields,
  };
}
