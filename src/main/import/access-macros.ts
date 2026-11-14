// Access import (E5): the macros of an export folder, saved as BaseCraft macros with report lines. The import never runs a macro.
// A macro that cannot be imported gives a line, never an error. The names the macros, forms and reports of this import hold are
// renamed to the names this import gave (a taken name is numbered).
import type { DatabaseSync } from 'node:sqlite';
import type { ExportMacro } from '../../shared/access-export';
import type { ReportLine } from '../../shared/access-import';
import { convertAccessMacro, parseAccessMacro, renameMacroRefs, type MacroRefKind } from '../../shared/access-macro';
import { EVENTS, readEvent } from '../../shared/design/events';
import { flattenControls, type DesignDoc } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import { uniqueName } from '../../shared/import-text';
import type { MacroDef } from '../../shared/macro/model';
import { deleteObject, getObject, listObjects, saveObject } from '../db/objects';

type Named = { remote: string; name: string };
const NOTE_LINE = { actionComment: 'macroActionComment', elseLost: 'macroElseLost', conditionKept: 'macroConditionKept', notConverted: 'macroNotConverted',
  argumentDropped: 'macroArgumentDropped' } as const;

/** The report lines of the notes of a conversion (a MacroNote code and its part); the same note twice is one line, counted for a comment. */
export function macroLines(object: string, notes: { code: string; part?: string }[], embedded = false): ReportLine[] {
  const lines = new Map<string, ReportLine>();
  for (const { code, part } of notes) {
    const key = `${code}|${part ?? ''}`;
    const line = lines.get(key);
    if (line) { if (line.n !== undefined) line.n++; }
    else lines.set(key, { code: NOTE_LINE[code as keyof typeof NOTE_LINE], object, ...(part !== undefined ? { part } : {}), ...(code === 'actionComment' ? { n: 1 } : {}), ...(embedded ? { reason: 'embedded' } : {}) });
  }
  return [...lines.values()];
}

/** Saves the macros of an Access export in `db`, then renames what the macros of this import and the forms and reports of this import
 *  hold (`known`: what this import brought, { remote: name in Access, name: name here }). Never throws for an object; never runs one. */
export function importMacros(db: DatabaseSync, macros: ExportMacro[], known: { tables: Named[]; queries: Named[]; forms: Named[]; reports: Named[] }):
  { macros: Named[]; lines: ReportLine[] } {
  const taken = listObjects(db, 'macro').map((o) => o.name);
  const seen: string[] = [];
  const lines: ReportLine[] = [];
  const saved: { remote: string; name: string; def: MacroDef }[] = [];
  for (const m of macros) {
    const skip = (reason: string): void => { lines.push({ code: 'macroSkipped', object: m.name, reason }); };
    const duplicate = seen.some((x) => sameName(x, m.name));
    seen.push(m.name);
    if (duplicate) { skip('duplicate'); continue; }
    if (m.text === null) { skip('unreadable'); continue; }
    let name: string | null = null;
    try {
      const rows = parseAccessMacro(m.text);
      if (!rows) { skip('notRead'); continue; }
      const { def, notes } = convertAccessMacro(rows);
      name = uniqueName(m.name, taken);
      if (!saveObject(db, 'macro', name, def, null).ok) { name = null; skip('nameInvalid'); continue; }
      if (!getObject(db, 'macro', name)) throw new Error('unreadable'); // saved but not readable back (over the size limit)
      taken.push(name);
      saved.push({ remote: m.name, name, def });
      lines.push({ code: 'macroImported', object: name, ...(name.normalize('NFC') !== m.name.normalize('NFC') ? { part: m.name } : {}) }, ...macroLines(name, notes));
    } catch {
      if (name !== null) try { deleteObject(db, 'macro', name); } catch { /* nothing more to undo */ }
      skip('notRead');
    }
  }

  const to: Record<MacroRefKind, Named[]> = { table: known.tables, query: known.queries, form: known.forms, report: known.reports, macro: saved };
  const rename = (kind: MacroRefKind, base: string): string | undefined => { const hit = to[kind].find((x) => sameName(x.remote, base)); return hit && hit.name !== base ? hit.name : undefined; };
  for (const s of saved) try {
    const def = renameMacroRefs(s.def, rename);
    if (JSON.stringify(def) !== JSON.stringify(s.def)) saveObject(db, 'macro', s.name, def, s.name);
  } catch { /* the macro stays as saved */ }
  for (const kind of ['form', 'report'] as const) for (const n of known[`${kind}s`]) try {
    const doc = getObject(db, kind, n.name)?.definition as DesignDoc | undefined;
    if (!doc) continue;
    let changed = false;
    for (const props of [doc.props, ...doc.sections.flatMap((s) => [s.props, ...flattenControls(s.controls).map((c) => c.props)])]) for (const ev of EVENTS) {
      const b = readEvent(props[ev]);
      if (b.kind === 'macro') {
        const [base, ...sub] = b.name.split('.');
        const name = rename('macro', base!);
        if (name !== undefined) { props[ev] = [name, ...sub].join('.'); changed = true; }
      } else if (b.kind === 'embedded') {
        const def = renameMacroRefs(b.def, rename);
        if (JSON.stringify(def) !== JSON.stringify(b.def)) { props[ev] = { embedded: def }; changed = true; }
      }
    }
    if (changed) saveObject(db, kind, n.name, doc, n.name);
  } catch { /* the object stays as saved */ }
  return { macros: saved.map(({ remote, name }) => ({ remote, name })), lines };
}
