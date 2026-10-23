import { describe, expect, it } from 'vitest';
import { pasteError, type PasteNames } from './paste';
import type { ObjectClip } from './object-clipboard';

const names: PasteNames = { tables: ['Clients'], queries: ['Ventes'], forms: ['Saisie'], reports: [] };
const clipT: ObjectClip = { kind: 'table', name: 'Clients', cut: false };

describe('pasteError', () => {
  it('table/query namespace is shared', () => expect(pasteError(clipT, 'ventes', 'data', names)).toBe('nav.paste.exists'));
  it('forms and reports have their own namespace', () => {
    expect(pasteError({ kind: 'form', name: 'Saisie', cut: false }, 'clients', 'data', names)).toBeNull();
    expect(pasteError({ kind: 'form', name: 'Saisie', cut: false }, 'SAISIE', 'data', names)).toBe('nav.paste.exists');
  });
  it('append needs an existing other table', () => {
    expect(pasteError(clipT, 'Nouveau', 'append', names)).toBe('nav.paste.appendTarget');
    expect(pasteError(clipT, 'Clients', 'append', names)).toBe('nav.paste.appendTarget');
    expect(pasteError(clipT, 'Ventes', 'append', names)).toBe('nav.paste.appendTarget'); // a query is not a table
    expect(pasteError(clipT, 'Autre', 'append', { ...names, tables: ['Clients', 'Autre'] })).toBeNull();
  });
  it('cut to its own name is allowed', () => expect(pasteError({ ...clipT, cut: true }, 'Clients', 'data', names)).toBeNull());
  it('cut under a taken name is refused', () => expect(pasteError({ ...clipT, cut: true }, 'Ventes', 'data', names)).toBe('nav.paste.exists'));
  it('empty, invalid and too long names', () => {
    expect(pasteError(clipT, '  ', 'data', names)).toBe('designError.nameEmpty');
    expect(pasteError(clipT, 'a.b', 'data', names)).toBe('designError.nameInvalid');
    expect(pasteError(clipT, '😀'.repeat(65), 'data', names)).toBe('designError.nameTooLong');
    expect(pasteError(clipT, '😀'.repeat(64), 'data', names)).toBeNull();
  });
});
