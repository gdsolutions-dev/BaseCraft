import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { CANON } from '../shared/coerce';
import { getObject, listObjects } from '../main/db/objects';
import { registerFunctions } from '../main/db/file-format';
import { validateDesignDoc, type ControlDef, type DesignDoc, type SectionDef } from '../shared/design/model';
import { newBase } from './new-base';
import { applyScript } from './script';
import { tmp } from './test-tmp';
import en from '../shared/i18n/en.json';
import { LABELS } from './ops-design';
import type { ControlKind } from '../shared/design/model';

const clients = { op: 'table.create', name: 'Clients', fields: [{ name: 'ID', type: 'autoNumber' }, { name: 'Nom', type: 'shortText' }] };
const src = { kind: 'table', name: 'Clients' };
const box = (name: string, ControlSource?: unknown): ControlDef => ({ kind: 'textBox', name, left: 1418, top: 0, width: 2268, height: 340, props: ControlSource === undefined ? {} : { ControlSource } });
const section = (kind: SectionDef['kind'], controls: ControlDef[] = []): SectionDef => ({ kind, height: 1000, props: {}, controls });
const docOf = (controls: ControlDef[], recordSource: unknown = src, kind: SectionDef['kind'] = 'detail'): unknown => ({ formatVersion: '1.0', recordSource, props: {}, sections: [section(kind, controls)] });
const run = async (ops: unknown[]) => { const p = tmp(); newBase(p, '0.3.1'); return { p, r: await applyScript(p, ops as never, CANON) }; };
const read = (p: string, kind: 'form' | 'report', name: string) => { const db = new DatabaseSync(p); registerFunctions(db); try { return getObject(db, kind, name); } finally { db.close(); } };
const message = (r: { ok: boolean }): string => ('message' in r ? String(r.message) : '');

