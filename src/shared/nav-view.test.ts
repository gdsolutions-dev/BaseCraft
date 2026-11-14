import { describe, expect, it } from 'vitest';
import { DEFAULT_NAV_OPTIONS, groupObjects, readNavOptions, refKey, weekStartOf, type NavObject, type NavOptions } from './nav-view';

const opts = (o: Partial<NavOptions>): NavOptions => ({ ...DEFAULT_NAV_OPTIONS, ...o });
const env = { now: new Date(2026, 10, 13, 12), weekStart: 1 };
const ids = (g: { id: string }[]) => g.map((x) => x.id);

describe('readNavOptions', () => {
  it('defaults and per-key fallback', () => {
    expect(readNavOptions(undefined)).toEqual(DEFAULT_NAV_OPTIONS);
    expect(readNavOptions({ viewBy: 'tiles', sort: { by: 'x' }, searchBar: 'yes', extra: 1 })).toEqual(DEFAULT_NAV_OPTIONS);
    expect(readNavOptions({ viewBy: 'icon', searchBar: false, sort: null }))
      .toMatchObject({ viewBy: 'icon', searchBar: false, sort: null });
  });
  it('keeps unknown category and group strings', () => {
    expect(readNavOptions({ category: 'custom:gone', filterGroup: 'tables' })).toMatchObject({ category: 'custom:gone', filterGroup: 'tables' });
  });
  it('keeps filterGroup null', () => {
    expect(readNavOptions({ filterGroup: null }).filterGroup).toBeNull();
  });
  it('wrong-typed hiddenGroups, categories, hidden, hiddenIn read as defaults', () => {
    expect(readNavOptions({ hiddenGroups: { type: 'macro' } }).hiddenGroups).toEqual(DEFAULT_NAV_OPTIONS.hiddenGroups);
    expect(readNavOptions({ hiddenGroups: { type: [1] } }).hiddenGroups).toEqual(DEFAULT_NAV_OPTIONS.hiddenGroups);
    expect(readNavOptions({ categories: 'x' }).categories).toEqual(DEFAULT_NAV_OPTIONS.categories);
    expect(readNavOptions({ categories: [{ id: 'c' }] }).categories).toEqual(DEFAULT_NAV_OPTIONS.categories);
    expect(readNavOptions({ hidden: 'a' }).hidden).toEqual(DEFAULT_NAV_OPTIONS.hidden);
    expect(readNavOptions({ hiddenIn: 3 }).hiddenIn).toEqual(DEFAULT_NAV_OPTIONS.hiddenIn);
  });
});

describe('weekStartOf', () => {
  it('Sunday, Saturday or Monday by region', () => {
    for (const r of ['en-US', 'en-CA', 'ja-JP', 'ja', 'ko-KR', 'zh-TW', 'pt-BR', 'he-IL']) expect(weekStartOf(r)).toBe(0);
    for (const r of ['ar-SA', 'fa-IR']) expect(weekStartOf(r)).toBe(6);
    for (const r of ['fr-FR', 'en-GB', 'pt-PT', 'zh-CN', 'de-DE', 'english', '']) expect(weekStartOf(r)).toBe(1);
  });
});

