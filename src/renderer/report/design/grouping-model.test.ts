import { describe, expect, it } from 'vitest';
import type { ControlDef, DesignDoc, SectionDef } from '../../../shared/design/model';
import { FACTURES_FIELDS } from '../../../shared/report/fixtures/factures';
import { readReport } from '../../../shared/report/model';
import { addGroup, addSort, addTotal, moveGroup, orderKind, removeGroup, setGroup } from './grouping-model';
import { blankReport, removesControls, sectionOrder } from './report-sections';

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
