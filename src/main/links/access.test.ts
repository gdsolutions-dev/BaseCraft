import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { Table } from 'mdb-reader';
import type MDBReader from 'mdb-reader';
import { ACCESS_EXPECTED, ACCESS_PASSWORD } from '../../../tests/fixtures/access/expected';
import { accessDesign, inspectAccess, loadAccessCache, openAccess } from './access';

const fixture = (name: string) => join(__dirname, '../../../tests/fixtures/access', name);
const tmp = fs.mkdtempSync(join(os.tmpdir(), 'bcaccess-'));
const textFile = join(tmp, 'notes.txt');
fs.writeFileSync(textFile, 'not an Access file at all, just text'.repeat(200));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const load = (file: string, names = ['Clients', 'Commandes', 'Divers'], pw?: string) => loadAccessCache(openAccess(fixture(file), pw), names).db;
const rows = (db: ReturnType<typeof load>, table: string) => db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all().map(Object.values);

describe('Access file to design and rows', () => {
  it('maps the Access types', () => {
    const r = openAccess(fixture('Ventes.accdb'));
    const { design, skipped } = accessDesign(r.getTable('Clients'));
    expect(skipped).toEqual(['Photo']);
    expect(design.fields.map((f) => [f.name, f.props.type, f.props.numberSize ?? f.props.size ?? null])).toEqual([
      ['N°', 'autoNumber', null], ['Nom', 'shortText', ACCESS_EXPECTED.nomSize], ['Ville', 'shortText', ACCESS_EXPECTED.villeSize],
      ['Inscrit', 'dateTime', null], ['Actif', 'yesNo', null], ['Remarque', 'longText', null]]);
    const cmd = accessDesign(r.getTable('Commandes')).design.fields;
    expect(cmd.map((f) => [f.name, f.props.type, f.props.numberSize ?? null])).toEqual([
      ['N°', 'autoNumber', null], ['Client', 'number', 'longInteger'], ['Montant', 'currency', null], ['Le', 'dateTime', null],
      ['Quantité', 'number', 'integer'], ['Remise', 'number', 'single'], ['Poids', 'number', 'double'], ['Taux', 'number', 'decimal'], ['Lot', 'number', 'byte']]);
    expect(cmd.find((f) => f.name === 'Taux')!.props).toMatchObject({ precision: 18, scale: 2 }); // as the file reports it (README)
  });

  it('stores the values Access shows', () => {
    const db = load('Ventes.accdb');
    expect(db.prepare('SELECT "Nom", "Ville", "Inscrit", "Actif", "Remarque" FROM "Clients" ORDER BY rowid').all().map(Object.values)).toEqual([
      ['Dupont', 'Lyon', '2024-01-15 00:00:00', 1, ' Client historique'], ['Martin', 'LYON', '2024-06-03 14:30:00', 1, null],
      ['Durand', 'Paris', '2025-09-30 00:00:00', 0, null], ['Éric', 'Lyôn', null, 1, 'Accent']]);
    expect(db.prepare('SELECT "Montant", "Remise", "Poids", "Taux", "Lot" FROM "Commandes" ORDER BY rowid').all().map(Object.values)).toEqual([
      [10.1, 0, 1.5, '19.60', 1], [0.1, 0, 0.25, '5.50', 1], [0.2, 0.1, 2, '19.60', 2], [99.99, 0.25, 12.125, '20.00', 3], [0.1, 0, 0, '0.00', 255]]);
    expect(db.prepare('SELECT "Avant1900", "Heure" FROM "Divers"').get()).toEqual({ Avant1900: '1789-07-14 00:00:00', Heure: '1899-12-30 09:30:00' });
    expect(db.prepare('SELECT "N°" FROM "Clients" ORDER BY rowid').all().map(Object.values)).toEqual([[1], [2], [3], [4]]);
  });

  it('.mdb and .accdb give the same rows', () => {
    for (const t of ['Clients', 'Commandes']) expect(rows(load('Ventes.mdb'), t)).toEqual(rows(load('Ventes.accdb'), t));
  });

  it.each(['Ventes-mdp.accdb', 'Ventes-mdp.mdb'])('%s: no password, wrong password, right password', (file) => {
    expect(() => openAccess(fixture(file))).toThrow(`bc:linkUnavailable|needsPassword|${fixture(file)}`);
    expect(() => openAccess(fixture(file), 'faux')).toThrow('|needsPassword|');
    expect(rows(load(file, ['Clients'], ACCESS_PASSWORD), 'Clients')).toHaveLength(4);
  });

  it('the error never carries the password', () => {
    for (const file of ['Ventes-mdp.accdb', 'Ventes-mdp.mdb']) {
      try { openAccess(fixture(file), 'Secret-123'); expect.unreachable(); } catch (e) { expect(String(e)).not.toContain('Secret-123'); expect(String(e)).not.toContain(ACCESS_PASSWORD); }
    }
  });

  it('lists what can be linked', () => {
    expect(inspectAccess(openAccess(fixture('Ventes.accdb')))).toEqual([
      { name: 'Clients', skipped: ['Photo'] }, { name: 'Commandes', skipped: [] }, { name: 'Divers', skipped: [] }]);
  });

  it('a table BaseCraft refuses is unsupported', () => {
    const real = openAccess(fixture('Ventes.accdb')).getTable('Divers');
    const fake = { name: 'bc_x', getColumns: () => real.getColumns() } as unknown as Table;
    const r = { getTableNames: () => ['bc_x'], getTable: () => fake } as unknown as MDBReader;
    expect(inspectAccess(r)).toEqual([{ name: 'bc_x', skipped: [], unsupported: 'reservedName' }]);
  });

  // No fixture has a GUID (Replication ID) or a Large Number column, nor is a Jet 3 file: a fake table through the same seams.
  const col = (name: string, type: string, size = 0) => ({ name, type, size, fixedLength: false, nullable: true, autoLong: false, autoUUID: false });
  const fakeTable = (name: string, cols: ReturnType<typeof col>[], data: Record<string, unknown>[] = []) =>
    ({ name, getColumns: () => cols, getData: () => data }) as unknown as Table;

  it('a GUID is Short Text 38 and a Large Number a Decimal (19, 0) kept to the last digit (R5)', () => {
    const guid = '{3F2504E0-4F89-11D3-9A0C-0305E82C3301}';
    const big = 2n ** 53n + 1n; // a double would round it to 2^53
    const t = fakeTable('Big', [col('Id', 'repid', 16), col('Grand', 'bigint', 8), col('Étendue', 'datetimextended', 42)],
      [{ Id: guid, Grand: big }, { Id: null, Grand: -(2n ** 63n) }, { Id: guid, Grand: 2n ** 63n - 1n }]);
    const { design, skipped } = accessDesign(t);
    expect(skipped).toEqual(['Étendue']); // Ruling F1
    expect(design.fields.map((f) => f.props)).toMatchObject([{ type: 'shortText', size: 38 }, { type: 'number', numberSize: 'decimal', precision: 19, scale: 0 }]);
    const r = { getTableNames: () => ['Big'], getTable: () => t } as unknown as MDBReader;
    expect(inspectAccess(r)).toEqual([{ name: 'Big', skipped: ['Étendue'] }]); // validateDesign accepts precision 19
    const db = loadAccessCache(r, ['Big']).db;
    expect(db.prepare('SELECT "Id", "Grand", typeof("Grand") AS t FROM "Big" ORDER BY rowid').all().map(Object.values)).toEqual([
      [guid, '9007199254740993', 'text'], [null, '-9223372036854775808', 'text'], [guid, '9223372036854775807', 'text']]);
  });

  it('a Jet 3 text size is in characters, a later one in bytes (m2)', () => {
    const t = fakeTable('T', [col('Nom', 'text', 100), col('Long', 'text', 510)]);
    expect(accessDesign(t, true).design.fields.map((f) => f.props.size)).toEqual([100, 255]);
    expect(accessDesign(t).design.fields.map((f) => f.props.size)).toEqual([50, 255]);
  });

  it('a table that is gone is reported missing', () => {
    const { db, missing } = loadAccessCache(openAccess(fixture('Ventes.accdb')), ['Divers', 'Disparue']);
    expect(missing).toEqual(['Disparue']);
    expect(rows(db, 'Divers')).toHaveLength(1);
  });

  it('the cache refuses writes', () => {
    expect(() => load('Ventes.accdb').exec('DELETE FROM "Clients"')).toThrow();
  });

  it('a file that is not Access fails cannotOpen', () => {
    expect(() => openAccess(textFile)).toThrow('|cannotOpen|');
    expect(() => openAccess(join(tmp, 'absent.accdb'))).toThrow('|cannotOpen|');
  });

  it('never writes beside the file', () => {
    const copy = join(tmp, 'copy.accdb');
    fs.copyFileSync(fixture('Ventes.accdb'), copy);
    const before = fs.statSync(copy).mtimeMs;
    loadAccessCache(openAccess(copy), ['Clients']);
    expect(fs.readdirSync(tmp).filter((f) => f.startsWith('copy'))).toEqual(['copy.accdb']);
    expect(fs.statSync(copy).mtimeMs).toBe(before);
  });
});
