// Export en classeur Excel (.xlsx), dans le processus de données : mêmes pages que l'export texte, écrites en flux (jszip, OOXML minimal)
// dans `<fichier>.bc-tmp` puis renommées. Cellules typées ; un texte reste du texte, jamais une formule (`=1+1`).
import JSZip from 'jszip';
import { createWriteStream, WriteStream } from 'node:fs';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_EXCEL_CELL, MAX_EXCEL_ROWS, type ExportResult } from '../../shared/exchange';
import { excelCurrencyFormat, excelDateFormat, exportCell, isTextField } from '../../shared/export-format';
import type { SqlValue } from '../../shared/coerce';
import type { LocaleInfo } from '../../shared/locale-format';
import type { SourceField, SourcePage } from '../../shared/record-source';
import { viaTemp, writeFailed } from './atomic-file';
import { EXPORT_PAGE } from './export-text';

const WIDTH_ROWS = 1000;
const MAX_WIDTH = 50;

export interface ExcelExport {
  fields: SourceField[];
  page(offset: number, limit: number): Promise<SourcePage>;
  path: string;
  sheet: string;
  info: LocaleInfo;
  tick?(done: number, total: number): Promise<void>;
  /** The temporary file's stream (tests inject a failing one). */
  openStream?(tmp: string): Writable;
}
interface Cell { value: string | number | boolean | Date | null; style?: number; width: number; cut?: boolean }

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/;

function excelCell(v: SqlValue, f: SourceField, fmt: { currency: string; date: string; dateTime: string; info: LocaleInfo }): Cell {
  const text = (s: string): Cell => {
    if (s.length <= MAX_EXCEL_CELL) return { value: s, width: s.length };
    return { value: s.slice(0, MAX_EXCEL_CELL), width: MAX_EXCEL_CELL, cut: true };
  };
  if (v === null) return { value: null, width: 0 };
  if (isTextField(f)) return text(String(v));
  switch (f.type) {
    case 'yesNo': return { value: !(v === 0 || v === '0'), width: 5 };
    case 'number': case 'currency': case 'autoNumber': {
      const n = Number(v);
      // a decimal that a double cannot hold exactly (or a NaN) stays text
      if (!Number.isFinite(n) || (f.props.numberSize === 'decimal' && String(n) !== String(v))) return text(String(v));
      return { value: n, width: String(n).length, ...(f.type === 'currency' ? { style: 2 } : {}) };
    }
    case 'dateTime': {
      const m = DATE.exec(String(v));
      if (!m) return text(String(v));
      // Excel's 1900 calendar has a 29 Feb 1900 and no year 0-99 (those dates would show as #####): written as the text export writes them
      if (m[0].slice(0, 10) < '1900-03-01') return text(exportCell(v, f, { info: fmt.info, yes: '', no: '' })!);
      const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
      const withTime = !!m[4] && (h! > 0 || mi! > 0 || s! > 0);
      // the UTC clock is written: no time-zone shift
      return { value: new Date(Date.UTC(y!, mo! - 1, d, h, mi, s)), style: withTime ? 4 : 3, width: withTime ? 19 : 10 };
    }
    default: return text(String(v));
  }
}


const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// XML 1.0 forbids most control characters; a literal `_x0041_` would be read as an escape
const text = (s: string) => esc(s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, '').replace(/_x([0-9a-fA-F]{4})_/g, '_x005F_x$1_'));
const colName = (i: number) => { let n = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) n = String.fromCharCode(65 + ((i - 1) % 26)) + n; return n; };
const DAY0 = Date.UTC(1899, 11, 30);

