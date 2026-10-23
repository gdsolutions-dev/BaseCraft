import { describe, expect, it } from 'vitest';
import { initialSource, refKey, sourceHint, sourceOptions } from './source-picker-model';

const options = sourceOptions(['Clients', 'Été'], ['Commandes du mois']);

describe('source picker model', () => {
  it('lists tables, then queries', () => {
    expect(options).toEqual([
      { kind: 'table', name: 'Clients' }, { kind: 'table', name: 'Été' }, { kind: 'query', name: 'Commandes du mois' },
    ]);
    expect(refKey(options[2]!)).toBe('query:Commandes du mois');
  });

  it('preselects the given source (kind and sameName), else the hint, else the first; -1 when there is nothing', () => {
    expect(initialSource(options, { kind: 'query', name: 'COMMANDES DU MOIS' }, null)).toBe(2);
    expect(initialSource(options, undefined, { kind: 'table', name: 'été' })).toBe(1);
    expect(initialSource(options, { kind: 'table', name: 'Absente' }, { kind: 'table', name: 'Été' })).toBe(1);
    expect(initialSource(options, { kind: 'query', name: 'Clients' }, null)).toBe(0); // a query named like a table does not exist
    expect(initialSource(options, null, { kind: 'table', name: 'Été' })).toBe(0); // null: no preselection asked
    expect(initialSource(options, { kind: 'sql', sql: 'SELECT 1' }, null)).toBe(0);
    expect(initialSource([], undefined, null)).toBe(-1);
  });

  it('hint: the active table or query document, else the navigation pane selection', () => {
    expect(sourceHint({ kind: 'query', name: 'Q', isNew: false }, { kind: 'table', name: 'T' })).toEqual({ kind: 'query', name: 'Q' });
    expect(sourceHint({ kind: 'form', name: 'F' }, { kind: 'table', name: 'T' })).toEqual({ kind: 'table', name: 'T' });
    expect(sourceHint({ kind: 'table', name: 'Table1', isNew: true }, { kind: 'report', name: 'R' })).toBeNull();
    expect(sourceHint(null, null)).toBeNull();
  });
});
