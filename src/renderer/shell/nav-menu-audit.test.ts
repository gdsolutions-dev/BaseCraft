import { describe, expect, it, vi } from 'vitest';
import { allNavItems } from './nav-menu';
import './nav-menu-items';
import '../exchange/exchange-menu';
import '../macro/macro-menu';

// Only the registrations matter: the modules behind the items' actions (bridge, dialogs) are stubbed.
vi.mock('../bridge', () => ({ api: {} }));
vi.mock('./document-views', () => ({ hasDocumentView: () => true, registerDocumentView: () => {} }));
vi.mock('./ObjectProperties', () => ({ showObjectProperties: () => {} }));
vi.mock('../exchange/export', () => ({ exportNamed: () => {} }));
vi.mock('../exchange/paste', () => ({ pasteClip: () => {} }));
vi.mock('../datasheet/glide-keyboard', () => ({ installEditorCommitFix: () => {} })); // design/entry's datasheet hooks `window` (node, no DOM)

describe('A6 audit', () => {
  it('A6 leaves no A6 placeholder in any registered menu, submenus included', () => {
    expect(allNavItems().length).toBeGreaterThan(0);
    expect(allNavItems().filter((i) => i.planned === 'A6').map((i) => i.id)).toEqual([]);
  });
});

describe('B1 audit', () => {
  it('B1 leaves no B1 placeholder in any registered menu, the macro menu included', () => {
    expect(allNavItems().filter((i) => i.planned === 'B1').map((i) => i.id)).toEqual([]);
  });
});

describe('B2 audit', () => {
  it('B2 leaves no B2 placeholder in any registered menu', () => {
    expect(allNavItems().filter((i) => i.planned === 'B2').map((i) => i.id)).toEqual([]);
  });
});

describe('B3 audit', () => {
  it('B3 leaves no B3 placeholder in any registered menu', () => {
    expect(allNavItems().filter((i) => i.planned === 'B3').map((i) => i.id)).toEqual([]);
  });
});

describe('B4 audit', () => {
  it('B4 leaves no B4 placeholder in any registered menu', () => {
    expect(allNavItems().filter((i) => i.planned === 'B4').map((i) => i.id)).toEqual([]);
  });
});

describe('B5 audit', () => {
  it('B5 leaves no B5 placeholder in any registered menu', () => {
    expect(allNavItems().filter((i) => i.planned === 'B5').map((i) => i.id)).toEqual([]);
  });
});

// C1 (PF18): the link items come from nav-menu-links (run code) and design/entry (the manager, design only), imported for real
// so the audit sees design/entry's own registration.
describe('C1 audit', () => {
  it('C1 delivers the linked-table placeholders', async () => {
    await import('../links/nav-menu-links');
    await import('../design/entry');
    const links = allNavItems().filter((i) => ['linkedTableManager', 'refreshLink', 'convertToLocal'].includes(i.id));
    expect(links.map((i) => i.id).sort()).toEqual(['convertToLocal', 'linkedTableManager', 'refreshLink']);
    expect(links.filter((i) => i.planned)).toEqual([]);
  });
});
