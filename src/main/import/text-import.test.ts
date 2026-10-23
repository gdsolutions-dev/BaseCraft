import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { defaultSpec, type ImportPlan, type ImportSpec } from '../../shared/import-text';
import { localeInfo } from '../../shared/locale-format';
import en from '../../shared/i18n/en.json';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { createTable, listTables, tableDesign } from '../db/schema';
import { defaultProps } from '../../shared/field-types';
import { saveRelation } from '../db/relations';
import { deleteSpec, loadSpecs, saveSpec } from './specs';
import { previewText, runImport, type ImportTexts } from './text-import';
import { saveObject } from '../db/objects';

const fr = localeInfo('fr-FR');
const texts: ImportTexts = {
  fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_ErreursImportation',
  errorFields: { error: 'Erreur', field: 'Champ', line: 'Ligne' }, messages: en.fieldError, log: en.importText.log,
};
const CSV = 'Date,Produit,Quantité vendue,Prix unitaire (€),Région\n'
  + '2024-01-15,Machine à café Expresso,3,249.90,Île-de-France\n'
  + '2024-01-16,"Machine à café ""Luxe"", inox",1,899.00,Bretagne\n';
let dir: string;
let db: DatabaseSync;
const file = (name: string, data: string | Buffer) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return p; };
const all = (t: string) => db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcti-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const planFor = (p: string, table = 'Ventes', region = fr): ImportPlan => {
  const pv = previewText(p, null, region, 'Champ');
  return { spec: pv.spec, target: { kind: 'new', table, primaryKey: { kind: 'auto' } } };
};

describe('preview', () => {
  it('detects everything on a UTF-8 CSV', () => {
    const pv = previewText(file('v.csv', CSV), null, fr, 'Champ');
    expect(pv.encoding).toBe('utf-8');
    expect(pv.spec).toMatchObject({ format: 'delimited', delimiter: ',', hasHeader: true, qualifier: '"' });
    expect(pv.header).toEqual(['Date', 'Produit', 'Quantité vendue', 'Prix unitaire (€)', 'Région']);
    expect(pv.rows[1][1]).toBe('Machine à café "Luxe", inox');
    expect(pv.spec.fields.map((f) => [f.name, f.type])).toEqual([
      ['Date', 'dateTime'], ['Produit', 'shortText'], ['Quantité vendue', 'longInteger'], ['Prix unitaire (€)', 'double'], ['Région', 'shortText'],
    ]);
    expect(pv.lines).toHaveLength(3);
  });
  it('reads the file once per version and encoding: option changes reuse the decoded sample', () => {
    const p = file('k.csv', 'a,b\n1,2\n');
    fs.utimesSync(p, 1e9, 1e9);
    const first = previewText(p, null, fr, 'Champ');
    fs.writeFileSync(p, 'x;y\n3;4\n'); // same size, same mtime: an unchanged file for the cache
    fs.utimesSync(p, 1e9, 1e9);
    expect(previewText(p, { ...first.spec, delimiter: ';' }, fr, 'Champ').lines).toEqual(['a,b', '1,2']);
    expect(previewText(p, { ...first.spec, encoding: 'windows-1252' }, fr, 'Champ').lines).toEqual(['x;y', '3;4']); // other encoding: read again
    fs.writeFileSync(p, 'x;y\n3;45\n'); // changed size: read again
    expect(previewText(p, first.spec, fr, 'Champ').lines).toEqual(['x;y', '3;45']);
  });
  it('a line over one million characters is a typed error at preview and at run, and leaves nothing', async () => {
    const p = file('huge.csv', 'A;B\nx;' + 'y'.repeat((1 << 20) + 10) + '\n');
    expect(() => previewText(p, null, fr, 'Champ')).toThrow('bc:fieldTooLong');
    const spec: ImportSpec = {
      ...defaultSpec(fr), delimiter: ';', hasHeader: true,
      fields: [{ name: 'A', type: 'shortText', indexed: 'no', skip: false }, { name: 'B', type: 'longText', indexed: 'no', skip: false }],
    };
    await expect(runImport(db, p, { spec, target: { kind: 'new', table: 'H', primaryKey: { kind: 'auto' } } }, fr, texts)).rejects.toThrow('bc:fieldTooLong');
    expect(listTables(db)).toEqual([]);
  });
  it('an empty file is refused at preview', () => {
    expect(() => previewText(file('empty.csv', ''), null, fr, 'Champ')).toThrow('bc:emptyFile');
    expect(() => previewText(file('blank.csv', '\r\n\n'), null, fr, 'Champ')).toThrow('bc:emptyFile');
  });
  it('keeps a given spec and re-infers for it', () => {
    const p = file('v.csv', CSV);
    const spec = { ...previewText(p, null, fr, 'Champ').spec, hasHeader: false };
    const pv = previewText(p, spec, fr, 'Champ');
    expect(pv.spec).toEqual(spec);
    expect(pv.header).toBeNull();
    expect(pv.inferred[0]).toMatchObject({ name: 'Champ1', type: 'shortText' });
  });
});

