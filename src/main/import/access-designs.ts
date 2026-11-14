// Access import (E4): the forms and reports of an export folder, saved as BaseCraft forms and reports with report lines.
// The import never runs a form or a report. An object that cannot be imported gives a line, never an error.
import type { DatabaseSync } from 'node:sqlite';
import type { ExportDesign } from '../../shared/access-export';
import type { ReportLine } from '../../shared/access-import';
import { convertAccessDesign, type ConvertedDesign } from '../../shared/access-design';
import { rewriteSql } from '../../shared/autocorrect/sql';
import { flattenControls, validateDesignDoc } from '../../shared/design/model';
import { foldName, isValidObjectName, sameName } from '../../shared/field-types';
import { uniqueName } from '../../shared/import-text';
import { bindQuery, QueryBindError } from '../../shared/query/bind';
import { parseSql } from '../../shared/query/sql-parser';
import type { RecordSourceRef } from '../../shared/record-source';
import { deleteObject, getObject, listObjects, saveObject } from '../db/objects';
import { codeBehindRefusal } from '../db/code-behind';
import { isTableName } from '../db/schema';
import { codeBehindModule } from '../../shared/python/code-behind';
import type { QueryCatalog } from '../../shared/query/bind';
import { macroLines } from './access-macros';
import { renameContext } from './access-queries';
import { saveCommentedModule, vbaAsPython, vbaLines } from './access-modules';

type Kind = 'form' | 'report';
type Named = { remote: string; name: string };
const IMPORTED = { form: 'formImported', report: 'reportImported' } as const;
const NOTE_CODE = { controlReplaced: 'designControlReplaced', eventDropped: 'designEventDropped', expressionKept: 'designExpressionKept',
  sectionDropped: 'designSectionDropped', controlRenamed: 'designControlRenamed', pageDefault: 'designPageDefault', eventProcedure: 'designEventProcedure' } as const;   // macroNote: macroLines

/** Saves the forms and reports of an Access export in `db` and says what became of each. Never throws for an object; never runs one.
 *  `tables`, `queries`: what this import brought ({ remote: name in Access, name: name in BaseCraft }).
 *  `code`: the code of a form or report is saved as the commented Python module `Form_<Name>` / `Report_<Name>`, and its `[Event Procedure]` events stay. */
