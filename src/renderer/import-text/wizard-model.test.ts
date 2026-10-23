import { describe, expect, it } from 'vitest';
import { defaultSpec, type ImportField } from '../../shared/import-text';
import { localeInfo } from '../../shared/locale-format';
import { clients } from '../../shared/test-fixtures';
import {
  addBreak, defaultTableName, destinationNameError, fieldsError, hasPendingRow, keyError, mapByName, mappingError, moveBreak, removeBreak, stepsFor, structuralChange,
} from './wizard-model';

const spec = defaultSpec(localeInfo('fr-FR'));
const field = (name: string, skip = false): ImportField => ({ name, type: 'shortText', indexed: 'no', skip });

describe('import wizard model', () => {
  it('steps', () => {
    expect(stepsFor('delimited', 'new')).toEqual(['source', 'format', 'delimited', 'fields', 'key', 'finish']);
    expect(stepsFor('excel', 'new')).toEqual(['source', 'sheet', 'fields', 'key', 'finish']);
    expect(stepsFor('excel', 'append')).toEqual(['source', 'sheet', 'fields', 'finish']);
    expect(stepsFor('fixed', 'append')).toEqual(['source', 'format', 'fixed', 'fields', 'finish']);
  });
  it('structural changes', () => {
    expect(structuralChange(spec, { ...spec, delimiter: ';' })).toBe(true);
    expect(structuralChange(spec, { ...spec, breaks: [3] })).toBe(true);
    expect(structuralChange(spec, { ...spec, decimalSep: '.', fields: [field('a')] })).toBe(false);
  });
  it('breaks: add, move, remove', () => {
    expect(addBreak([10, 20], 15)).toEqual([10, 15, 20]);
    expect(addBreak([10], 10)).toEqual([10]);
    expect(addBreak([10], 0)).toEqual([10]);
    expect(moveBreak([10, 20], 10, 25)).toEqual([20, 25]);
    expect(moveBreak([10, 20], 10, 20)).toEqual([10, 20]);
    expect(removeBreak([10, 20], 10)).toEqual([20]);
  });
  it('default table name from the file', () => {
    expect(defaultTableName('C:\\data\\Ventes_machines_cafe_UTF8.csv', [], 'Table1')).toBe('Ventes_machines_cafe_UTF8');
    expect(defaultTableName('/tmp/ventes.v2.csv', ['ventes_v2'], 'Table1')).toBe('ventes_v21');
    expect(defaultTableName('/tmp/.csv', [], 'Table1')).toBe('Table1');
    expect(destinationNameError('ventes', ['Clients'], ['Ventes'])).toEqual({ key: 'importText.error.queryExists', params: { name: 'ventes' } });
    expect(destinationNameError('CLIENTS', ['Clients'], ['Ventes'])).toEqual({ key: 'importText.error.tableExists', params: { name: 'CLIENTS' } });
    expect(destinationNameError('Autre', ['Clients'], ['Ventes'])).toBeNull();
  });
  it('maps columns to fields by name, never to the AutoNumber', () => {
    expect(mapByName(['nom', 'N°', 'Inconnu', 'NOM', 'email'], clients)).toEqual(['Nom', null, null, null, 'Email']);
  });
  it('a pending row in a datasheet of the target table blocks an append', () => {
    const tab = (name: string, mode: 'design' | 'datasheet', dirty: boolean, isNew = false, kind = 'table') => ({ kind, name, mode, dirty, isNew });
    expect(hasPendingRow([tab('Ventes', 'datasheet', true)], 'Ventes')).toBe(true);
    expect(hasPendingRow([tab('ventes', 'datasheet', true)], 'Ventes')).toBe(false); // names are exact: a twin is another table
    expect(hasPendingRow([tab('Ventes', 'datasheet', false)], 'Ventes')).toBe(false);
    expect(hasPendingRow([tab('Ventes', 'design', true)], 'Ventes')).toBe(false); // a design is never touched by an import
    expect(hasPendingRow([tab('Autre', 'datasheet', true), tab('Ventes', 'datasheet', true, true)], 'Ventes')).toBe(false);
    expect(hasPendingRow([tab('Ventes', 'datasheet', true, false, 'form')], 'Ventes')).toBe(false); // a form's datasheet (M10) is not the table's
  });
  it('checks', () => {
    expect(fieldsError({ ...spec, fields: [field('a', true)] })).toEqual({ key: 'importText.error.noField' });
    expect(fieldsError({ ...spec, fields: [field('a'), field('A')] })).toEqual({ key: 'designError.nameDuplicate', index: 1 });
    expect(fieldsError({ ...spec, fields: [field('a'), field('a.b')] })).toEqual({ key: 'designError.nameInvalid', index: 1 });
    expect(fieldsError({ ...spec, fields: [field('a'), field('a', true)] })).toBeNull();
    expect(mappingError([null, null])).toBe('importText.error.noField');
    expect(mappingError(['Nom', 'Nom'])).toBe('importText.error.mappingDuplicate');
    expect(keyError({ ...spec, fields: [field('a', true)] }, { kind: 'field', field: 'a' })).toBe('importText.error.pkField');
    expect(keyError(spec, { kind: 'auto' })).toBeNull();
  });
});
