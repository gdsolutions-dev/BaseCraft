import { describe, expect, it } from 'vitest';
import type { ControlDef, DesignDoc, SectionDef } from '../../../shared/design/model';
import { FACTURES_FIELDS } from '../../../shared/report/fixtures/factures';
import { readReport } from '../../../shared/report/model';
import { addGroup, addSort, addTotal, moveGroup, orderKind, removeGroup, setGroup } from './grouping-model';
import { blankReport, removesControls, sectionOrder } from './report-sections';
import { readLayouts } from '../../../shared/design/layout';
import { instantReport } from '../../../shared/report/instant';
import { createLayout, membersOf } from '../../../shared/design/layout-edit';
import { designerReducer, initDesigner } from '../../designer/designer-model';

const blank = blankReport();
const groupSections = (d: DesignDoc) => d.sections.filter((s) => s.kind === 'groupHeader' || s.kind === 'groupFooter').map((s) => [s.kind, s.groupLevel]);
const groupHeaderOf = (d: DesignDoc, level: number): SectionDef => d.sections.find((s) => s.kind === 'groupHeader' && s.groupLevel === level)!;
const withLabelInGroupHeader = (d: DesignDoc, level: number, name: string): DesignDoc => ({ ...d, sections: d.sections.map((s) => (s !== groupHeaderOf(d, level) ? s
  : { ...s, controls: [{ kind: 'label', name, left: 0, top: 0, width: 1000, height: 300, props: { Caption: name } }] })) });
const controlsWithSource = (d: DesignDoc, source: string): (ControlDef & { section: string })[] =>
  d.sections.flatMap((s) => s.controls.filter((c) => c.props.ControlSource === source).map((c) => ({ ...c, section: s.kind })));
const consistent = (d: DesignDoc) => {
  // the sections the flags ask for, in Access order: headers from level 0 inwards, footers from the innermost level out
  const levels = d.props.grouping as { header: boolean; footer: boolean }[];
  expect(groupSections(d)).toEqual([...levels.flatMap((l, i) => (l.header ? [['groupHeader', i]] : [])),
    ...levels.flatMap((l, i) => (l.footer ? [['groupFooter', i]] : [])).reverse()]);
  expect(sectionOrder(d)).toBe(d);
  expect(readReport(d, FACTURES_FIELDS).issues.filter((i) => i.code === 'groupingInvalid')).toEqual([]);
};

