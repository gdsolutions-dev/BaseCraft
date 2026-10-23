// État instantané (AutoReport d'Access) : un état tabulaire sur toutes les colonnes d'une table ou d'une requête. Module pur.
// Aucune valeur par défaut écrite à la main (C5) : bordures, fonds et polices viennent du catalogue (defaultFor(…, 'report')).
import type { ControlDef, DesignDoc, SectionDef } from '../design/model';
import { sameName, type FieldType } from '../field-types';
import type { RecordSourceRef, SourceField, SourceInfo } from '../record-source';
import { DEFAULT_PAGE_SETUP, pageGeometry, type PageSetup } from './model';

/** Between two columns; the width of the report header's date and time boxes (also the designer's Date and Time). */
export const GAP = 57, STAMP = 3402;
const MIN_WIDTH = 567;
const MIN_TOTAL = 4535 + GAP + STAMP;   // the title, the date and the page number need some room even over one column
/** Values the band formatter right-aligns under `general`: their column label is right-aligned too, as in Access. */
const RIGHT: FieldType[] = ['autoNumber', 'number', 'currency', 'dateTime'];
const WIDTHS: Record<FieldType, number> = { autoNumber: 851, yesNo: 851, shortText: 2268, longText: 3402, number: 1418, currency: 1701, dateTime: 1701, hyperlink: 2835 };
const widthOf = (f: SourceField) => (f.type === 'shortText' && (f.props.size ?? 255) <= 10 ? 1134 : WIDTHS[f.type] ?? 2268);

/** `base`, else `base1`, `base2`… (sameName), cut so that it stays a valid name (64 characters). */
export function uniqueReportName(taken: string[], base: string): string {
  const chars = [...base];
  for (let n = 0; ; n++) {
    const suffix = n === 0 ? '' : String(n), name = chars.slice(0, 64 - suffix.length).join('') + suffix;
    if (!taken.some((x) => sameName(x, name))) return name;
  }
}

export function instantReport(source: RecordSourceRef & { name: string }, info: SourceInfo, opts: { lang: 'fr' | 'en' }): DesignDoc {
  const names: string[] = [];
  const ctl = (kind: ControlDef['kind'], base: string, left: number, top: number, width: number, height: number, props: Record<string, unknown>): ControlDef => {
    const name = uniqueReportName(names, base);
    names.push(name);
    return { kind, name, left, top, width, height, props };
  };

  let widths = info.fields.map(widthOf);
  const gaps = GAP * Math.max(0, widths.length - 1), sum = () => widths.reduce((a, b) => a + b, 0) + gaps;
  let pageSetup: PageSetup = DEFAULT_PAGE_SETUP;
  if (sum() > pageGeometry(pageSetup).printableWidth) pageSetup = { ...DEFAULT_PAGE_SETUP, orientation: 'landscape' };
  const printable = pageGeometry(pageSetup).printableWidth;
  if (sum() > printable) {   // same ratio for every column, never below 1 cm: what still overflows is clipped (widthExceedsPage)
    const ratio = (printable - gaps) / (sum() - gaps);
    widths = widths.map((w) => Math.max(MIN_WIDTH, Math.floor(w * ratio)));
  }
  const lefts = widths.map((_, i) => widths.slice(0, i).reduce((a, w) => a + w + GAP, 0));
  const width = Math.max(sum(), MIN_TOTAL);

  const title = ctl('label', 'Titre', 0, 283, width - STAMP - GAP, 567, { Caption: source.name, FontSize: 18, FontWeight: 'bold' });
  const date = ctl('textBox', 'Auto_Date', width - STAMP, 57, STAMP, 340, { ControlSource: '=Date()', Format: 'longDate', TextAlign: 'right' });
  const time = ctl('textBox', 'Auto_Heure', width - STAMP, 454, STAMP, 340, { ControlSource: '=Time()', Format: 'longTime', TextAlign: 'right' });
  const labels = info.fields.map((f, i) => ctl('label', `Étiquette_${f.name}`, lefts[i]!, 57, widths[i]!, 340, { Caption: f.props.caption || f.name, FontWeight: 'bold', ...(RIGHT.includes(f.type) ? { TextAlign: 'right' } : {}) }));
  const boxes = info.fields.map((f, i) => ctl(f.type === 'yesNo' ? 'checkBox' : 'textBox', f.name, lefts[i]!, 0, widths[i]!, 340,
    { ControlSource: f.name, ...(f.type === 'longText' ? { CanGrow: true } : {}) }));
  const page = opts.lang === 'fr' ? '="Page " & [Page] & " sur " & [Pages]' : '="Page " & [Page] & " of " & [Pages]';
  const pageNo = ctl('textBox', 'Numéro_Page', 0, 57, width, 340, { ControlSource: page, TextAlign: 'right' });
  // A Currency first column shows its sum rather than the count (one control per place).
  const totals = info.fields.flatMap((f, i) => f.type === 'currency' ? [ctl('textBox', `Somme_${f.name}`, lefts[i]!, 57, widths[i]!, 340, { ControlSource: `=Sum([${f.name}])` })]
    : i === 0 ? [ctl('textBox', 'Nombre', 0, 57, widths[0]!, 340, { ControlSource: '=Count(*)' })] : []);

  const section = (kind: SectionDef['kind'], height: number, controls: ControlDef[], props: Record<string, unknown> = {}): SectionDef => ({ kind, height, props, controls });
  return {
    formatVersion: '1.0',
    recordSource: source.kind === 'sql' ? { kind: 'sql', sql: source.sql } : { kind: source.kind, name: source.name },
    props: { Width: width, pageSetup, grouping: [] },
    sections: [
      section('reportHeader', 1134, [title, date, time]),
      section('pageHeader', 454, labels),
      section('detail', 340, boxes, info.fields.some((f) => f.type === 'longText') ? { CanGrow: true } : {}),
      section('pageFooter', 454, [pageNo]),
      section('reportFooter', 454, totals),
    ],
  };
}
