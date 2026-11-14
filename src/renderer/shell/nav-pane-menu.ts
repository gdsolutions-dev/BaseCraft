// Menus du volet de navigation hors objet : l'en-tête (catégorie, filtre par groupe) et le fond (Catégorie, Tri, Afficher par, options).
import type { BuiltinCategory, NavGroup, NavOptions } from '../../shared/nav-view';
import type { NavMenuItem } from './nav-menu';

export interface PaneMenuEnv {
  opts: NavOptions; groups: NavGroup[]; customCategories: { id: string; name: string }[];
  /** Tables and Related Views reads the definitions: absent where the design module is (the Runtime). */
  relatedAvailable: boolean;
  runtime: boolean; canPaste: boolean; set(patch: Partial<NavOptions>): void; showAllGroups(): void; paste(): void; openOptions(): void;
}

const item = (id: string, labelKey: string, extra: Partial<NavMenuItem> = {}): NavMenuItem => ({ id, group: 'open', order: 0, labelKey, ...extra });
const numbered = (l: NavMenuItem[]) => l.map((x, order) => ({ ...x, order }));
const BUILTIN: BuiltinCategory[] = ['related', 'type', 'created', 'modified'];

function categories(e: PaneMenuEnv): NavMenuItem[] {
  const cat = (id: string, label: Partial<NavMenuItem>) =>
    item(`cat-${id}`, '', { ...label, checked: () => e.opts.category === id, run: () => e.set({ category: id, filterGroup: null }) });
  // a custom category is listed under its own name; the default one has none and reads « Personnalisé »
  return [
    ...e.customCategories.map((c) => cat(c.id, c.name === '' ? { labelKey: 'nav.category.custom' } : { labelKey: c.name, literal: true })),
    ...BUILTIN.filter((id) => id !== 'related' || e.relatedAvailable).map((id) => cat(id, { labelKey: `nav.category.${id}` })),
  ];
}

export function headerMenu(e: PaneMenuEnv): NavMenuItem[][] {
  const groupLabel = (g: NavGroup): Partial<NavMenuItem> =>
    typeof g.label === 'string' ? { labelKey: g.label, literal: true } : { labelKey: g.label.key, labelValues: g.label.values };
  return [
    numbered([item('heading-goto', 'nav.pane.goToCategory', { heading: true }), ...categories(e)]),
    numbered([
      item('heading-filter', 'nav.pane.filterByGroup', { heading: true }),
      ...e.groups.map((g) => item(`group-${g.id}`, '', { ...groupLabel(g), checked: () => e.opts.filterGroup === g.id, run: () => e.set({ filterGroup: g.id }) })),
      item('all', 'nav.pane.allObjects', { checked: () => e.opts.filterGroup === null, run: () => e.set({ filterGroup: null }) }),
    ]),
  ];
}

export function backgroundMenu(e: PaneMenuEnv): NavMenuItem[][] {
  const { sort } = e.opts;
  const dir = sort?.dir ?? 'asc';
  const by = (id: 'name' | 'type' | 'created' | 'modified', key: string) =>
    item(`sort-${id}`, key, { checked: () => sort?.by === id, run: () => e.set({ sort: { by: id, dir } }) });
  const dirItem = (d: 'asc' | 'desc', key: string) =>
    item(`sort-${d}`, key, { checked: () => sort?.dir === d, run: () => e.set({ sort: { by: sort?.by ?? 'name', dir: d } }) });
  const view = (id: NavOptions['viewBy'], key: string) => item(`view-${id}`, key, { checked: () => e.opts.viewBy === id, run: () => e.set({ viewBy: id }) });
  const searchBar = item('searchBar', 'nav.pane.searchBar', { toggle: true, checked: () => e.opts.searchBar, run: () => e.set({ searchBar: !e.opts.searchBar }) });
  return [
    numbered([
      item('category', 'nav.pane.category', { submenu: numbered(categories(e)) }),
      item('sort', 'nav.pane.sortBy', {
        submenu: numbered([
          dirItem('asc', 'nav.pane.sortAsc'), dirItem('desc', 'nav.pane.sortDesc'),
          { ...by('name', 'nav.pane.byName'), sepBefore: true }, by('type', 'nav.pane.byType'),
          by('created', 'nav.pane.byCreated'), by('modified', 'nav.pane.byModified'),
          item('sort-none', 'nav.pane.removeSorts', { run: () => e.set({ sort: null }) }),
        ]),
      }),
      item('viewBy', 'nav.pane.viewBy', {
        submenu: numbered([view('details', 'nav.pane.details'), view('icon', 'nav.pane.icon'), view('list', 'nav.pane.list')]),
      }),
      item('showAllGroups', 'nav.pane.showAllGroups', { run: () => e.showAllGroups() }),
    ]),
    ...(e.runtime ? [] : [numbered([item('paste', 'nav.pane.paste', { enabled: () => e.canPaste, run: () => e.paste() })])]),
    numbered([...(e.runtime ? [] : [item('options', 'nav.pane.options', { run: () => e.openOptions() })]), searchBar]),
  ];
}