describe('grouping model (Group, Sort and Total pane)', () => {
  it('add group creates header only', () => {
    const d = addGroup(blank, 'Client');
    expect(d.props.grouping).toEqual([{ expression: 'Client', order: 'asc', header: true, footer: false, keepTogether: 'no' }]);
    expect(groupSections(d)).toEqual([['groupHeader', 0]]); expect(groupSections(addSort(blank, 'Date'))).toEqual([]);
    expect(d.sections.find((s) => s.kind === 'groupHeader')!.props).toEqual({});   // catalog defaults (Keep Together…)
    consistent(d);
  });
  it('footer flag adds footer; remove renumbers', () => {
    let d = setGroup(addGroup(addGroup(blank, 'Client'), 'Date'), 0, { footer: true });
    consistent(d);
    expect(groupSections(d)).toEqual([['groupHeader', 0], ['groupHeader', 1], ['groupFooter', 0]]);
    d = removeGroup(d, 0); expect(d.props.grouping).toMatchObject([{ expression: 'Date' }]); expect(groupSections(d)).toEqual([['groupHeader', 0]]);
    consistent(d);
    expect(groupSections(setGroup(d, 0, { header: false }))).toEqual([]);
    expect(setGroup(d, 5, { header: false })).toBe(d);
  });
  it('move keeps sections attached to their level', () => {
    const d = moveGroup(withLabelInGroupHeader(addGroup(addGroup(blank, 'Client'), 'Date'), 0, 'L'), 0, 1);
    expect(d.props.grouping).toMatchObject([{ expression: 'Date' }, { expression: 'Client' }]); expect(groupHeaderOf(d, 1).controls.map((c) => c.name)).toEqual(['L']);
    consistent(d);
    expect(moveGroup(d, 0, 0)).toBe(d);
  });
  it('removing a level with controls is caught by the guard', () =>
    expect(removesControls(withLabelInGroupHeader(addGroup(blank, 'Client'), 0, 'L'), removeGroup(withLabelInGroupHeader(addGroup(blank, 'Client'), 0, 'L'), 0))).toBe(true));
  const MONTANT = FACTURES_FIELDS[4]!;   // Currency
  it('add total in every group footer and the report footer', () => {
    const d = addTotal(setGroup(addGroup(blank, 'Client'), 0, { footer: true }), MONTANT, 'Sum', 3000, 1500);
    expect(controlsWithSource(d, '=Sum([Montant])').map((c) => [c.section, c.left, c.props.Format])).toEqual([['groupFooter', 3000, 'currency'], ['reportFooter', 3000, 'currency']]);
    expect(controlsWithSource(d, '=Sum([Montant])').map((c) => c.name)).toEqual(['Somme_Montant', 'Somme_Montant1']);
    expect(controlsWithSource(d, '=Sum([Montant])')[0]!.props.BorderStyle).toBeUndefined();
    expect(addTotal(d, MONTANT, 'Sum', 3000, 1500)).toEqual(d);
    expect(addTotal(d, MONTANT, 'Sum', 3000, 1500)).toBe(d);   // no empty undo step
    expect(controlsWithSource(addTotal(blank, MONTANT, 'CountRecords', 0, 1500), '=Count(*)')).toHaveLength(1);
    expect(readReport(d, FACTURES_FIELDS).issues).toEqual([]);
    consistent(d);
  });
  it('a count gets no currency format; every total function has its source and prefix', () => {
    const src = (fn: Parameters<typeof addTotal>[2]) => controlsWithSource(addTotal(blank, MONTANT, fn, 0, 1500), fn === 'CountRecords' ? '=Count(*)' : `=${fn}([Montant])`)[0]!;
    expect(src('Count').props.Format).toBeUndefined();
    expect((['Sum', 'Avg', 'CountRecords', 'Count', 'Max', 'Min', 'StDev', 'Var'] as const).map((fn) => src(fn).name))
      .toEqual(['Somme_Montant', 'Moyenne_Montant', 'Nombre_Montant', 'Nombre_Montant', 'Max_Montant', 'Min_Montant', 'EcartType_Montant', 'Var_Montant']);
    const d = addTotal(blank, MONTANT, 'Avg', 0, 1500);
    expect(d.sections.map((s) => s.kind)).toEqual(['reportHeader', 'pageHeader', 'detail', 'pageFooter', 'reportFooter']);
    const footer = d.sections.find((s) => s.kind === 'reportFooter')!;
    expect(footer.height).toBeGreaterThanOrEqual(footer.controls[0]!.top + footer.controls[0]!.height);
  });
  it('the sort order is worded by the field type, as in Access (text, number, date; Yes/No and expressions: plain)', () => {
    expect(['Client', 'N°', 'Montant', 'Date', '[Date]', '=Year([Date])', 'Inconnu'].map((e) => orderKind(e, FACTURES_FIELDS)))
      .toEqual(['text', 'number', 'number', 'date', 'date', null, null]);
    expect(orderKind('Payé', [{ name: 'Payé', type: 'yesNo', props: { type: 'yesNo', required: false, indexed: 'no', primaryKey: false } }])).toBeNull();
  });
  it('a new total goes under the controls already in the footer, never on them', () => {
    const d = addTotal(blank, MONTANT, 'Sum', 3000, 1500);
    const two = addTotal(d, MONTANT, 'Avg', 3000, 1500);
    const footer = two.sections.find((s) => s.kind === 'reportFooter')!;
    const [a, b] = footer.controls;
    expect(b!.top).toBeGreaterThanOrEqual(a!.top + a!.height);
    expect(footer.height).toBeGreaterThanOrEqual(b!.top + b!.height);
  });
});

