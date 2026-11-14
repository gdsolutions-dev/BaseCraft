import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { ExportDesign } from '../../shared/access-export';
import type { DesignDoc } from '../../shared/design/model';
import { defaultProps, type FieldDef } from '../../shared/field-types';
import { registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { getObject, saveObject } from '../db/objects';
import { createTable } from '../db/schema';
import { readAccessExport, readExportDesigns } from './access-export';
import { importDesigns } from './access-designs';
import * as converter from '../../shared/access-design';

vi.mock('../../shared/access-design', async (orig) => {
  const real = await orig<typeof import('../../shared/access-design')>();
  return { ...real, convertAccessDesign: vi.fn(real.convertAccessDesign) };
});

const memoryBase = () => { const db = new DatabaseSync(':memory:'); registerFunctions(db); for (const ddl of SYSTEM_DDL) db.exec(ddl); return db; };
const text = (name: string): FieldDef => ({ name, props: { ...defaultProps('shortText'), size: 50 } });
const FIXTURE = join(__dirname, '../../../tests/fixtures/access/Ventes-complet.export');
const design = (kind: 'form' | 'report', name: string, body: string): ExportDesign => ({ kind, name, text: kind === 'form'
  ? `Begin Form\n${body}\n Begin\n  Begin Section\n   Begin\n   End\n  End\n End\nEnd\n` : `Begin Report\n${body}\n Begin\n  Begin Section\n  End\n End\nEnd\n` });
const withControls = (name: string, record: string, controls: string): ExportDesign => ({ kind: 'form', name, text: `Begin Form\n RecordSource ="${record}"\n Begin\n  Begin Section\n   Begin\n${controls}\n   End\n  End\n End\nEnd\n` });
const def = (db: DatabaseSync, kind: 'form' | 'report', name: string) => getObject(db, kind, name)!.definition as DesignDoc;
const none = { tables: [], queries: [] };
let db: DatabaseSync;

beforeEach(() => {
  db = memoryBase();
  createTable(db, { name: 'Clients', fields: [text('Nom'), text('Ville')] });
  createTable(db, { name: 'Commandes', fields: [text('Client'), text('Produit')] });
});

describe('importDesigns', () => {
  it('the fixture: both objects saved, record sources bound, lines', () => {
    const read = readAccessExport(FIXTURE, 'Ventes-complet.accdb');
    if (!read.ok) throw new Error('fixture');
    const designs = readExportDesigns(FIXTURE, read.export);
    const r = importDesigns(db, designs, { tables: [{ remote: 'Clients', name: 'Clients' }, { remote: 'Commandes', name: 'Commandes' }], queries: [] });
    expect(r.forms).toEqual([{ name: 'FClients', remote: 'FClients' }]);
    expect(r.reports).toEqual([{ name: 'ECommandes', remote: 'ECommandes' }]);
    expect(def(db, 'form', 'FClients').recordSource).toEqual({ kind: 'table', name: 'Clients' });
    expect(def(db, 'report', 'ECommandes').recordSource).toEqual({ kind: 'table', name: 'Commandes' });
    const codes = r.lines.map((l) => l.code);
    expect(codes).toEqual(expect.arrayContaining(['formImported', 'reportImported', 'designEventDropped', 'designControlReplaced', 'designSubformTable', 'designPropertiesIgnored', 'designPageDefault']));
    expect(r.lines.find((l) => l.code === 'designSubformTable')).toEqual({ code: 'designSubformTable', object: 'FClients', part: 'Table.Commandes' });
    expect(r.lines.find((l) => l.code === 'designPropertiesIgnored' && l.object === 'FClients')!.part).toMatch(/^\w+ \(\d+\)(, \w+ \(\d+\))*$/);
  });
  it('renamed tables, queries and forms are followed', () => {
    createTable(db, { name: 'Clients1', fields: [text('Nom')] });
    saveObject(db, 'query', 'Q', { formatVersion: '1.0', sql: 'SELECT Nom FROM Clients' }, null);
    saveObject(db, 'query', 'Q1', { formatVersion: '1.0', sql: 'SELECT Nom FROM Clients1' }, null);
    saveObject(db, 'form', 'Sub', { formatVersion: '1.0', recordSource: null, props: {}, sections: [] }, null);
    const r = importDesigns(db, [withControls('F', 'Clients', 'Begin ComboBox\n Name ="C"\n RowSourceType ="Table/Query"\n RowSource ="SELECT Nom FROM Clients"\nEnd\nBegin ListBox\n Name ="L"\n RowSourceType ="Table/Query"\n RowSource ="Q"\nEnd\nBegin Subform\n Name ="S"\n SourceObject ="Form.Sub"\nEnd'),
      design('form', 'Sub', '')], { tables: [{ remote: 'Clients', name: 'Clients1' }], queries: [{ remote: 'Q', name: 'Q1' }] });
    const d = def(db, 'form', 'F');
    expect(d.recordSource).toEqual({ kind: 'table', name: 'Clients1' });
    const p = (n: string) => d.sections[0]!.controls.find((c) => c.name === n)!.props;
    expect(String(p('C').RowSource)).toContain('Clients1');
    expect(p('L').RowSource).toBe('Q1');
    expect(p('S').SourceObject).toBe('Sub1');
    expect(r.forms).toEqual([{ name: 'F', remote: 'F' }, { name: 'Sub1', remote: 'Sub' }]);
    expect(r.lines).toContainEqual({ code: 'formImported', object: 'Sub1', part: 'Sub' });
    expect(r.lines.some((l) => l.code === 'designSourceMissing')).toBe(false);
  });
  it('a source this import did not bring is flagged, present in the target or not', () => {
    createTable(db, { name: 'Stock', fields: [text('X')] });
    const r = importDesigns(db, [withControls('A', 'Stock', ''), withControls('B', 'Nowhere', 'Begin Subform\n Name ="S"\n SourceObject ="Form.Gone"\nEnd'), withControls('C', 'SELECT * FROM Stock', ''), withControls('D', 'SELECT FROM WHERE', '')], none);
    expect(def(db, 'form', 'A').recordSource).toEqual({ kind: 'table', name: 'Stock' });
    expect(def(db, 'form', 'B').recordSource).toEqual({ kind: 'table', name: 'Nowhere' });
    expect(def(db, 'form', 'C').recordSource).toMatchObject({ kind: 'sql' });
    expect(def(db, 'form', 'D').recordSource).toBeNull();
    expect(r.lines.filter((l) => l.code === 'designSourceMissing').map((l) => [l.object, l.part])).toEqual([['A', 'Stock'], ['B', 'Nowhere'], ['B', 'Form.Gone'], ['C', 'Stock'], ['D', undefined]]);
  });
  it('skipped: no text, not SaveAsText, truncated, a refused name, a duplicate — the others import', () => {
    const r = importDesigns(db, [{ kind: 'form', name: 'A', text: null }, { kind: 'form', name: 'B', text: 'hello' }, { kind: 'report', name: 'C', text: 'Begin Report\n Begin\n' },
      design('form', 'bad[name]', ''), design('form', 'Ok', ''), design('form', 'ok', ''), design('report', 'Ok', '')], none);
    expect(r.lines.filter((l) => l.code === 'designSkipped').map((l) => [l.object, l.reason])).toEqual([['A', 'unreadable'], ['B', 'notRead'], ['C', 'notRead'], ['bad[name]', 'nameInvalid'], ['ok', 'duplicate']]);
    expect(r.forms).toEqual([{ name: 'Ok', remote: 'Ok' }]);
    expect(r.reports).toEqual([{ name: 'Ok', remote: 'Ok' }]); // a form and a report may share a name
  });
  it('the lines of one object are in order, properties ignored last', () => {
    const r = importDesigns(db, [withControls('F', '', 'Begin WebBrowser\n Name ="W"\nEnd\nBegin TextBox\n Name ="T"\n ZzUnknownProperty =3\n OnClick ="[Event Procedure]"\nEnd')], none);
    expect(r.lines.map((l) => l.code)).toEqual(['formImported', 'designControlReplaced', 'designEventDropped', 'designPropertiesIgnored']);
    expect(r.lines[3]).toEqual({ code: 'designPropertiesIgnored', object: 'F', n: 1, part: 'ZzUnknownProperty (1)' });
  });
  it('one bad object never undoes the others: an over-limit definition (saved, then unreadable)', () => {
    const big = design('form', 'Big', ` Caption ="${'x'.repeat(9 * 1024 * 1024)}"`);
    const r = importDesigns(db, [design('form', 'A', ''), big, design('form', 'C', '')], none);
    expect(r.forms.map((f) => f.name)).toEqual(['A', 'C']);
    expect(r.lines.filter((l) => l.code === 'designSkipped')).toEqual([{ code: 'designSkipped', object: 'Big', reason: 'notRead' }]);
    expect(r.lines.some((l) => l.code === 'formImported' && l.object === 'Big')).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bc_objects WHERE name = 'Big'").get()).toEqual({ n: 0 });
  });
  it('one bad object never undoes the others: a converter that throws something else', () => {
    const real = vi.mocked(converter.convertAccessDesign).getMockImplementation()!;
    vi.mocked(converter.convertAccessDesign).mockImplementation((t, k) => { if (t.includes('Boom')) throw new TypeError('x'); return real(t, k); });
    try {
      const r = importDesigns(db, [design('form', 'A', ''), design('form', 'B', ' Caption ="Boom"'), design('form', 'C', '')], none);
      expect(r.forms.map((f) => f.name)).toEqual(['A', 'C']);
      expect(r.lines.filter((l) => l.code === 'designSkipped')).toEqual([{ code: 'designSkipped', object: 'B', reason: 'notRead' }]);
    } finally { vi.mocked(converter.convertAccessDesign).mockImplementation(real); }
  });
  it('a subform pointing at a skipped object is "not in this import"', () => {
    const r = importDesigns(db, [{ kind: 'form', name: 'Sub', text: null }, withControls('F', '', 'Begin Subform\n Name ="S"\n SourceObject ="Form.Sub"\nEnd')], none);
    expect(def(db, 'form', 'F').sections[0]!.controls[0]!.props.SourceObject).toBe('');
    expect(r.lines).toContainEqual({ code: 'designSourceMissing', object: 'F', part: 'Form.Sub' });
  });
  it('a Value List row source is left alone and gives no line', () => {
    createTable(db, { name: 'Clients1', fields: [text('Nom')] });
    const r = importDesigns(db, [withControls('F', '', 'Begin ComboBox\n Name ="C"\n RowSourceType ="Value List"\n RowSource ="\\"Clients\\";\\"Autres\\""\nEnd')], { tables: [{ remote: 'Clients', name: 'Clients1' }], queries: [] });
    expect(def(db, 'form', 'F').sections[0]!.controls[0]!.props.RowSource).toBe('"Clients";"Autres"');
    expect(r.lines.map((l) => l.code)).toEqual(['formImported']);
  });
  it('a record source that is not a name nor readable SQL is left empty with one line; a bracketed name is a name', () => {
    createTable(db, { name: 'Mes clients', fields: [text('Nom')] });
    const r = importDesigns(db, [withControls('A', 'DELETE FROM x', ''), withControls('B', 'a b WHERE c', ''), withControls('C', '[Mes clients]', '')], none);
    expect(def(db, 'form', 'A').recordSource).toBeNull();
    expect(def(db, 'form', 'B').recordSource).toBeNull();
    expect(def(db, 'form', 'C').recordSource).toEqual({ kind: 'table', name: 'Mes clients' });
    expect(r.lines.filter((l) => l.code === 'designSourceMissing').map((l) => [l.object, l.part])).toEqual([['A', undefined], ['B', undefined], ['C', 'Mes clients']]);
  });
  it('a table of the target named like SQL is a name, not text', () => {
    createTable(db, { name: 'Select list', fields: [text('X')] });
    const r = importDesigns(db, [withControls('F', 'Select list', 'Begin ComboBox\n Name ="C"\n RowSourceType ="Table/Query"\n RowSource ="[Select list]"\nEnd')], none);
    expect(def(db, 'form', 'F').recordSource).toEqual({ kind: 'table', name: 'Select list' });
    expect(def(db, 'form', 'F').sections[0]!.controls[0]!.props.RowSource).toBe('[Select list]');
    expect(r.lines.filter((l) => l.code === 'designSourceMissing')).toEqual([{ code: 'designSourceMissing', object: 'F', part: 'Select list' }]);
  });
  it('a row source that is neither a name nor readable SQL stays as written, without a line', () => {
    const r = importDesigns(db, [withControls('F', '', 'Begin ComboBox\n Name ="C"\n RowSourceType ="Table/Query"\n RowSource ="a b WHERE c"\nEnd')], none);
    expect(def(db, 'form', 'F').sections[0]!.controls[0]!.props.RowSource).toBe('a b WHERE c');
    expect(r.lines.map((l) => l.code)).toEqual(['formImported']);
  });
  it('a missing source is reported once per object whatever its case', () => {
    createTable(db, { name: 'Stock', fields: [text('X')] });
    const r = importDesigns(db, [withControls('F', 'Stock', 'Begin ComboBox\n Name ="C"\n RowSourceType ="Table/Query"\n RowSource ="stock"\nEnd')], none);
    expect(r.lines.filter((l) => l.code === 'designSourceMissing')).toEqual([{ code: 'designSourceMissing', object: 'F', part: 'Stock' }]);
  });
  const sub = (n: string, src: string) => `Begin Subform\n Name ="${n}"\n SourceObject ="${src}"\nEnd`;
  const srcs = (kind: 'form' | 'report', n: string) => def(db, kind, n).sections.flatMap((s) => s.controls).map((c) => c.props.SourceObject);
  it('subforms and subreports resolve within their own kind', () => {
    const r = importDesigns(db, [withControls('Self', '', sub('S', 'Form.Self') + '\n' + sub('L', 'Form.Later')), design('form', 'Later', ''), design('form', 'X', ''), design('report', 'X', ''),
      withControls('FX', '', sub('S', 'Form.X') + '\n' + sub('R', 'Report.X')),
      { kind: 'report', name: 'RX', text: `Begin Report\n Begin\n  Begin Section\n   Begin\n${sub('S', 'Report.X')}\n   End\n  End\n End\nEnd\n` }], none);
    expect(srcs('form', 'Self')).toEqual(['Self', 'Later']);
    expect(srcs('form', 'FX')).toEqual(['X', '']);
    expect(srcs('report', 'RX')).toEqual(['X']);
    expect(r.lines.filter((l) => l.code === 'designSourceMissing').map((l) => [l.object, l.part])).toEqual([['FX', 'Report.X']]);
  });
  it('the lines of one object: imported, notes, sources, then properties ignored', () => {
    const r = importDesigns(db, [withControls('F', 'Nowhere', 'Begin WebBrowser\n Name ="W"\nEnd\nBegin TextBox\n Name ="T"\n ZzUnknownProperty =3\nEnd')], none);
    expect(r.lines.map((l) => l.code)).toEqual(['formImported', 'designControlReplaced', 'designSourceMissing', 'designPropertiesIgnored']);
  });
});
