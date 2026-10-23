// Définition normalisée d'un état : lecture du DesignDoc par le catalogue (contrat 1.3, 1.4, 1.5, C5).
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SETUP, pageGeometry, readReport, reportWidth, type GroupLevel } from './model';
import { readProp } from './props';
import { LIGHT_THEME_HEX, resolveColor, type ColorValue } from '../design/colors';
import type { ControlDef, DesignDoc, SectionDef, SectionKind } from '../design/model';
import { defaultFor, PROPERTY_CATALOG, type PropertyTarget } from '../design/properties';
import { defaultProps, MAX_TWIPS, type FieldType } from '../field-types';
import type { SourceField } from '../record-source';

const sf = (name: string, type: FieldType): SourceField => ({ name, type, props: defaultProps(type) });
const fields = [sf('Client', 'shortText'), sf('Montant', 'currency')];
const def = (name: string, target: PropertyTarget) => defaultFor(PROPERTY_CATALOG.find((d) => d.name === name)!, target, 'report');

const g = (expression: string, o: Partial<GroupLevel> = {}): GroupLevel =>
  ({ expression, order: 'asc', header: true, footer: true, keepTogether: 'no', ...o });
const GEOMETRY = ['left', 'top', 'width', 'height'];
/** A control: `o` mixes geometry (left, top, width, height) and properties (FontName…). */
const ctl = (kind: ControlDef['kind'], name: string, o: Record<string, unknown> = {}): ControlDef => ({
  kind, name, left: 0, top: 0, width: 1000, height: 300,
  ...Object.fromEntries(Object.entries(o).filter(([k]) => GEOMETRY.includes(k))),
  props: Object.fromEntries(Object.entries(o).filter(([k]) => !GEOMETRY.includes(k))),
});
const tb = (name: string, src: string, o: Record<string, unknown> = {}) => ctl('textBox', name, { ControlSource: src, ...o });
const sec = (kind: SectionKind, groupLevel?: number, controls: ControlDef[] = [tb(`${kind}${groupLevel ?? ''}`, '[Client]')],
  props: Record<string, unknown> = {}): SectionDef => ({ kind, height: 300, props, controls, ...(groupLevel === undefined ? {} : { groupLevel }) });
const doc = (o: { grouping?: unknown; sections?: SectionDef[]; props?: Record<string, unknown> }): DesignDoc =>
  ({ formatVersion: '1.0', recordSource: null, props: { ...(o.grouping === undefined ? {} : { grouping: o.grouping }), ...o.props }, sections: o.sections ?? [] });

