import { describe, expect, it } from 'vitest';
import { docTabId, showsKind } from './doc-tab-ids';

describe('document tab ids', () => {
  it('tables keep their name, objects carry their kind, the Relations window has a fixed id', () => {
    expect(docTabId({ kind: 'table', name: 'Clients' })).toBe('Clients');
    expect(docTabId({ kind: 'form', name: 'Clients' })).toBe('form-Clients');
    expect(docTabId({ kind: 'relations', name: 'Relations' })).toBe('window-relations'); // a table may be named "relations"
    expect(docTabId({ kind: 'table', name: 'relations' })).toBe('relations');
  });
  it('the accessible name adds the kind, except for the Relations window (its title already says it)', () => {
    expect(showsKind('form')).toBe(true);
    expect(showsKind('table')).toBe(true);
    expect(showsKind('relations')).toBe(false);
  });
});
