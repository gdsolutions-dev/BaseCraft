import { describe, expect, it, vi } from 'vitest';
import { allNavItems } from './nav-menu';
import './nav-menu-items';
import '../exchange/exchange-menu';
import '../macro/macro-menu';

// Only the registrations matter: the modules behind the items' actions (bridge, dialogs) are stubbed.
vi.mock('../bridge', () => ({ api: {} }));
vi.mock('./document-views', () => ({ hasDocumentView: () => true }));
vi.mock('./ObjectProperties', () => ({ showObjectProperties: () => {} }));
vi.mock('../exchange/export', () => ({ exportNamed: () => {} }));
vi.mock('../exchange/paste', () => ({ pasteClip: () => {} }));

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