describe('readReport (brief)', () => {
  it('orders sections and reads catalog defaults', () => {
    const s = readReport(doc({ grouping: [g('Client')], sections: [sec('detail'), sec('groupFooter', 0), sec('reportHeader'), sec('groupHeader', 0)] }), fields);
    expect(s.reportHeader?.kind).toBe('reportHeader'); expect(s.groupHeaders[0]?.keepTogether).toBe(def('KeepTogether', 'groupHeader')); expect(s.detail?.keepTogether).toBe(def('KeepTogether', 'detail'));
    expect(s.detail?.controls[0]!.font).toEqual({ name: def('FontName', 'textBox'), size: def('FontSize', 'textBox'), bold: false, italic: false, underline: false });
    expect(s.page).toEqual(DEFAULT_PAGE_SETUP); expect(s.issues).toEqual([]);
  });
  it('expressions, aggregates, page refs', () => {
    const s = readReport(doc({ sections: [sec('pageFooter', undefined, [tb('P', '="Page " & [Page] & " sur " & [Pages]')]), sec('reportFooter', undefined, [tb('T', '=Sum([Montant])')])] }), fields);
    expect(s.pageFooter?.controls[0]!.source).toMatchObject({ kind: 'expr', usesPage: true, usesPages: true });
    expect(s.reportFooter?.controls[0]!.source).toMatchObject({ kind: 'expr', aggs: [{ fn: 'Sum' }] });
  });
  it('issues, never throws', () => {
    const s = readReport(doc({ sections: [sec('detail', undefined, [tb('A', '[Inconnu]'), tb('B', '=1 +'), { ...tb('C', '[Client]'), kind: 'subform' }, tb('D', '[Client]', { FontName: 'Comic Sans MS' }), tb('E', '[Client]', { FontName: 'Arial' })]),
      sec('pageHeader', undefined, [tb('F', '=Sum([Montant])')]), sec('reportFooter', undefined, [tb('G', '[Client]', { FontName: 'Comic Sans MS' })])], grouping: [g('=Left(')] }), fields);
    expect(s.issues.map((i) => i.code).sort()).toEqual(['aggregateNotAllowed', 'fontNotPortable', 'groupingInvalid', 'invalidExpression', 'unknownField', 'unsupportedControl']);   // Arial : alias, portable ; Comic Sans MS (D, G) : une seule fois
    expect(() => readReport({ formatVersion: '1.0', recordSource: null, props: { grouping: 'x', pageSetup: 3 }, sections: [{ kind: 'detail' } as never] }, fields)).not.toThrow();
  });
  it('page geometry', () => {
    expect(pageGeometry(DEFAULT_PAGE_SETUP)).toEqual({ width: 11906, height: 16838, bodyLeft: 567, bodyTop: 567, printableWidth: 10772, printableHeight: 15704 });
    expect(pageGeometry({ ...DEFAULT_PAGE_SETUP, orientation: 'landscape' }).printableWidth).toBe(15704);
  });
  it('theme colours resolve in light', () => {
    const s = readReport(doc({ sections: [sec('detail', undefined, [tb('A', '[Client]', { ForeColor: 'theme:text' }), tb('B', '[Client]', { ForeColor: '#1A2B3C' })])] }), fields);
    expect(s.detail!.controls[0]!.color).toBe(LIGHT_THEME_HEX.text);
    expect(s.detail!.controls[1]!.color).toBe(resolveColor(def('ForeColor', 'textBox') as ColorValue, 'light'));   // majuscules invalides -> défaut du descripteur
  });
  it('border and back', () => {
    const c = readReport(doc({ sections: [sec('detail', undefined, [tb('A', '[Client]', { BorderStyle: 'dashed', BorderWidth: 2, BorderColor: 'theme:accent', BackStyle: 'transparent' }), tb('B', '[Client]', { BorderStyle: 'solid', BorderWidth: 0 })])] }), fields).detail!.controls;
    expect(c[0]!.border).toEqual({ width: 30, style: 'dashed', color: LIGHT_THEME_HEX.accent }); expect(c[0]!.back).toBeNull(); expect(c[1]!.border?.width).toBe(15);
  });
  it('width', () => {
    expect(readReport(doc({ props: { Width: 9000 } }), fields).width).toBe(9000);
    expect(readReport(doc({ sections: [sec('detail', undefined, [tb('A', '[Client]', { left: 1000, width: 2000 })])] }), fields).width).toBe(3000);
    const wide = { ...tb('A', '[Client]', { left: 1000, width: 2000 }), children: [ctl('label', 'A_Label', { left: 2500, width: 1500 })] };   // l'enfant dépasse son parent
    expect(readReport(doc({ sections: [sec('detail', undefined, [wide])] }), fields).width).toBe(4000);
  });
});

