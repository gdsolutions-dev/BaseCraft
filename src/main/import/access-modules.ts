// Access import (E5): the VBA modules of an export folder, and the code of forms and reports, saved as BaseCraft Python modules whose
// every line is a comment. VBA is never converted and never run; a module that cannot be carried gives a line, never an error.
import type { DatabaseSync } from 'node:sqlite';
import type { ExportModule } from '../../shared/access-export';
import type { ReportLine } from '../../shared/access-import';
import { sameName } from '../../shared/field-types';
import { uniqueName } from '../../shared/import-text';
import type { ModuleDef } from '../../shared/python/module-def';
import { isModuleName } from '../../shared/python/module-def';
import { deleteObject, getObject, listObjects, saveObject } from '../db/objects';

type Named = { remote: string; name: string };
export const vbaLines = (vba: string): string[] => vba.replace(/\0/g, '').replace(/\r\n|[\r\n\u2028\u2029\v\f\u0085]/g, '\n').replace(/\n$/, '').split('\n');

/** The VBA as a Python module: a header, then every VBA line as a comment (an empty line gives `#`); line ends are `\n`. */
export const vbaAsPython = (name: string, vba: string): string =>
  [`# VBA module "${name}" imported from Access. Not converted: rewrite it in Python.`, ...vbaLines(vba).map((l) => (l === '' ? '#' : `# ${l}`))].join('\n');

/** A name BaseCraft's modules accept: what `isModuleName` refuses becomes `_`, a leading digit gets a leading `_`, a Python keyword a trailing `_`; then numbered when taken. */
export function pythonModuleName(name: string, taken: string[]): string {
  let n = name.replace(/[^\p{L}\p{N}_]/gu, '_');
  if (!/^[\p{L}_]/u.test(n)) n = `_${n}`;
  if (!isModuleName(n)) n += '_';
  return uniqueName([...n].slice(0, 64).join(''), taken);
}

/** Saves `source` as the module `name`; never throws, false when it cannot be saved or read back (a half-saved module is deleted). */
export function saveCommentedModule(db: DatabaseSync, name: string, source: string): boolean {
  const def: ModuleDef = { formatVersion: '1.0', source, exports: [] };
  try {
    if (saveObject(db, 'module', name, def, null).ok && getObject(db, 'module', name)) return true;
  } catch { /* undone below */ }
  try { deleteObject(db, 'module', name); } catch { /* nothing more to undo */ }
  return false;
}

/** Saves the modules of an Access export in `db` as commented Python. Never throws for a module; never runs one. */
export function importModules(db: DatabaseSync, modules: ExportModule[]): { modules: Named[]; lines: ReportLine[] } {
  const taken = listObjects(db, 'module').map((o) => o.name);
  const seen: string[] = [];
  const out: Named[] = [];
  const report: ReportLine[] = [];
  for (const m of modules) {
    const skip = (reason: string): void => { report.push({ code: 'moduleSkipped', object: m.name, reason }); };
    const duplicate = seen.some((x) => sameName(x, m.name));
    seen.push(m.name);
    if (duplicate) { skip('duplicate'); continue; }
    if (m.text === null) { skip('unreadable'); continue; }
    try {
      const name = pythonModuleName(m.name, taken);
      if (!saveCommentedModule(db, name, vbaAsPython(name, m.text))) { skip('notSaved'); continue; }
      taken.push(name);
      out.push({ remote: m.name, name });
      report.push({ code: 'moduleImported', object: name, ...(name.normalize('NFC') !== m.name.normalize('NFC') ? { part: m.name } : {}), n: vbaLines(m.text).length });
    } catch { skip('notSaved'); }
  }
  return { modules: out, lines: report };
}
