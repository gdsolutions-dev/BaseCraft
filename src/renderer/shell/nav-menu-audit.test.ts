import { describe, expect, it, vi } from 'vitest';
import { allNavItems } from './nav-menu';
import './nav-menu-items';
import '../exchange/exchange-menu';

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
