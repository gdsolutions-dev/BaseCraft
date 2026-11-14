import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ATTACHMENT_MAX_BYTES, attachmentName, isRunnable } from '../../shared/attachments';
import { f, t } from '../../shared/test-fixtures';
import { defaultExportSpec } from '../../shared/exchange';
import { localeInfo } from '../../shared/locale-format';
import { Session, type SessionDeps } from '../session';
import type { RiskProbe } from './location-risk';

let dir: string;
let s: Session;
const probe: RiskProbe = { platform: 'linux', env: {}, homedir: '/home/x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const bytes = (...n: number[]) => Uint8Array.from(n);
const save = (design: ReturnType<typeof t>) => s.saveTable({ originalName: null, design, mapping: [], allowDataLoss: false });
const first = async (table: string) => (await s.page(table, { offset: 0, limit: 10 })).rows[0]!;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcatt-'));
  s = Session.create(path.join(dir, 'b.basecraft'), deps);
  await save(t('Clients', [f('Nom', 'shortText'), f('Pieces', 'attachment')]));
  await s.insert('Clients', { Nom: 'A' });
});
afterEach(() => { s.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('attachment fields', () => {
  it('several files per cell, the datasheet reads the count, a name taken becomes (2)', async () => {
    const { rowid } = await first('Clients');
    expect(s.attachmentAdd('Clients', 'Pieces', rowid, [{ name: 'C:\\x\\a.txt', data: bytes(65) }, { name: 'a.txt', data: bytes(66) }, { name: 'b.png', data: bytes(1, 2) }]))
      .toEqual(['a.txt', 'a (2).txt', 'b.png']);
    expect((await first('Clients')).values).toEqual(['A', 3]);
    expect(s.attachmentList('Clients', 'Pieces', rowid).map((x) => [x.name, x.type, x.bytes])).toEqual([['a.txt', 'txt', 1], ['a (2).txt', 'txt', 1], ['b.png', 'png', 2]]);
    const list = s.attachmentList('Clients', 'Pieces', rowid);
    expect(s.attachmentGet('Clients', 'Pieces', rowid, list[1]!.id).data).toEqual(bytes(66));
    // another field update leaves the files and the count alone, and is not a conflict
    expect((await s.update('Clients', rowid, { Nom: 'B' }, { Nom: 'A', Pieces: 3 })).ok).toBe(true);
    expect((await first('Clients')).values).toEqual(['B', 3]);
    for (const x of list) s.attachmentRemove('Clients', 'Pieces', rowid, x.id);
    expect((await first('Clients')).values).toEqual(['B', 0]); // no file: a count of 0
    expect(s.attachmentList('Clients', 'Pieces', rowid)).toEqual([]);
  });

  it('refuses a file over 25 MB (nothing added), a non-attachment field, a typed value', async () => {
    const { rowid } = await first('Clients');
    expect(() => s.attachmentAdd('Clients', 'Pieces', rowid, [{ name: 'ok.txt', data: bytes(1) }, { name: 'big.bin', data: new Uint8Array(ATTACHMENT_MAX_BYTES + 1) }])).toThrow('bc:attachmentTooLarge');
    expect(s.attachmentList('Clients', 'Pieces', rowid)).toEqual([]);
    expect(() => s.attachmentAdd('Clients', 'Nom', rowid, [{ name: 'a.txt', data: bytes(1) }])).toThrow('bc:invalidArgument');
    expect(await s.update('Clients', rowid, { Pieces: 5 })).toMatchObject({ ok: false, errors: [{ field: 'Pieces', code: 'readOnly' }] });
  });

  it('keeps the files through a table alteration; a table copy copies them; deleting the row deletes them', async () => {
    const { rowid } = await first('Clients');
    s.attachmentAdd('Clients', 'Pieces', rowid, [{ name: 'a.txt', data: bytes(65) }]);
    const design = s.tableDesign('Clients');
    expect((await s.saveTable({ originalName: 'Clients', design: { ...design, fields: [...design.fields, f('Note', 'longText')] }, mapping: [...design.fields.map((x) => ({ name: x.name, sourceName: x.name })), { name: 'Note', sourceName: null }], allowDataLoss: false })).ok).toBe(true);
    expect(s.attachmentList('Clients', 'Pieces', rowid)).toHaveLength(1);
    expect(s.copyTable('Clients', 'Copie')).toEqual({ ok: true });
    const copy = (await first('Copie')).rowid;
    expect(s.attachmentList('Copie', 'Pieces', copy)).toHaveLength(1);
    s.attachmentAdd('Copie', 'Pieces', copy, [{ name: 'b.txt', data: bytes(66) }]);
    expect(s.attachmentList('Clients', 'Pieces', rowid)).toHaveLength(1); // the copy's own set
    expect(await s.delete('Copie', [copy])).toEqual({ ok: true, count: 1 });
    expect(s.attachmentList('Clients', 'Pieces', rowid)).toHaveLength(1);
    await s.compact();
    expect(s.attachmentList('Clients', 'Pieces', rowid)).toHaveLength(1);
    expect(await s.delete('Clients', [rowid])).toEqual({ ok: true, count: 1 });
  });
});

describe('attachment export', () => {
  it('a text export writes the names of the files, « ; » between them', async () => {
    const { rowid } = await first('Clients');
    s.attachmentAdd('Clients', 'Pieces', rowid, [{ name: 'a.txt', data: bytes(65) }, { name: 'b.png', data: bytes(1) }]);
    await s.insert('Clients', { Nom: 'B' });
    const file = path.join(dir, 'out.csv');
    expect((await s.exportText({ ref: { kind: 'table', name: 'Clients' } }, defaultExportSpec(localeInfo('fr-FR')), file, { yes: 'Oui', no: 'Non' })).ok).toBe(true);
    expect(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)).toEqual(['﻿"Nom";"Pieces"', '"A";"a.txt; b.png"', '"B";']);
  });
});

describe('attachment in a query', () => {
  it('a query shows the number of files, not the set id', async () => {
    await s.insert('Clients', { Nom: 'B' });
    const rows = (await s.page('Clients', { offset: 0, limit: 10 })).rows;
    s.attachmentAdd('Clients', 'Pieces', rows[1]!.rowid, [{ name: 'a.txt', data: bytes(65) }]);   // set 1 -> row B
    s.attachmentAdd('Clients', 'Pieces', rows[0]!.rowid, [{ name: 'b.txt', data: bytes(66) }, { name: 'c.txt', data: bytes(67) }]);   // set 2 -> row A
    const page = await s.pageSource({ kind: 'sql', sql: 'SELECT Nom, Pieces FROM Clients ORDER BY Nom' }, { offset: 0, limit: 10 });
    expect(page.rows).toEqual([['A', 2], ['B', 1]]);
    expect(page.rowids).toEqual([rows[0]!.rowid, rows[1]!.rowid]);
  });
});

describe('attachment faces (reports)', () => {
  it('the first file of each row: a picture as a data URL, else its name and type, null without files', async () => {
    await s.insert('Clients', { Nom: 'B' });
    await s.insert('Clients', { Nom: 'C' });
    const [a, b, c] = (await s.page('Clients', { offset: 0, limit: 10 })).rows.map((r) => r.rowid);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    s.attachmentAdd('Clients', 'Pieces', a!, [{ name: 'p.png', data: png }, { name: 'z.txt', data: bytes(65) }]);
    s.attachmentAdd('Clients', 'Pieces', b!, [{ name: 'doc.pdf', data: bytes(37, 80, 68, 70) }]);
    const faces = s.attachmentFaces('Clients', 'Pieces', [a!, b!, c!]);
    expect(faces[0]).toMatchObject({ name: 'p.png', type: 'png' });
    expect(faces[0]!.src).toMatch(/^data:image\/png;base64,/);
    expect(faces[1]).toEqual({ name: 'doc.pdf', type: 'pdf', src: null });
    expect(faces[2]).toBeNull();
    expect(() => s.attachmentFaces('Clients', 'Nom', [a!])).toThrow('bc:invalidArgument');
  });
});

describe('attachment names', () => {
  it('keeps the last path part, replaces what Windows refuses, flags what can run', () => {
    expect(attachmentName('C:\\a\\b\\f?.txt')).toBe('f_.txt');
    expect(attachmentName('../x/')).toBeNull();
    expect(attachmentName('con.txt')).toBe('_con.txt');
    expect(isRunnable('Setup.EXE')).toBe(true);
    expect(isRunnable('a.png')).toBe(false);
  });
});

describe('orphaned files', () => {
  const count = () => (s as unknown as { conn(): { prepare(q: string): { get(): { n: number } } } }).conn().prepare('SELECT count(*) AS n FROM bc_attachments').get().n;

  it('a CASCADE delete, a dropped field and a dropped table take their files with them', async () => {
    await save(t('Parents', [f('N°', 'autoNumber'), f('Nom', 'shortText')]));
    await save(t('Enfants', [f('Parent', 'number', { numberSize: 'longInteger' }), f('Pieces', 'attachment')]));
    await s.insert('Parents', { Nom: 'P' });
    await s.insert('Enfants', { Parent: 1 });
    const kid = (await first('Enfants')).rowid;
    s.attachmentAdd('Enfants', 'Pieces', kid, [{ name: 'a.txt', data: bytes(65) }]);
    expect(count()).toBe(1);
    expect(s.saveRelation({ name: '', parentTable: 'Parents', parentFields: ['N°'], childTable: 'Enfants', childFields: ['Parent'], enforce: true, cascadeUpdate: false, cascadeDelete: true, joinType: 1 }, null)).toMatchObject({ ok: true });
    expect(await s.delete('Parents', [(await first('Parents')).rowid])).toMatchObject({ ok: true });
    expect(count()).toBe(0);
    // dropped table
    const { rowid } = await first('Clients');
    s.attachmentAdd('Clients', 'Pieces', rowid, [{ name: 'b.txt', data: bytes(66) }]);
    expect(count()).toBe(1);
    const design = s.tableDesign('Clients');
    expect((await s.saveTable({ originalName: 'Clients', design: { ...design, fields: design.fields.filter((x) => x.name !== 'Pieces') }, mapping: [{ name: 'Nom', sourceName: 'Nom' }], allowDataLoss: true })).ok).toBe(true);
    expect(count()).toBe(0);

  });

  it('a dropped table, and Compact removes a set no cell references', async () => {
    const { rowid } = await first('Clients');
    s.attachmentAdd('Clients', 'Pieces', rowid, [{ name: 'b.txt', data: bytes(66) }]);
    expect(s.dropTable('Clients')).toEqual({ ok: true });
    expect(count()).toBe(0);
    const db = (s as unknown as { conn(): { exec(q: string): void } }).conn();
    db.exec("INSERT INTO bc_attachments (set_id, name, type, data, created) VALUES (99, 'x.txt', 'txt', x'41', '')");
    expect(count()).toBe(1);
    await s.compact();
    expect(count()).toBe(0);
  });
});