describe('import', () => {
  it('creates the table with an AutoNumber key and typed values', async () => {
    const r = await runImport(db, file('v.csv', CSV), planFor(file('v.csv', CSV)), fr, texts);
    expect(r).toEqual({ ok: true, table: 'Ventes', imported: 2, errors: 0 });
    const d = tableDesign(db, 'Ventes');
    expect(d.fields.map((f) => f.name)).toEqual(['N°', 'Date', 'Produit', 'Quantité vendue', 'Prix unitaire (€)', 'Région']);
    expect(d.fields[0].props.type).toBe('autoNumber');
    expect(all('Ventes')[1]).toEqual({
      'N°': 2, Date: '2024-01-16 00:00:00', Produit: 'Machine à café "Luxe", inox', 'Quantité vendue': 1, 'Prix unitaire (€)': 899, Région: 'Bretagne',
    });
  });

  it('own primary key, skipped field, no key', async () => {
    const p = file('v.csv', CSV);
    const plan = planFor(p);
    plan.spec.fields[4].skip = true;
    plan.target = { kind: 'new', table: 'T1', primaryKey: { kind: 'field', field: 'Produit' } };
    expect((await runImport(db, p, plan, fr, texts)).ok).toBe(true);
    const d = tableDesign(db, 'T1');
    expect(d.fields.map((f) => f.name)).toEqual(['Date', 'Produit', 'Quantité vendue', 'Prix unitaire (€)']);
    expect(d.fields[1].props).toMatchObject({ primaryKey: true, required: true });
    plan.target = { kind: 'new', table: 'T2', primaryKey: { kind: 'none' } };
    await runImport(db, p, plan, fr, texts);
    expect(tableDesign(db, 'T2').fields.some((f) => f.props.primaryKey)).toBe(false);
  });

  it('appends with a column mapping', async () => {
    const p = file('v.csv', CSV);
    await runImport(db, p, planFor(p), fr, texts);
    const spec = planFor(p).spec;
    const r = await runImport(db, p, { spec, target: { kind: 'append', table: 'Ventes', mapping: ['Date', 'Produit', null, 'Prix unitaire (€)', 'Région'] } }, fr, texts);
    expect(r).toMatchObject({ ok: true, imported: 2, errors: 0 });
    expect(all('Ventes')).toHaveLength(4);
    expect(all('Ventes')[3]).toMatchObject({ 'N°': 4, 'Quantité vendue': null });
  });

  it('the error table name avoids query names too (one namespace)', async () => {
    saveObject(db, 'query', 'ventes_erreursimportation', { formatVersion: '1.0' }, null);
    const p = file('e.csv', CSV + '2024-02-30,Moulin,abc,10.00,Bretagne\n');
    const plan = planFor(p);
    plan.spec.fields[2].type = 'longInteger';
    expect(await runImport(db, p, plan, fr, texts)).toMatchObject({ ok: true, errorTable: 'Ventes_ErreursImportation1' });
  });

  it('refuses rows that do not convert and logs them in the error table', async () => {
    const p = file('e.csv', CSV + '2024-02-30,Moulin,abc,10.00,Bretagne\n');
    const plan = planFor(p);
    plan.spec.fields[0].type = 'dateTime'; // the invalid date made the sample text
    plan.spec.fields[2].type = 'longInteger';
    const r = await runImport(db, p, plan, fr, texts);
    expect(r).toEqual({ ok: true, table: 'Ventes', imported: 2, errors: 2, errorTable: 'Ventes_ErreursImportation' });
    expect(all('Ventes_ErreursImportation')).toEqual([
      { Erreur: en.fieldError.invalidDate, Champ: 'Date', Ligne: 4 },
      { Erreur: en.fieldError.invalidNumber, Champ: 'Quantité vendue', Ligne: 4 },
    ]);
    expect(tableDesign(db, 'Ventes_ErreursImportation').fields.map((f) => [f.name, f.props.type, f.props.size])).toEqual([
      ['Erreur', 'shortText', 255], ['Champ', 'shortText', 64], ['Ligne', 'number', undefined],
    ]);
  });

  it('duplicates in a unique key are refused rows', async () => {
    const p = file('d.csv', 'Code,Nom\nA,x\nA,y\n');
    const plan = planFor(p, 'Codes');
    plan.target = { kind: 'new', table: 'Codes', primaryKey: { kind: 'field', field: 'Code' } };
    expect(await runImport(db, p, plan, fr, texts)).toMatchObject({ imported: 1, errors: 1 });
  });

  it('a failure mid-import rolls everything back', async () => {
    const p = file('e.csv', CSV + 'bad,row,x,y,z\n');
    const before = listTables(db);
    await expect(runImport(db, p, planFor(p), fr, texts, async (done, total) => { if (done === total) throw new Error('disk gone'); }))
      .rejects.toThrow('disk gone');
    expect(listTables(db)).toEqual(before);
    expect(db.isTransaction).toBe(false);
    expect(db.prepare(`SELECT count(*) AS n FROM bc_tables`).get()).toEqual({ n: 0 });
  });

  it('a connection closed mid-import (lock lost, window closed) is a typed error and leaves nothing', async () => {
    const p = file('c.csv', CSV);
    const base = path.join(dir, 'test.basecraft');
    await expect(runImport(db, p, planFor(p), fr, texts, async () => { db.close(); })).rejects.toThrow('bc:importInterrupted');
    db = openBaseFile(base, 'write', '0.0.0').db;
    expect(listTables(db)).toEqual([]);
  });

  it('existing table name and invalid design are results, not exceptions', async () => {
    const p = file('v.csv', CSV);
    await runImport(db, p, planFor(p), fr, texts);
    expect(await runImport(db, p, planFor(p, 'ventes'), fr, texts)).toEqual({ ok: false, reason: 'nameExists' });
    const plan = planFor(p, 'X');
    plan.spec.fields[1].name = plan.spec.fields[0].name;
    expect(await runImport(db, p, plan, fr, texts)).toMatchObject({ ok: false, reason: 'design' });
  });

  it('Windows-1252 file with a semicolon and decimal comma', async () => {
    const p = file('w.csv', Buffer.from('Libellé;Montant\nCafé;12,50\nThé;3\n', 'latin1'));
    const plan = planFor(p, 'W');
    expect(plan.spec).toMatchObject({ delimiter: ';', decimalSep: ',' });
    await runImport(db, p, plan, fr, texts);
    expect(all('W')).toEqual([{ 'N°': 1, Libellé: 'Café', Montant: 12.5 }, { 'N°': 2, Libellé: 'Thé', Montant: 3 }]);
  });

  it('fixed width', async () => {
    const p = file('f.txt', 'Dupont    Paris     12\nMartin    Lyon      345\n');
    const plan = planFor(p, 'F');
    expect(plan.spec.format).toBe('fixed');
    await runImport(db, p, plan, fr, texts);
    expect(all('F')).toEqual([{ 'N°': 1, Champ1: 'Dupont', Champ2: 'Paris', Champ3: 12 }, { 'N°': 2, Champ1: 'Martin', Champ2: 'Lyon', Champ3: 345 }]);
  });
});

