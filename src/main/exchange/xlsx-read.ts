// Minimal .xlsx reader on jszip: the typed value of every cell of a sheet (no styles beyond « is it a date »).
// A shared string, an inline string, a number, a boolean, an error, a date (by number format) ; a formula gives its cached result.
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';

export type XValue = string | number | boolean | Date | { error: string };
/** A sheet's rows that have at least one cell with a value; `cells` is sparse (index = column - 1). */
export interface XRow { line: number; cells: XValue[] }
export interface XSheet { name: string; rows(): Promise<XRow[]> }

const attr = (s: string, name: string) => new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`).exec(s)?.slice(1).find((x) => x !== undefined);
const unesc = (s: string) => s
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => e[0] === '#'
    ? String.fromCodePoint(e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]!)
  .replace(/_x([0-9a-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
const texts = (x: string) => [...x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)].map((m) => unesc(m[1] ?? '')).join('');
const each = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g'))].map((m) => ({ a: m[1]!, body: m[2] ?? '' }));
const colIndex = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFormat = (code: string) => /[dmyhs]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ''));

/** Excel serial -> UTC date (the clock as written, no time-zone shift), to the second. */
function serialDate(n: number, date1904: boolean): Date {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : n < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30); // the 1900 leap-year bug
  return new Date(epoch + Math.round(n * 86400) * 1000);
}

export async function openXlsx(path: string): Promise<XSheet[]> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const read = async (name: string) => (await zip.file(name)?.async('string')) ?? '';
  const wb = await read('xl/workbook.xml');
  if (!wb) throw new Error('not a workbook');
  const date1904 = /<workbookPr\b[^>]*date1904=["'](1|true)["']/.test(wb);
  const rels = new Map(each(await read('xl/_rels/workbook.xml.rels'), 'Relationship').map((r) => [attr(r.a, 'Id'), attr(r.a, 'Target') ?? ''] as const));
  const shared = each(await read('xl/sharedStrings.xml'), 'si').map((s) => texts(s.body));
  const styles = await read('xl/styles.xml');
  const codes = new Map(each(styles, 'numFmt').map((n) => [Number(attr(n.a, 'numFmtId')), unesc(attr(n.a, 'formatCode') ?? '')]));
  const cellXfs = each(each(styles, 'cellXfs')[0]?.body ?? '', 'xf').map((x) => Number(attr(x.a, 'numFmtId') ?? 0));
  const dateStyle = cellXfs.map((id) => BUILTIN_DATES.has(id) || (codes.has(id) && isDateFormat(codes.get(id)!)));

  return each(wb, 'sheet').map(({ a }) => {
    const target = rels.get(attr(a, 'r:id')) ?? '';
    const file = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    let memo: Promise<XRow[]> | undefined;
    return { name: unesc(attr(a, 'name') ?? ''), rows: () => (memo ??= parse(file)) };
  });

  async function parse(file: string): Promise<XRow[]> {
    const xml = await read(file);
    const merged = new Set<string>(); // cells inside a merged range other than its top-left: no value
    for (const m of each(xml, 'mergeCell')) {
      const [from, to] = (attr(m.a, 'ref') ?? '').split(':');
      if (!to) continue;
      const [c1, r1, c2, r2] = [colIndex(from!), parseInt(from!.replace(/\D/g, '')), colIndex(to), parseInt(to.replace(/\D/g, ''))];
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) merged.add(`${c}:${r}`);
    }
    const rows: XRow[] = [];
    let line = 0;
    for (const row of each(xml, 'row')) {
      line = Number(attr(row.a, 'r') ?? line + 1);
      const cells: XValue[] = [];
      let col = 0;
      for (const c of each(row.body, 'c')) {
        const ref = attr(c.a, 'r');
        col = ref ? colIndex(ref) : col + 1;
        const t = attr(c.a, 't') ?? 'n';
        const v = /<v\b[^>]*?>([\s\S]*?)<\/v>/.exec(c.body)?.[1];
        let value: XValue | undefined;
        if (t === 'inlineStr') value = texts(c.body);
        else if (v === undefined) continue; // a styled empty cell, a formula never calculated
        else if (t === 's') value = shared[Number(v)] ?? '';
        else if (t === 'str') value = unesc(v);
        else if (t === 'b') value = v.trim() === '1';
        else if (t === 'e') value = { error: unesc(v) };
        else if (t === 'd') value = new Date(unesc(v).replace(/(\d)$/, '$1Z'));
        else {
          const n = Number(v);
          value = dateStyle[Number(attr(c.a, 's') ?? 0)] && Number.isFinite(n) ? serialDate(n, date1904) : n;
        }
        cells[col - 1] = merged.has(`${col}:${line}`) ? '' : value;
      }
      if (cells.some((x) => x !== undefined)) rows.push({ line, cells });
    }
    return rows;
  }
}
