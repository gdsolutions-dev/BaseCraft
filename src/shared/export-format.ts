// Export « sans mise en forme » (Access) : texte de chaque valeur, enregistrement délimité, encodage. Module pur.
import { toDecimal, type SqlValue } from './coerce';
import type { ExportTextSpec } from './exchange';
import { formatCurrency, type LocaleInfo } from './locale-format';
import type { SourceField } from './record-source';

export interface CellTexts { info: LocaleInfo; yes: string; no: string }

const TEXT_TYPES = new Set(['shortText', 'longText', 'hyperlink']);
export const isTextField = (f: SourceField): boolean => TEXT_TYPES.has(f.type);

/** null : champ vide. Texte : tel que stocké ; nombres : chiffres canoniques, séparateur décimal régional ; dates : date courte
 *  de la région, plus l'heure (hh:nn:ss) hors minuit ; Oui/Non : les mots de la langue de l'interface. */
export function exportCell(v: SqlValue, f: SourceField, t: CellTexts): string | null {
  if (v === null) return null;
  switch (f.type) {
    case 'yesNo': return v === 0 || v === '0' ? t.no : t.yes;
    case 'number': case 'currency': case 'autoNumber': {
      const d = toDecimal(v, { ...t.info, decimalSep: '.', groupSep: '' });
      return d === null ? String(v) : d.replace('.', t.info.decimalSep);
    }
    case 'dateTime': {
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(String(v));
      if (!m) return String(v);
      const part: Record<string, string> = { D: m[3]!, M: m[2]!, Y: m[1]! };
      const date = [...t.info.dateOrder].map((c) => part[c]).join(t.info.dateSep);
      const time = m[4] === undefined || `${m[4]}${m[5]}${m[6]}` === '000000' ? '' : ` ${m[4]}:${m[5]}:${m[6]}`;
      return date + time;
    }
    default: return String(v);
  }
}

/** A text field is wrapped in the qualifier (inner qualifiers doubled); an empty field (null) stays empty. A cell that is not
 *  wrapped and holds the delimiter, CR or LF is written as is and reported `ambiguous`. */
export function csvRecord(cells: (string | null)[], quoted: boolean[], spec: ExportTextSpec): { line: string; ambiguous: boolean } {
  const q = spec.qualifier;
  let ambiguous = false;
  const out = cells.map((c, i) => {
    if (c === null) return '';
    if (q !== '' && quoted[i]) return q + c.split(q).join(q + q) + q;
    if (c.includes(spec.delimiter) || /[\r\n]/.test(c)) ambiguous = true;
    return c;
  });
  return { line: out.join(spec.delimiter), ambiguous };
}

const CP1252 = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/** utf-8-bom puts EF BB BF first (the writer asks for it once, on the first part). windows-1252: anything else is `?`, counted. */
export function encodeText(s: string, encoding: ExportTextSpec['encoding']): { bytes: Uint8Array; unmappable: number } {
  if (encoding !== 'windows-1252') {
    const body = new TextEncoder().encode(s);
    if (encoding === 'utf-8') return { bytes: body, unmappable: 0 };
    const bytes = new Uint8Array(body.length + 3);
    bytes.set([0xef, 0xbb, 0xbf]);
    bytes.set(body, 3);
    return { bytes, unmappable: 0 };
  }
  const out: number[] = [];
  let unmappable = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const b = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252.get(c);
    if (b === undefined) { out.push(0x3f); unmappable++; } else out.push(b);
  }
  return { bytes: Uint8Array.from(out), unmappable };
}

/** Excel forbids [ ] : * ? / \ in a sheet name and more than 31 characters; nothing left: 'Sheet1'. */
export function sheetName(objectName: string): string {
  const s = objectName.replace(/[[\]:*?/\\]/g, '').trim().slice(0, 31).replace(/[\ud800-\udbff]$/, '').trim();
  return s || 'Sheet1';
}

/** The region's currency written as an Excel number format (symbol before or after, with its space). No currency: plain. */
export function excelCurrencyFormat(info: LocaleInfo): string {
  const s = formatCurrency(0, info.locale);
  const symbol = s.replace(/[\d.,\s  ]/g, '');
  if (!symbol) return '#,##0.00';
  const sym = `"${symbol}"`;
  const gap = /[\s  ]/.test(s) ? '\\ ' : '';
  return s.startsWith(symbol) ? `${sym}${gap}#,##0.00` : `#,##0.00${gap}${sym}`;
}

/** Excel format of the region's short date, zero-padded as the region writes it (dd/mm/yyyy, m/d/yyyy), plus hh:mm:ss. */
export function excelDateFormat(info: LocaleInfo, withTime: boolean): string {
  const sample = new Intl.DateTimeFormat(info.locale, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date(Date.UTC(2026, 2, 4, 5)));
  const padded = (type: string) => (sample.find((p) => p.type === type)?.value.length ?? 1) > 1;
  const code: Record<string, string> = { D: padded('day') ? 'dd' : 'd', M: padded('month') ? 'mm' : 'm', Y: 'yyyy' };
  const date = [...info.dateOrder].map((c) => code[c]).join(info.dateSep);
  return withTime ? `${date} ${padded('hour') ? 'hh' : 'h'}:mm:ss` : date;
}
