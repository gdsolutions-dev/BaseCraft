// Navigation Pane view options (category, filter, sort, view) and object grouping. Pure: shared by main and renderer.

/** Same folding as bc_fold (accents and case ignored). */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('und');

export type NavKind = 'table' | 'query' | 'form' | 'report' | 'macro' | 'module';
export interface NavObject { kind: NavKind; name: string; description?: string | null; created?: string; modified?: string; link?: unknown; hidden?: boolean }
export type BuiltinCategory = 'type' | 'related' | 'created' | 'modified';
export interface CustomCategory { id: string; name: string; groups: { id: string; name: string; items: string[] }[] }
type SortBy = 'name' | 'type' | 'created' | 'modified';
export interface NavOptions {
  category: BuiltinCategory | string;
  filterGroup: string | null;
  sort: { by: SortBy; dir: 'asc' | 'desc' } | null;
  viewBy: 'details' | 'icon' | 'list';
  searchBar: boolean; singleClick: boolean; showHidden: boolean;
  hiddenGroups: Record<string, string[]>;
  categories: CustomCategory[]; hidden: string[]; hiddenIn: string[];
}
export const DEFAULT_NAV_OPTIONS: NavOptions = {
  category: 'type', filterGroup: null, sort: { by: 'type', dir: 'asc' }, viewBy: 'list',
  searchBar: true, singleClick: false, showHidden: false, hiddenGroups: {},
  categories: [{ id: 'custom', name: '', groups: [{ id: 'custom1', name: '', items: [] }] }], hidden: [], hiddenIn: [],
};

/** First day of the week (0 Sunday, 6 Saturday, 1 Monday) for a region tag like en-US. */
export function weekStartOf(region: string): number {
  if (/^(en-US|en-CA|ja|ko|zh-TW|pt-BR|he)(-|$)/i.test(region)) return 0;
  return /^(ar|fa)(-|$)/i.test(region) ? 6 : 1;
}

export const refKey = (x: { kind: string; name: string }) => `${x.kind}:${x.name}`;

const BUILTIN = ['type', 'related', 'created', 'modified'];
const KINDS: NavKind[] = ['table', 'query', 'form', 'report', 'macro', 'module'];
const KIND_LABEL: Record<NavKind, string> = {
  table: 'nav.tables', query: 'nav.queries', form: 'nav.forms', report: 'nav.reports', macro: 'nav.macros', module: 'nav.modules',
};
const DATE_GROUPS = ['today', 'yesterday', 'lastWeek', 'twoWeeksAgo', 'threeWeeksAgo', 'lastMonth', 'older'] as const;

const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCategory = (c: unknown): c is CustomCategory =>
  isObj(c) && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.groups) &&
  c.groups.every((g) => isObj(g) && typeof g.id === 'string' && typeof g.name === 'string' && isStrArray(g.items));

/** Valid categories (no id or name: dropped; duplicate id: the first kept); null when none is left. */
function readCategories(v: unknown): CustomCategory[] | null {
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  const out = v.filter((c): c is CustomCategory => isCategory(c) && c.id !== '' && !seen.has(c.id) && !!seen.add(c.id));
  return out.length ? out : null;
}

/** Untrusted input (stored JSON): each key is validated alone, anything wrong falls back to its default. Never throws. */
export function readNavOptions(raw: unknown): NavOptions {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_NAV_OPTIONS;
  const bool = (k: 'searchBar' | 'singleClick' | 'showHidden') => (typeof r[k] === 'boolean' ? (r[k] as boolean) : d[k]);
  const s = r.sort;
  const sort: NavOptions['sort'] = s === null ? null
    : isObj(s) && ['name', 'type', 'created', 'modified'].includes(s.by as string) && (s.dir === 'asc' || s.dir === 'desc')
      ? { by: s.by as SortBy, dir: s.dir } : d.sort;
  const hg = r.hiddenGroups;
  return {
    category: typeof r.category === 'string' && r.category ? r.category : d.category,
    filterGroup: r.filterGroup === null ? null : typeof r.filterGroup === 'string' ? r.filterGroup : d.filterGroup,
    sort,
    viewBy: r.viewBy === 'details' || r.viewBy === 'icon' || r.viewBy === 'list' ? r.viewBy : d.viewBy,
    searchBar: bool('searchBar'), singleClick: bool('singleClick'), showHidden: bool('showHidden'),
    hiddenGroups: isObj(hg) && Object.values(hg).every(isStrArray) ? (hg as Record<string, string[]>) : d.hiddenGroups,
    categories: readCategories(r.categories) ?? d.categories,
    hidden: isStrArray(r.hidden) ? r.hidden : d.hidden,
    hiddenIn: isStrArray(r.hiddenIn) ? r.hiddenIn : d.hiddenIn,
  };
}

