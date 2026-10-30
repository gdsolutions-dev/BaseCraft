import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accessKey, navItemEnabled, navMenuGroups, placeMenu, registerNavMenuItems, type NavMenuContext, type NavMenuItem } from './nav-menu';

// The macro menu is assembled from the real registrations (foundation, A6, B1); the modules behind the items' actions are stubbed.
const stub = vi.hoisted(() => ({ hasView: vi.fn(() => false), runMacroByName: vi.fn(async () => {}) }));
vi.mock('../bridge', () => ({ api: {} }));
vi.mock('./document-views', () => ({ hasDocumentView: stub.hasView }));
vi.mock('./ObjectProperties', () => ({ showObjectProperties: () => {} }));
vi.mock('../exchange/export', () => ({ exportNamed: () => {} }));
vi.mock('../exchange/paste', () => ({ pasteClip: () => {} }));
vi.mock('../macro/macro-shell', () => ({ runMacroByName: stub.runMacroByName }));

const ctx = (over: Partial<NavMenuContext> = {}): NavMenuContext => ({
  kind: 'form', name: 'F', readOnly: false, runtime: false, modal: {} as NavMenuContext['modal'], dispatch: () => {}, reselect: () => {}, ...over,
});
const ids = (c: NavMenuContext) => navMenuGroups(c).map((g) => g.map((x) => x.id));

