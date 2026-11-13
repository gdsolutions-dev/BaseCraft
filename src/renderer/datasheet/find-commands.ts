// Home › Find: Find opens « Rechercher et remplacer » (Ctrl+F, O2 R10); Go To and Select are menus under their buttons.
import type { AppSettings } from '../../shared/api';
import type { FindOptions } from '../form/form-instances';
import type { CommandHandlers } from '../shell/ribbon-model';

export type GoTo = 'first' | 'previous' | 'next' | 'last' | 'new';
export type SelectWhat = 'record' | 'all';

/** The row Go To lands on (`current`: the selected row, null without one; `count`: saved records), or 'new' for the new record. */
export function goToRow(where: GoTo, current: number | null, count: number): number | 'new' | null {
  if (where === 'new') return 'new';
  if (count === 0) return null;
  const at = current ?? 0;
  return where === 'first' ? 0 : where === 'last' ? count - 1 : where === 'next' ? Math.min(count - 1, at + 1) : Math.max(0, at - 1);
}

export function findCommands(env: { openFind(tab: 'find' | 'replace'): void; openMenu(menu: 'goTo' | 'select'): void }): CommandHandlers {
  return { find: () => env.openFind('find'), replace: () => env.openFind('replace'), goTo: () => env.openMenu('goTo'), selectMenu: () => env.openMenu('select') };
}

/** « Rechercher/Remplacer par défaut » (R10): where the dialog's Look In and Match start. */
export function findDefaults(d: AppSettings['findReplaceDefault']): { onlyCurrentField: boolean; match: FindOptions['match'] } {
  return d === 'general' ? { onlyCurrentField: false, match: 'anywhere' } : { onlyCurrentField: true, match: d === 'startOfField' ? 'start' : 'whole' };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Replace (Access's): the matched text of `text` becomes `replaceWith`. Whole Field: the whole text; Start of Field: the text's
 *  start; Any Part of Field: the first occurrence, or every one when `all`. The caller has checked that `text` matches. */
export function replaceText(text: string, o: { what: string; match: FindOptions['match']; matchCase: boolean }, replaceWith: string, all: boolean): string {
  if (o.match === 'whole') return replaceWith;
  const re = new RegExp(o.match === 'start' ? '^' + escapeRe(o.what) : escapeRe(o.what), (o.matchCase ? '' : 'i') + (all && o.match === 'anywhere' ? 'g' : ''));
  return text.replace(re, () => replaceWith);
}

/** Find's comparison (the dialog and FindRecord, B2 R13): without Match Case, case ignored, accents kept (Access); the region's
 *  no-break spaces (« 1 200,00 € ») read as the space typed. */
export function matchText(text: string, what: string, match: FindOptions['match'], matchCase: boolean, locale: string): boolean {
  const norm = (x: string) => {
    const s = x.replace(/[\u00a0\u202f]/g, ' ');
    return matchCase ? s : s.toLocaleLowerCase(locale);
  };
  const a = norm(text), b = norm(what);
  return match === 'whole' ? a === b : match === 'start' ? a.startsWith(b) : a.includes(b);
}
