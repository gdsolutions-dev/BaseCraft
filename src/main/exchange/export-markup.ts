// XML (Access's data format, F1) and HTML table (F5) export, in the data process: the source is read page by page as the text
// export does, written to `<file>.bc-tmp` as UTF-8, then renamed. Everything written is escaped (src/shared/export-markup.ts).
import { open, type FileHandle } from 'node:fs/promises';
import type { ExportResult } from '../../shared/exchange';
import { exportCell, type CellTexts } from '../../shared/export-format';
import { htmlText, xmlName, xmlRow } from '../../shared/export-markup';
import type { SourceField, SourcePage } from '../../shared/record-source';
import { viaTemp, writeFailed } from './atomic-file';
import { EXPORT_PAGE } from './export-text';

export interface MarkupExport {
  format: 'xml' | 'html';
  /** The table or query name: the row element of the XML, the title of the HTML. */
  name: string;
  fields: SourceField[];
  page(offset: number, limit: number): Promise<SourcePage>;
  path: string;
  texts: CellTexts;
  tick?(done: number, total: number): Promise<void>;
  now?: Date;
}

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ponytail: no .xsd schema file (Access's « Schema of the data »): the importer guesses types from the values.
export async function writeMarkupExport(x: MarkupExport): Promise<ExportResult> {
  const { fields, format } = x;
  const xml = format === 'xml';
  const row = xmlName(x.name);
  let handle: FileHandle | undefined;
  const put = async (text: string) => {
    try { await handle!.write(text, null, 'utf8'); } catch (e) { throw writeFailed(e); }
  };
  return viaTemp(x.path, async (tmp) => {
    try {
      try { handle = await open(tmp, 'w'); } catch (e) { throw writeFailed(e); }
      await put(xml
        ? `<?xml version="1.0" encoding="UTF-8"?>\r\n<dataroot xmlns:od="urn:schemas-microsoft-com:officedata" generated="${iso(x.now ?? new Date())}">\r\n`
        : `<!DOCTYPE html>\r\n<html>\r\n<head>\r\n<meta charset="utf-8">\r\n<title>${htmlText(x.name)}</title>\r\n</head>\r\n<body>\r\n<table border="1">\r\n`
          + `<thead><tr>${fields.map((f) => `<th>${htmlText(f.name)}</th>`).join('')}</tr></thead>\r\n<tbody>\r\n`);
      let rows = 0, total = 0;
      for (;;) {
        const page = await x.page(rows, EXPORT_PAGE);
        if (rows === 0) total = page.total;
        let text = '';
        for (const r of page.rows) {
          text += xml ? xmlRow(row, fields, r)
            : `<tr>${fields.map((f, i) => `<td>${htmlText(exportCell(r[i] ?? null, f, x.texts) ?? '')}</td>`).join('')}</tr>\r\n`;
        }
        if (text) await put(text);
        rows += page.rows.length;
        if (page.rows.length) await x.tick?.(rows, Math.max(total, rows));
        if (page.rows.length < EXPORT_PAGE) break;
      }
      await put(xml ? '</dataroot>\r\n' : '</tbody>\r\n</table>\r\n</body>\r\n</html>\r\n');
      try { await handle.close(); handle = undefined; } catch (e) { throw writeFailed(e); }
      return { ok: true, rows, warnings: { unmappable: 0, truncated: 0, ambiguous: 0 } };
    } catch (e) {
      await handle?.close().catch(() => {});
      throw e;
    }
  });
}