describe('readProp', () => {
  it('keeps a valid value, otherwise the report default of the target', () => {
    expect(readProp({ FontSize: 12 }, 'FontSize', 'label')).toBe(12);
    expect(readProp({ FontSize: 100 }, 'FontSize', 'label')).toBe(def('FontSize', 'label'));   // max 72
    expect(readProp({ FontSize: '12' }, 'FontSize', 'label')).toBe(def('FontSize', 'label'));
    expect(readProp({ BorderStyle: 'wavy' }, 'BorderStyle', 'textBox')).toBe('transparent');   // report:textBox
    expect(readProp({}, 'BackColor', 'detail')).toBe('#ffffff');                              // report:detail
    expect(readProp({ FontName: '' }, 'FontName', 'label')).toBe(def('FontName', 'label'));
  });
  it('a property that does not apply to the target takes its default', () => {
    expect(readProp({ CanGrow: true }, 'CanGrow', 'pageHeader')).toBe(false);
    expect(readProp({ RepeatSection: true }, 'RepeatSection', 'detail')).toBe(false);
    expect(readProp({ ControlSource: '[Client]' }, 'ControlSource', 'label')).toBe('');
  });
  it('a name absent from the catalog is read raw, else the fallback', () => {
    expect(readProp({ SizeMode: 'clip' }, 'SizeMode', 'image', 'zoom')).toBe('clip');
    expect(readProp({}, 'SizeMode', 'image', 'zoom')).toBe('zoom');
  });
});

