import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import MDBReader from 'mdb-reader';
import { ACCESS_PASSWORD } from '../../../tests/fixtures/access/expected';

const fixture = (name: string) => join(__dirname, '../../../tests/fixtures/access', name);

// C2: the dependency reads the owner's files in Node.
describe('mdb-reader on the owner\'s files', () => {
  it('reads the owner\'s file in Node', () => {
    const r = new MDBReader(readFileSync(fixture('Ventes.accdb')));
    expect(r.getTableNames()).toEqual(['Clients', 'Commandes', 'Divers']);
  });

  it('refuses a protected .accdb without the password, opens it with it', () => {
    const buf = readFileSync(fixture('Ventes-mdp.accdb'));
    expect(() => new MDBReader(buf)).toThrow('Wrong password');
    expect(() => new MDBReader(buf, { password: 'nope' })).toThrow('Wrong password');
    expect(new MDBReader(buf, { password: ACCESS_PASSWORD }).getTableNames()).toEqual(['Clients', 'Commandes', 'Divers']);
  });

  // Jet 4 (.mdb): the password is stored in the header, not enforced by the reader (the data is not encrypted).
  it('reads a protected .mdb without checking its password; getPassword() holds it', () => {
    const r = new MDBReader(readFileSync(fixture('Ventes-mdp.mdb')));
    expect(r.getTableNames()).toEqual(['Clients', 'Commandes', 'Divers']);
    expect(r.getPassword()).toBe(ACCESS_PASSWORD);
  });
});
