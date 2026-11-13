// Label Wizard (Create › Labels): a report in columns, one text box per line in a Detail as tall as a label, Across then Down. Pure module.
import type { ControlDef, DesignDoc } from '../../shared/design/model';
import { bracket } from '../../shared/expr/lexer';
import { sameName } from '../../shared/field-types';
import type { RecordSourceRef } from '../../shared/record-source';
import { pageGeometry, type PageSetup, type PaperId } from '../../shared/report/model';
import { addSort } from '../report/design/grouping-model';

/** A sheet of labels, in twips: the label, the columns, and the sheet's left and top margins (the right one is the same). */
export interface LabelSheet { paper: PaperId; width: number; height: number; columns: number; left: number; top: number }
const MM = 1440 / 25.4;
const mm = (v: number) => Math.round(v * MM);
export const LABEL_SHEETS: Record<string, LabelSheet & { name: string }> = {
  L7160: { name: 'Avery L7160 (21 · A4 · 63,5 × 38,1 mm)', paper: 'a4', width: 3600, height: 2160, columns: 3, left: mm(7.2), top: mm(15.1) },
  L7163: { name: 'Avery L7163 (14 · A4 · 99,1 × 38,1 mm)', paper: 'a4', width: 5619, height: 2160, columns: 2, left: mm(4.65), top: mm(15.1) },
  L7173: { name: 'Avery L7173 (10 · A4 · 99,1 × 57 mm)', paper: 'a4', width: 5619, height: mm(57), columns: 2, left: mm(4.65), top: mm(12.9) },
  '5160': { name: 'Avery 5160 (30 · Letter · 2⅝ × 1 in.)', paper: 'letter', width: 3780, height: 1440, columns: 3, left: 270, top: 720 },
};
const BOTTOM = 280;   // ponytail: a fixed bottom margin (about 5 mm) for the printer's unprintable edge
const PAD = 113;      // the text's inset in a label (2 mm)

/** The gap between two columns: what the sheet's margins leave. A sheet whose columns do not fit in the printable width has none. */
export function labelGeometry(s: LabelSheet): { page: PageSetup; spacing: number; fits: boolean } {
  const page: PageSetup = { orientation: 'portrait', paper: s.paper, margins: { top: s.top, right: s.left, bottom: BOTTOM, left: s.left } };
  const free = pageGeometry(page).printableWidth - s.columns * s.width;
  return { page, spacing: s.columns > 1 ? Math.max(0, Math.floor(free / (s.columns - 1))) : 0, fits: free >= 0 && s.height > 0 && s.height <= pageGeometry(page).printableHeight };
}

/** One line of a label as an expression: `[Field]` (a name of the source, `]` written `]]`) is a field, anything else is text;
 *  the pieces are joined with `&`, text quoted with `"` doubled. null for an empty line. */
export function lineExpression(line: string, fields: string[]): string | null {
  const parts: string[] = [];
  let text = '';
  const flush = () => { if (text) parts.push(`"${text.replace(/"/g, '""')}"`); text = ''; };
  for (const piece of line.split(/(\[(?:[^\]]|\]\])+\])/)) {
    const name = piece.startsWith('[') ? piece.slice(1, -1).replace(/]]/g, ']') : '';
    const field = name ? fields.find((f) => sameName(f, name)) : undefined;
    if (field === undefined) text += piece;
    else { flush(); parts.push(bracket(field)); }
  }
  flush();
  return parts.length ? `=${parts.join(' & ')}` : null;
}

export interface LabelChoices { sheet: LabelSheet; fontSize: number; lines: string[]; sort: string | null }

export function labelReport(ref: RecordSourceRef & { name: string }, fields: string[], c: LabelChoices): DesignDoc {
  const { page, spacing } = labelGeometry(c.sheet);
  const { width, height, columns } = c.sheet;
  const lines = c.lines.length ? c.lines : [''];
  const lineH = Math.max(1, Math.floor((height - 2 * PAD) / lines.length));
  const boxes = lines.flatMap((l, i): ControlDef[] => {
    const source = lineExpression(l, fields);
    return source ? [{ kind: 'textBox', name: `Ligne${i + 1}`, left: PAD, top: PAD + i * lineH, width: Math.max(1, width - 2 * PAD), height: lineH, props: { ControlSource: source, FontSize: c.fontSize } }] : [];
  });
  const doc: DesignDoc = {
    formatVersion: '1.0',
    recordSource: { kind: ref.kind === 'sql' ? 'table' : ref.kind, name: ref.name },
    props: { Width: columns * width + (columns - 1) * spacing, pageSetup: page, grouping: [], columns: { count: columns, spacing, across: true } },
    sections: [
      { kind: 'pageHeader', height: 0, props: {}, controls: [] },
      { kind: 'detail', height, props: {}, controls: boxes },
      { kind: 'pageFooter', height: 0, props: {}, controls: [] },
    ],
  };
  return c.sort ? addSort(doc, c.sort) : doc;
}
