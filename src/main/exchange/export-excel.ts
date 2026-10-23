// Export en classeur Excel (.xlsx), dans le processus de données : mêmes pages que l'export texte, écrites en flux (exceljs)
// dans `<fichier>.bc-tmp` puis renommées. Cellules typées ; un texte reste du texte, jamais une formule (`=1+1`).
import ExcelJS from 'exceljs';
import { createWriteStream, WriteStream } from 'node:fs';
import type { Writable } from 'node:stream';
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
  page(offset: number, limit: number): SourcePage;
  path: string;
  sheet: string;
  info: LocaleInfo;
  tick?(done: number, total: number): Promise<void>;
  /** The temporary file's stream (tests inject a failing one). */
  openStream?(tmp: string): Writable;
}
interface Cell { value: string | number | boolean | Date | null; numFmt?: string; width: number; cut?: boolean }

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
      if (Number.isNaN(n) || (f.props.numberSize === 'decimal' && String(n) !== String(v))) return text(String(v));
      return { value: n, width: String(n).length, ...(f.type === 'currency' ? { numFmt: fmt.currency } : {}) };
    }
    case 'dateTime': {
      const m = DATE.exec(String(v));
      if (!m) return text(String(v));
      // Excel's 1900 calendar has a 29 Feb 1900 and no year 0-99 (those dates would show as #####): written as the text export writes them
      if (m[0].slice(0, 10) < '1900-03-01') return text(exportCell(v, f, { info: fmt.info, yes: '', no: '' })!);
      const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
      const withTime = !!m[4] && (h! > 0 || mi! > 0 || s! > 0);
      // exceljs writes the UTC clock: no time-zone shift
      return { value: new Date(Date.UTC(y!, mo! - 1, d, h, mi, s)), numFmt: withTime ? fmt.dateTime : fmt.date, width: withTime ? 19 : 10 };
    }
    default: return text(String(v));
  }
}

export async function writeExcelExport(x: ExcelExport): Promise<ExportResult> {
  const total = x.page(0, 0).total;
  if (total > MAX_EXCEL_ROWS) return { ok: false, reason: 'tooManyRows', limit: MAX_EXCEL_ROWS };
  const fmt = { currency: excelCurrencyFormat(x.info), date: excelDateFormat(x.info, false), dateTime: excelDateFormat(x.info, true), info: x.info };
  return viaTemp(x.path, async (tmp) => {
    const stream = x.openStream?.(tmp) ?? createWriteStream(tmp);
    let failure: unknown;
    stream.on('error', (e: unknown) => { failure ??= e; }); // an error event nobody listens to would end the data process
    try {
      if (stream instanceof WriteStream) await new Promise<void>((ok, ko) => { stream.once('open', () => ok()); stream.once('error', ko); }).catch((e) => { throw writeFailed(e); });
      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
      const ws = wb.addWorksheet(x.sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
      if (x.fields.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: x.fields.length } };
      let rows = 0, truncated = 0;
      for (let first = true; ; first = false) {
        const page = x.page(rows, EXPORT_PAGE);
        const cells = page.rows.map((row) => x.fields.map((f, i) => excelCell(row[i] ?? null, f, fmt)));
        if (first) {
          // the columns are written with the sheet's first row: widths come from the header and the first rows
          ws.columns = x.fields.map((f, i) => ({
            width: Math.min(MAX_WIDTH, Math.max([...f.name].length, ...cells.slice(0, WIDTH_ROWS).map((c) => c[i]!.width))) + 2,
          }));
          const header = ws.addRow(x.fields.map((f) => f.name));
          header.eachCell((c) => { c.font = { bold: true }; });
          header.commit();
        }
        for (const c of cells) {
          const row = ws.addRow(c.map((k) => k.value));
          c.forEach((k, i) => {
            if (k.numFmt) row.getCell(i + 1).numFmt = k.numFmt;
            if (k.cut) truncated++;
          });
          row.commit();
        }
        rows += page.rows.length;
        if (failure) throw writeFailed(failure); // exceljs would wait for events that were already emitted
        if (page.rows.length) await x.tick?.(rows, Math.max(total, rows));
        if (failure) throw writeFailed(failure);
        if (page.rows.length < EXPORT_PAGE) break;
      }
      ws.commit();
      if (failure) throw writeFailed(failure);
      // exceljs waits for `finish` or a later `error`: a stream that dies meanwhile must end the wait
      const dead = new Promise<never>((_, ko) => {
        stream.once('error', ko);
        stream.once('close', () => { if (!stream.writableFinished) ko(new Error('stream closed')); });
      });
      dead.catch(() => {});
      await Promise.race([wb.commit(), dead]);
      if (!stream.writableFinished) await Promise.race([new Promise<void>((ok) => { stream.once('finish', () => ok()); }), dead]);
      if (failure) throw writeFailed(failure);
      return { ok: true, rows, warnings: { unmappable: 0, truncated, ambiguous: 0 } } satisfies ExportResult;
    } catch (e) {
      stream.destroy(); // releases the file before it is removed
      throw e instanceof Error && e.message.startsWith('bc:') ? e : failure ? writeFailed(failure) : e;
    }
  });
}
