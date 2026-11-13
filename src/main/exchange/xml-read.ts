// XML import (F1): a flat file, as Access writes it (<dataroot> > one element per record > one element per field), becomes records
// of canonical texts, which the Excel/text import engine types and writes. A hand reader for this shape only: no DTD, no entity
// declaration (a <!DOCTYPE> is refused, so nothing external is ever resolved), no dependency.
import { readFileSync, statSync } from 'node:fs';
import { MAX_EXCEL_BYTES } from '../../shared/exchange';
import { xmlUnname } from '../../shared/export-markup';

export interface FlatXml { row: string; columns: string[]; rows: string[][] }

// ponytail: an attribute value holding a raw `>` ends its tag early (attributes are ignored anyway); linear, no backtracking.
const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(!DOCTYPE|!ENTITY)|<(\/?)([^\s/>!?]+)([^>]*?)(\/?)>|([^<]+)/gi;
const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The five predefined entities and numeric references; any other `&…;` stays as written (nothing is looked up anywhere). */
export const xmlDecode = (s: string): string => s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (m, hex?: string, dec?: string, name?: string) => {
  if (name) return ENTITY[name.toLowerCase()]!;
  const n = hex ? parseInt(hex, 16) : parseInt(dec!, 10);
  return Number.isSafeInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
});

/** Access writes `2026-01-15T00:00:00`; the import engine reads `2026-01-15 00:00:00`. A fraction or a zone is dropped. */
// ponytail: the zone designator is dropped, not applied: the clock time in the file is kept as it is.
const isoDate = (v: string): string => v.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/, '$1 $2');

/** Throws bc:xmlUnsupported (not XML of this shape, a DTD, a field with children). Elements named xs:/xsd: at the record level (an
 *  embedded schema) are skipped; attributes are ignored. */
export function parseFlatXml(text: string): FlatXml {
  const bad = () => new Error('bc:xmlUnsupported');
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const columns: string[] = [];
  let row: string | null = null;
  const records: Map<string, string>[] = [];
  let cur: Map<string, string> | null = null;
  let field: string | null = null;
  let fieldText = '';
  let depth = 0, skip = 0, rootSeen = false;
  const finishRow = () => {
    records.push(cur!);
    cur = null;
  };
  for (const m of body.matchAll(TOKEN)) {
    const [, cdata, dtd, close, name, , selfClose, chars] = m;
    if (dtd) throw bad();
    if (name === undefined) { // text, CDATA, comment, declaration
      if (depth === 3) fieldText += cdata ?? (chars !== undefined ? xmlDecode(chars) : '');
      else if (chars !== undefined && chars.trim() !== '' && skip === 0) throw bad(); // text between elements
      continue;
    }
    if (close) {
      if (skip > 0) { skip--; continue; }
      if (depth === 3) { if (!cur!.has(field!)) cur!.set(field!, isoDate(fieldText)); }
      else if (depth === 2) finishRow();
      depth--;
      continue;
    }
    if (skip > 0) { if (!selfClose) skip++; continue; }
    if (depth === 0) { if (rootSeen) throw bad(); rootSeen = true; depth = selfClose ? 0 : 1; continue; }
    if (depth === 1) { // a record, or an embedded schema
      const n = xmlUnname(name);
      if (/^(xs|xsd):/i.test(name) || (row !== null && n !== row)) { if (!selfClose) skip = 1; continue; } // not a record
      row ??= n;
      cur = new Map();
      if (selfClose) finishRow(); else depth = 2;
      continue;
    }
    if (depth === 2) { // a field
      field = xmlUnname(name);
      if (!columns.includes(field)) columns.push(field);
      if (selfClose) { if (!cur!.has(field)) cur!.set(field, ''); } else { fieldText = ''; depth = 3; }
      continue;
    }
    throw bad(); // an element inside a field
  }
  if (row === null || columns.length === 0 || depth !== 0) throw bad();
  return { row, columns, rows: records.map((m) => columns.map((c) => m.get(c) ?? '')) }; // a column first seen in a later record is empty before
}

/** The file (a path chosen in the open dialog, checked by the caller), size-limited, read as UTF-8 text. */
export function readFlatXml(path: string): FlatXml {
  if (statSync(path).size > MAX_EXCEL_BYTES) throw new Error('bc:fileTooLarge');
  return parseFlatXml(readFileSync(path, 'utf8'));
}