describe('text sizes', () => {
  it('long values after the sample still import (short text is 255)', async () => {
    const p = file('s.csv', 'Nom;Desc\n' + 'a;court\n'.repeat(1050) + `b;${'x'.repeat(80)}\n`.repeat(50));
    expect(await runImport(db, p, planFor(p, 'S'), fr, texts)).toEqual({ ok: true, table: 'S', imported: 1100, errors: 0 });
  });
  it('a value too long for the target is truncated, the row imported, the truncation logged', async () => {
    const p = file('t.csv', 'Nom;Desc\na;0123456789ABCDE\nb;ok\n');
    const plan = planFor(p, 'T');
    plan.spec.fields[1].size = 10; // a size set by the user (Advanced…)
    expect(await runImport(db, p, plan, fr, texts)).toMatchObject({ imported: 2, errors: 1 });
    expect(all('T').map((x) => (x as Record<string, unknown>).Desc)).toEqual(['0123456789', 'ok']);
    expect(all('T_ErreursImportation')).toEqual([{ Erreur: texts.log.truncated, Champ: 'Desc', Ligne: 2 }]);
    // append into a table whose field is shorter than the file's values
    createTable(db, { name: 'Petit', fields: [{ name: 'Desc', props: { ...defaultProps('shortText'), size: 3 } }] });
    const r = await runImport(db, p, { spec: plan.spec, target: { kind: 'append', table: 'Petit', mapping: [null, 'Desc'] } }, fr, texts);
    expect(r).toMatchObject({ imported: 2, errors: 1, errorTable: 'Petit_ErreursImportation' });
    expect(all('Petit')).toEqual([{ Desc: '012' }, { Desc: 'ok' }]);
  });
});

