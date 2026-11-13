// Définition normalisée d'un état : lecture du DesignDoc par le catalogue (contrat 1.3, 1.4, 1.5, C5).
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SETUP, pageGeometry, readReport, reportWidth, type GroupLevel } from './model';
import { readProp } from './props';
import { setUserFunctions } from '../expr/user-functions';
import { BUILTIN_THEMES, DEFAULT_THEME, shade } from '../design/theme';
import { FACTURES_REPORT } from './fixtures/factures';
import { LIGHT_THEME_HEX, resolveColor, type ColorValue } from '../design/colors';
import { validateDesignDoc, type ControlDef, type DesignDoc, type SectionDef, type SectionKind } from '../design/model';
import { cellItemName } from '../design/layout';
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
    expect(s.detail?.controls[0]!.font).toEqual({ name: DEFAULT_THEME.fonts.minor, size: def('FontSize', 'textBox'), bold: false, italic: false, underline: false });
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
    expect(s.issues.map((i) => i.code).sort()).toEqual(['aggregateNotAllowed', 'fontNotPortable', 'groupingInvalid', 'invalidExpression', 'unknownField']);   // Arial : alias, portable ; Comic Sans MS (D, G) : une seule fois
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
  it('flattens children after their parent; an unknown kind is dropped with its children; a tab control keeps its first page', () => {
    const withLabel = { ...tb('A', '[Client]'), children: [{ ...ctl('label', 'A_Label', { left: 50 }), children: [ctl('label', 'Deep')] }] };
    const group = { ...ctl('optionGroup', 'G'), children: [ctl('optionButton', 'O')] };
    const tabs = { ...ctl('tabControl', 'T', { Pages: ['One', 'Two'] }), children: [ctl('textBox', 'T_Box'), { ...ctl('textBox', 'T_Two'), props: { PageIndex: 1 } }] };
    const odd = { ...ctl('textBox', 'Odd'), kind: 'gizmo' as never, children: [ctl('textBox', 'Lost')] };
    const s = readReport(doc({ sections: [sec('detail', undefined, [withLabel, group, ctl('commandButton', 'B'), ctl('listBox', 'LB'), tabs, odd, ctl('comboBox', 'K'), ctl('subform', 'S'), tb('Z', '[Client]')])] }), fields);
    expect(s.detail!.controls.map((c) => c.name)).toEqual(['A', 'A_Label', 'Deep', 'G', 'O', 'B', 'LB', 'T', 'T_Box', 'K', 'S', 'Z']);
    expect(s.detail!.controls[1]!.left).toBe(50);
    expect(s.detail!.controls.find((c) => c.name === 'T')!.pages).toEqual(['One', 'Two']);
    expect(s.issues).toEqual([{ code: 'unsupportedControl', control: 'Odd', detail: 'gizmo' }]);
  });
  it('a design with a button, a toggle button, an option group, a list box and a tab control is valid in a report', () => {
    const kinds = ['commandButton', 'toggleButton', 'optionGroup', 'listBox', 'tabControl'] as const;
    const d = doc({ sections: [sec('detail', undefined, kinds.map((k) => ctl(k, `C_${k}`)))] });
    expect(validateDesignDoc(d)).toEqual([]);
    expect(readReport(d, fields).detail!.controls.map((c) => c.kind)).toEqual([...kinds]);
  });
  it('a label with a HyperlinkAddress is read as a link (underlined, blue); another label is not (D3)', () => {
    const d = doc({ sections: [sec('detail', undefined, [ctl('label', 'Lien', { Caption: 'Site', HyperlinkAddress: 'https://example.com/' }), ctl('label', 'Plain', { Caption: 'x' })])] });
    const [link, plain] = readReport(d, fields).detail!.controls;
    expect(link).toMatchObject({ color: '#0563c1', font: { underline: true } });
    expect(plain!.font.underline).toBe(false); expect(plain!.color).not.toBe('#0563c1');
  });
  it('page setup is read, or the default when invalid', () => {
    const page = { orientation: 'landscape', margins: { top: 0, right: 1134, bottom: 5670, left: 284 } };
    expect(readReport(doc({ props: { pageSetup: page } }), fields).page).toEqual({ ...page, paper: 'a4' });
    expect(readReport(doc({ props: { pageSetup: { ...page, paper: 'letter' } } }), fields).page.paper).toBe('letter');
    expect(readReport(doc({ props: { pageSetup: { ...page, paper: 'nope' } } }), fields).page.paper).toBe('a4');
    for (const bad of [{ ...page, orientation: 'tall' }, { ...page, margins: { ...page.margins, left: 5671 } }, { ...page, margins: { ...page.margins, top: 1.5 } }, { orientation: 'portrait' }])
      expect(readReport(doc({ props: { pageSetup: bad } }), fields).page).toEqual(DEFAULT_PAGE_SETUP);
  });
  it('width beyond the printable width is reported', () => {
    expect(readReport(doc({ props: { Width: 10772 } }), fields).issues).toEqual([]);
    expect(readReport(doc({ props: { Width: 10773 } }), fields).issues).toEqual([{ code: 'widthExceedsPage' }]);
    expect(readReport(doc({ props: { Width: 10773, pageSetup: { orientation: 'landscape', margins: DEFAULT_PAGE_SETUP.margins } } }), fields).issues).toEqual([]);
    expect(readReport(doc({ props: { Width: 'wide' }, sections: [sec('detail', undefined, [tb('A', '[Client]', { left: 500 })])] }), fields).width).toBe(1500);
  });
  it('image alignment and tiling: only set when not default', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const c = (p: Record<string, unknown>) => one(ctl('image', 'I', { Picture: png, ...p })).detail!.controls[0]!;
    expect(c({ PictureAlignment: 'bottomRight', PictureTiling: true })).toMatchObject({ pictureAlign: 'bottomRight', tiling: true });
    const plain = c({ PictureAlignment: 'weird' });
    expect('pictureAlign' in plain).toBe(false); expect('tiling' in plain).toBe(false);
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

describe('readReport (images partagées, F3)', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const shared = ctl('image', 'I', { PictureType: 'shared', Picture: 'logo' });
  const read = (c: ControlDef, resources?: Record<string, string>) => readReport(doc({ sections: [sec('detail', undefined, [c])] }), fields, resources ? { resources } : {});
  it('une image partagée prend la galerie', () => {
    expect(read(shared, { logo: png }).detail!.controls[0]!.picture).toBe(png);
    expect(read(shared, { logo: png }).issues).toEqual([]);
  });
  it("une image partagée absente : pas d'image et un avertissement pictureMissing", () => {
    const r = read(shared, {});
    expect(r.detail!.controls[0]!.picture).toBeUndefined();
    expect(r.issues).toEqual([{ code: 'pictureMissing', control: 'I', detail: 'logo' }]);
    expect(read(shared).issues).toEqual([{ code: 'pictureMissing', control: 'I', detail: 'logo' }]);
  });
  it('incorporée ou « linked » : lue comme avant, sans avertissement', () => {
    expect(read(ctl('image', 'I', { Picture: png })).detail!.controls[0]!.picture).toBe(png);
    const l = read(ctl('image', 'I', { PictureType: 'linked', Picture: png }));
    expect(l.detail!.controls[0]!.picture).toBe(png);
    expect(l.issues).toEqual([]);
  });
});

