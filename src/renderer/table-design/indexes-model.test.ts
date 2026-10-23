import { describe, expect, it } from 'vitest';
import { f, t } from '../../shared/test-fixtures';
import type { TableDesign } from '../../shared/field-types';
import { applyIndexRows, indexRows, indexRowsError, type IndexRow } from './indexes-model';

const d: TableDesign = {
  ...t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Prénom', 'shortText'), f('Ville', 'shortText'), f('Email', 'shortText', { indexed: 'yesNoDuplicates' })]),
  indexes: [{ name: 'NomVille', fields: [{ name: 'Nom', desc: false }, { name: 'Ville', desc: true }], unique: false }],
};
const field = (x: TableDesign, n: string) => x.fields.find((fd) => fd.name === n)!;
const row = (name: string, fields: string[], extra: Partial<IndexRow> = {}): IndexRow =>
  ({ name, fields: fields.map((n) => ({ name: n, desc: false })), primary: false, unique: false, ...extra });
const fields = d.fields.map((x) => x.name);

describe('indexes model', () => {
  it('rows: PrimaryKey first, then the indexed fields, then the multi-field indexes', () => {
    expect(indexRows(d).map((r) => [r.name, r.primary, r.unique])).toEqual([
      ['PrimaryKey', true, true], ['N°', false, true], ['Email', false, true], ['NomVille', false, false]]);
  });

  it('round trip of rows', () => expect(indexRows(applyIndexRows(d, indexRows(d)))).toEqual(indexRows(d)));
  it('unknown keys of an IndexDef and of its fields go through the dialog', () => {
    const ix = { name: 'NV', fields: [{ name: 'Nom', desc: false, poids: 2 }, { name: 'Ville', desc: true }], unique: false, futur: 1 };
    const x = { ...d, indexes: [ix] };
    expect(applyIndexRows(x, indexRows(x)).indexes).toEqual([ix]);
  });

  it('single-field row maps to Indexed', () => {
    const out = applyIndexRows(d, [...indexRows(d), row('Ville', ['Ville'])]);
    expect(field(out, 'Ville').props.indexed).toBe('yesDuplicates');
    expect(out.indexes).toEqual(d.indexes);
  });

  it('multi-field becomes IndexDef; a removed row unindexes its field; primary moves', () => {
    const rows = indexRows(d).filter((r) => r.name !== 'Email' && r.name !== 'NomVille' && !r.primary);
    const out = applyIndexRows(d, [...rows, row('PK', ['Nom', 'Prénom'], { primary: true }), row('NomPrénom', ['Nom', 'Prénom'], { unique: true })]);
    expect(out.indexes).toEqual([{ name: 'NomPrénom', fields: [{ name: 'Nom', desc: false }, { name: 'Prénom', desc: false }], unique: true }]);
    expect(field(out, 'Email').props.indexed).toBe('no');
    expect(out.fields.filter((x) => x.props.primaryKey).map((x) => x.name)).toEqual(['Nom', 'Prénom']);
  });

  it('a descending single-field index keeps its order as an IndexDef', () => {
    const out = applyIndexRows(d, [row('Ville', [], { fields: [{ name: 'Ville', desc: true }] })]);
    expect(field(out, 'Ville').props.indexed).toBe('no');
    expect(out.indexes).toEqual([{ name: 'Ville', fields: [{ name: 'Ville', desc: true }], unique: false }]);
  });

  it('errors', () => {
    expect(indexRowsError(indexRows(d), fields)).toBeNull();
    expect(indexRowsError([row('A', ['Nom']), row('a', ['Ville'])], fields)).toBe('indexes.duplicateName');
    expect(indexRowsError([row(' ', ['Nom'])], fields)).toBe('indexes.emptyName');
    expect(indexRowsError([row('A.B', ['Nom'])], fields)).toBe('indexes.invalidName');
    expect(indexRowsError([row('A', [])], fields)).toBe('indexes.noField');
    expect(indexRowsError([row('A', ['Pays'])], fields)).toBe('indexes.unknownField');
    expect(indexRowsError([row('A', ['Nom', 'nom'])], fields)).toBe('indexes.fieldTwice');
    const manyFields = Array(40).fill(0).map((_, i) => `F${i}`);
    expect(indexRowsError([row('A', Array(11).fill(0).map((_, i) => `F${i}`))], manyFields)).toBe('indexes.tooManyFields');
    expect(indexRowsError(manyFields.slice(0, 33).map((n) => row(n, [n])), manyFields)).toBe('indexes.tooManyIndexes');
    expect(indexRowsError([row('A', ['Nom'], { primary: true }), row('B', ['Ville'], { primary: true })], fields)).toBe('indexes.twoPrimary');
  });
});
