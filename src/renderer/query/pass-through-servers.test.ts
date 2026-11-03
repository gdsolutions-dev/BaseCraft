import { describe, expect, it } from 'vitest';
import { serverOptions, type Server } from './pass-through-servers';

const P = { host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 };
const pg = (params: Record<string, unknown>): Server => ({ kind: 'postgresql', params });

describe('serverOptions (C6 R3: the Connexion list)', () => {
  it('two links differing only in TLS mode: two entries, each with its own params, the TLS mode in the label', () => {
    const { options, selected } = serverOptions(null, [pg(P), pg({ ...P, tls: 'disable' })]);
    expect(options.map((o) => [o.label, o.params.tls])).toEqual([
      ['db.example:5432/ventes (verify-full)', 'verify-full'], ['db.example:5432/ventes (disable)', 'disable'],
    ]);
    expect(selected).toBe(-1);
  });

  it('one entry per connection (host case aside); a single server keeps the plain label', () => {
    const { options } = serverOptions(null, [pg(P), pg({ ...P, host: 'DB.example', timeout: 5 })]);
    expect(options).toEqual([{ ...pg(P), label: 'db.example:5432/ventes' }]);
  });

  it('same label and TLS mode, another user: the user too', () => {
    const { options } = serverOptions(null, [pg(P), pg({ ...P, user: 'bob' })]);
    expect(options.map((o) => o.label)).toEqual(['db.example:5432/ventes (verify-full, ana)', 'db.example:5432/ventes (verify-full, bob)']);
  });

  it('SQL Server (C5 R13): a named instance by its name, never its port; one entry per kind and instance', () => {
    const ms = (params: Record<string, unknown>): Server => ({ kind: 'sqlserver', params });
    const S = { host: 'db.example', port: 1433, database: 'ventes', user: 'ana', tls: 'require', timeout: 60 };
    const { options } = serverOptions(ms({ ...S, instance: 'SQLEXPRESS', port: undefined }), [ms({ ...S, instance: 'SQLEXPRESS' }), ms({ ...S, instance: 'AUTRE' }), ms(S), pg({ ...P, port: 1433 })]);
    expect(options.map((o) => [o.kind, o.label])).toEqual([['sqlserver', 'db.example\\SQLEXPRESS/ventes'], ['sqlserver', 'db.example\\AUTRE/ventes'],
      ['sqlserver', 'db.example:1433/ventes (require)'], ['postgresql', 'db.example:1433/ventes (verify-full)']]);
    expect(serverOptions(null, [ms({ ...S, instance: 'SQLEXPRESS' }), ms({ ...S, instance: 'sqlexpress', port: 1 })]).options).toHaveLength(1); // instance names ignore case
  });

  it("the pass-through's own params are selected exactly: in place of its link's entry, else first", () => {
    const own = { ...P, timeout: 0 };
    const same = serverOptions(pg(own), [pg({ ...P, tls: 'disable' }), pg(P)]);
    expect(same.selected).toBe(1);
    expect(same.options[1]!.params).toBe(own);
    expect(same.options).toHaveLength(2);
    const other = serverOptions(pg({ ...P, tls: 'require' }), [pg(P)]);
    expect(other.selected).toBe(0);
    expect(other.options.map((o) => o.label)).toEqual(['db.example:5432/ventes (require)', 'db.example:5432/ventes (verify-full)']);
  });
});