export interface NavGroup { id: string; label: string | { key: string; values?: Record<string, string> }; items: NavObject[] }

/** Dates come as ISO or SQLite text; a bare date is local, like the other forms. */
function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function dateBucket(d: Date | null, now: Date, weekStart: number): (typeof DATE_GROUPS)[number] {
  if (!d) return 'older';
  const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n).getTime();
  const sow = -((now.getDay() - weekStart + 7) % 7); // start of this week, in days from today
  const t = d.getTime();
  if (t >= day(0)) return 'today';
  if (t >= day(-1)) return 'yesterday';
  if (t >= day(sow - 7)) return 'lastWeek'; // earlier this week also lands here
  if (t >= day(sow - 14)) return 'twoWeeksAgo';
  if (t >= day(sow - 21)) return 'threeWeeksAgo';
  return t >= new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime() ? 'lastMonth' : 'older';
}

function sortItems(items: NavObject[], sort: NavOptions['sort']): NavObject[] {
  if (!sort) return items;
  const by = (a: NavObject, b: NavObject) => {
    if (sort.by === 'created' || sort.by === 'modified') return (parseDate(a[sort.by])?.getTime() ?? 0) - (parseDate(b[sort.by])?.getTime() ?? 0);
    if (sort.by === 'type') { const k = KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind); if (k) return k; }
    return fold(a.name).localeCompare(fold(b.name));
  };
  const s = sort.dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => s * by(a, b));
}

export function groupObjects(
  objs: NavObject[], o: NavOptions, env: { now: Date; weekStart: number; related?: NavGroup[] },
): NavGroup[] {
  let groups: NavGroup[];
  const custom = BUILTIN.includes(o.category) ? undefined : o.categories.find((c) => c.id === o.category);
  if (o.category === 'related' && env.related) groups = env.related;
  else if (o.category === 'created' || o.category === 'modified') {
    const field = o.category;
    const by = new Map<string, NavObject[]>(DATE_GROUPS.map((g) => [g, []]));
    for (const x of objs) by.get(dateBucket(parseDate(x[field]), env.now, env.weekStart))!.push(x);
    groups = DATE_GROUPS.map((g) => ({ id: g, label: { key: `nav.group.${g}` }, items: by.get(g)! })).filter((g) => g.items.length);
  } else if (custom) {
    const used = new Set(custom.groups.flatMap((g) => g.items));
    groups = [
      ...custom.groups.map((g) => ({
        id: g.id, label: g.name === '' ? { key: `nav.group.${g.id}` } : g.name, items: objs.filter((x) => g.items.includes(refKey(x))),
      })),
      { id: 'unassigned', label: { key: 'nav.group.unassigned' }, items: objs.filter((x) => !used.has(refKey(x))) },
    ];
  } else {
    groups = KINDS.map((k) => ({ id: k, label: { key: KIND_LABEL[k] }, items: objs.filter((x) => x.kind === k) }));
  }
  // Hidden objects (everywhere, or in one group): left out, or kept and marked when showHidden.
  groups = groups.map((g) => ({
    ...g,
    items: g.items.flatMap((x) => {
      const k = refKey(x);
      const h = o.hidden.includes(k) || o.hiddenIn.includes(`${o.category}|${g.id}|${k}`);
      return !h ? [x] : o.showHidden ? [{ ...x, hidden: true }] : [];
    }),
  }));
  const hidden = o.hiddenGroups[o.category] ?? [];
  if (!groups.every((g) => hidden.includes(g.id))) groups = groups.filter((g) => !hidden.includes(g.id)); // a hand-edited file never hides every object
  if (o.filterGroup && groups.some((g) => g.id === o.filterGroup)) groups = groups.filter((g) => g.id === o.filterGroup);
  return groups.map((g) => ({ ...g, items: sortItems(g.items, o.sort) }));
}