export function importDesigns(db: DatabaseSync, designs: ExportDesign[], known: { tables: Named[]; queries: Named[] }, catalog?: QueryCatalog, opts?: { code?: boolean }):
  { forms: Named[]; reports: Named[]; lines: ReportLine[] } {
  const taken: Record<Kind, string[]> = { form: listObjects(db, 'form').map((o) => o.name), report: listObjects(db, 'report').map((o) => o.name) };
  const seen: Record<Kind, string[]> = { form: [], report: [] };
  const lines: ReportLine[][] = designs.map(() => []);
  const saved: { i: number; kind: Kind; remote: string; name: string; conv: ConvertedDesign; module?: string; refused?: boolean; tooLong?: boolean }[] = [];
  // 1 and 2: names, then every object saved before any source is resolved (a subform may point at a later form)
  designs.forEach((d, i) => {
    const skip = (reason: string): void => { lines[i] = [{ code: 'designSkipped', object: d.name, reason }]; };
    const duplicate = seen[d.kind].some((x) => sameName(x, d.name));
    seen[d.kind].push(d.name);
    if (duplicate) return skip('duplicate');
    if (d.text === null) return skip('unreadable');
    let name: string | null = null;
    try {
      let conv = convertAccessDesign(d.text, d.kind);
      if (validateDesignDoc(conv.doc).length) return skip('notRead');
      name = uniqueName(d.name, taken[d.kind]).normalize('NFC');
      let module: string | undefined;
      let refused = false;
      let tooLong = false;
      if (opts?.code && conv.code !== null) { // the module of the code: refused when another form or report, or another module, has that name
        const m = codeBehindModule(d.kind, name);
        tooLong = [...m].length > 64;
        refused = tooLong || codeBehindRefusal(db, d.kind, name) !== null || listObjects(db, 'module').some((x) => sameName(x.name, m));
        if (!refused) { module = m; conv = convertAccessDesign(d.text, d.kind, { keepProcedures: true }); }
      }
      if (!saveObject(db, d.kind, name, conv.doc, null).ok) { name = null; return skip('nameInvalid'); }
      if (!getObject(db, d.kind, name)) throw new Error('unreadable'); // saved but not readable back (over the size limit)
      taken[d.kind].push(name);
      saved.push({ i, kind: d.kind, remote: d.name, name, conv, ...(module !== undefined ? { module } : {}), ...(refused ? { refused } : {}), ...(tooLong ? { tooLong } : {}) });
    } catch {
      if (name !== null) try { deleteObject(db, d.kind, name); } catch { /* nothing more to undo */ }
      skip('notRead');
    }
  });

  // 3 to 5: what the sources of each object mean here
  const { changes, renames, old, lenient } = renameContext(db, known.tables, known.queries, catalog);
  const access: typeof lenient = { // the objects of this import, by their Access names
    table: (n) => (known.tables.some((t) => sameName(t.remote, n)) ? old.table(n) : null),
    query: (n) => (known.queries.some((q) => sameName(q.remote, n)) ? old.query(n) : null),
  };
  /** A source as Access wrote it: `ref` and `out` (the text as it stands here), `missing`: sources this import did not bring; `bad`: not understood. */
  const resolve = (text: string): { ref: RecordSourceRef | null; out: string; missing: string[]; bad: boolean } => {
    const t = text.trim();
    if (!t) return { ref: null, out: text, missing: [], bad: false };
    const table = known.tables.find((x) => sameName(x.remote, t));
    if (table) return { ref: { kind: 'table', name: table.name }, out: table.name, missing: [], bad: false };
    const query = known.queries.find((x) => sameName(x.remote, t));
    if (query) return { ref: { kind: 'query', name: query.name }, out: query.name, missing: [], bad: false };
    let parsed;
    try { parsed = parseSql(t); } catch { /* a name, or text BaseCraft's SQL does not read */ }
    if (parsed && !['insert', 'update', 'delete'].includes(parsed.body.k)) { // an action query gives no records
      let sql = t;
      try { sql = (changes.length ? rewriteSql(t, lenient, renames) : null) ?? t; } catch { /* kept as written */ }
      let missing: string[] = [];
      try { bindQuery(parsed, access); } catch (e) { if (e instanceof QueryBindError && e.code === 'unknownSource') missing = [e.detail]; }
      return { ref: { kind: 'sql', sql: sql.trim() }, out: sql, missing, bad: false };
    }
    // a name: one name BaseCraft could hold (one pair of brackets removed). A table or query of the target of that name is that name, whatever
    // its words; otherwise (ponytail: heuristic) text with an SQL word in it is not a name
    const bare = /^\[[^\]]*\]$/.test(t) ? t.slice(1, -1) : t;
    if (!isValidObjectName(bare)) return { ref: null, out: text, missing: [], bad: true };
    const here = getObject(db, 'query', bare) ? 'query' : isTableName(db, bare) ? 'table' : null;
    if (!here && /\b(SELECT|TRANSFORM|PARAMETERS|DELETE|UPDATE|INSERT|FROM|WHERE|UNION)\b/i.test(bare)) return { ref: null, out: text, missing: [], bad: true };
    return { ref: { kind: here ?? 'table', name: bare }, out: text, missing: [bare], bad: false };
  };
  const missingLine = (object: string, part: string): ReportLine => ({ code: 'designSourceMissing', object, part });
  const failed = new Set<number>(); // objects skipped in the second pass
  const nameHere = (kind: Kind, remote: string) => saved.find((s) => !failed.has(s.i) && s.kind === kind && sameName(s.remote, remote))?.name;

  for (const { i, kind, remote, name, conv, module, refused, tooLong } of saved) try {
    const { doc } = conv;
    const object = name;
    const out: ReportLine[] = [{ code: IMPORTED[kind], object, ...(name.normalize('NFC') !== remote.normalize('NFC') ? { part: remote } : {}) }];
    for (const n of conv.notes) if (n.code !== 'macroNote') out.push({ code: NOTE_CODE[n.code], object, ...(n.part !== undefined ? { part: n.part } : {}), ...(n.reason !== undefined ? { reason: n.reason } : {}) });
    out.push(...macroLines(object, conv.notes.flatMap((n) => (n.code === 'macroNote' ? [{ code: n.reason!, part: n.part }] : [])), true));
    const reported = new Set<string>();
    const missing = (part: string) => { if (!reported.has(foldName(part))) { reported.add(foldName(part)); out.push(missingLine(object, part)); } };
    const rs = resolve(conv.recordSource);
    doc.recordSource = rs.ref;
    if (rs.bad) out.push({ code: 'designSourceMissing', object });
    rs.missing.forEach(missing);
    for (const c of doc.sections.flatMap((s) => flattenControls(s.controls))) {
      const p = c.props;
      if ((c.kind === 'comboBox' || c.kind === 'listBox') && typeof p.RowSource === 'string' && (p.RowSourceType === undefined || p.RowSourceType === 'tableQuery')) {
        const r = resolve(p.RowSource);
        p.RowSource = r.out;
        r.missing.forEach(missing);
      } else if (c.kind === 'subform' && typeof p.SourceObject === 'string' && p.SourceObject.trim()) {
        const text = p.SourceObject;
        const m = /^(Form|Report|Table|Query)\.(.*)$/i.exec(text.trim());
        const prefix = m?.[1]!.toLowerCase();
        if (prefix === 'table' || prefix === 'query') { p.SourceObject = ''; out.push({ code: 'designSubformTable', object, part: text }); continue; }
        const here = prefix === undefined || prefix === kind ? nameHere(kind, m ? m[2]! : text.trim()) : undefined;
        p.SourceObject = here ?? '';
        if (here === undefined) missing(text);
      }
    }
    if (conv.ignored.size) {
      const sorted = [...conv.ignored].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      out.push({ code: 'designPropertiesIgnored', object, n: sorted.reduce((s, e) => s + e[1], 0), part: sorted.map(([k, n]) => `${k} (${n})`).join(', ') });
    }
    if (!saveObject(db, kind, name, doc, name).ok || !getObject(db, kind, name)) throw new Error('not saved');
    if (refused) out.push({ code: 'codeBehindSkipped', object, reason: tooLong ? 'nameTooLong' : 'nameTaken' });
    if (module !== undefined) {
      out.push(saveCommentedModule(db, module, vbaAsPython(module, conv.code!)) ? { code: 'codeBehindImported', object, part: module, n: vbaLines(conv.code!).length }
        : { code: 'codeBehindSkipped', object, reason: 'notSaved' });
    }
    lines[i] = out;
  } catch {
    failed.add(i);
    try { deleteObject(db, kind, name); } catch { /* nothing more to undo */ }
    lines[i] = [{ code: 'designSkipped', object: remote, reason: 'notRead' }];
  }
  const list = (kind: Kind) => saved.filter((s) => s.kind === kind && !failed.has(s.i)).flatMap((s) => {
    try { const o = getObject(db, kind, s.name); return o ? [{ name: o.name, remote: s.remote }] : []; } catch { return []; }
  });
  return { forms: list('form'), reports: list('report'), lines: lines.flat() };
}
