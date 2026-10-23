import { describe, expect, it } from 'vitest';
import { defaultProps, type FieldProps, type TableDesign } from '../../shared/field-types';
import { addField, namedFormatPatch, patchField, patchTable, removeField, renameField, stepDecimals, toggleIndex } from './field-edit';

const d = (names: string[]): TableDesign => ({ name: 'T', validationRule: '[A]>0', fields: names.map((name) => ({ name, props: { ...defaultProps('shortText'), size: 40, caption: `c-${name}` } })) });

describe('field-edit', () => {
  it('adds after the selected field with a unique name', () => {
    const e = addField(d(['N°', 'Nom', 'Champ1']), 'N°', 'number', { base: 'Champ' });
    expect(e.design.fields.map((f) => f.name)).toEqual(['N°', 'Champ2', 'Nom', 'Champ1']);
    expect(e.mapping).toContainEqual({ name: 'Champ2', sourceName: null });
    expect(e.mapping).toContainEqual({ name: 'Nom', sourceName: 'Nom' });
  });
  it('adds at the end without a selection, with the number size', () => {
    const e = addField(d(['A']), null, 'number', { base: 'F', numberSize: 'double' });
    expect(e.design.fields.map((f) => f.name)).toEqual(['A', 'F1']);
    expect(e.design.fields[1].props.numberSize).toBe('double');
  });
  it('rename maps new to old', () => {
    const e = renameField(d(['Nom']), 'Nom', 'NomClient', 'Nom du client', undefined);
    expect(e.mapping).toEqual([{ name: 'NomClient', sourceName: 'Nom' }]);
    expect(e.design.fields[0].props.caption).toBe('Nom du client');
    expect(e.design.validationRule).toBe('[A]>0');
  });
  it('remove drops the mapping entry', () => expect(removeField(d(['A', 'B']), 'A').mapping).toEqual([{ name: 'B', sourceName: 'B' }]));
  it('patch keeps other props', () => {
    const e = patchField(d(['Nom']), 'Nom', { required: true });
    expect(e.design.fields[0].props).toMatchObject({ required: true, size: 40, caption: 'c-Nom' });
    expect(e.mapping).toEqual([{ name: 'Nom', sourceName: 'Nom' }]);
  });
});

const p = (o: Partial<FieldProps>): FieldProps => ({ ...defaultProps('number'), ...o }) as FieldProps;
describe('formatting and index helpers', () => {
  it('decimals', () => {
    expect(stepDecimals(p({ decimalPlaces: 'auto' }), 1)).toEqual({ decimalPlaces: 2 });
    expect(stepDecimals(p({ decimalPlaces: 3 }), -1)).toEqual({ decimalPlaces: 2 });
    expect(stepDecimals(p({ decimalPlaces: 0 }), -1)).toEqual({ decimalPlaces: 0 });
    expect(stepDecimals(p({ decimalPlaces: 15 }), 1)).toEqual({ decimalPlaces: 15 });
  });
  it('named formats by type', () => {
    expect(namedFormatPatch(p({ type: 'currency' }), 'percent')).toEqual({ format: 'percent' });
    expect(namedFormatPatch(p({ type: 'number' }), 'comma')).toEqual({ format: 'standard' });
    expect(namedFormatPatch(p({ type: 'shortText' }), 'currency')).toBeNull();
  });
  it('unique and indexed toggles', () => {
    expect(toggleIndex(p({ indexed: 'no' }), 'unique')).toEqual({ indexed: 'yesNoDuplicates' });
    expect(toggleIndex(p({ indexed: 'yesDuplicates' }), 'unique')).toEqual({ indexed: 'yesNoDuplicates' });
    expect(toggleIndex(p({ indexed: 'yesNoDuplicates' }), 'unique')).toEqual({ indexed: 'no' });
    expect(toggleIndex(p({ indexed: 'no' }), 'indexed')).toEqual({ indexed: 'yesDuplicates' });
    expect(toggleIndex(p({ indexed: 'yesNoDuplicates' }), 'indexed')).toEqual({ indexed: 'no' });
  });
});

describe('patchTable', () => {
  it('sets and clears the record rule and message, fields untouched', () => {
    const a = patchTable(d(['A', 'B']), { validationRule: '[A]<[B]', validationText: 'non' });
    expect(a.design).toMatchObject({ validationRule: '[A]<[B]', validationText: 'non' });
    expect(a.mapping).toEqual([{ name: 'A', sourceName: 'A' }, { name: 'B', sourceName: 'B' }]);
    const b = patchTable(a.design, { validationRule: '' });
    expect('validationRule' in b.design).toBe(false);
    expect(b.design.validationText).toBe('non');
  });
});
