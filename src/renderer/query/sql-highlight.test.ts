import { describe, expect, it } from 'vitest';
import { complete, highlight, wordAt } from './sql-highlight';

describe('SQL view helpers', () => {
  it('colours runs and gives the text back', () => {
    const t = 'SELECT [Nom], "a" FROM Clients WHERE x > 1.5 AND d = #2026-01-01#';
    const runs = highlight(t);
    expect(runs.map((r) => r.text).join('')).toBe(t);
    const kinds = Object.fromEntries(runs.filter((r) => r.kind !== 'text').map((r) => [r.text, r.kind]));
    expect(kinds).toMatchObject({ SELECT: 'kw', '[Nom]': 'id', '"a"': 'str', FROM: 'kw', '1.5': 'num', AND: 'kw', '#2026-01-01#': 'date' });
    expect(kinds.Clients).toBeUndefined();
    expect(highlight('SELECT "ab').map((r) => r.kind)).toEqual(['kw', 'text', 'str']); // half-typed text never throws
  });
  it('finds the word at the caret and completes it', () => {
    expect(wordAt('SELECT * FROM Cl', 16)).toEqual({ start: 14, word: 'Cl' });
    expect(wordAt('SELECT * FROM ', 14)).toBeNull();
    expect(wordAt('SELECT [Ma', 10)).toEqual({ start: 7, word: '[Ma' });
    expect(complete('fr', ['Clients'])).toEqual(['FROM']);
    expect(complete('cl', ['Clients', 'Ma commande'])).toEqual(['Clients']);
    expect(complete('ma', ['Ma commande'])).toEqual(['MAX', '[Ma commande]']);
    expect(complete('[ma', ['Ma commande'])).toEqual(['[Ma commande]']);
  });
});
