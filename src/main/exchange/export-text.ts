// Export en fichier texte, dans le processus de données : la source est lue par pages (celles de la feuille de données),
// écrite dans `<fichier>.bc-tmp` puis renommée sur le fichier (un fichier existant n'est remplacé qu'une fois le nouveau complet).
import { open, type FileHandle } from 'node:fs/promises';
import type { ExportResult, ExportTextSpec } from '../../shared/exchange';
import { csvRecord, encodeText, exportCell, isTextField, type CellTexts } from '../../shared/export-format';
import type { SourceField, SourcePage } from '../../shared/record-source';
import { viaTemp, writeFailed } from './atomic-file';

export const EXPORT_PAGE = 5000;

export interface TextExport {
  fields: SourceField[];
  /** The rows [offset, offset + limit) of the source, in its order. */
  page(offset: number, limit: number): SourcePage;
  spec: ExportTextSpec;
  path: string;
  texts: CellTexts;
  tick?(done: number, total: number): Promise<void>;
}

export async function writeTextExport(x: TextExport): Promise<ExportResult> {
  const { fields, spec } = x;
  const quoted = fields.map(isTextField);
  let unmappable = 0, ambiguous = 0;
  let handle: FileHandle | undefined;
  // `first`: the BOM goes once, with the first part written (the header, or the first rows, or nothing at all)
  let first = true;
  const put = async (text: string) => {
    const enc = encodeText(text, first || spec.encoding !== 'utf-8-bom' ? spec.encoding : 'utf-8');
    first = false;
    unmappable += enc.unmappable;
    try { await handle!.write(enc.bytes); } catch (e) { throw writeFailed(e); }
  };
  return viaTemp(x.path, async (tmp) => {
    try {
      try { handle = await open(tmp, 'w'); } catch (e) { throw writeFailed(e); }
      if (spec.hasHeader) {
        const r = csvRecord(fields.map((f) => f.name), fields.map(() => true), spec);
        if (r.ambiguous) ambiguous++;
        await put(r.line + '\r\n');
      } else await put('');
      let rows = 0, total = 0;
      for (;;) {
        const page = x.page(rows, EXPORT_PAGE);
        if (rows === 0) total = page.total;
        let text = '';
        for (const row of page.rows) {
          const r = csvRecord(fields.map((f, i) => exportCell(row[i] ?? null, f, x.texts)), quoted, spec);
          if (r.ambiguous) ambiguous++;
          text += r.line + '\r\n';
        }
        if (text) await put(text);
        rows += page.rows.length;
        if (page.rows.length) await x.tick?.(rows, Math.max(total, rows));
        if (page.rows.length < EXPORT_PAGE) break;
      }
      try { await handle.close(); handle = undefined; } catch (e) { throw writeFailed(e); }
      return { ok: true, rows, warnings: { unmappable, truncated: 0, ambiguous } };
    } catch (e) {
      await handle?.close().catch(() => {});
      throw e;
    }
  });
}
