import { describe, expect, it } from 'vitest';
import { autoIndexed, withAutoIndex } from './auto-index';
import type { ImportField } from './import-text';

describe('auto-index', () => {
  it('begins or ends with an entry, case-insensitive, accents significant', () => {
    const L = 'N°;clé;code;num';
    for (const n of ['N°Client', 'CodePostal', 'NUM', 'Numéro', 'ClientCode', 'CLÉ', 'clé']) expect(autoIndexed(n, L), n).toBe(true);
    for (const n of ['Annuaire', 'cle', 'Ville', '']) expect(autoIndexed(n, L), n).toBe(false);
    expect(autoIndexed('ClientID', ' ID ;;')).toBe(true); expect(autoIndexed('id', 'ID')).toBe(true);
    expect(autoIndexed('ID', '')).toBe(false); expect(autoIndexed('ID', ';;')).toBe(false);
  });
  it('withAutoIndex leaves set values alone', () => {
    const f = (name: string, indexed: ImportField['indexed']): ImportField => ({ name, type: 'shortText', indexed, skip: false });
    expect(withAutoIndex([f('CodeClient', 'no'), f('CodeX', 'yesNoDuplicates'), f('Ville', 'no')], 'code').map((x) => x.indexed))
      .toEqual(['yesDuplicates', 'yesNoDuplicates', 'no']);
  });
});
