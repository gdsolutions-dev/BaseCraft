// Per-item edits of the pane's groups (Add to group, Hide / Unhide in this Group, Delete in a custom group, Hidden attribute):
// each returns the NavOptions patch to apply (or null when there is nothing to do), so the menu items stay thin.
import { refKey, type NavOptions } from '../../shared/nav-view';

export interface NavCtx { opts: NavOptions; category: string; group: string; set(patch: Partial<NavOptions>): void }
const BUILTIN = ['type', 'related', 'created', 'modified'];
type Ref = { kind: string; name: string };

const hiddenKey = (n: NavCtx, x: Ref) => `${n.category}|${n.group}|${refKey(x)}`;
export const customOf = (n: NavCtx) => (BUILTIN.includes(n.category) ? undefined : n.opts.categories.find((c) => c.id === n.category));
/** The group the item is listed in, when it is a real group of a custom category (not "unassigned"). */
const groupOf = (n: NavCtx) => customOf(n)?.groups.find((g) => g.id === n.group);

export const isHiddenHere = (n: NavCtx, x: Ref) => n.opts.hiddenIn.includes(hiddenKey(n, x));
/** The custom groups an item can be added to: the current category's, minus those that already hold it. */
export const addTargets = (n: NavCtx, x: Ref) => (customOf(n)?.groups ?? []).filter((g) => !g.items.includes(refKey(x)));
export const inCustomGroup = (n: NavCtx, x: Ref) => !!groupOf(n)?.items.includes(refKey(x));

export const hideInGroup = (n: NavCtx, x: Ref): Partial<NavOptions> | null =>
  isHiddenHere(n, x) ? null : { hiddenIn: [...n.opts.hiddenIn, hiddenKey(n, x)] };
export const unhideInGroup = (n: NavCtx, x: Ref): Partial<NavOptions> | null =>
  isHiddenHere(n, x) ? { hiddenIn: n.opts.hiddenIn.filter((k) => k !== hiddenKey(n, x)) } : null;

const editGroup = (n: NavCtx, groupId: string, f: (items: string[]) => string[]): Partial<NavOptions> => ({
  categories: n.opts.categories.map((c) => (c.id !== n.category ? c : { ...c, groups: c.groups.map((g) => (g.id === groupId ? { ...g, items: f(g.items) } : g)) })),
});
export const addToGroup = (n: NavCtx, x: Ref, groupId: string): Partial<NavOptions> | null =>
  addTargets(n, x).some((g) => g.id === groupId) ? editGroup(n, groupId, (i) => [...i, refKey(x)]) : null;
/** Delete on a shortcut: the item leaves this group only, the object stays. */
export const removeFromGroup = (n: NavCtx, x: Ref): Partial<NavOptions> | null =>
  inCustomGroup(n, x) ? editGroup(n, n.group, (i) => i.filter((k) => k !== refKey(x))) : null;

/** The Hidden attribute (hidden in every category). */
export const setHidden = (opts: NavOptions, x: Ref, on: boolean): Partial<NavOptions> => ({
  hidden: [...opts.hidden.filter((k) => k !== refKey(x)), ...(on ? [refKey(x)] : [])],
});
