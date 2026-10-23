import { describe, expect, it } from 'vitest';
import { defaultProps } from './field-types';
import { toOrigin, type SourceInfo } from './record-source';

const field = (name: string, origin?: { table: string; field: string }) => ({ name, type: 'shortText' as const, props: defaultProps('shortText'), ...(origin ? { origin } : {}) });
const info: SourceInfo = {
  fields: [field('Client', { table: 'Clients', field: 'Nom' }), field('Ville', { table: 'Clients', field: 'Ville' }), field('Total')],
  updatable: true, keyTable: 'Clients', parameters: [],
};

describe('toOrigin', () => {
  it('maps output aliases back to the key table fields', () => {
    expect(toOrigin(info, { client: 'Dupont', Ville: null })).toEqual({ table: 'Clients', values: { Nom: 'Dupont', Ville: null } });
    expect(toOrigin(info, {})).toEqual({ table: 'Clients', values: {} });
  });

  it('null when the source is not updatable, or a written column has no origin, is unknown or is in another table', () => {
    expect(toOrigin({ ...info, updatable: false }, { Client: 'x' })).toBeNull();
    expect(toOrigin({ ...info, keyTable: undefined }, { Client: 'x' })).toBeNull();
    expect(toOrigin(info, { Total: 3 })).toBeNull(); // computed column: read-only
    expect(toOrigin(info, { Absent: 3 })).toBeNull();
    const joined: SourceInfo = { ...info, fields: [...info.fields, field('Pays', { table: 'Pays', field: 'Nom' })] };
    expect(toOrigin(joined, { Pays: 'France' })).toBeNull();
  });

  it('a field named __proto__ stays an ordinary key', () => {
    const odd: SourceInfo = { ...info, fields: [field('P', { table: 'Clients', field: '__proto__' })] };
    const r = toOrigin(odd, { P: 1 })!;
    expect(Object.keys(r.values)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(r.values)).toBe(Object.prototype);
  });
});
