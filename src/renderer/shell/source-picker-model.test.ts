import { describe, expect, it } from 'vitest';
import { initialSource, refKey, selectedSource, sourceHint, sourceOptions } from './source-picker-model';

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

  it('Create › Form and Report: the selected table or query, else the source of the selected form or report', () => {
    expect(selectedSource({ kind: 'query', name: 'Q' })).toEqual({ ref: { kind: 'query', name: 'Q' }, name: 'Q' });
    expect(selectedSource({ kind: 'report', name: 'R' }, { recordSource: { kind: 'table', name: 'T' } })).toEqual({ ref: { kind: 'table', name: 'T' }, name: 'T' });
    expect(selectedSource({ kind: 'form', name: 'F' }, { recordSource: { kind: 'sql', sql: 'SELECT 1' } })).toEqual({ ref: { kind: 'sql', sql: 'SELECT 1' }, name: 'F' });
    expect(selectedSource({ kind: 'form', name: 'F' }, { recordSource: null })).toBeNull();   // unbound: the picker asks
    expect(selectedSource({ kind: 'form', name: 'F' }, { recordSource: { kind: 'table' } })).toBeNull();
    expect(selectedSource({ kind: 'macro', name: 'M' })).toBeNull();
    expect(selectedSource(null)).toBeNull();
  });
});
