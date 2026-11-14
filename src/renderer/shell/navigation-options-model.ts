// Navigation Options dialog: the pure edits of a draft NavOptions.
import { fold, type CustomCategory, type NavOptions } from '../../shared/nav-view';

/** Ticks or unticks a group of a category (hiddenGroups lists the unticked ones). `all`: the category's group ids; Access refuses to untick the last visible one. */
export function toggleGroup(o: NavOptions, categoryId: string, groupId: string, all: readonly string[]): NavOptions {
  const hidden = o.hiddenGroups[categoryId] ?? [];
  const next = hidden.includes(groupId) ? hidden.filter((g) => g !== groupId)
    : all.every((g) => g === groupId || hidden.includes(g)) ? hidden : [...hidden, groupId];
  if (next === hidden) return o;
  const { [categoryId]: _, ...rest } = o.hiddenGroups;
  return { ...o, hiddenGroups: next.length ? { ...rest, [categoryId]: next } : rest };
}

const BUILTIN = ['type', 'related', 'created', 'modified'];
/** True when `name` (accent/case-insensitive) is already in `names`, except at index `except`. */
export const nameTaken = (names: readonly string[], name: string, except = -1): boolean => names.some((n, i) => i !== except && fold(n) === fold(name.trim()));
// Edits below return the same object when refused (empty or duplicate name, built-in, unknown id).
const withCategory = (o: NavOptions, id: string, f: (c: CustomCategory) => CustomCategory): NavOptions => ({ ...o, categories: o.categories.map((c) => (c.id === id ? f(c) : c)) });

export function addCategory(o: NavOptions, id: string, name: string): NavOptions {
  const n = name.trim();
  if (!n || nameTaken(o.categories.map((c) => c.name), n)) return o;
  return { ...o, categories: [...o.categories, { id, name: n, groups: [] }] };
}
export function renameCategory(o: NavOptions, id: string, name: string): NavOptions {
  const n = name.trim(), i = o.categories.findIndex((c) => c.id === id);
  return !n || i < 0 || nameTaken(o.categories.map((c) => c.name), n, i) ? o : withCategory(o, id, (c) => ({ ...c, name: n }));
}
export function deleteCategory(o: NavOptions, id: string): NavOptions {
  if (BUILTIN.includes(id) || !o.categories.some((c) => c.id === id)) return o;
  const { [id]: _, ...hiddenGroups } = o.hiddenGroups;
  return { ...o, categories: o.categories.filter((c) => c.id !== id), hiddenGroups, category: o.category === id ? 'type' : o.category, filterGroup: o.category === id ? null : o.filterGroup };
}
/** Display order: custom categories move among themselves (the built-ins stay first, in their fixed order). */
export function moveCategory(o: NavOptions, id: string, delta: number): NavOptions {
  const i = o.categories.findIndex((c) => c.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= o.categories.length) return o;
  const categories = [...o.categories];
  [categories[i], categories[j]] = [categories[j], categories[i]];
  return { ...o, categories };
}

export function addGroup(o: NavOptions, catId: string, id: string, name: string): NavOptions {
  const n = name.trim(), c = o.categories.find((x) => x.id === catId);
  if (!n || !c || id === 'unassigned' || nameTaken(c.groups.map((g) => g.name), n)) return o;
  return withCategory(o, catId, (x) => ({ ...x, groups: [...x.groups, { id, name: n, items: [] }] }));
}
export function renameGroup(o: NavOptions, catId: string, id: string, name: string): NavOptions {
  const n = name.trim(), c = o.categories.find((x) => x.id === catId), i = c?.groups.findIndex((g) => g.id === id) ?? -1;
  if (!n || !c || i < 0 || nameTaken(c.groups.map((g) => g.name), n, i)) return o;
  return withCategory(o, catId, (x) => ({ ...x, groups: x.groups.map((g) => (g.id === id ? { ...g, name: n } : g)) }));
}
/** The group's items fall back to "unassigned" (computed, so removing the group is enough). */
export function deleteGroup(o: NavOptions, catId: string, id: string): NavOptions {
  if (!o.categories.find((x) => x.id === catId)?.groups.some((g) => g.id === id)) return o;
  const hidden = (o.hiddenGroups[catId] ?? []).filter((g) => g !== id);
  const { [catId]: _, ...rest } = o.hiddenGroups;
  return { ...withCategory(o, catId, (x) => ({ ...x, groups: x.groups.filter((g) => g.id !== id) })), hiddenGroups: hidden.length ? { ...rest, [catId]: hidden } : rest, filterGroup: o.filterGroup === id ? null : o.filterGroup };
}