describe('readReport', () => {
  const one = (c: ControlDef, kind: SectionKind = 'detail') => readReport(doc({ sections: [sec(kind, undefined, [c])] }), fields);

  it('reads every control property through the catalog', () => {
    const c = one(tb('A', 'Client', { FontName: 'Caladea', FontSize: 12, FontWeight: 'bold', FontItalic: true, TextAlign: 'center',
      Format: 'currency', DecimalPlaces: '2', Visible: false, CanGrow: true, BackStyle: 'normal', BackColor: 'theme:accent' })).detail!.controls[0]!;
    expect(c).toMatchObject({ kind: 'textBox', name: 'A', left: 0, top: 0, width: 1000, height: 300, source: { kind: 'field', name: 'Client' },
      font: { name: 'Caladea', size: 12, bold: true, italic: true, underline: false }, align: 'center', format: 'currency', decimalPlaces: 2,
      visible: false, canGrow: true, canShrink: false, back: LIGHT_THEME_HEX.accent, border: null });
    expect(one(tb('B', '[Client]')).detail!.controls[0]).toMatchObject({ decimalPlaces: 'auto', back: null, align: 'general' });
    expect(one(tb('B', '[Client]')).detail!.controls[0]!.format).toBeUndefined();
    expect(one(ctl('label', 'L', { Caption: 'Titre' })).detail!.controls[0]).toMatchObject({ caption: 'Titre', source: { kind: 'none' }, back: null, border: null });
  });
  it('reads section properties, page sections never grow', () => {
    const s = readReport(doc({ grouping: [g('Client')], sections: [sec('groupHeader', 0, [], { RepeatSection: true, ForceNewPage: 'before', BackColor: '#eeeeee' }),
      sec('pageHeader', undefined, [], { CanGrow: true, Visible: false })] }), fields);
    expect(s.groupHeaders[0]).toMatchObject({ kind: 'groupHeader', groupLevel: 0, height: 300, repeatSection: true, forceNewPage: 'before', back: '#eeeeee', keepTogether: true });
    expect(s.pageHeader).toMatchObject({ canGrow: false, visible: false, back: '#ffffff', keepTogether: false });
  });
  it('a duplicate or misplaced section is ignored with sectionIgnored, naming its kind (M2)', () => {
    const s = readReport(doc({ grouping: [g('Client', { footer: false })], sections: [sec('detail', undefined, [tb('X', '[Client]')]), sec('detail', undefined, [tb('Y', '[Client]')]),
      sec('groupHeader', 1), sec('groupFooter', 0), sec('formHeader'), sec('groupHeader', 0), sec('groupHeader', 0)] }), fields);
    expect(s.detail!.controls[0]!.name).toBe('X');
    expect(s.groupHeaders).toHaveLength(1); expect(s.groupHeaders[0]?.kind).toBe('groupHeader');
    expect(s.groupFooters).toEqual([undefined]);   // footer: false
    expect(s.issues).toEqual(['detail', 'groupHeader', 'groupFooter', 'formHeader'].map((detail) => ({ code: 'sectionIgnored', detail })));   // jamais « groupHeader:1 »
  });
  it('grouping: keys parsed like control sources, wrong shapes ignored', () => {
    const s = readReport(doc({ grouping: [g('[Client]', { order: 'desc' }), g('=Left([Client], 1)'), g('=Sum([Montant])')] }), fields);
    expect(s.grouping.map((l) => l.key.kind)).toEqual(['field', 'expr', 'error']);
    expect(s.grouping[0]).toMatchObject({ expression: '[Client]', order: 'desc', header: true, footer: true, keepTogether: 'no', key: { name: 'Client' } });
    expect(s.issues.map((i) => i.code)).toEqual(['groupingInvalid']);
    for (const bad of ['x', [{ ...g('Client'), order: 'up' }], [g('Client'), null]]) {
      const r = readReport(doc({ grouping: bad, sections: [sec('groupHeader', 0)] }), fields);
      expect(r.grouping).toEqual([]); expect(r.groupHeaders).toEqual([]); expect(r.issues).toEqual([{ code: 'groupingMalformed' }, { code: 'sectionIgnored', detail: 'groupHeader' }]);
    }
  });
  it('an invalid expression or a page-section aggregate gives an error source (#Erreur), unbound stays none', () => {
    expect(one(tb('A', '=1 +')).detail!.controls[0]!.source).toEqual({ kind: 'error' });
    expect(one(tb('A', '=Max(1 + Count(*))')).issues).toEqual([{ code: 'invalidExpression', control: 'A', detail: '=Max(1 + Count(*))' }]);
    const p = one(tb('P', '=[Page] + Count(*)'), 'pageFooter');
    expect(p.pageFooter!.controls[0]!.source).toEqual({ kind: 'error' });
    expect(p.issues).toEqual([{ code: 'aggregateNotAllowed', control: 'P', detail: '=[Page] + Count(*)' }]);
    expect(one(tb('U', '')).detail!.controls[0]!.source).toEqual({ kind: 'none' });
  });
  it('unknown fields inside expressions, once per name; Page and Pages are fields when the source has them', () => {
    expect(one(tb('A', '=[X] + Sum([X]) + [Page]')).issues).toEqual([{ code: 'unknownField', control: 'A', detail: 'X' }]);
    const s = readReport(doc({ sections: [sec('detail', undefined, [tb('P', '=[page] & [Pages]')])] }), [...fields, sf('Page', 'shortText')]);
    expect(s.detail!.controls[0]!.source).toMatchObject({ usesPage: false, usesPages: true }); expect(s.issues).toEqual([]);
  });
  it('flattens children after their parent; controls that are not drawn are dropped with their children', () => {
    const withLabel = { ...tb('A', '[Client]'), children: [{ ...ctl('label', 'A_Label', { left: 50 }), children: [ctl('label', 'Deep')] }] };
    const group = { ...ctl('optionGroup', 'G'), children: [ctl('optionButton', 'O')] };
    const tabs = { ...ctl('tabControl', 'T'), children: [ctl('textBox', 'T_Box')] };
    const s = readReport(doc({ sections: [sec('detail', undefined, [withLabel, group, ctl('commandButton', 'B'), ctl('listBox', 'LB'), tabs, ctl('comboBox', 'K'), ctl('subform', 'S'), tb('Z', '[Client]')])] }), fields);
    expect(s.detail!.controls.map((c) => c.name)).toEqual(['A', 'A_Label', 'Deep', 'K', 'S', 'Z']);
    expect(s.detail!.controls[1]!.left).toBe(50);
    expect(s.issues).toEqual([['G', 'optionGroup'], ['B', 'commandButton'], ['LB', 'listBox'], ['T', 'tabControl'], ['S', 'subform']]
      .map(([control, detail]) => ({ code: 'unsupportedControl', control, detail })));
  });
  it('page setup is read, or the default when invalid', () => {
    const page = { orientation: 'landscape', margins: { top: 0, right: 1134, bottom: 5670, left: 284 } };
    expect(readReport(doc({ props: { pageSetup: page } }), fields).page).toEqual(page);
    for (const bad of [{ ...page, orientation: 'tall' }, { ...page, margins: { ...page.margins, left: 5671 } }, { ...page, margins: { ...page.margins, top: 1.5 } }, { orientation: 'portrait' }])
      expect(readReport(doc({ props: { pageSetup: bad } }), fields).page).toEqual(DEFAULT_PAGE_SETUP);
  });
  it('width beyond the printable width is reported', () => {
    expect(readReport(doc({ props: { Width: 10772 } }), fields).issues).toEqual([]);
    expect(readReport(doc({ props: { Width: 10773 } }), fields).issues).toEqual([{ code: 'widthExceedsPage' }]);
    expect(readReport(doc({ props: { Width: 10773, pageSetup: { orientation: 'landscape', margins: DEFAULT_PAGE_SETUP.margins } } }), fields).issues).toEqual([]);
    expect(readReport(doc({ props: { Width: 'wide' }, sections: [sec('detail', undefined, [tb('A', '[Client]', { left: 500 })])] }), fields).width).toBe(1500);
  });
  it('image and line properties not in the catalog yet are read raw with safe fallbacks', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(one(ctl('image', 'I', { Picture: png, SizeMode: 'stretch' })).detail!.controls[0]).toMatchObject({ picture: png, sizeMode: 'stretch' });
    const bad = one(ctl('image', 'I', { Picture: 'https://example.com/x.png', SizeMode: 'tile' })).detail!.controls[0]!;
    expect(bad.picture).toBeUndefined(); expect(bad.sizeMode).toBe('zoom');
    expect(one(ctl('line', 'L', { LineSlant: true })).detail!.controls[0]!.slant).toBe(true);
    expect(one(ctl('line', 'L')).detail!.controls[0]!.slant).toBe(false);
  });
});

