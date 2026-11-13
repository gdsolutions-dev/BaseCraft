// XML and HTML export (F1, F5): names, escaping and value texts. Pure module, used by the data process and the tests.
import type { SqlValue } from './coerce';
import type { SourceField } from './record-source';

/** An XML element name from a field or table name, as Access writes it: a character a name cannot hold becomes `_xHHHH_`
 *  (a space is `_x0020_`), UTF-16 unit by unit (a surrogate pair is two escapes, which the reader joins again). */
export function xmlName(name: string): string {
  let out = '';
  for (let i = 0; i < name.length; i++) {
    const c = name[i]!;
    const ok = i === 0 ? /[\p{L}_]/u.test(c) : /[\p{L}\p{N}_.\-]/u.test(c);
    out += ok ? c : `_x${name.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}_`;
  }
  return out || '_x0020_';
}

/** The name an `xmlName` escape stands for (the import reads Access's files back). */
export const xmlUnname = (s: string): string => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** Text for element content: & < > escaped, characters XML 1.0 cannot carry dropped. */
export function xmlText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Access's data format: dates `YYYY-MM-DDTHH:MM:SS`, Yes/No 1 or 0, numbers and text as stored; null: no element (undefined). */
export function xmlValue(v: SqlValue, f: SourceField): string | undefined {
  if (v === null) return undefined;
  if (f.type === 'yesNo') return v === 0 || v === '0' ? '0' : '1';
  if (f.type === 'dateTime') {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(String(v));
    return m ? `${m[1]}T${m[2] ?? '00:00:00'}` : String(v);
  }
  return String(v);
}

/** One row as an element named `row`: one child element per field that has a value. */
export function xmlRow(row: string, fields: SourceField[], values: SqlValue[]): string {
  let out = `<${row}>\r\n`;
  fields.forEach((f, i) => {
    const t = xmlValue(values[i] ?? null, f);
    if (t !== undefined) { const n = xmlName(f.name); out += `<${n}>${xmlText(t)}</${n}>\r\n`; }
  });
  return out + `</${row}>\r\n`;
}

/** Text for HTML content and double-quoted attributes. */
export const htmlText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