describe('nav-menu registry (C6)', () => {
  it('groups in Access order, items by order, hidden left out, empty groups dropped; unregister; same id replaces', () => {
    const item = (id: string, group: NavMenuItem['group'], order: number, extra: Partial<NavMenuItem> = {}): NavMenuItem =>
      ({ id, group, order, labelKey: id, ...extra });
    const offA = registerNavMenuItems('form', [
      item('props', 'properties', 10), item('delete', 'object', 30), item('rename', 'object', 10),
      item('design', 'open', 20, { visible: (c) => !c.runtime }), item('cut', 'clipboard', 10, { planned: 'A6' }),
    ]);
    const offB = registerNavMenuItems('form', [item('open', 'open', 10)]);
    expect(ids(ctx())).toEqual([['open', 'design'], ['rename', 'delete'], ['cut'], ['props']]);
    expect(ids(ctx({ runtime: true }))).toEqual([['open'], ['rename', 'delete'], ['cut'], ['props']]);
    expect(ids(ctx({ kind: 'report' }))).toEqual([]);
    // a batch delivering the placeholder: same id, its real item
    const offC = registerNavMenuItems('form', [item('cut', 'clipboard', 10, { run: () => {} })]);
    const cut = navMenuGroups(ctx()).flat().filter((x) => x.id === 'cut');
    expect(cut).toHaveLength(1);
    expect(cut[0]!.planned).toBeUndefined();
    offC();
    offB();
    expect(ids(ctx())).toEqual([['design'], ['rename', 'delete'], ['cut'], ['props']]);
    expect(navItemEnabled(navMenuGroups(ctx()).flat().find((x) => x.id === 'cut')!, ctx())).toBe(false);
    offA();
    expect(ids(ctx())).toEqual([]);
  });

  it('a batch overrides the generic Open of the foundation by its id; unregistering it restores the generic one', () => {
    const generic: NavMenuItem = { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.open', enabled: () => false };
    const offGeneric = registerNavMenuItems('query', [generic, { id: 'design', group: 'open', order: 20, labelKey: 'nav.menu.design' }]);
    const a3: NavMenuItem = { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.open', run: () => {} };
    const offA3 = registerNavMenuItems('query', [a3, { id: 'sql', group: 'open', order: 30, labelKey: 'nav.menu.sql' }]);
    const c = ctx({ kind: 'query' });
    expect(navMenuGroups(c)).toEqual([[a3, expect.objectContaining({ id: 'design' }), expect.objectContaining({ id: 'sql' })]]);
    offA3();
    expect(navMenuGroups(c)).toEqual([[generic, expect.objectContaining({ id: 'design' })]]);
    offGeneric();
    expect(navMenuGroups(c)).toEqual([]);
  });

  it('a submenu child is overridden by its id (A6 activates Import › Excel); unregistering restores the placeholder', () => {
    const text: NavMenuItem = { id: 'text', group: 'transfer', order: 10, labelKey: 't', run: () => {} };
    const excel: NavMenuItem = { id: 'excel', group: 'transfer', order: 20, labelKey: 'e', planned: 'A6' };
    const offBase = registerNavMenuItems('table', [{ id: 'import', group: 'transfer', order: 10, labelKey: 'i', submenu: [text, excel] }]);
    const liveExcel: NavMenuItem = { id: 'excel', group: 'transfer', order: 20, labelKey: 'e', run: () => {} };
    const xml: NavMenuItem = { id: 'xml', group: 'transfer', order: 15, labelKey: 'x', run: () => {} };
    const offA6 = registerNavMenuItems('table', [{ id: 'import', group: 'transfer', order: 10, labelKey: 'i', submenu: [liveExcel, xml] }]);
    const sub = () => navMenuGroups(ctx({ kind: 'table' }))[0]![0]!.submenu!;
    expect(sub()).toEqual([text, xml, liveExcel]); // by order
    offA6();
    expect(sub()).toEqual([text, excel]);
    offBase();
  });

  it('a fallback registration loses to a non-fallback one of the same id whatever the registration order (item and submenu child)', () => {
    const live: NavMenuItem = { id: 'open', group: 'open', order: 10, labelKey: 'live', run: () => {} };
    const offLive = registerNavMenuItems('report', [live]);
    const offGeneric = registerNavMenuItems('report', [{ id: 'open', group: 'open', order: 10, labelKey: 'generic' }], { fallback: true });
    expect(navMenuGroups(ctx({ kind: 'report' }))).toEqual([[live]]);
    offLive();
    expect(navMenuGroups(ctx({ kind: 'report' }))).toEqual([[expect.objectContaining({ labelKey: 'generic' })]]);
    offGeneric();

    const excel: NavMenuItem = { id: 'excel', group: 'transfer', order: 20, labelKey: 'e', planned: 'A6' };
    const liveExcel: NavMenuItem = { id: 'excel', group: 'transfer', order: 20, labelKey: 'e', run: () => {} };
    const parent = { id: 'import', group: 'transfer', order: 10, labelKey: 'i' } as const;
    const offA6 = registerNavMenuItems('report', [{ ...parent, submenu: [liveExcel] }]);
    const offBase = registerNavMenuItems('report', [{ ...parent, submenu: [excel, { id: 'text', group: 'transfer', order: 10, labelKey: 't' }] }], { fallback: true });
    expect(navMenuGroups(ctx({ kind: 'report' }))[0]![0]!.submenu).toEqual([expect.objectContaining({ id: 'text' }), liveExcel]);
    offA6(); offBase();
  });

  it('enabled: a placeholder never, otherwise its rule', () => {
    const x: NavMenuItem = { id: 'r', group: 'object', order: 1, labelKey: 'r', enabled: (c) => !c.readOnly };
    expect(navItemEnabled(x, ctx())).toBe(true);
    expect(navItemEnabled(x, ctx({ readOnly: true }))).toBe(false);
    expect(navItemEnabled({ ...x, enabled: undefined }, ctx({ readOnly: true }))).toBe(true);
    expect(navItemEnabled({ ...x, planned: 'later' }, ctx())).toBe(false);
  });

  it('access keys: the letter after &', () => {
    expect(accessKey('&Ouvrir')).toEqual({ before: '', key: 'O', after: 'uvrir' });
    expect(accessKey('Mo&de création')).toEqual({ before: 'Mo', key: 'd', after: 'e création' });
    expect(accessKey('Copier…')).toEqual({ before: 'Copier…', key: '', after: '' });
  });

  it('placement: beside its anchor, flipped up or left when it would spill, always inside the window', () => {
    const at = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y });
    expect(placeMenu(at(100, 100), { width: 200, height: 300 }, { width: 1000, height: 700 })).toEqual({ left: 100, top: 100 });
    expect(placeMenu(at(900, 650), { width: 200, height: 300 }, { width: 1000, height: 700 })).toEqual({ left: 700, top: 350 }); // flipped both ways
    expect(placeMenu(at(50, 200), { width: 200, height: 500 }, { width: 1000, height: 400 })).toEqual({ left: 50, top: 4 }); // taller than room: clamped
    // a submenu beside its item: right of it, else left of it; aligned on its top, else on its bottom
    const item = { left: 600, right: 800, top: 500, bottom: 528 };
    expect(placeMenu(item, { width: 150, height: 60 }, { width: 1000, height: 700 })).toEqual({ left: 800, top: 500 });
    expect(placeMenu(item, { width: 250, height: 260 }, { width: 1000, height: 700 })).toEqual({ left: 350, top: 268 });
  });
});

