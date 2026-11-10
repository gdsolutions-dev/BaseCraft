import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { CANON } from '../shared/coerce';
import { getObject, listObjects, saveObject } from '../main/db/objects';
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

describe('shared pictures in form.create / report.create', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const png = (): string => { const f = tmp().replace('x.basecraft', 'logo.png'); fs.writeFileSync(f, PNG); return f; };
  const withPic = (Picture: string): unknown => docOf([{ kind: 'image', name: 'Image1', left: 0, top: 0, width: 1000, height: 1000, props: { PictureType: 'shared', Picture } }], null);
  it('refuses a shared picture that is not in the gallery, naming it', async () => {
    for (const kind of ['form', 'report'] as const) {
      const { r } = await run([{ op: `${kind}.create`, name: 'F', layout: 'doc', doc: withPic('absent') }]);
      expect(r.ok).toBe(false);
      expect(message(r)).toContain('absent');
    }
  });
  it('looks the gallery name up exactly: Picture "logo" is refused when the gallery holds "Logo"', async () => {
    const f = tmp().replace('x.basecraft', 'Logo.png'); fs.writeFileSync(f, PNG);
    const { r } = await run([{ op: 'resource.add', file: f }, { op: 'form.create', name: 'F', layout: 'doc', doc: withPic('logo') }]);
    expect(r.ok).toBe(false);
    expect(message(r)).toContain('logo');
  });
  it('accepts it once resource.add ran before it in the same script', async () => {
    const { p, r } = await run([{ op: 'resource.add', file: png() }, { op: 'form.create', name: 'F', layout: 'doc', doc: withPic('logo') }]);
    expect(r).toMatchObject({ ok: true, applied: 2 });
    expect(read(p, 'form', 'F')).not.toBeNull();
  });
});

