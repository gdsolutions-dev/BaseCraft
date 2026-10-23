import { describe, expect, it } from 'vitest';
import type { Relation } from '../../shared/api';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import type { RecordSourceRef, SourceField, SourceInfo } from '../../shared/record-source';
import { masterValues, MAX_SUBFORM_DEPTH, proposeLinks, splitFields } from './links';
import type { RecordSnapshot } from './record-controller';

const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField => ({ name, type, props: { ...defaultProps(type), ...props } as FieldProps });
const infoOf = (table: string, fields: SourceField[]): SourceInfo =>
  ({ fields: fields.map((f) => ({ ...f, origin: f.origin ?? { table, field: f.name } })), updatable: true, keyTable: table, parameters: [] });
const tbl = (name: string): RecordSourceRef => ({ kind: 'table', name });
const rel = (parentTable: string, parentFields: string[], childTable: string, childFields: string[]): Relation =>
  ({ name: `${parentTable}${childTable}`, parentTable, parentFields, childTable, childFields, enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 });

const clientsInfo = infoOf('Clients', [sf('N°', 'autoNumber'), sf('Nom', 'shortText')]);
const commandesInfo = infoOf('Commandes', [sf('N°', 'autoNumber'), sf('Client', 'number'), sf('Montant', 'currency')]);
const contactsInfoWithNo = infoOf('Contacts', [sf('Id', 'autoNumber'), sf('N°', 'number'), sf('Nom', 'shortText')]);
const produitsInfo = infoOf('Produits', [sf('Réf', 'autoNumber'), sf('Libellé', 'shortText')]);

const snapWith = (s: Partial<RecordSnapshot>): RecordSnapshot => ({
  status: 'ready', info: clientsInfo, total: 2, index: 1, isNew: false, values: [], pending: {}, dirty: false, errors: [], editable: true,
  canAdd: true, canDelete: true, busy: false, refused: false, saves: 0, sort: [], filter: [], ...s,
});

describe('subform links', () => {
  it('split', () => {
    expect(splitFields(' N° ; Pays ')).toEqual(['N°', 'Pays']);
    expect(splitFields(undefined)).toEqual([]);
    expect(splitFields(' ; ')).toEqual([]);
  });

  it('master values', () => {
    expect(masterValues(['N°'], snapWith({ values: [2, 'Martin'] }))).toEqual([2]);
    expect(masterValues(['n°', 'Nom'], snapWith({ values: [2, 'Martin'] }))).toEqual([2, 'Martin']);   // names compared as Access does
    expect(masterValues(['N°'], snapWith({ isNew: true, values: [null, ''] }))).toBeNull();
    expect(masterValues(['Nom'], snapWith({ values: [3, null] }))).toBeNull();                       // a Null link field
    expect(masterValues(['Ville'], snapWith({ values: [2, 'Martin'] }))).toBeNull();                 // an unknown field
    expect(masterValues(['N°'], snapWith({ total: 0, index: 0, values: [] }))).toBeNull();          // no record at all
    expect(masterValues(['N°'], snapWith({ info: null, values: [2] }))).toBeNull();                  // an unbound master
  });

  it('master values: the stored value, never the entry typed over it', () =>
    expect(masterValues(['N°'], snapWith({ values: [2, 'Martin'], pending: { 'N°': 9 }, dirty: true }))).toEqual([2]));

  it('propose from relation, then same-name key', () => {
    expect(proposeLinks(clientsInfo, tbl('Clients'), commandesInfo, tbl('Commandes'), [rel('Clients', ['N°'], 'Commandes', ['Client'])])).toEqual({ master: ['N°'], child: ['Client'] });
    expect(proposeLinks(clientsInfo, tbl('Clients'), contactsInfoWithNo, tbl('Contacts'), [])).toEqual({ master: ['N°'], child: ['N°'] });
    expect(proposeLinks(clientsInfo, tbl('Clients'), produitsInfo, tbl('Produits'), [])).toBeNull();
  });

  it('propose: only a relation from the master table to the child table, field names as the sources show them', () => {
    // the reverse relation does not count; the key fallback then needs a child field named N°: Commandes has one
    expect(proposeLinks(clientsInfo, tbl('Clients'), commandesInfo, tbl('Commandes'), [rel('Commandes', ['Client'], 'Clients', ['N°'])])).toEqual({ master: ['N°'], child: ['N°'] });
    // a query source: its key table and the fields' origins (an alias)
    const query: SourceInfo = { fields: [{ ...sf('Qui', 'number'), origin: { table: 'Commandes', field: 'Client' } }, { ...sf('Montant', 'currency'), origin: { table: 'Commandes', field: 'Montant' } }],
      updatable: true, keyTable: 'Commandes', parameters: [] };
    expect(proposeLinks(clientsInfo, tbl('clients'), query, { kind: 'query', name: 'Q' }, [rel('Clients', ['N°'], 'Commandes', ['Client'])])).toEqual({ master: ['N°'], child: ['Qui'] });
    // the relation's child field missing from the child source: the key fallback
    const sansClient = infoOf('Commandes', [sf('N°', 'autoNumber'), sf('Montant', 'currency')]);
    expect(proposeLinks(clientsInfo, tbl('Clients'), sansClient, tbl('Commandes'), [rel('Clients', ['N°'], 'Commandes', ['Client'])])).toEqual({ master: ['N°'], child: ['N°'] });
  });

  it('propose: a master without a primary key has no fallback', () =>
    expect(proposeLinks(infoOf('T', [sf('N°', 'number')]), tbl('T'), commandesInfo, tbl('Commandes'), [])).toBeNull());

  it('depth', () => expect(MAX_SUBFORM_DEPTH).toBe(7));
});
