// B6b: the code-behind module (`Form_<Name>` / `Report_<Name>`) belongs to its form or report: it is renamed, copied and deleted
// with it, in the same transaction. Two names mapping to one module name (`A B`, `A_B`) are refused (moduleNameClash).
import type { DatabaseSync } from 'node:sqlite';
import type { ObjectKind, OpResult } from '../../shared/api';
import { sameName } from '../../shared/field-types';
import { codeBehindModule } from '../../shared/python/code-behind';
import { copyObject, deleteObject, listObjects, renameObject } from './objects';

export type CodeKind = 'form' | 'report';
export const hasCodeBehind = (kind: ObjectKind): kind is CodeKind => kind === 'form' || kind === 'report';

const clash: OpResult = { ok: false, reason: 'moduleNameClash' };
const moduleOf = (db: DatabaseSync, kind: CodeKind, name: string): string | undefined => {
  const m = codeBehindModule(kind, name);
  return listObjects(db, 'module').find((x) => sameName(x.name, m))?.name;
};

/** Refusal for a form or report `name` (new, renamed, copied) whose module name another form or report already has (`self`: the one
 *  renamed, left out) or, when the module of `from` moves or is copied there, that another existing module already takes. */
export function codeBehindRefusal(db: DatabaseSync, kind: CodeKind, name: string, self?: string, from?: string): OpResult | null {
  const m = codeBehindModule(kind, name);
  if (listObjects(db, kind).some((o) => !sameName(o.name, name) && !(self !== undefined && sameName(o.name, self)) && sameName(codeBehindModule(kind, o.name), m))) return clash;
  if (from !== undefined) {
    const src = moduleOf(db, kind, from);
    const there = moduleOf(db, kind, name);
    if (src !== undefined && there !== undefined && !sameName(src, there)) return clash;
  }
  return null;
}

/** After a form or report rename: its module follows (nothing when it has none). */
export function renameCodeBehind(db: DatabaseSync, kind: CodeKind, from: string, to: string): void {
  const src = moduleOf(db, kind, from);
  const dst = codeBehindModule(kind, to.normalize('NFC'));
  if (src !== undefined && src !== dst) renameObject(db, 'module', src, dst);
}
/** After a copy: the module is copied under the new name. */
export function copyCodeBehind(db: DatabaseSync, kind: CodeKind, from: string, to: string): void {
  const src = moduleOf(db, kind, from);
  if (src !== undefined) copyObject(db, 'module', src, codeBehindModule(kind, to.normalize('NFC')));
}
/** After a delete. */
export function deleteCodeBehind(db: DatabaseSync, kind: CodeKind, name: string): void {
  const src = moduleOf(db, kind, name);
  if (src !== undefined) deleteObject(db, 'module', src);
}
