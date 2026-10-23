import { describe, expect, it } from 'vitest';
import { validateDesignDoc, type DesignDoc } from '../../../shared/design/model';
import { effectiveProp } from '../../../shared/design/properties';
import { FACTURES_FIELDS } from '../../../shared/report/fixtures/factures';
import { boundControlWithLabel } from '../../designer/field-controls';
import { i18n } from '../../i18n';
import {
  blankReport, newReportControls, removesControls, reportDesignStates, sectionLabel, sectionOrder, togglePageHeaderFooter, toggleReportHeaderFooter,
} from './report-sections';

const tFr = i18n.getFixedT('fr');
const prefixFr = (k: string) => tFr(`designer.ctlPrefix.${k}`);
const kinds = (d: DesignDoc) => d.sections.map((s) => s.kind);
const withLabelIn = (d: DesignDoc, kind: string): DesignDoc => ({ ...d, sections: d.sections.map((s) => (s.kind !== kind ? s
  : { ...s, controls: [{ kind: 'label', name: 'Titre', left: 0, top: 0, width: 1000, height: 300, props: { Caption: 'Titre' } }] })) });
const withGroup = (expression: string): DesignDoc => {
  const b = blankReport();
  return { ...b, props: { ...b.props, grouping: [{ expression, order: 'asc', header: true, footer: false, keepTogether: 'no' }] },
    sections: sectionOrder({ ...b, sections: [...b.sections, { kind: 'groupHeader', groupLevel: 0, height: 454, props: {}, controls: [] }] }).sections };
};

describe('report sections (band designer)', () => {
  it('a blank report: page header, detail, page footer, no source, no grouping', () => {
    const b = blankReport();
    expect(b.sections.map((s) => [s.kind, s.height])).toEqual([['pageHeader', 454], ['detail', 2268], ['pageFooter', 454]]);
    expect(b.recordSource).toBeNull();
    expect(b.props).toEqual({ grouping: [], Width: 6994 });   // Width stockée (M3) : le défaut du catalogue
    expect(validateDesignDoc(b)).toEqual([]);
  });

  it('toggles the report header/footer pair', () => {
    const d = toggleReportHeaderFooter(blankReport());
    expect(kinds(d)).toEqual(['reportHeader', 'pageHeader', 'detail', 'pageFooter', 'reportFooter']);
    expect(d.sections[0].height).toBe(454);
    expect(kinds(toggleReportHeaderFooter(d))).toEqual(['pageHeader', 'detail', 'pageFooter']);
  });

  it('toggles the page header/footer pair, keeping the canonical order', () => {
    const d = togglePageHeaderFooter(toggleReportHeaderFooter(blankReport()));
    expect(kinds(d)).toEqual(['reportHeader', 'detail', 'reportFooter']);
    expect(kinds(togglePageHeaderFooter(d))).toEqual(['reportHeader', 'pageHeader', 'detail', 'pageFooter', 'reportFooter']);
  });

  it('an edit that drops controls is detected', () => {
    const d = withLabelIn(blankReport(), 'pageHeader');
    expect(removesControls(d, togglePageHeaderFooter(d))).toBe(true);
    expect(removesControls(blankReport(), toggleReportHeaderFooter(blankReport()))).toBe(false);
    expect(removesControls(d, d)).toBe(false);
  });

  it('canonical order: group headers by level, detail, group footers innermost first (Access)', () => {
    const s = (kind: DesignDoc['sections'][number]['kind'], groupLevel?: number) => ({ kind, height: 0, props: {}, controls: [], ...(groupLevel === undefined ? {} : { groupLevel }) });
    const d: DesignDoc = { ...blankReport(), sections: [s('groupFooter', 0), s('pageFooter'), s('detail'), s('groupHeader', 1), s('groupFooter', 1), s('reportHeader'),
      s('groupHeader', 0), s('pageHeader')] };
    expect(sectionOrder(d).sections.map((x) => `${x.kind}${x.groupLevel ?? ''}`))
      .toEqual(['reportHeader', 'pageHeader', 'groupHeader0', 'groupHeader1', 'detail', 'groupFooter1', 'groupFooter0', 'pageFooter']);
  });

  it('labels a group header with its expression', () => {
    expect(sectionLabel({ kind: 'groupHeader', groupLevel: 0, height: 0, props: {}, controls: [] }, withGroup('Client'), tFr)).toBe('En-tête de groupe : Client');
    expect(sectionLabel({ kind: 'detail', height: 0, props: {}, controls: [] }, blankReport(), tFr)).toBe('Détail');
  });

  it('a new text box has an attached label and no written default', () => {
    const c = newReportControls('textBox', { left: 2000, top: 0, width: 1500, height: 300 }, 1, blankReport(), prefixFr);
    expect(c[0].name).toBe('Texte1');
    expect(c[0].props).toEqual({});
    expect(c[0].children?.[0]).toMatchObject({ kind: 'label', name: 'Étiquette1', props: { Caption: expect.any(String) } });
    expect(c[0].children![0].left + c[0].children![0].width).toBeLessThanOrEqual(2000);
    const b = blankReport();
    expect(validateDesignDoc({ ...b, sections: b.sections.map((s, i) => (i === 1 ? { ...s, controls: c } : s)) })).toEqual([]);
  });

  it('a check box carries its label on the right; a label gets its caption; names are unique', () => {
    const b = blankReport();
    const [box] = newReportControls('checkBox', { left: 500, top: 0, width: 284, height: 284 }, 1, b, prefixFr);
    expect(box.children?.[0]).toMatchObject({ kind: 'label' });
    expect(box.children![0].left).toBeGreaterThan(box.left + box.width);
    const [l] = newReportControls('label', { left: 0, top: 0, width: 1418, height: 340 }, 0, b, prefixFr);
    expect(l.props).toEqual({ Caption: 'Étiquette1' });
    const taken = { ...b, sections: b.sections.map((s, i) => (i === 0 ? { ...s, controls: [l] } : s)) };
    expect(newReportControls('label', { left: 0, top: 400, width: 1418, height: 340 }, 0, taken, prefixFr)[0].name).toBe('Étiquette2');
    expect(newReportControls('line', { left: 0, top: 0, width: 1000, height: 0 }, 1, b, prefixFr)[0]).toMatchObject({ kind: 'line', name: 'Trait1', props: {} });
  });

  it('a bound field from the Field List is a borderless report text box (catalog default)', () => {
    const [c] = boundControlWithLabel(blankReport(), FACTURES_FIELDS[1], { section: 1, left: 1418, top: 0 }, { objectKind: 'report', labelSuffix: 'Étiquette' });
    expect(c.props.TabIndex).toBeUndefined();
    expect(effectiveProp(c.props, 'BorderStyle', 'textBox', 'report')).toBe('transparent');
  });
});

describe('pressed states of the Report Design and Page Setup tabs', () => {
  it('Portrait / Landscape from the page setup, Group & Sort from the pane, Hide Details from the Visible of the Detail', () => {
    const b = blankReport();
    expect(reportDesignStates(b, false)).toEqual({ portrait: { active: true }, landscape: { active: false }, groupSort: { active: false }, hideDetails: { active: false } });
    const hidden: DesignDoc = { ...b, props: { ...b.props, pageSetup: { orientation: 'landscape', margins: { top: 567, right: 567, bottom: 567, left: 567 } } },
      sections: b.sections.map((s) => (s.kind === 'detail' ? { ...s, props: { Visible: false } } : s)) };
    expect(reportDesignStates(hidden, true)).toEqual({ portrait: { active: false }, landscape: { active: true }, groupSort: { active: true }, hideDetails: { active: true } });
  });
});