describe('field rules (A2)', () => {
  const qte = (extra: Record<string, unknown>) => createTable(db, {
    name: 'Stock', fields: [
      { name: 'Article', props: defaultProps('shortText') },
      { name: 'Qte', props: { ...defaultProps('number'), validationRule: '>0', ...extra } },
    ],
  });
  const append = async () => {
    const p = file('stock.csv', 'Article;Qte\nA;3\nB;-1\nC;7\n');
    return runImport(db, p, { spec: planFor(p, 'x').spec, target: { kind: 'append', table: 'Stock', mapping: ['Article', 'Qte'] } }, fr, texts);
  };
  it('a row breaking a Valide si rule goes to the error table with its validation text; valid rows import', async () => {
    qte({ validationText: 'Quantité positive' });
    expect(await append()).toMatchObject({ imported: 2, errors: 1 });
    expect(all('Stock').map((x) => (x as Record<string, unknown>).Qte)).toEqual([3, 7]);
    expect(all('Stock_ErreursImportation')).toEqual([{ Erreur: 'Quantité positive', Champ: 'Qte', Ligne: 3 }]);
  });
  it('without a validation text, the generic message names the rule', async () => {
    qte({});
    await append();
    expect(all('Stock_ErreursImportation')).toEqual([{ Erreur: en.fieldError.validation.replace('{{rule}}', '>0'), Champ: 'Qte', Ligne: 3 }]);
  });
  it('a message over 255 characters (long rule quoted) is logged truncated: the import completes', async () => {
    const rule = '>0' + ' And <>1000'.repeat(30);
    qte({ validationRule: rule });
    expect(await append()).toMatchObject({ imported: 2, errors: 1 });
    const [row] = all('Stock_ErreursImportation') as { Erreur: string }[];
    const full = en.fieldError.validation.replace('{{rule}}', rule);
    expect(full.length).toBeGreaterThan(255);
    expect(row.Erreur).toBe(full.slice(0, 255));
  });
  it('an input mask never refuses an imported value, as in Access (A2-R10)', async () => {
    createTable(db, { name: 'Tel', fields: [{ name: 'Num', props: { ...defaultProps('shortText'), inputMask: '00\\ 00\\ 00\\ 00\\ 00;0;_' } }] });
    const p = file('tel.csv', 'Num\n0612\nabc\n');
    expect(await runImport(db, p, { spec: planFor(p, 'x').spec, target: { kind: 'append', table: 'Tel', mapping: ['Num'] } }, fr, texts)).toMatchObject({ imported: 2, errors: 0 });
    expect(all('Tel').map((x) => (x as Record<string, unknown>).Num)).toEqual(['0612', 'abc']);
  });
  it('appending into a child table logs the rows without a parent record and imports the others', async () => {
    createTable(db, { name: 'Clients', fields: [{ name: 'Code', props: { ...defaultProps('shortText'), primaryKey: true } }] });
    createTable(db, { name: 'Cmd', fields: [{ name: 'Client', props: defaultProps('shortText') }, { name: 'Qte', props: defaultProps('number') }] });
    db.exec(`INSERT INTO "Clients" VALUES ('A')`);
    expect(saveRelation(db, { name: '', parentTable: 'Clients', parentFields: ['Code'], childTable: 'Cmd', childFields: ['Client'], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 }, null, fr).ok).toBe(true);
    const p = file('cmd.csv', 'Client;Qte\nA;1\nZ;2\nA;3\n');
    expect(await runImport(db, p, { spec: planFor(p, 'x').spec, target: { kind: 'append', table: 'Cmd', mapping: ['Client', 'Qte'] } }, fr, texts)).toMatchObject({ imported: 2, errors: 1 });
    expect(all('Cmd').map((x) => (x as Record<string, unknown>).Qte)).toEqual([1, 3]);
    expect(all('Cmd_ErreursImportation')).toEqual([{ Erreur: en.fieldError.noParent.replace('{{table}}', 'Clients'), Champ: 'Client', Ligne: 3 }]);
  });
});