describe('chart controls and the charts command', () => {
  const commandes = { op: 'table.create', name: 'Commandes', fields: [{ name: 'ID', type: 'autoNumber' }, { name: 'Client', type: 'shortText' }, { name: 'Montant', type: 'currency' }] };
  const chart = (props: Record<string, unknown>, name = 'g1'): ControlDef => ({ kind: 'chart', name, left: 0, top: 0, width: 4000, height: 3000,
    props: { ChartSource: { kind: 'table', name: 'Commandes' }, ChartAxis: ['client'], ChartValues: [{ field: 'Montant', agg: 'sum' }], ...props } });
  const list = async (p: string) => { const { run: cli } = await import('./main'); const out: string[] = []; const code = await cli(['charts', p], { out: (s) => out.push(s), err: () => {} }); return { code, json: code === 0 ? JSON.parse(out.join('')) : null }; };
  it('creates a form and a report with a chart, lists them (also nested in a tab)', async () => {
    const tab: ControlDef = { kind: 'tabControl', name: 'T', left: 0, top: 0, width: 5000, height: 4000, props: {}, children: [{ kind: 'tabControl', name: 'P', left: 0, top: 0, width: 4000, height: 3000, props: {}, children: [chart({ ChartType: 'pie' }, 'inTab')] }] };
    const { p, r } = await run([commandes,
      { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([chart({}), tab], null) },
      { op: 'report.create', name: 'R', layout: 'doc', doc: docOf([chart({ ChartSource: undefined }, 'g2')], { kind: 'table', name: 'Commandes' }, 'reportHeader') }]);
    expect(message(r)).toBe('');
    const { json } = await list(p);
    expect(json).toEqual([
      { object: { kind: 'form', name: 'F' }, control: 'g1', type: 'columnClustered', source: { kind: 'table', name: 'Commandes' } },
      { object: { kind: 'form', name: 'F' }, control: 'inTab', type: 'pie', source: { kind: 'table', name: 'Commandes' } },
      { object: { kind: 'report', name: 'R' }, control: 'g2', type: 'columnClustered', source: null }]);
  });
  it('F5a : un nuage de points se crée et se liste ; WordCloud et les tailles hors bornes sont refusés en nommant le contrôle', async () => {
    const f = async (props: Record<string, unknown>) => message((await run([commandes, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([chart(props)], null) }])).r);
    const { r, p } = await run([commandes, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([chart({ ChartType: 'scatter', ChartAxis: ['client'], ChartValues: [{ field: 'Montant', agg: 'none' }] }, 'nuage')], null) }]);
    expect(message(r)).toBe('');
    expect((await list(p)).json).toEqual([{ object: { kind: 'form', name: 'F' }, control: 'nuage', type: 'scatter', source: { kind: 'table', name: 'Commandes' } }]);
    expect(await f({ ChartType: 'wordCloud' })).toMatch(/^control g1: ChartType "wordCloud"/);
    expect(await f({ DoughnutHoleSize: 5 })).toMatch(/^control g1: .*DoughnutHoleSize/);
    expect(await f({ BubbleMaxSize: 500 })).toMatch(/^control g1: .*BubbleMaxSize/);
    expect(await f({ ChartType: 'doughnut', DoughnutHoleSize: 60 })).toBe('');
  });
  it('refuses an unknown field, type, agg or a value without a field, naming the control', async () => {
    const f = async (props: Record<string, unknown>) => message((await run([commandes, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([chart(props)], null) }])).r);
    expect(await f({ ChartValues: [{ field: 'Nope', agg: 'sum' }] })).toMatch(/^control g1: .*Nope/);
    expect(await f({ ChartAxis: ['Nope'] })).toMatch(/^control g1: .*Nope/);
    expect(await f({ ChartLegend: 'Nope' })).toMatch(/^control g1: .*Nope/);
    expect(await f({ ChartType: 'weird' })).toMatch(/^control g1: .*weird/);
    expect(await f({ ChartType: 'wordCloud' }), 'wordCloud').toMatch(/^control g1: ChartType "wordCloud" is not one of .*doughnut/);   // Nuage de mots : prévu plus tard
    expect(await f({ ChartType: 'waterfall', WaterfallShowTotal: false, WaterfallIncreaseColor: '#112233' })).toBe('');
    expect(await f({ ChartType: 'waterfall', WaterfallDecreaseColor: 'red' })).toMatch(/^control g1: .*WaterfallDecreaseColor/);
    expect(await f({ ChartType: 'waterfall', WaterfallShowTotal: 'yes' })).toMatch(/^control g1: .*WaterfallShowTotal/);
    expect(await f({ ChartType: 'scatter' })).toBe('');
    expect(await f({ ChartType: 'boxWhisker' })).toBe('');
    expect(await f({ ChartType: 'pareto' })).toBe('');
    expect(await f({ ChartType: 'waterfall' })).toBe('');
    for (const [k, v] of [['ChartBorderStyle', 'wavy'], ['LegendPosition', 'middle'], ['AxisRange', 'wide'], ['AxisUnits', 'lots'], ['ChartBackStyle', 'x'],
      ['TitleFontSize', 'big'], ['AxisFontSize', 2], ['ChartBorderWidth', 9], ['HasSubtitle', 'yes'], ['Subtitle', 3], ['AxisMax', 'x'], ['AxisMin', null], ['TitleFontColor', 'red'], ['ChartBackColor', 'blue'], ['TitleFontName', 5], ['AxisFormat', 1],
      ['AxisSecRange', 'wide'], ['AxisSecUnits', 'lots'], ['AxisSecFontSize', 2], ['AxisSecFontColor', 'red'], ['AxisSecMin', null], ['AxisSecMax', 'x'], ['AxisSecTitle', 3], ['AxisSecFormat', 1]] as const) {
      expect(await f({ [k]: v }), k).toMatch(new RegExp(`^control g1: .*${k}`));
    }
    expect(await f({ AxisRange: 'manual', AxisMin: 0, AxisMax: 100, TitleFontSize: 20, AxisUnits: 'thousands', TitleFontColor: 'theme:accent1' })).toBe('');
    expect(await f({ ChartValues: [{ agg: 'sum' }] })).toMatch(/^control g1: /);
    expect(await f({ ChartValues: [{ field: 'Montant', agg: 'median' }] })).toMatch(/^control g1: .*median/);
    expect(await f({ ChartSource: { kind: 'table', name: 'Absent' } })).toMatch(/Absent/);
  });
  it('uses the document record source when ChartSource is absent, and names auto controls Chart', async () => {
    expect(LABELS.prefix('chart')).toBe('Chart');
    const ok = await run([commandes, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([chart({ ChartSource: undefined })], { kind: 'table', name: 'Commandes' }) }]);
    expect(message(ok.r)).toBe('');
    const bad = await run([clients, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([chart({ ChartSource: undefined })]) }]);
    expect(message(bad.r)).toBe('control g1: field "client" is not a field of the chart source');
  });
  it('refuses over-cap or blank axis/value names, an unknown date group and malformed raw props', async () => {
    const f = async (props: Record<string, unknown>) => message((await run([commandes, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([chart(props)], null) }])).r);
    expect(await f({ ChartAxis: Array(9).fill('client') })).toMatch(/^control g1: .*at most 8/);
    expect(await f({ ChartValues: Array(17).fill({ field: 'Montant', agg: 'sum' }) })).toMatch(/^control g1: .*at most 16/);
    expect(await f({ ChartAxis: ['client', '  '] })).toMatch(/^control g1: .*empty/);
    expect(await f({ ChartAxis: [''] })).toMatch(/^control g1: .*empty/);
    expect(await f({ ChartValues: [{ field: ' ', agg: 'sum' }] })).toMatch(/^control g1: /);
    expect(await f({ ChartDateGroup: 'week' })).toMatch(/^control g1: .*week/);
    expect(await f({ ChartAxis: 'client' })).toMatch(/^control g1: .*ChartAxis/);
    expect(await f({ ChartValues: 'x' })).toMatch(/^control g1: .*ChartValues/);
    expect(await f({ ChartLegend: 3 })).toMatch(/^control g1: .*ChartLegend/);
    expect(await f({ ChartSource: { kind: 'table' } })).toMatch(/^control g1: .*ChartSource/);
    expect(await f({ ChartSource: null })).toMatch(/^control g1: .*ChartSource/);
    expect(await f({ ChartValues: [{ field: 'Montant', agg: null }] })).toMatch(/^control g1: .*agg/);
    const v = { ChartValues: [{ field: 'Montant', agg: 'sum' }] };
    expect(await f({ ...v, ChartSeries: 'x' })).toMatch(/^control g1: .*ChartSeries must be an array/);
    expect(await f({ ...v, ChartSeries: Array(17).fill({ field: 'Montant' }) })).toMatch(/^control g1: .*at most 16/);
    expect(await f({ ...v, ChartSeries: [{ field: 'Nope' }] })).toMatch(/^control g1: ChartSeries\[0\]/);
    expect(await f({ ...v, ChartSeries: [{ field: 'Montant', type: 'pie' }] })).toMatch(/^control g1: .*type "pie"/);
    expect(await f({ ...v, ChartSeries: [{ field: 'Montant', secondary: 'yes' }] })).toMatch(/^control g1: .*secondary/);
    expect(await f({ ...v, ChartSeries: [{ field: 'Montant', color: 'red' }] })).toMatch(/^control g1: .*color/);
    expect(await f({ ...v, ChartSeries: [{ field: 'Montant', type: 'line', secondary: true, color: '#ff0000' }] })).not.toMatch(/ChartSeries/);
    for (const bad of [{ dataLabels: 'yes' }, { borderColor: 'red' }, { trendline: 'cubic' }, { trendlineName: 3 }, { lineWidth: 11 }, { lineWidth: 'x' }, { dash: 'wavy' }, { marker: 1 }, { gap: 'jump' }]) {
      expect(await f({ ...v, ChartSeries: [{ field: 'Montant', ...bad }] }), JSON.stringify(bad)).toMatch(/^control g1: ChartSeries\[0\] /);
    }
    const good = { dataLabels: true, borderColor: 'theme:accent2', trendline: 'power', trendlineName: 'T', lineWidth: 2.5, dash: 'dotted', marker: false, gap: 'zero' };
    expect(await f({ ...v, ChartSeries: [{ field: 'Montant', ...good }] })).not.toMatch(/ChartSeries/);
  });
  it('accepts LinkMasterFields and LinkChildFields on a chart like on a subform', async () => {
    const f = async (props: Record<string, unknown>) => message((await run([commandes, { op: 'form.create', name: 'F', layout: 'doc', doc: docOf([chart(props)], null) }])).r);
    expect(await f({ LinkMasterFields: 'ID', LinkChildFields: 'Client' })).not.toMatch(/Link/);
  });
  it('lists charts of a read-only file and skips corrupt objects', async () => {
    const { p } = await run([commandes, { op: 'form.create', name: 'Good', layout: 'doc', doc: docOf([chart({})], null) }]);
    const db = new DatabaseSync(p); registerFunctions(db);
    saveObject(db, 'form', 'Bad', { sections: [{ kind: 'detail', controls: [null, 3] }] } as never, null);
    db.close();
    fs.chmodSync(p, 0o444);
    const { code, json } = await list(p);
    expect(code).toBe(0);
    expect(json).toEqual([{ object: { kind: 'form', name: 'Good' }, control: 'g1', type: 'columnClustered', source: { kind: 'table', name: 'Commandes' } }]);
  });
});