describe('addTotal in a Tabular layout column', () => {
  const MONTANT = FACTURES_FIELDS[4]!;
  const info = { fields: FACTURES_FIELDS, updatable: true, parameters: [] };
  const grouped = () => setGroup(addGroup(instantReport({ kind: 'table', name: 'Factures' }, info, { lang: 'fr' }), 'Client'), 0, { footer: true });
  const cellOf = (d: DesignDoc, n: string) => { const l = readLayouts(d)[0]!; const c = l.cells.find((x) => x.control === n)!; return [l.rows[c.row]!.section, c.col]; };
  const rowsIn = (d: DesignDoc, sec: string) => readLayouts(d)[0]!.rows.filter((r) => r.section === sec).length;
  it('each footer total joins the column of the member, once per fn', () => {
    const d = addTotal(grouped(), MONTANT, 'Avg', 3000, 1500, 'Montant');
    const avg = controlsWithSource(d, '=Avg([Montant])');
    expect(avg.map((c) => cellOf(d, c.name))).toEqual([['groupFooter:0', 4], ['reportFooter', 4]]);
    expect(avg.every((c) => c.props.LayoutID === readLayouts(d)[0]!.id)).toBe(true);
    expect(addTotal(d, MONTANT, 'Avg', 3000, 1500, 'Montant')).toBe(d);
    const e = addTotal(d, MONTANT, 'Max', 3000, 1500, 'Montant');
    expect([rowsIn(d, 'groupFooter:0'), rowsIn(e, 'groupFooter:0')]).toEqual([1, 2]);
    expect([rowsIn(d, 'reportFooter'), rowsIn(e, 'reportFooter')]).toEqual([2, 3]);
  });
  it('a free member or none: placed as before', () => {
    const d = addTotal(grouped(), MONTANT, 'Avg', 3000, 1500);
    expect(controlsWithSource(d, '=Avg([Montant])').every((c) => !('LayoutID' in c.props))).toBe(true);
    expect(addTotal(blank, MONTANT, 'Sum', 3000, 1500, 'Inconnu')).toEqual(addTotal(blank, MONTANT, 'Sum', 3000, 1500));
  });
});

describe('a layout in a group section follows its group', () => {
  // Région > Ville ; Ville et Code (chacun avec son étiquette) en Empilé dans l'en-tête de groupe Ville
  const field = (name: string, top: number): ControlDef => ({ kind: 'textBox', name, left: 1500, top, width: 2000, height: 300, props: {},
    children: [{ kind: 'label', name: `L${name}`, left: 0, top, width: 1000, height: 300, props: { Caption: `${name}:` } }] });
  const grouped = (): DesignDoc => {
    const d = addGroup(addGroup(blank, 'Région'), 'Ville');
    const g = { ...d, sections: d.sections.map((s) => (s.kind === 'groupHeader' && s.groupLevel === 1 ? { ...s, height: 2000, controls: [field('Ville', 0), field('Code', 500)] } : s)) };
    return createLayout(g, membersOf(g, ['Ville', 'Code']), 'stacked', { headerSection: 'pageHeader' });
  };
  const flat = (d: DesignDoc) => d.sections.flatMap((s) => s.controls.map((c) => [s.kind, s.groupLevel, c.name, c.left, c.top, c.props.LayoutID]));
  it('deleting the outer group keeps the layout, its members and their coordinates (one level up)', () => {
    const d0 = grouped();
    const s = designerReducer(initDesigner(d0, 'report'), { type: 'edit', apply: (d) => removeGroup(d, 0) });
    const [l] = readLayouts(s.doc);
    expect(readLayouts(d0)[0].rows.map((r) => r.section)).toEqual(['groupHeader:1', 'groupHeader:1']);
    expect(l).toEqual({ ...readLayouts(d0)[0], tops: { 'groupHeader:0': readLayouts(d0)[0].tops['groupHeader:1'] },
      rows: readLayouts(d0)[0].rows.map((r) => ({ ...r, section: 'groupHeader:0' })) });
    expect(flat(s.doc)).toEqual(flat(d0).filter((x) => x[0] === 'groupHeader').map((x) => [x[0], 0, ...x.slice(2)]));
  });
  it('swapping the groups moves the layout with its section', () => {
    const d = moveGroup(grouped(), 1, 0);
    expect(readLayouts(d)[0].rows.map((r) => r.section)).toEqual(['groupHeader:0', 'groupHeader:0']);
    expect(Object.keys(readLayouts(d)[0].tops)).toEqual(['groupHeader:0']);
  });
  it('a group section removed takes its layout away', () => {
    const s = designerReducer(initDesigner(grouped(), 'report'), { type: 'edit', apply: (d) => removeGroup(d, 1) });
    expect(readLayouts(s.doc)).toEqual([]);
  });
});