describe('readReport (Task 5 carry-overs)', () => {
  it('an empty group expression is groupingMalformed, one using Page or Pages groupingInvalid, both with an error key', () => {
    const s = readReport(doc({ grouping: [g(''), g('=[Page]'), g('="x" & [Pages]'), g('Client')] }), fields);
    expect(s.grouping.map((l) => l.key.kind)).toEqual(['error', 'error', 'error', 'field']);
    expect(s.issues).toEqual([{ code: 'groupingMalformed' }, { code: 'groupingInvalid', detail: '=[Page]' }, { code: 'groupingInvalid', detail: '="x" & [Pages]' }]);
    // a real field named Page is an ordinary key
    expect(readReport(doc({ grouping: [g('=[Page]')] }), [...fields, sf('Page', 'shortText')]).issues).toEqual([]);
  });
  it('Page and Pages resolve only outside aggregates', () =>
    expect(readReport(doc({ sections: [sec('reportFooter', undefined, [tb('T', '=Sum([Page]) + [Pages]')])] }), fields).issues)
      .toEqual([{ code: 'unknownField', control: 'T', detail: 'Page' }]));
  it('DEFAULT_PAGE_SETUP is never shared', () => {
    expect(Object.isFrozen(DEFAULT_PAGE_SETUP) && Object.isFrozen(DEFAULT_PAGE_SETUP.margins)).toBe(true);
    const page = readReport(doc({}), fields).page;
    expect(page).toEqual(DEFAULT_PAGE_SETUP); expect(page).not.toBe(DEFAULT_PAGE_SETUP); expect(page.margins).not.toBe(DEFAULT_PAGE_SETUP.margins);
  });
  it('a combo box prints as a report text box: no border, no back by default', () => {
    const [k, t] = readReport(doc({ sections: [sec('detail', undefined, [ctl('comboBox', 'K', { ControlSource: 'Client' }), tb('T', 'Client')])] }), fields).detail!.controls;
    expect(k).toMatchObject({ kind: 'comboBox', border: null, back: null, source: { kind: 'field', name: 'Client' } });
    expect({ ...k, kind: 'textBox', name: 'T' }).toEqual(t);
  });
});