describe('macro menu (B1)', () => {
  // a fresh registry holding only what the app registers for macros
  const load = async () => {
    vi.resetModules();
    const nav = await import('./nav-menu');
    await import('./nav-menu-items');
    await import('../exchange/exchange-menu');
    await import('../macro/macro-menu');
    return nav;
  };
  beforeEach(() => { stub.hasView.mockReturnValue(false); stub.runMacroByName.mockClear(); });

  it("Run, Design View | Export | Rename, Hide, Delete | Cut, Copy, Paste | Object Properties; Export and Hide are planned for later", async () => {
    const { navMenuGroups } = await load();
    const groups = navMenuGroups(ctx({ kind: 'macro', name: 'MBip' }));
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([['open', 'design'], ['export'], ['rename', 'hide', 'delete'], ['cut', 'copy', 'paste'], ['properties']]);
    expect(groups.flat().filter((x) => x.planned).map((x) => [x.id, x.planned])).toEqual([['export', 'later'], ['hide', 'later']]);
    expect(groups.flat().map((x) => x.labelKey)).toEqual(['nav.menu.run', 'nav.menu.design', 'nav.menu.export', 'nav.menu.rename', 'nav.menu.hide', 'nav.menu.delete',
      'nav.menu.cut', 'nav.menu.copy', 'nav.menu.paste', 'nav.menu.objectProperties']);
  });

  it('at runtime Design View, Rename, Delete, Cut and Paste are hidden', async () => {
    const { navMenuGroups } = await load();
    expect(navMenuGroups(ctx({ kind: 'macro', runtime: true })).map((g) => g.map((x) => x.id))).toEqual([['open'], ['export'], ['hide'], ['copy'], ['properties']]);
  });

  it('Run runs the macro by its name; Design View is enabled once a Design view is registered, and opens the macro in it', async () => {
    const { navMenuGroups, navItemEnabled } = await load();
    const dispatch = vi.fn();
    const c = ctx({ kind: 'macro', name: 'MBip', dispatch });
    const [run, design] = navMenuGroups(c)[0]!;
    expect(navItemEnabled(run!, c)).toBe(true);
    void run!.run!(c);
    expect(stub.runMacroByName).toHaveBeenCalledWith('MBip');
    expect(navItemEnabled(design!, c)).toBe(false);
    stub.hasView.mockReturnValue(true);
    expect(navItemEnabled(design!, c)).toBe(true);
    expect(stub.hasView).toHaveBeenLastCalledWith('macro', 'design');
    void design!.run!(c);
    expect(dispatch).toHaveBeenCalledWith({ type: 'open', kind: 'macro', name: 'MBip', mode: 'design' });
  });

  it('Rename, Delete, Cut and Paste need a writable base; Copy does not', async () => {
    const { navMenuGroups, navItemEnabled } = await load();
    stub.hasView.mockReturnValue(true); // Design View is not what is under test
    const c = ctx({ kind: 'macro', readOnly: true });
    expect(navMenuGroups(c).flat().filter((x) => x.run && !navItemEnabled(x, c)).map((x) => x.id)).toEqual(['rename', 'delete', 'cut', 'paste']);
  });
});

describe('linked table menu (C1)', () => {
  const load = async () => {
    vi.resetModules();
    const nav = await import('./nav-menu');
    await import('./nav-menu-items');
    await import('../exchange/exchange-menu');
    await import('../links/nav-menu-links');
    return nav;
  };
  const link = { kind: 'basecraft', path: 'C:/data/Ventes-donnees.basecraft' };

  it('a link: Design View (read-only, C1 R8), no Rename, Import or clipboard; Refresh Link and Convert to Local Table in the link group', async () => {
    const { navMenuGroups } = await load();
    expect(navMenuGroups(ctx({ kind: 'table', link })).map((g) => g.map((x) => x.id)))
      .toEqual([['open', 'design'], ['export'], ['hide', 'delete'], ['refreshLink', 'convertToLocal'], ['properties']]);
  });

  // design/entry registers this item (it pulls in the designers and Glide, which need a DOM: the item itself is registered here)
  it('with the designers, the Linked Table Manager leads the link group; never at runtime, never on a local table', async () => {
    const { navMenuGroups, registerNavMenuItems: register } = await load();
    register('table', [(await import('../links/LinkedTableManager')).linkedTableManagerItem]);
    expect(navMenuGroups(ctx({ kind: 'table', link })).map((g) => g.map((x) => x.id)))
      .toEqual([['open', 'design'], ['export'], ['hide', 'delete'], ['linkedTableManager', 'refreshLink', 'convertToLocal'], ['properties']]);
    expect(navMenuGroups(ctx({ kind: 'table', link, runtime: true })).map((g) => g.map((x) => x.id)))
      .toEqual([['open'], ['export'], ['hide'], ['refreshLink'], ['properties']]);
    expect(navMenuGroups(ctx({ kind: 'table' })).flat().map((x) => x.id)).not.toContain('linkedTableManager');
  });

  it('a local table has no link items', async () => {
    const { navMenuGroups } = await load();
    const all = navMenuGroups(ctx({ kind: 'table' })).flat().map((x) => x.id);
    expect(all).not.toContain('refreshLink');
    expect(all).not.toContain('convertToLocal');
    expect(all).toContain('design');
  });

  it('at runtime a link keeps Open, Export, Refresh Link and Properties (Hide stays a placeholder)', async () => {
    const { navMenuGroups } = await load();
    expect(navMenuGroups(ctx({ kind: 'table', link, runtime: true })).map((g) => g.map((x) => x.id)))
      .toEqual([['open'], ['export'], ['hide'], ['refreshLink'], ['properties']]);
  });

  it('Convert to Local Table needs a writable base; Refresh Link does not', async () => {
    const { navMenuGroups, navItemEnabled } = await load();
    const c = ctx({ kind: 'table', link, readOnly: true });
    const items = navMenuGroups(c).flat();
    expect(navItemEnabled(items.find((x) => x.id === 'convertToLocal')!, c)).toBe(false);
    expect(navItemEnabled(items.find((x) => x.id === 'refreshLink')!, c)).toBe(true);
  });
});
