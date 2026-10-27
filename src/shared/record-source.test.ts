import { describe, expect, it } from 'vitest';
import { defaultProps } from './field-types';
import { lookupFor, writableColumn, type SourceInfo } from './record-source';

const field = (name: string, origin?: { table: string; field: string }) => ({ name, type: 'shortText' as const, props: defaultProps('shortText'), ...(origin ? { origin } : {}) });
const info: SourceInfo = {
  fields: [field('Client', { table: 'Clients', field: 'Nom' }), field('Ville', { table: 'Clients', field: 'Ville' }), field('Total')],
  updatable: true, keyTable: 'Clients', parameters: [],
};

describe('writableColumn', () => {
  it('without tables (A3): an aliased key table field yes; computed, unknown, another table or a read-only source no', () => {
    expect(['Client', 'ville', 'Total', 'Absent'].map((n) => writableColumn(info, n))).toEqual([true, true, false, false]);
    expect(writableColumn({ ...info, fields: [...info.fields, field('Pays', { table: 'Pays', field: 'Nom' })] }, 'Pays')).toBe(false);
    expect(writableColumn({ ...info, updatable: false }, 'Client')).toBe(false);
  });
  it('with tables: a field of any plan table that is not one of its read-only join fields', () => {
    const joined: SourceInfo = { ...info, keyTable: 'Commandes', fields: [...info.fields, field('Clé', { table: 'Clients', field: 'N°' }),
      field('Client', { table: 'Commandes', field: 'Client' }), field('Pays', { table: 'Pays', field: 'Nom' })].slice(1),
    tables: [{ table: 'Commandes', role: 'key', readOnly: [], lookupBy: [] }, { table: 'Clients', role: 'one', readOnly: ['N°'], lookupBy: ['Client'] }] };
    expect(['Ville', 'Clé', 'Client', 'Total', 'Pays', 'Absent'].map((n) => writableColumn(joined, n))).toEqual([true, false, true, false, false, false]);
  });
});

describe('lookupFor (B4 R4)', () => {
  // Commandes ⋈ Clients ⋈ Produits: two 'one' tables, each looked up by its own link
  const two: SourceInfo = {
    fields: [field('Client', { table: 'Commandes', field: 'Client' }), field('Produit', { table: 'Commandes', field: 'Produit' }),
      field('Nom', { table: 'Clients', field: 'Nom' }), field('Prix', { table: 'Produits', field: 'Prix' }), field('Total')],
    updatable: true, keyTable: 'Commandes', parameters: [],
    tables: [{ table: 'Commandes', role: 'key', readOnly: [], lookupBy: [] }, { table: 'Clients', role: 'one', readOnly: ['N°'], lookupBy: ['Client'] },
      { table: 'Produits', role: 'one', readOnly: ['Réf'], lookupBy: ['Produit'] }],
  };
  it('a link change looks up only the tables it links: their whole link is sent, only their columns come back', () => {
    expect(lookupFor(two, 'client')).toEqual({ links: ['Client'], columns: ['Nom'] }); // Produits (and a Prix typed for it) untouched
    expect(lookupFor(two, 'Produit')).toEqual({ links: ['Produit'], columns: ['Prix'] });
    expect(lookupFor(two, 'Nom')).toBeNull(); // not a link
    expect(lookupFor({ ...two, tables: undefined }, 'Client')).toBeNull(); // A3: no join
  });
  it('a chain and a composite link: every link column of each table looked up, once', () => {
    const chain: SourceInfo = { ...two, tables: [two.tables![0]!, { table: 'Clients', role: 'one', readOnly: [], lookupBy: ['Client', 'Produit'] },
      { table: 'Produits', role: 'one', readOnly: [], lookupBy: ['Produit'] }] };
    expect(lookupFor(chain, 'Produit')).toEqual({ links: ['Client', 'Produit'], columns: ['Nom', 'Prix'] });
    expect(lookupFor(chain, 'Client')).toEqual({ links: ['Client'], columns: ['Nom'] }); // Produit links Produits, not looked up
  });
  it('an intermediate link of a chain looks the far table up from the value typed, not through the near one', () => {
    // Lignes ⋈ Commandes ⋈ Clients: Commande (Lignes.Commande) links Commandes then Clients; Client (Commandes.Client) links Clients
    const l3: SourceInfo = {
      fields: [field('Commande', { table: 'Lignes', field: 'Commande' }), field('Client', { table: 'Commandes', field: 'Client' }),
        field('Nom', { table: 'Clients', field: 'Nom' })],
      updatable: true, keyTable: 'Lignes', parameters: [],
      tables: [{ table: 'Lignes', role: 'key', readOnly: [], lookupBy: [] }, { table: 'Commandes', role: 'one', readOnly: ['N°'], lookupBy: ['Commande'] },
        { table: 'Clients', role: 'one', readOnly: ['N°'], lookupBy: ['Commande', 'Client'] }],
    };
    expect(lookupFor(l3, 'Client')).toEqual({ links: ['Client'], columns: ['Nom'] });
    expect(lookupFor(l3, 'Commande')).toEqual({ links: ['Commande', 'Client'], columns: ['Client', 'Nom'] });
  });
});