describe('readReport (Task 6 carry-overs)', () => {
  it('a bare Page or Pages group key (no =) is groupingInvalid, not an unknown field', () => {
    const s = readReport(doc({ grouping: [g('Page'), g('[pages]')] }), fields);
    expect(s.grouping.map((l) => l.key)).toEqual([{ kind: 'error' }, { kind: 'error' }]);
    expect(s.issues).toEqual([{ code: 'groupingInvalid', detail: 'Page' }, { code: 'groupingInvalid', detail: '[pages]' }]);
    // a real field named Page is an ordinary key
    const real = readReport(doc({ grouping: [g('[Page]')] }), [...fields, sf('Page', 'shortText')]);
    expect(real.grouping[0]!.key).toEqual({ kind: 'field', name: 'Page' }); expect(real.issues).toEqual([]);
  });
});

describe('readReport: dimensions past Access’s limit (final review I1)', () => {
  it.each([9e15, 1e9])('a section, a control and the Width of %d twips are clamped to MAX_TWIPS, with a sizeClamped issue', (big) => {
    const huge = ctl('textBox', 'A', { left: big, top: big, width: big, height: big, ControlSource: '[Client]' });
    const s = readReport(doc({ props: { Width: big }, sections: [{ ...sec('detail', undefined, [huge]), height: big }] }), fields);
    expect(s.detail!.height).toBe(MAX_TWIPS);
    expect(s.detail!.controls[0]).toMatchObject({ left: MAX_TWIPS, top: MAX_TWIPS, width: MAX_TWIPS, height: MAX_TWIPS });
    expect(s.width).toBe(MAX_TWIPS);
    expect(s.issues).toEqual(expect.arrayContaining([{ code: 'sizeClamped', control: 'A' }, { code: 'sizeClamped', detail: 'detail' }, { code: 'sizeClamped', detail: 'Width' }]));
  });
  it('a dimension at the limit is kept, with no issue', () => {
    const s = readReport(doc({ sections: [{ ...sec('detail', undefined, [ctl('textBox', 'A', { height: MAX_TWIPS, ControlSource: '[Client]' })]), height: MAX_TWIPS }] }), fields);
    expect(s.detail!.height).toBe(MAX_TWIPS); expect(s.issues).toEqual([]);
  });
});

describe('reportWidth: one rule for print and design (C5, final review M3)', () => {
  it('the stored Width, else the right edge of the rightmost control (children included), the catalog’s 6994 only with neither; at most MAX_TWIPS', () => {
    expect(reportWidth(doc({ props: { Width: 9000 } }))).toBe(9000);
    expect(reportWidth(doc({ props: { Width: 99999 } }))).toBe(MAX_TWIPS);
    // nothing stored and no control: the catalog's width, so the designer never draws a report 0 wide
    expect(reportWidth(doc({}))).toBe(def('Width', 'report')); expect(reportWidth(doc({ props: { Width: 0 } }))).toBe(0);
    const wide = { ...tb('A', '[Client]', { left: 1000, width: 2000 }), children: [ctl('label', 'A_Label', { left: 2500, width: 1500 })] };
    const d = doc({ sections: [sec('detail', undefined, [wide])] });
    expect(reportWidth(d)).toBe(4000); expect(readReport(d, fields).width).toBe(reportWidth(d));
    expect(() => reportWidth({ formatVersion: '1.0', recordSource: null, props: {}, sections: [{ kind: 'detail', controls: 'x' } as never] })).not.toThrow();
  });
});
