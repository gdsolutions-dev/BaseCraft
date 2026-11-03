import { describe, expect, it } from 'vitest';
import { readLayouts, reflow } from '../design/layout';
import { validateDesignDoc, type DesignDoc } from '../design/model';
import { defaultProps } from '../field-types';
import type { SourceInfo } from '../record-source';
import { FACTURES_FIELDS } from './fixtures/factures';
import { instantReport, uniqueReportName } from './instant';
import { layoutReport } from './layout';
import { pageGeometry, readReport, type PageSetup } from './model';
import type { LayoutEnv } from './types';

const src = { kind: 'table', name: 'Factures' } as const, info: SourceInfo = { fields: FACTURES_FIELDS, updatable: true, parameters: [] };
const longTexts = (n: number): SourceInfo => ({ updatable: true, parameters: [],
  fields: Array.from({ length: n }, (_, i) => ({ name: `Note${i}`, type: 'longText' as const, props: defaultProps('longText') })) });
const footer = (d: DesignDoc) => d.sections[3]!.controls[0]!.props.ControlSource;

describe('instantReport', () => {
  it('stores the options margins in a new report (O3 R9)', () => {
    const M = { top: 360, right: 360, bottom: 360, left: 1134 };
    expect(readReport(instantReport(src, info, { lang: 'fr', margins: M }), []).page.margins).toEqual(M);
  });
  it('builds a tabular report', () => {
    const d = instantReport(src, info, { lang: 'fr' });
    expect(d.sections.map((s) => s.kind)).toEqual(['reportHeader', 'pageHeader', 'detail', 'pageFooter', 'reportFooter']);
    expect(d.sections.map((s) => s.height)).toEqual([1134, 454, 340, 454, 454]);
    expect(d.recordSource).toEqual({ kind: 'table', name: 'Factures' });
    expect(d.props).toMatchObject({ grouping: [], pageSetup: { orientation: 'portrait' } });
    expect(d.sections[0]!.controls[0]).toMatchObject({ kind: 'label', name: 'Titre', props: { Caption: 'Factures', FontSize: 18, FontWeight: 'bold' } });
    expect(d.sections[1]!.controls.map((c) => c.props.Caption)).toEqual(['N°', 'Client', 'Date', 'Libellé', 'Montant']);
    expect(d.sections[2]!.controls.map((c) => c.props.ControlSource)).toEqual(['N°', 'Client', 'Date', 'Libellé', 'Montant']);
    expect(d.sections[2]!.controls.map((c) => c.width)).toEqual([851, 2268, 1701, 2268, 1701]);
    expect(d.sections[2]!.controls.map((c) => c.left)).toEqual([0, 908, 3233, 4991, 7316]);
    expect(d.props.Width).toBe(9017);
    expect(d.sections[4]!.controls.map((c) => c.props.ControlSource)).toEqual(['=Count(*)', '=Sum([Montant])']);
    expect(d.sections[4]!.controls.map((c) => c.left)).toEqual([0, 7316]);
    expect(footer(d)).toBe('="Page " & [Page] & " sur " & [Pages]');
    expect(d.sections[3]!.controls[0]!.props.TextAlign).toBe('right');
    expect(d.sections[2]!.controls[0]!.props.BorderStyle).toBeUndefined();
    const spec = readReport(d, FACTURES_FIELDS);
    expect(spec.detail!.controls[0]!.border).toBeNull();   // C5 report default
    expect(validateDesignDoc(d)).toEqual([]); expect(spec.issues).toEqual([]);
  });

  it('caption, small text, long text grows, control names stay unique', () => {
    const fields = [
      { name: 'Titre', type: 'shortText' as const, props: { ...defaultProps('shortText'), size: 10, caption: 'Intitulé' } },
      { name: 'Étiquette_Titre', type: 'longText' as const, props: defaultProps('longText') },
    ];
    const d = instantReport({ kind: 'query', name: 'Q' }, { fields, updatable: false, parameters: [] }, { lang: 'en' });
    expect(d.sections[1]!.controls.map((c) => c.props.Caption)).toEqual(['Intitulé', 'Étiquette_Titre']);
    expect(d.sections[2]!.controls.map((c) => c.width)).toEqual([1134, 3402]);
    expect(d.sections[2]!.props.CanGrow).toBe(true);
    expect(d.sections[2]!.controls.map((c) => c.props.CanGrow)).toEqual([undefined, true]);
    expect(validateDesignDoc(d)).toEqual([]); expect(readReport(d, fields).issues).toEqual([]);
  });

  it('wide source goes landscape then scales', () => {
    expect(instantReport(src, longTexts(4), { lang: 'fr' }).props.pageSetup).toMatchObject({ orientation: 'landscape' });   // 4 × 3402 + 3 × 57 > 10772
    expect(instantReport(src, longTexts(3), { lang: 'fr' }).props.pageSetup).toMatchObject({ orientation: 'portrait' });
    const d = instantReport(src, longTexts(12), { lang: 'fr' }); expect(d.props.pageSetup).toMatchObject({ orientation: 'landscape' });
    expect(d.sections[2]!.controls.every((c) => c.width >= 567 && c.width < 3402)).toBe(true);
    expect(d.props.Width).toBeLessThanOrEqual(15704);
    expect(readReport(d, longTexts(12).fields).issues).toEqual([]);
    const clipped = instantReport(src, longTexts(30), { lang: 'fr' });   // 30 × 567 + 29 × 57 > 15704: clipped
    expect(clipped.sections[2]!.controls.every((c) => c.width === 567)).toBe(true);
    expect(readReport(clipped, longTexts(30).fields).issues).toEqual([{ code: 'widthExceedsPage' }]);
  });

  it('date and time in the report header, right-aligned beside the title (as Access)', () => {
    const d = instantReport(src, info, { lang: 'fr' }), [title, date, time] = d.sections[0]!.controls;
    expect(d.sections[0]!.controls.map((c) => [c.kind, c.props.ControlSource, c.props.Format, c.props.TextAlign]))
      .toEqual([['label', undefined, undefined, undefined], ['textBox', '=Date()', 'longDate', 'right'], ['textBox', '=Time()', 'longTime', 'right']]);
    expect(date!.left + date!.width).toBe(d.props.Width); expect(time!.left + time!.width).toBe(d.props.Width);
    expect(title!.left + title!.width).toBeLessThan(date!.left);
    expect(time!.top).toBeGreaterThanOrEqual(date!.top + date!.height); expect(time!.top + time!.height).toBeLessThanOrEqual(1134);
    expect(readReport(d, FACTURES_FIELDS).issues).toEqual([]);
  });

  it('labels of number, currency, date and AutoNumber columns are right-aligned, others are left unwritten', () => {
    const d = instantReport(src, info, { lang: 'fr' });
    expect(d.sections[1]!.controls.map((c) => c.props.TextAlign)).toEqual(['right', undefined, 'right', undefined, 'right']);
    const n = instantReport(src, { ...info, fields: [{ name: 'Qté', type: 'number', props: defaultProps('number') }] }, { lang: 'fr' });
    expect(n.sections[1]!.controls[0]!.props.TextAlign).toBe('right');
  });

  it('a Yes/No field is a check box bound to the field', () => {
    const fields = [{ name: 'Payé', type: 'yesNo' as const, props: defaultProps('yesNo') }, ...FACTURES_FIELDS];
    const d = instantReport(src, { ...info, fields }, { lang: 'fr' });
    expect(d.sections[2]!.controls[0]).toMatchObject({ kind: 'checkBox', props: { ControlSource: 'Payé' }, width: 851 });
    expect(d.sections[2]!.controls.slice(1).every((c) => c.kind === 'textBox')).toBe(true);
    expect(validateDesignDoc(d)).toEqual([]); expect(readReport(d, fields).issues).toEqual([]);
  });

  it('a Currency first column: its Sum takes the footer cell, Count is dropped', () => {
    const fields = [FACTURES_FIELDS[4]!, FACTURES_FIELDS[1]!];
    const d = instantReport(src, { ...info, fields }, { lang: 'fr' });
    expect(d.sections[4]!.controls.map((c) => [c.left, c.props.ControlSource])).toEqual([[0, '=Sum([Montant])']]);
  });

  it('is one Tabular layout: labels in the Page Header, boxes in the Detail, totals stay free in the Report Footer', () => {
    const d = instantReport(src, info, { lang: 'fr' }), ls = readLayouts(d);
    expect(ls).toHaveLength(1); expect(ls[0]).toMatchObject({ kind: 'tabular', rows: [{ section: 'pageHeader' }, { section: 'detail' }] });
    const names = ls[0]!.cells.flatMap((c) => (c.control ? [c.control] : [])).sort();
    expect(names).toEqual([...d.sections[1]!.controls, ...d.sections[2]!.controls].map((c) => c.name).sort());
    expect(reflow(d)).toBe(d);
    expect(d.sections[4]!.controls.every((c) => !('LayoutID' in c.props))).toBe(true);
    expect(d.sections[1]!.controls.map((c) => c.left)).toEqual(d.sections[2]!.controls.map((c) => c.left));
  });

  it('no field: no layout, no crash', () => {
    const d = instantReport(src, { ...info, fields: [] }, { lang: 'fr' });
    expect(readLayouts(d)).toEqual([]); expect(validateDesignDoc(d)).toEqual([]);
  });

  it('every item stays inside the printable width once laid out (layoutReport on a fixed dataset)', async () => {
    const env: LayoutEnv = { locale: 'fr-FR', lang: 'fr', now: () => new Date(Date.UTC(2026, 9, 22)), errorText: { error: '#Erreur', name: '#Nom?' } };
    for (const [i, inf] of [info, longTexts(4), longTexts(12)].entries()) {
      const d = instantReport(src, inf, { lang: 'fr' });
      const rows = Array.from({ length: 3 }, (_, k) => inf.fields.map((f) => (f.type === 'longText' ? 'x'.repeat(40 * (k + 1)) : k)));
      const out = await layoutReport(readReport(d, inf.fields), { fields: inf.fields, rows }, env);
      const printable = pageGeometry(d.props.pageSetup as PageSetup).printableWidth;
      const items = out.pages.flatMap((p) => p.bands.flatMap((b) => b.items));
      expect(items.length, `case ${i}`).toBeGreaterThan(0);
      for (const it of items) if (it.kind !== 'line') expect(it.left + it.width, `case ${i} ${it.name}`).toBeLessThanOrEqual(printable);
    }
  });

  it('english footer', () => expect(footer(instantReport(src, info, { lang: 'en' }))).toBe('="Page " & [Page] & " of " & [Pages]'));
});

describe('uniqueReportName', () => {
  it('unique name', () => expect(uniqueReportName(['factures', 'Factures1'], 'Factures')).toBe('Factures2'));
  it('free base', () => expect(uniqueReportName(['Autre'], 'Factures')).toBe('Factures'));
  it('stays within 64 characters', () => {
    const base = 'x'.repeat(64);
    expect(uniqueReportName([base], base)).toBe('x'.repeat(63) + '1');
  });
});