/** Cell XML; a date is its serial number (the 1900 system), a text an inline string, never a formula. */
function cellXml(ref: string, c: Cell): string {
  const s = c.style ? ` s="${c.style}"` : '';
  const v = c.value;
  if (v === null) return '';
  if (typeof v === 'string') return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${text(v)}</t></is></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${s}><v>${v instanceof Date ? (v.getTime() - DAY0) / 86_400_000 : v}</v></c>`;
}

const SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
const xf = (numFmtId: number, fontId = 0) => `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="0" borderId="0" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}/>`;

/** The package's small files; the cellXfs are the `style` of Cell: 0 default, 1 bold header, 2 currency, 3 date, 4 date and time. */
function packageFiles(sheet: string, fmt: { currency: string; date: string; dateTime: string }): Record<string, string> {
  const codes = [fmt.currency, fmt.date, fmt.dateTime].map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(c)}"/>`).join('');
  return {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${SHEET}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${SHEET}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${SHEET}.styles+xml"/></Types>`,
    '_rels/.rels': `${HEAD}<Relationships ${REL_NS}>${rel('rId1', 'officeDocument', 'xl/workbook.xml')}</Relationships>`,
    'xl/workbook.xml': `${HEAD}<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${HEAD}<Relationships ${REL_NS}>${rel('rId1', 'worksheet', 'worksheets/sheet1.xml')}${rel('rId2', 'styles', 'styles.xml')}</Relationships>`,
    'xl/styles.xml': `${HEAD}<styleSheet ${NS}><numFmts count="3">${codes}</numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5">${xf(0)}${xf(0, 1)}${xf(164)}${xf(165)}${xf(166)}</cellXfs></styleSheet>`,
  };
}

export async function writeExcelExport(x: ExcelExport): Promise<ExportResult> {
  const total = (await x.page(0, 0)).total;
  if (total > MAX_EXCEL_ROWS) return { ok: false, reason: 'tooManyRows', limit: MAX_EXCEL_ROWS };
  const fmt = { currency: excelCurrencyFormat(x.info), date: excelDateFormat(x.info, false), dateTime: excelDateFormat(x.info, true), info: x.info };
  return viaTemp(x.path, async (tmp) => {
    const stream = x.openStream?.(tmp) ?? createWriteStream(tmp);
    let failure: unknown;
    let stopped = false;
    stream.on('error', (e: unknown) => { failure ??= e; }); // an error event nobody listens to would end the data process
    try {
      if (stream instanceof WriteStream) await new Promise<void>((ok, ko) => { stream.once('open', () => ok()); stream.once('error', ko); }).catch((e) => { throw writeFailed(e); });
      let rows = 0, truncated = 0;
      const n = x.fields.length;
      async function* sheetXml() {
        yield `${HEAD}<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
        for (let first = true; !stopped; first = false) {
          const page = await x.page(rows, EXPORT_PAGE);
          const cells = page.rows.map((row) => x.fields.map((f, i) => excelCell(row[i] ?? null, f, fmt)));
          let xml = '';
          if (first) {
            // the columns are written with the sheet's first row: widths come from the header and the first rows
            if (n) xml += '<cols>' + x.fields.map((f, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(MAX_WIDTH, Math.max([...f.name].length, ...cells.slice(0, WIDTH_ROWS).map((c) => c[i]!.width))) + 2}" customWidth="1"/>`).join('') + '</cols>';
            xml += '<sheetData><row r="1">' + x.fields.map((f, i) => cellXml(`${colName(i)}1`, { value: f.name, style: 1, width: 0 })).join('') + '</row>';
          }
          cells.forEach((c, r) => {
            const line = rows + r + 2;
            xml += `<row r="${line}">` + c.map((k, i) => { if (k.cut) truncated++; return cellXml(`${colName(i)}${line}`, k); }).join('') + '</row>';
          });
          rows += page.rows.length;
          yield Buffer.from(xml);
          if (page.rows.length) await x.tick?.(rows, Math.max(total, rows));
          if (page.rows.length < EXPORT_PAGE) break;
        }
        yield `</sheetData>${n ? `<autoFilter ref="A1:${colName(n - 1)}1"/>` : ''}</worksheet>`;
      }
      const zip = new JSZip();
      for (const [name, content] of Object.entries(packageFiles(x.sheet, fmt))) zip.file(name, content);
      zip.file('xl/worksheets/sheet1.xml', Readable.from(sheetXml()), { binary: true });
      await pipeline(zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE' }), stream);
      return { ok: true, rows, warnings: { unmappable: 0, truncated, ambiguous: 0 } } satisfies ExportResult;
    } catch (e) {
      stopped = true;
      stream.destroy(); // releases the file before it is removed
      throw e instanceof Error && e.message.startsWith('bc:') ? e : failure ? writeFailed(failure) : e;
    }
  });
}