describe('groupObjects', () => {
  const objs: NavObject[] = [
    { kind: 'query', name: 'Zed' }, { kind: 'table', name: 'Élan' }, { kind: 'table', name: 'Eagle' }, { kind: 'macro', name: 'm' },
  ];
  it('type groups in order, empties kept', () => {
    expect(ids(groupObjects(objs, opts({}), env))).toEqual(['table', 'query', 'form', 'report', 'macro', 'module']);
  });
  it('filterGroup and fallback', () => {
    expect(ids(groupObjects(objs, opts({ filterGroup: 'query' }), env))).toEqual(['query']);
    expect(groupObjects(objs, opts({ filterGroup: 'nope' }), env)).toHaveLength(6);
  });
  it('hiddenGroups never hide every group of the category', () => {
    const all = ['table', 'query', 'form', 'report', 'macro', 'module'];
    expect(ids(groupObjects(objs, opts({ hiddenGroups: { type: all } }), env))).toEqual(all);
  });
  it('hiddenGroups', () => {
    expect(ids(groupObjects(objs, opts({ hiddenGroups: { type: ['macro'] } }), env))).not.toContain('macro');
  });
  it('sort with folding, null keeps order', () => {
    const t = (o: Partial<NavOptions>) => groupObjects(objs, opts(o), env)[0].items.map((i) => i.name);
    expect(t({ sort: { by: 'name', dir: 'asc' } })).toEqual(['Eagle', 'Élan']);
    expect(t({ sort: { by: 'name', dir: 'desc' } })).toEqual(['Élan', 'Eagle']);
    expect(t({ sort: null })).toEqual(['Élan', 'Eagle']);
  });
  it('date groups', () => {
    const dates = ['2026-11-13', '2026-11-12', '2026-11-04', '2026-10-29', '2026-10-22', '2026-10-01', undefined];
    const o = dates.map((d, i) => ({ kind: 'table' as const, name: `t${i}`, created: d && `${d}T08:00:00` }));
    const g = groupObjects(o, opts({ category: 'created' }), env);
    expect(ids(g)).toEqual(['today', 'yesterday', 'lastWeek', 'twoWeeksAgo', 'threeWeeksAgo', 'lastMonth', 'older']);
    expect(g[0].label).toEqual({ key: 'nav.group.today' });
  });
  it('earlier days of this week group as Last Week', () => {
    // env.now is Friday 2026-11-13, weekStart Monday: 2026-11-10 is earlier this week, not yesterday
    const g = groupObjects([{ kind: 'table', name: 'mon', created: '2026-11-10T08:00:00' }], opts({ category: 'created' }), env);
    expect(ids(g)).toEqual(['lastWeek']);
  });
  it('type sort inside date group', () => {
    const o: NavObject[] = [{ kind: 'query', name: 'a', modified: '2026-11-13T01:00:00' }, { kind: 'table', name: 'b', modified: '2026-11-13T01:00:00' }];
    const g = groupObjects(o, opts({ category: 'modified', sort: { by: 'type', dir: 'asc' } }), env);
    expect(g[0].items.map((i) => i.name)).toEqual(['b', 'a']);
  });
  it('related while the list is not available groups by type, never empty', () => {
    const o: NavObject[] = [{ kind: 'table', name: 'T' }, { kind: 'macro', name: 'm' }];
    const g = groupObjects(o, opts({ category: 'related' }), env);
    expect(ids(g)).toEqual(['table', 'query', 'form', 'report', 'macro', 'module']);
    expect(g.flatMap((x) => x.items).length).toBe(2);
  });
  it('related returns env.related then filters', () => {
    const related = [{ id: 'r1', label: 'R1', items: [{ kind: 'table' as const, name: 'z' }, { kind: 'table' as const, name: 'a' }] }, { id: 'r2', label: 'R2', items: [] }];
    const g = groupObjects([], opts({ category: 'related', sort: { by: 'name', dir: 'asc' }, filterGroup: 'r1' }), { ...env, related });
    expect(ids(g)).toEqual(['r1']);
    expect(g[0].items.map((i) => i.name)).toEqual(['a', 'z']);
  });
  it('refKey', () => expect(refKey({ kind: 'table', name: 'x' })).toBe('table:x'));
});

describe('custom categories', () => {
  const a: NavObject = { kind: 'table', name: 'A' }, b: NavObject = { kind: 'form', name: 'B' }, c: NavObject = { kind: 'query', name: 'C' };
  const cat = { id: 'k', name: 'Mine', groups: [{ id: 'g1', name: 'One', items: ['table:A', 'form:B'] }, { id: 'g2', name: '', items: ['form:B'] }] };
  const o = (x: Partial<NavOptions> = {}) => opts({ category: 'k', categories: [cat], sort: null, ...x });
  it('read drops invalid and duplicate categories, default when none', () => {
    expect(readNavOptions({ categories: [] }).categories).toEqual(DEFAULT_NAV_OPTIONS.categories);
    expect(DEFAULT_NAV_OPTIONS.categories).toEqual([{ id: 'custom', name: '', groups: [{ id: 'custom1', name: '', items: [] }] }]);
    const ok = { id: 'x', name: 'X', groups: [] };
    expect(readNavOptions({ categories: [{ id: '', name: 'n', groups: [] }, ok, { ...ok, name: 'dup' }] }).categories).toEqual([ok]);
  });
  it('groups in order, then unassigned', () => {
    const g = groupObjects([a, b, c], o(), env);
    expect(ids(g)).toEqual(['g1', 'g2', 'unassigned']);
    expect(g[0].label).toBe('One');
    expect(g[1].label).toEqual({ key: 'nav.group.g2' });
    expect(g[2].label).toEqual({ key: 'nav.group.unassigned' });
    expect(g.map((x) => x.items.map((i) => i.name))).toEqual([['A', 'B'], ['B'], ['C']]);
  });
  it('hidden and hiddenIn, shown and marked with showHidden', () => {
    const h = o({ hidden: ['query:C'], hiddenIn: ['k|g1|form:B'] });
    expect(groupObjects([a, b, c], h, env).map((x) => x.items.map((i) => i.name))).toEqual([['A'], ['B'], []]);
    const s = groupObjects([a, b, c], { ...h, showHidden: true }, env);
    expect(s[0].items[1]).toMatchObject({ name: 'B', hidden: true });
    expect(s[1].items[0].hidden).toBeUndefined();
    expect(s[2].items[0]).toMatchObject({ name: 'C', hidden: true });
  });
});