describe('error table name', () => {
  it('a 64-character table name: the base is cut so the suffix fits, a number is added when taken', async () => {
    const long = 'T'.repeat(64);
    const p = file('e.csv', 'Nom;N\na;x\n');
    const plan = planFor(p, long);
    plan.spec.fields[1].type = 'longInteger';
    const want = 'T'.repeat(64 - texts.errorSuffix.length) + texts.errorSuffix;
    expect(await runImport(db, p, plan, fr, texts)).toMatchObject({ imported: 0, errors: 1, errorTable: want });
    plan.target = { kind: 'append', table: long, mapping: ['Nom', 'N'] };
    const second = 'T'.repeat(64 - texts.errorSuffix.length - 1) + texts.errorSuffix + '1';
    expect(await runImport(db, p, plan, fr, texts)).toMatchObject({ errors: 1, errorTable: second });
    expect([...second].length).toBe(64);
  });
});

describe('unclosed qualifier', () => {
  it('no row is swallowed: the bad row is imported as read and logged', async () => {
    const p = file('q.csv', 'Nom;Desc\nA;"bad\nB;ok\nC;ok');
    expect(await runImport(db, p, planFor(p, 'Q'), fr, texts)).toMatchObject({ imported: 3, errors: 1 });
    expect(all('Q').map((x) => (x as Record<string, unknown>).Desc)).toEqual(['"bad', 'ok', 'ok']);
    expect(all('Q_ErreursImportation')).toEqual([{ Erreur: texts.log.unclosed, Champ: null, Ligne: 2 }]);
  });
  it('error lines are physical lines (embedded line breaks and blank lines counted)', async () => {
    const p = file('l.csv', 'Nom;N\n"a\nb";1\n\nc;x\n');
    const plan = planFor(p, 'L');
    plan.spec.fields[1].type = 'longInteger';
    await runImport(db, p, plan, fr, texts);
    expect(all('L_ErreursImportation')).toEqual([{ Erreur: en.fieldError.invalidNumber, Champ: 'N', Ligne: 5 }]);
  });
});