describe('form.create (auto)', () => {
  it('creates an automatic form over a table of the same script, valid when read back', async () => {
    const { p, r } = await run([clients, { op: 'form.create', name: 'FClients', recordSource: src, layout: 'auto' }]);
    expect(r).toEqual({ ok: true, applied: 2, activeContent: false });
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listObjects(db, 'form').map((o) => o.name)).toEqual(['FClients']);
    db.close();
    const doc = read(p, 'form', 'FClients')!.definition as DesignDoc;
    expect(validateDesignDoc(doc)).toEqual([]);
    expect(doc.recordSource).toEqual(src);
    const detail = doc.sections.find((s) => s.kind === 'detail')!;
    expect(detail.controls.filter((c) => c.kind === 'textBox').map((c) => c.props.ControlSource)).toEqual(['ID', 'Nom']);
    expect(detail.controls[1].top).toBeGreaterThan(detail.controls[0].top);
  });
  it('creates an automatic form over a saved query and over a SQL source', async () => {
    const { p, r } = await run([clients, { op: 'query.create', name: 'QC', sql: 'SELECT Nom FROM Clients' },
      { op: 'form.create', name: 'F1', recordSource: { kind: 'query', name: 'QC' }, layout: 'auto', description: 'd' },
      { op: 'form.create', name: 'F2', recordSource: { kind: 'sql', sql: 'SELECT ID FROM Clients' }, layout: 'auto' }]);
    expect(r).toEqual({ ok: true, applied: 4, activeContent: false });
    const detail = (read(p, 'form', 'F1')!.definition as DesignDoc).sections.find((s) => s.kind === 'detail')!;
    expect(detail.controls.filter((c) => c.kind === 'textBox').map((c) => c.props.ControlSource)).toEqual(['Nom']);
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listObjects(db, 'form').find((o) => o.name === 'F1')?.description).toBe('d');
    db.close();
  });
  it('refuses a form over a missing table, file unchanged', async () => {
    const p = tmp(); newBase(p, '0.3.1'); const before = fs.readFileSync(p);
    const r = await applyScript(p, [{ op: 'form.create', name: 'F', recordSource: { kind: 'table', name: 'Nope' }, layout: 'auto' }], CANON);
    expect(r).toMatchObject({ ok: false, index: 0, op: 'form.create', message: 'record source not found: Nope' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
  it('refuses a form over a missing saved query', async () => {
    const { r } = await run([{ op: 'form.create', name: 'F', recordSource: { kind: 'query', name: 'Nope' }, layout: 'auto' }]);
    expect(r).toMatchObject({ ok: false, message: 'record source not found: Nope' });
  });
  it('refuses a SQL source that does not bind, with the error text', async () => {
    const { r } = await run([{ op: 'form.create', name: 'F', recordSource: { kind: 'sql', sql: 'SELECT * FROM Nope' }, layout: 'auto' }]);
    expect(message(r)).toMatch(/^notFound\|unknownSource\|Nope/);
    const bad = (await run([{ op: 'form.create', name: 'F', recordSource: { kind: 'sql', sql: 'SELECT FROM' }, layout: 'auto' }])).r;
    expect(message(bad)).toMatch(/^invalidQuery\|/);
  });
  it('refuses a form whose name is already used by another form, file unchanged after the refusal', async () => {
    const { p, r } = await run([clients,
      { op: 'form.create', name: 'X', recordSource: src, layout: 'auto' },
      { op: 'form.create', name: 'x', recordSource: src, layout: 'auto' }]);
    expect(r).toMatchObject({ ok: false, index: 2, op: 'form.create', message: 'form name already used: x' });
    const db = new DatabaseSync(p); expect(db.prepare("SELECT count(*) AS n FROM bc_objects WHERE kind = 'form'").get()).toEqual({ n: 0 }); db.close();
  });
  it('refuses an invalid name', async () => {
    const { r } = await run([clients, { op: 'form.create', name: '', recordSource: src, layout: 'auto' }]);
    expect(message(r)).toBe('invalid form name: ');
  });
  it('allows a report with the same name as a form', async () => {
    const { r } = await run([clients, { op: 'form.create', name: 'X', recordSource: src, layout: 'auto' }, { op: 'report.create', name: 'X', recordSource: src, layout: 'auto' }]);
    expect(r).toEqual({ ok: true, applied: 3, activeContent: false });
  });
  it('refuses a missing recordSource, a bad shape and a doc with layout auto', async () => {
    expect(message((await run([{ op: 'form.create', name: 'F', layout: 'auto' }])).r)).toMatch(/"recordSource" is required/);
    expect(message((await run([{ op: 'form.create', name: 'F', layout: 'auto', recordSource: 'Clients' }])).r)).toMatch(/"recordSource" must be/);
    expect(message((await run([clients, { op: 'form.create', name: 'F', layout: 'auto', recordSource: src, doc: docOf([]) }])).r)).toMatch(/"doc" is only allowed/);
    expect(message((await run([{ op: 'form.create', name: 'F', layout: 'x' }])).r)).toMatch(/"layout" must be/);
  });
});

describe('report.create (auto)', () => {
  it('creates the instant report (tabular), in English by default and in French on request', async () => {
    const { p, r } = await run([clients,
      { op: 'report.create', name: 'REn', recordSource: src, layout: 'auto' },
      { op: 'report.create', name: 'RFr', recordSource: src, layout: 'auto', lang: 'fr' }]);
    expect(r).toEqual({ ok: true, applied: 3, activeContent: false });
    const text = (n: string) => JSON.stringify(read(p, 'report', n)!.definition);
    expect(validateDesignDoc(read(p, 'report', 'REn')!.definition)).toEqual([]);
    expect(text('REn')).toContain(' of ');
    expect(text('RFr')).toContain(' sur ');
    expect(text('REn')).not.toContain(' sur ');
  });
  it('refuses a lang other than fr or en, and a missing table', async () => {
    expect(message((await run([clients, { op: 'report.create', name: 'R', recordSource: src, layout: 'auto', lang: 'de' }])).r)).toMatch(/"lang" must be/);
    expect(message((await run([{ op: 'report.create', name: 'R', recordSource: { kind: 'table', name: 'Nope' }, layout: 'auto' }])).r)).toBe('record source not found: Nope');
  });
  it('refuses a report name already used', async () => {
    const { r } = await run([clients, { op: 'report.create', name: 'R', recordSource: src, layout: 'auto' }, { op: 'report.create', name: 'r', recordSource: src, layout: 'auto' }]);
    expect(r).toMatchObject({ ok: false, index: 2, message: 'report name already used: r' });
  });
});

describe('explicit documents', () => {
  it('creates a form from a document with a valid ControlSource, an expression and a different case', async () => {
    const { p, r } = await run([clients, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([box('t1', 'Nom'), box('t2', '=Date()'), box('t3', 'nom'), box('t4')]) }]);
    expect(r).toEqual({ ok: true, applied: 2, activeContent: false });
    expect(read(p, 'form', 'F')).not.toBeNull();
  });
  it('a report document also accepts [Field]; a form document does not', async () => {
    const d = docOf([box('t1', '[Nom]')], src, 'pageHeader');
    expect((await run([clients, { op: 'report.create', name: 'R', layout: 'doc', doc: d }])).r).toEqual({ ok: true, applied: 2, activeContent: false });
    const f = docOf([box('t1', '[Nom]')]);
    expect(message((await run([clients, { op: 'form.create', name: 'F', layout: 'doc', doc: f }])).r)).toBe('control t1: ControlSource "[Nom]" is not a field of the record source');
  });
  it('refuses a control whose ControlSource is not a field, naming the control, file unchanged', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    expect(await applyScript(p, [clients], CANON)).toEqual({ ok: true, applied: 1, activeContent: false });
    const before = fs.readFileSync(p);
    const r = await applyScript(p, [{ op: 'form.create', name: 'F', layout: 'doc', doc: docOf([box('Total', 'Inconnu')]) }], CANON);
    expect(r).toMatchObject({ ok: false, index: 0, message: 'control Total: ControlSource "Inconnu" is not a field of the record source' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
  it('checks a control nested in a container', async () => {
    const group: ControlDef = { kind: 'optionGroup', name: 'G', left: 0, top: 0, width: 2000, height: 2000, props: {}, children: [box('inner', 'Nope')] };
    expect(message((await run([clients, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([group]) }])).r)).toMatch(/^control inner: /);
  });
  it('refuses a wrong formatVersion and an unknown section kind with the validator paths, file unchanged', async () => {
    const p = tmp(); newBase(p, '0.3.1'); const before = fs.readFileSync(p);
    const bad = { ...(docOf([]) as object), formatVersion: '2.0' };
    expect(await applyScript(p, [{ op: 'form.create', name: 'F', layout: 'doc', doc: bad }], CANON)).toMatchObject({ ok: false, message: 'design: formatVersion' });
    const kind = { ...(docOf([]) as DesignDoc), sections: [section('nope' as never)] };
    expect(await applyScript(p, [{ op: 'report.create', name: 'R', layout: 'doc', doc: kind }], CANON)).toMatchObject({ ok: false, message: 'design: sections[0].kind' });
    expect(message((await run([{ op: 'form.create', name: 'F', layout: 'doc', doc: { ...bad, formatVersion: '1.0', props: 1, sections: 3 } }])).r)).toBe('design: props; design: sections');
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
  it('refuses a document whose sections do not fit the object kind', async () => {
    expect(message((await run([clients, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([], src, 'pageHeader') }])).r)).toBe('design: sections[0].kind (pageHeader is not a form section)');
    expect(message((await run([clients, { op: 'report.create', name: 'R', layout: 'doc', doc: docOf([], src, 'formHeader') }])).r)).toBe('design: sections[0].kind (formHeader is not a report section)');
  });
  it('refuses the doc and recordSource shapes', async () => {
    expect(message((await run([clients, { op: 'form.create', name: 'F', layout: 'doc', recordSource: src, doc: docOf([]) }])).r)).toBe('"recordSource" goes inside "doc" when layout is "doc"');
    expect(message((await run([clients, { op: 'form.create', name: 'F', layout: 'doc' }])).r)).toBe('"doc" is required when layout is "doc"');
  });
  it('refuses a document over a missing source', async () => {
    expect(message((await run([{ op: 'form.create', name: 'F', layout: 'doc', doc: docOf([], { kind: 'table', name: 'Nope' }) }])).r)).toBe('record source not found: Nope');
  });
  it('accepts an unbound document (recordSource null) but refuses a bound control in it', async () => {
    expect((await run([{ op: 'form.create', name: 'F', layout: 'doc', doc: docOf([box('t1', '=1+1'), box('t2')], null) }])).r).toEqual({ ok: true, applied: 1, activeContent: false });
    expect(message((await run([{ op: 'form.create', name: 'F', layout: 'doc', doc: docOf([box('t1', 'Nom')], null) }])).r)).toMatch(/^control t1: ControlSource "Nom" is not a field/);
  });
  it('a refusal in the middle of a script leaves the file as it was', async () => {
    const p = tmp(); newBase(p, '0.3.1'); const before = fs.readFileSync(p);
    const r = await applyScript(p, [clients, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([box('a', 'Zzz')]) }], CANON);
    expect(r).toMatchObject({ ok: false, index: 1 });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
});

describe('English form labels', () => {
  it('match the en locale the application uses (designer.ctlPrefix, form.tabPage)', async () => {
    for (const [k, v] of Object.entries(en.designer.ctlPrefix)) expect(LABELS.prefix(k as ControlKind)).toBe(v);
    expect(LABELS.tabPage(3)).toBe(en.form.tabPage.replace('{{n}}', '3'));
  });
});