describe("readReport : image d'arrière-plan (F3 Task 8)", () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const pic = { PictureType: 'shared', Picture: 'Motif', PictureTiling: true };
  const read = (props: Record<string, unknown>, resources?: Record<string, string>) => readReport(doc({ props, sections: [sec('detail')] }), fields, resources ? { resources } : {});
  it('une image partagée présente donne background', () => {
    const r = read(pic, { Motif: png });
    expect(r.background).toEqual({ src: png, sizeMode: 'clip', alignment: 'center', tiling: true });
    expect(r.issues).toEqual([]);
  });
  it('absente : pas de background et pictureMissing sans contrôle', () => {
    const r = read(pic, {});
    expect('background' in r).toBe(false);
    expect(r.issues).toEqual([{ code: 'pictureMissing', detail: 'Motif' }]);
  });
  it('incorporée : lue ; aucune image : pas de clé', () => {
    expect(read({ Picture: png }).background?.src).toBe(png);
    expect('background' in read({})).toBe(false);
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

describe('margins and gridlines', () => {
  it('readReport reads margin, gridlines and padding; none when transparent', () => {
    const c = readReport(doc({ sections: [sec('detail', undefined, [tb('A', '[Client]', { LeftMargin: 90, GridlineStyleTop: 'dashed', GridlineWidthTop: 2, GridlineColor: '#ff0000', RightPadding: 30 }), tb('B', '[Client]')])] }), fields).detail!.controls;
    expect(c[0]!.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 90 });
    expect(c[0]!.gridlines).toMatchObject({ top: { width: 30, color: '#ff0000', style: 'dashed' }, bottom: null, left: null, right: null, padding: { right: 30, left: 0 } });
    expect(c[1]!.gridlines).toBeNull();
  });
});

describe('user functions (D3)', () => {
  it('a registered Python name is accepted in a control source', () => {
    const d = doc({ sections: [sec('detail', undefined, [tb('R', '=remise([Montant])')])] });
    setUserFunctions([]);
    expect(readReport(d, fields).issues.map((i) => i.code)).toEqual(['invalidExpression']);
    setUserFunctions(['remise']);
    expect(readReport(d, fields).issues).toEqual([]);
    setUserFunctions([]);
  });
});

describe('readReport: empty layout cells (L5)', () => {
  const lay = (cells: unknown[]) => [{ id: 'L1', kind: 'stacked', left: 200, tops: { detail: 100 }, cols: [1000, 3000], rows: [{ section: 'detail', height: 400 }, { section: 'detail', height: 300 }], cells }];
  const withCells = (cells: unknown[]) => doc({ sections: [sec('detail')], props: { Layouts: lay(cells) } });
  const formatted = { row: 0, col: 1, control: null, props: { BackStyle: 'normal', BackColor: '#ff0000', GridlineStyleTop: 'solid', LeftPadding: 180 } };
  const bare = { row: 1, col: 0, control: null };
  const cells = [{ row: 0, col: 0, control: null, props: { BackStyle: 'normal', BackColor: '#00ff00' } }, formatted, bare, { row: 1, col: 1, control: null }];
  it('a formatted empty cell becomes a rectangle before the controls; a bare one nothing', () => {
    const c = readReport(withCells(cells), fields).detail!.controls;
    expect(c).toHaveLength(3);
    expect(c[1]).toMatchObject({ kind: 'rectangle', name: cellItemName({ layout: 'L1', row: 0, col: 1 }), border: null, source: { kind: 'none' }, back: '#ff0000',
      gridlines: { top: { style: 'solid' }, padding: { left: 180 } } });
    expect(c[2].name).toBe('detail');
  });
  it('allCells emits every cell', () => {
    expect(readReport(withCells(cells), fields, { allCells: true }).detail!.controls).toHaveLength(5);
    expect(readReport(withCells(cells), fields).detail!.controls).toHaveLength(3);
  });
  it('pre-L5: no layouts or only bare cells give the same spec', () => {
    const plain = readReport(doc({ sections: [sec('detail')] }), fields);
    expect(readReport(withCells([bare, { row: 0, col: 0, control: null }, { row: 0, col: 1, control: null }, { row: 1, col: 1, control: null }]), fields)).toEqual(plain);
  });
});

describe('readReport with a theme (F2)', () => {
  const ocean = BUILTIN_THEMES.find((t) => t.name === 'Océan')!;
  const themed = doc({ sections: [sec('detail', undefined, [tb('T', '[Client]', { ForeColor: 'theme:accent1@-25', FontName: '(Headings)' })])] });
  const first = (r: ReturnType<typeof readReport>) => r.detail!.controls[0]!;
  it('theme font and light shade; the dark palette is never used', () => {
    const c = first(readReport(themed, fields, { theme: ocean }));
    expect(c.font.name).toBe(ocean.fonts.major);
    expect(c.color).toBe(shade(ocean.colors.light.accent1, 0.25));
  });
  it('without a theme: the default theme, the fixture is unchanged', () => {
    expect(first(readReport(themed, fields)).font.name).toBe(DEFAULT_THEME.fonts.major);
    expect(readReport(FACTURES_REPORT, [])).toEqual(readReport(FACTURES_REPORT, [], { theme: DEFAULT_THEME }));
    expect(JSON.stringify(readReport(FACTURES_REPORT, []))).not.toContain('(Body)');
  });
  it('a non-embedded theme font is reported and kept by name', () => {
    const odd = { ...ocean, fonts: { name: 'x', major: 'Comic Sans MS', minor: 'Comic Sans MS' } };
    const r = readReport(themed, fields, { theme: odd });
    expect(first(r).font.name).toBe('Comic Sans MS');
    expect(r.issues.map((i) => i.code)).toContain('fontNotPortable');
  });
});

describe('readReport : graphique (F4)', () => {
  const chartCtl = ctl('chart', 'Graph', { left: 100, top: 200, width: 3000, height: 2000, ChartAxis: ['Ville'], ChartValues: [{ field: 'Montant', agg: 'sum' }] });
  const spec = (opts: Parameters<typeof readReport>[2]) => readReport(doc({ sections: [sec('detail', undefined, [chartCtl])] }), fields, opts).detail!.controls[0]!;
  const data = { columns: [], rows: [], truncated: false };
  it('un contrôle chart garde sa géométrie, ses données et le titre localisé par défaut', () => {
    const c = spec({ charts: { Graph: data }, chartLabels: { title: 'Titre du graphique', empty: '(vide)' } });
    expect(c).toMatchObject({ kind: 'chart', left: 100, top: 200, width: 3000, height: 2000 });
    expect(c.chart).toMatchObject({ data, format: { title: 'Titre du graphique', emptyLabel: '(vide)' }, spec: { axis: ['Ville'] }, fontFamily: 'Inter' });
  });
  it('sans données : data null', () => expect(spec({}).chart!.data).toBeNull());
});