describe('yes/no columns', () => {
  it('every token inferred as Oui/Non is imported', async () => {
    const p = file('b.csv', 'Nom;Actif\nA;Vrai\nB;Faux\nC; OUI \nD;non\nE;Yes\nF;false\nG;TRUE\nH;no\n');
    const plan = planFor(p, 'B');
    expect(plan.spec.fields[1].type).toBe('yesNo');
    expect(await runImport(db, p, plan, fr, texts)).toMatchObject({ imported: 8, errors: 0 });
    expect(all('B').map((x) => (x as Record<string, unknown>).Actif)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });
  it('-1/0/1 import into a Oui/Non field', async () => {
    const p = file('n.csv', 'Nom;Actif\nA;-1\nB;0\nC;1\n');
    const plan = planFor(p, 'N');
    plan.spec.fields[1].type = 'yesNo';
    expect(await runImport(db, p, plan, fr, texts)).toMatchObject({ imported: 3, errors: 0 });
    expect(all('N').map((x) => (x as Record<string, unknown>).Actif)).toEqual([1, 0, 1]);
  });
});

describe('numbers follow the file, not the region', () => {
  const run = async (name: string, data: string, region: string) => {
    const p = file(`${name}.csv`, data);
    const r = await runImport(db, p, planFor(p, name, localeInfo(region)), localeInfo(region), texts);
    return { r, rows: all(name).map((x) => (x as Record<string, unknown>).Prix) };
  };
  it('de-DE region, file with decimal points: 249.90 stays 249.9', async () => {
    expect((await run('De', 'Nom;Prix\nA;249.90\nB;12.5\n', 'de-DE')).rows).toEqual([249.9, 12.5]);
  });
  it('en-US region, French file: 2,5 stays 2.5 and 1 234,5 is 1234.5', async () => {
    expect((await run('Us', 'Nom;Prix\nA;2,5\nB;1 234,5\n', 'en-US')).rows).toEqual([2.5, 1234.5]);
  });
  it('fr-FR region, US file with thousands commas', async () => {
    expect((await run('Fr', 'Nom,Prix\nA,"1,234.50"\nB,3.5\n', 'fr-FR')).rows).toEqual([1234.5, 3.5]);
  });
  it('German file: 1.234 is 1234', async () => {
    expect((await run('De2', 'Nom;Prix\nA;1.234\nB;5,25\n', 'en-US')).rows).toEqual([1234, 5.25]);
  });
  it('fr-FR, three decimals with a leading 0: decimal comma, never ×1000', async () => {
    const r = await run('Poids', 'Article;Prix\nA;1,250\nB;0,750\nC;2,125\n', 'fr-FR');
    expect(r.rows).toEqual([1.25, 0.75, 2.125]);
    expect(tableDesign(db, 'Poids').fields[2].props).toMatchObject({ type: 'number', numberSize: 'double' });
  });
  it('fr-FR, ambiguous 1,250 / 2,125: the region decimal is assumed, and the preview says so', async () => {
    const p = file('amb.csv', 'Article;Prix\nA;1,250\nB;2,125\n');
    expect(previewText(p, null, fr, 'Champ')).toMatchObject({ spec: { decimalSep: ',' }, assumedDecimal: true });
    expect((await run('Amb', 'Article;Prix\nA;1,250\nB;2,125\n', 'fr-FR')).rows).toEqual([1.25, 2.125]);
  });
  it('en-US, ambiguous 1,250 / 2,125: thousands', async () => {
    expect((await run('AmbUs', 'Article;Prix\nA;1,250\nB;2,125\n', 'en-US')).rows).toEqual([1250, 2125]);
  });
  it('a repeated separator proves the thousands: fr-FR 1,250,500 / 2,125 and de-DE 1.250.500 / 0,5', async () => {
    expect((await run('Rep1', 'Article;Prix\nA;1,250,500\nB;2,125\n', 'fr-FR')).rows).toEqual([1250500, 2125]);
    expect((await run('Rep2', 'Article;Prix\nA;1.250.500\nB;0,5\n', 'de-DE')).rows).toEqual([1250500, 0.5]);
    expect(previewText(file('rep3.csv', 'A;P\nx;1.250.500\n'), null, localeInfo('en-US'), 'Champ'))
      .toMatchObject({ spec: { decimalSep: ',', thousandsSep: '.' }, assumedDecimal: false });
  });
  it('contradicting proofs: the choice is shown', () => {
    expect(previewText(file('tie.csv', 'A;P;Q\nx;12,5;12.5\n'), null, fr, 'Champ')).toMatchObject({ spec: { decimalSep: ',' }, assumedDecimal: true });
  });
  it('an unambiguous file is not flagged', () => {
    expect(previewText(file('u.csv', 'A;P\nx;2,5\n'), null, localeInfo('en-US'), 'Champ').assumedDecimal).toBe(false);
  });
  it('a value that does not fit the grouping is an error row, never ×100', async () => {
    const p = file('bad.csv', 'Nom;Prix\nA;1.234,5\nB;249.90\n');
    const plan = planFor(p, 'Bad', localeInfo('de-DE'));
    expect(plan.spec).toMatchObject({ decimalSep: ',', thousandsSep: '.' });
    plan.spec.fields[1].type = 'double';
    const r = await runImport(db, p, plan, localeInfo('de-DE'), texts);
    expect(r).toMatchObject({ imported: 1, errors: 1 });
    expect(all('Bad').map((x) => (x as Record<string, unknown>).Prix)).toEqual([1234.5]);
    expect(all('Bad_ErreursImportation')).toEqual([{ Erreur: en.fieldError.invalidNumber, Champ: 'Prix', Ligne: 3 }]);
  });
});

describe('saved specifications', () => {
  it('save, load, delete; invalid entries are dropped on load', () => {
    const spec = defaultSpec(fr);
    saveSpec(db, 'Ventes', spec);
    saveSpec(db, 'Autre', { ...spec, delimiter: ';' });
    expect(Object.keys(loadSpecs(db))).toEqual(['Ventes', 'Autre']);
    expect(loadSpecs(db).Ventes).toEqual(spec);
    db.prepare(`UPDATE bc_meta SET value = json_set(value, '$.importSpecs.Bad', json('{"format":"xml"}')) WHERE key = 'options'`).run();
    expect(Object.keys(loadSpecs(db))).toEqual(['Ventes', 'Autre']);
    deleteSpec(db, 'Autre');
    expect(Object.keys(loadSpecs(db))).toEqual(['Ventes']);
    expect(() => saveSpec(db, ' x', spec)).toThrow('bc:invalidArgument');
    expect(() => saveSpec(db, '__proto__', spec)).toThrow('bc:invalidArgument');
  });
  it('a corrupt options value reads as no specification', () => {
    db.prepare(`UPDATE bc_meta SET value = 'not json' WHERE key = 'options'`).run();
    expect(loadSpecs(db)).toEqual({});
  });
});
