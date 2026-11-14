// Navigation Pane options of the base (bc_meta, options.navigation): read tolerantly, saved without losing what BaseCraft does not know.
import type { DatabaseSync } from 'node:sqlite';
import { sameName } from '../../shared/field-types';
import { readNavOptions, type NavKind, type NavOptions } from '../../shared/nav-view';
import { readOptions, updateOptions } from './file-format';

export function navOptions(db: DatabaseSync): NavOptions {
  return readNavOptions(readOptions(db).navigation);
}

/** The other options keys, and the navigation keys of a newer BaseCraft, are kept; an unusable section is replaced. */
export function saveNavOptions(db: DatabaseSync, o: NavOptions): void {
  updateOptions(db, (opts) => {
    const prev = opts.navigation;
    opts.navigation = { ...(prev !== null && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}), ...o };
  });
}

/** Rewrites every refKey of the base's groups, `hidden` and `hiddenIn` (`to` undefined: drops it). Nothing is written when no key matches. */
function mapKeys(db: DatabaseSync, kind: NavKind, name: string, to: string | undefined): void {
  if (readOptions(db).navigation === undefined) return;
  const o = navOptions(db);
  let changed = false;
  const fix = (key: string, prefix = ''): string | undefined => {
    const ref = key.slice(prefix.length);
    if (!ref.startsWith(`${kind}:`) || !sameName(ref.slice(kind.length + 1), name)) return key;
    changed = true;
    return to === undefined ? undefined : `${prefix}${kind}:${to}`;
  };
  const list = (l: string[], prefix: (k: string) => string = () => '') =>
    l.flatMap((k) => { const r = fix(k, prefix(k)); return r === undefined ? [] : [r]; });
  // hiddenIn is `category|group|refKey`; a name may hold '|', so only the first two are separators
  const inPrefix = (k: string) => { const [c = '', g = ''] = k.split('|', 2); return k.startsWith(`${c}|${g}|`) ? `${c}|${g}|` : k; };
  const next: NavOptions = {
    ...o,
    categories: o.categories.map((c) => ({ ...c, groups: c.groups.map((g) => ({ ...g, items: list(g.items) })) })),
    hidden: list(o.hidden), hiddenIn: list(o.hiddenIn, inPrefix),
  };
  if (changed) saveNavOptions(db, next);
}

/** A renamed object (or table): its keys follow, with the same name comparison as the object itself. */
export const navRename = (db: DatabaseSync, kind: NavKind, oldName: string, newName: string): void => mapKeys(db, kind, oldName, newName);
/** A deleted object (or table, or link): its keys go. */
export const navForget = (db: DatabaseSync, kind: NavKind, name: string): void => mapKeys(db, kind, name, undefined);
