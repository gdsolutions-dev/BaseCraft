// Menu contextuel du volet de navigation (règle C6) : registre par type d'objet. Le socle inscrit les éléments génériques
// (nav-menu-items.ts) ; chaque lot inscrit les siens dans son propre module, par un seul appel, sans modifier ce fichier.
import type { LucideIcon } from 'lucide-react';
import type { AppAction, DocKind } from '../state/app-state';
import type { ModalApi } from './Modal';
import type { PlannedIn } from './ribbon-model';

/** Access's order: open, transfer (Import / Export), object (Rename, Hide, Delete), clipboard, print, link, properties. */
export type NavMenuGroup = 'open' | 'transfer' | 'object' | 'clipboard' | 'print' | 'link' | 'properties';
export const NAV_MENU_GROUPS: readonly NavMenuGroup[] = ['open', 'transfer', 'object', 'clipboard', 'print', 'link', 'properties'];
/** The shell's dispatch: a change of mode or an open that the document's mode guard decides answers whether it happened. */
export type AppDispatch = (a: AppAction) => void | Promise<boolean>;

/** `reselect`: the pane's selection follows a renamed object (its new name) or a deleted one (null). */
export interface NavMenuContext {
  kind: DocKind; name: string; readOnly: boolean; runtime: boolean; modal: ModalApi; dispatch: AppDispatch;
  reselect(name: string | null): void;
}

/**
 * labelKey: an i18n label whose `&` marks the access key. enabled false: disabled for a temporary
 * reason (read-only base…). planned: like a ribbon placeholder (ruling C11), shown disabled but focusable, its tooltip naming
 * the batch or stage that delivers it; the batch delivering it replaces the placeholder (same id) by its real item.
 */
export interface NavMenuItem {
  id: string; group: NavMenuGroup; order: number; labelKey: string; icon?: LucideIcon;
  visible?(c: NavMenuContext): boolean; enabled?(c: NavMenuContext): boolean; run?(c: NavMenuContext): void | Promise<void>;
  submenu?: NavMenuItem[]; planned?: PlannedIn;
}

interface Batch { items: NavMenuItem[]; fallback: boolean }
const registry = new Map<DocKind, Batch[]>();

/** Adds `items` to `kind`'s menu; returns the unregistration. A later item with the id of an earlier one replaces it
 *  (a batch delivering a placeholder); when both have a submenu, their children merge the same way, by id.
 *  `fallback: true` (the foundation's generic items) makes the registration lose to any non-fallback one with the same id,
 *  whatever the registration order. A replacing item wins as a whole: when it overrides a parent item (one with a submenu),
 *  it must repeat group, order, labelKey, visible and enabled (only the children merge). */
export function registerNavMenuItems(kind: DocKind, items: NavMenuItem[], options: { fallback?: boolean } = {}): () => void {
  const own: Batch = { items: [...items], fallback: options.fallback === true };
  registry.set(kind, [...(registry.get(kind) ?? []), own]);
  return () => registry.set(kind, (registry.get(kind) ?? []).filter((x) => x !== own));
}

/** Fallbacks first (stable), so that the later-wins merge lets every non-fallback win. */
const ordered = (kind: DocKind): NavMenuItem[] => {
  const all = registry.get(kind) ?? [];
  return [...all.filter((b) => b.fallback), ...all.filter((b) => !b.fallback)].flatMap((b) => b.items);
};

/** `c.kind`'s menu: its non-empty groups in Access order (a separator between two), items by `order`, hidden ones left out. */
export function navMenuGroups(c: NavMenuContext): NavMenuItem[][] {
  const items = merged(ordered(c.kind)).filter((x) => !x.visible || x.visible(c));
  return NAV_MENU_GROUPS.map((g) => items.filter((x) => x.group === g)).filter((g) => g.length > 0);
}

/** Later items win by id; two submenus of one id merge their children likewise. Sorted by `order`. */
function merged(list: NavMenuItem[]): NavMenuItem[] {
  const byId = new Map<string, NavMenuItem>();
  for (const x of list) {
    const prev = byId.get(x.id);
    byId.set(x.id, prev?.submenu && x.submenu ? { ...x, submenu: merged([...prev.submenu, ...x.submenu]) } : x);
  }
  return [...byId.values()].sort((a, b) => a.order - b.order);
}

/** Runs item `id` of the menu of `c` as a click would (Ctrl+X/C/V on the pane): only when it is shown and enabled. */
export function runNavItem(c: NavMenuContext, id: string): boolean {
  const x = merged(ordered(c.kind)).find((i) => i.id === id);
  if (!x?.run || (x.visible && !x.visible(c)) || !navItemEnabled(x, c)) return false;
  void x.run(c);
  return true;
}

/** The pane tells the shell how to run Cut / Copy / Paste on its selected item (Home › Clipboard while the pane has the focus). */
let clipboardRunner: ((id: 'cut' | 'copy' | 'paste') => boolean) | null = null;
export function setNavClipboardRunner(fn: typeof clipboardRunner): () => void {
  clipboardRunner = fn;
  return () => { if (clipboardRunner === fn) clipboardRunner = null; };
}
export const runNavClipboard = (id: 'cut' | 'copy' | 'paste'): boolean => clipboardRunner?.(id) ?? false;

export const navItemEnabled = (x: NavMenuItem, c: NavMenuContext): boolean => !x.planned && (!x.enabled || x.enabled(c));

/** A label split around its access key (the letter after `&`); key '' when it has none. */
export function accessKey(label: string): { before: string; key: string; after: string } {
  const i = label.indexOf('&');
  if (i < 0 || i === label.length - 1) return { before: label.replace('&', ''), key: '', after: '' };
  return { before: label.slice(0, i), key: label[i + 1]!, after: label.slice(i + 2) };
}

/** Same folding as the pane's search: "É" answers "e". */
export const foldKey = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('und');

interface Rect { left: number; right: number; top: number; bottom: number }
const MARGIN = 4;
/** Top-left of a menu: right of `anchor` (a point for the menu, its item for a submenu) and on its top, flipped to its left or
 *  onto its bottom when it would spill out of `view`, then kept inside it. */
export function placeMenu(anchor: Rect, size: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number } {
  const axis = (start: number, end: number, len: number, room: number) => {
    const p = start + len > room - MARGIN ? end - len : start;
    return Math.max(MARGIN, Math.min(p, room - len - MARGIN));
  };
  return { left: axis(anchor.right, anchor.left, size.width, view.width), top: axis(anchor.top, anchor.bottom, size.height, view.height) };
}
