import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import frJson from '../../shared/i18n/fr.json';
import { DEFAULT_THEME } from '../../shared/design/theme';
import { toSourceRef } from '../../shared/record-source';
import { CONTROL_KINDS, type ControlDef, type ControlKind, type DesignDoc } from '../../shared/design/model';
import { defaultFor, PROPERTY_CATALOG, type PropertyDescriptor } from '../../shared/design/properties';
import { localeInfo } from '../../shared/locale-format';
import { chartRows, chartSummary, checkPropValue, columnWidthsToDisplay, columnWidthsToStored, controlSourceToCanonical, controlSourceToDisplay, fontLabel, fontWarning, fromSourceRef,
  MIXED, pictureLabel, pictureRows, readProp, setPictureType, sheetRows, targetKind, targetsOf } from './property-sheet-model';
import { designerReducer, initDesigner, type PropTarget } from './designer-model';
import { FACTURES_REPORT } from '../../shared/report/fixtures/factures';
import { EVENTS } from '../../shared/design/events';
import { emptyCellsOf, readLayouts } from '../../shared/design/layout';
import { createLayout, insertCells, membersOf, setCellProp } from '../../shared/design/layout-edit';

const ctl = (kind: ControlKind, name: string, left = 0, top = 0, children?: ControlDef[]): ControlDef =>
  ({ kind, name, left, top, width: 2268, height: 340, props: {}, ...(children ? { children } : {}) });
const doc: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 567, props: {}, controls: [ctl('label', 'Titre')] },
  { kind: 'detail', height: 2268, props: {}, controls: [ctl('textBox', 'Nom', 1134, 0, [ctl('label', 'Étiquette_Nom')]), ctl('textBox', 'Ville', 1134, 567)] },
  { kind: 'formFooter', height: 0, props: {}, controls: [] },
] };
const ctlT = (name: string): PropTarget => ({ kind: 'control', name });
const desc = (name: string): PropertyDescriptor => PROPERTY_CATALOG.find((d) => d.name === name)!;
const fr = localeInfo('fr-FR');

describe('property sheet model', () => {
  it('targets of a selection', () => {
    expect(targetsOf({ kind: 'controls', names: ['Nom', 'Ville'] })).toEqual([ctlT('Nom'), ctlT('Ville')]);
    expect(targetsOf({ kind: 'controls', names: ['Nom'], cells: [{ layout: 'L1', row: 0, col: 2 }] })).toEqual(targetsOf({ kind: 'controls', names: ['Nom'] }));
    expect(targetsOf({ kind: 'controls', names: [] })).toEqual([{ kind: 'doc' }]);
    expect(targetsOf({ kind: 'section', index: 1 })).toEqual([{ kind: 'section', index: 1 }]);
    expect(targetKind(doc, 'report', { kind: 'doc' })).toBe('report');
    expect(targetKind(doc, 'form', { kind: 'section', index: 1 })).toBe('detail');
    expect(targetKind(doc, 'form', ctlT('Étiquette_Nom'))).toBe('label');
  });
  it('rows by tab and target', () => {
    const r = sheetRows(doc, 'form', [{ kind: 'control', name: 'Nom' }], 'data', false).map((x) => x.d.name);
    expect(r).toEqual(expect.arrayContaining(['ControlSource', 'DefaultValue', 'ValidationRule', 'Enabled', 'Locked'])); expect(r).not.toContain('RecordSource');
    expect(sheetRows(doc, 'form', [{ kind: 'doc' }], 'data', false).map((x) => x.d.name)).toContain('RecordSource');
  });
  it('common props only, mixed values', () => {
    const rows = sheetRows(doc, 'form', [{ kind: 'control', name: 'Nom' }, { kind: 'control', name: 'Titre' }], 'format', false);
    expect(rows.map((x) => x.d.name)).not.toContain('Format');   // pas sur une étiquette
    expect(rows.find((x) => x.d.name === 'Left')!.value).toBe(MIXED);
    expect(rows.find((x) => x.d.name === 'Width')!.value).toBe(2268);
  });
  it('a report without Width shows the width it prints at: its rightmost edge, not the catalog’s 6994 (M3)', () => {
    const report: DesignDoc = { ...doc, sections: [{ kind: 'detail', height: 2268, props: {}, controls: [ctl('textBox', 'Nom', 1134)] }] };
    expect(readProp(report, 'report', { kind: 'doc' }, desc('Width'))).toBe(1134 + 2268);
    expect(readProp(doc, 'form', { kind: 'doc' }, desc('Width'))).toBe(defaultFor(desc('Width'), 'form', 'form'));   // un formulaire : inchangé
  });
  it('events editable on a writable base, read-only on a read-only one', () => {
    expect(sheetRows(doc, 'form', [ctlT('Nom')], 'event', false).every((r) => !r.readOnly)).toBe(true);
    expect(sheetRows(doc, 'form', [ctlT('Nom')], 'event', true).every((r) => r.readOnly)).toBe(true);
  });
  it('every catalogue event is editable', () => {
    const kinds = CONTROL_KINDS;   // every kind, a new one included
    const form: DesignDoc = { ...doc, sections: [{ kind: 'detail', height: 2268, props: {}, controls: kinds.map((k) => ctl(k, `c_${k}`)) }] };
    const detail = FACTURES_REPORT.sections.findIndex((s) => s.kind === 'detail');
    const rows = [
      ...sheetRows(form, 'form', [{ kind: 'doc' }], 'event', false), ...kinds.flatMap((k) => sheetRows(form, 'form', [ctlT(`c_${k}`)], 'event', false)),
      ...sheetRows(FACTURES_REPORT, 'report', [{ kind: 'doc' }], 'event', false), ...sheetRows(FACTURES_REPORT, 'report', [{ kind: 'section', index: detail }], 'event', false),
    ];
    expect(rows.filter((r) => r.readOnly).map((r) => r.d.name)).toEqual([]);
    expect(new Set(rows.map((r) => r.d.name))).toEqual(new Set(EVENTS));
  });
  it('a report control has no event (control events belong to forms)', () => {
    const ctlOf = FACTURES_REPORT.sections.flatMap((s) => s.controls).find((c) => c.kind === 'textBox')!;
    expect(sheetRows(FACTURES_REPORT, 'report', [ctlT(ctlOf.name)], 'event', false)).toEqual([]);
  });
  it('report-only events', () => {
    const rows = (d: DesignDoc, kind: 'form' | 'report', t: PropTarget[], tab: 'event') => sheetRows(d, kind, t, tab, false);
    const detailOf = (d: DesignDoc) => d.sections.findIndex((s) => s.kind === 'detail');
    expect(rows(FACTURES_REPORT, 'report', [{ kind: 'section', index: detailOf(FACTURES_REPORT) }], 'event').map((r) => r.d.name)).toEqual(['OnFormat', 'OnPrint']);
    expect(rows(doc, 'form', [{ kind: 'section', index: 1 }], 'event')).toEqual([]);   // a form's Detail has no On Format / On Print
    expect(rows(FACTURES_REPORT, 'report', [{ kind: 'doc' }], 'event').map((r) => r.d.name)).toEqual(['OnOpen', 'OnClose', 'OnNoData']);
    expect(rows(doc, 'form', [{ kind: 'doc' }], 'event').map((r) => r.d.name)).not.toContain('OnNoData');
  });
  it('event values: a macro name or an embedded macro, nothing else', () => {
    const d = desc('OnClick'), t = ctlT('Nom');
    expect(checkPropValue(doc, t, d, undefined)).toBeNull();
    expect(checkPropValue(doc, t, d, 'MLyon.Fermer')).toBeNull();
    expect(checkPropValue(doc, t, d, { embedded: { formatVersion: '1.0', items: [] } })).toBeNull();
    expect(checkPropValue(doc, t, d, 'a.b.c')).toBe('sheet.error.badMacroName');
    expect(checkPropValue(doc, t, d, { embedded: { formatVersion: '2.0', items: [] } })).toBe('sheet.error.badEmbedded');
  });
  it('read-only session: every row read-only; Name read-only in a multi-selection', () => {
    expect(sheetRows(doc, 'form', [ctlT('Nom')], 'all', true).every((r) => r.readOnly)).toBe(true);
    expect(sheetRows(doc, 'form', [ctlT('Nom')], 'other', false).find((r) => r.d.name === 'Name')!.readOnly).toBe(false);
    expect(sheetRows(doc, 'form', [ctlT('Nom'), ctlT('Ville')], 'other', false).find((r) => r.d.name === 'Name')!.readOnly).toBe(true);
  });
  it('all tab = union without duplicates, tab by tab in catalog order', () => {
    const all = sheetRows(doc, 'form', [ctlT('Nom')], 'all', false).map((r) => r.d.name);
    expect(new Set(all).size).toBe(all.length);
    const tabs = (['format', 'data', 'event', 'other'] as const).flatMap((t) => sheetRows(doc, 'form', [ctlT('Nom')], t, false).map((r) => r.d.name));
    expect(all).toEqual(tabs);
  });
  it('a stale target gives no rows', () => expect(sheetRows(doc, 'form', [ctlT('Zz')], 'all', false)).toEqual([]));
  it('geometry, name and record source read from the model', () => {
    expect(readProp(doc, 'form', ctlT('Nom'), desc('Left'))).toBe(1134);
    expect(readProp(doc, 'form', ctlT('Nom'), desc('Name'))).toBe('Nom');
    expect(readProp(doc, 'form', { kind: 'doc' }, desc('RecordSource'))).toEqual({ kind: 'table', name: 'Clients' });
    expect(readProp(doc, 'form', { kind: 'section', index: 1 }, desc('Height'))).toBe(2268);
  });
  it('per-target defaults', () => {
    expect(readProp(doc, 'form', ctlT('Nom'), desc('Visible'))).toBe(true);
    expect(readProp(doc, 'form', ctlT('Titre'), desc('BorderStyle'))).toBe(defaultFor(desc('BorderStyle'), 'label', 'form'));
    expect(readProp(doc, 'form', ctlT('Nom'), desc('BorderStyle'))).toBe('solid'); expect(readProp(doc, 'report', ctlT('Nom'), desc('BorderStyle'))).toBe('transparent');
  });
  it('validation', () => {
    expect(checkPropValue(doc, ctlT('Nom'), desc('Name'), 'Ville')).toBe('sheet.error.nameExists');
    expect(checkPropValue(doc, ctlT('Nom'), desc('Name'), 'nom')).toBeNull();   // le sien, casse changée
    expect(checkPropValue(doc, ctlT('Nom'), desc('Name'), 'a.b')).toBe('sheet.error.nameInvalid');
    expect(checkPropValue(doc, ctlT('Nom'), desc('Name'), undefined)).toBe('sheet.error.nameInvalid');
    expect(checkPropValue(doc, ctlT('Nom'), desc('BackColor'), 'red')).toBe('sheet.error.invalidColor');
    expect(checkPropValue(doc, ctlT('Nom'), desc('BackColor'), 'theme:accent')).toBeNull();
    expect(checkPropValue(doc, ctlT('Nom'), desc('Width'), 99999)).toBe('sheet.error.outOfRange');
    expect(checkPropValue(doc, ctlT('Nom'), desc('Width'), undefined)).toBe('sheet.error.outOfRange');   // géométrie : jamais vide
    expect(checkPropValue(doc, ctlT('Nom'), desc('FontSize'), 80)).toBe('sheet.error.outOfRange');
    expect(checkPropValue(doc, ctlT('Nom'), desc('FontSize'), Number.NaN)).toBe('sheet.error.outOfRange');
    expect(checkPropValue(doc, ctlT('Nom'), desc('FontSize'), undefined)).toBeNull();   // vide : la clé est retirée
    expect(checkPropValue(doc, ctlT('Nom'), desc('ColumnWidths'), null)).toBe('sheet.error.outOfRange');
  });
  it('aggregates accepted only where a group can exist (report, A5)', () => {
    const ctx = { lang: 'fr', region: fr } as const;
    expect(controlSourceToCanonical('=Somme([Montant])', ctx, { aggregates: true })).toEqual({ ok: true, value: '=Sum([Montant])' });
    expect(controlSourceToCanonical('=Somme([Montant])', ctx)).toEqual({ ok: false, code: 'aggregateContext' });
  });
  it('integer properties', () => {
    expect(PROPERTY_CATALOG.filter((d) => d.integer).map((d) => d.name)).toEqual(expect.arrayContaining(['GridX', 'GridY', 'ColumnCount', 'BoundColumn', 'TabIndex', 'FontSize']));
    expect(checkPropValue(doc, ctlT('Nom'), desc('FontSize'), 10.5)).toBe('sheet.error.notInteger');
    expect(checkPropValue(doc, { kind: 'doc' }, desc('GridX'), 2.5)).toBe('sheet.error.notInteger');
    expect(checkPropValue(doc, { kind: 'doc' }, desc('GridX'), 5)).toBeNull();
    expect(checkPropValue(doc, { kind: 'doc' }, desc('GridX'), 20)).toBe('sheet.error.outOfRange');
  });
  it('control source fr <-> canonical', () => {
    const ctx = { lang: 'fr', region: fr } as const;
    expect(controlSourceToCanonical('=VraiFaux([Qté]>1,5; "gros"; "petit")', ctx)).toEqual({ ok: true, value: '=IIf([Qté] > 1.5, "gros", "petit")' });
    expect(controlSourceToDisplay('=IIf([Qté] > 1.5, "gros", "petit")', ctx)).toBe('=VraiFaux([Qté] > 1,5; "gros"; "petit")');
    expect(controlSourceToDisplay('Nom', ctx)).toBe('Nom'); expect(controlSourceToDisplay(undefined, ctx)).toBe('');
    expect(controlSourceToCanonical('Nom', ctx)).toEqual({ ok: true, value: 'Nom' }); expect(controlSourceToCanonical('', ctx)).toEqual({ ok: true, value: undefined });
    expect(controlSourceToCanonical('=1 +', ctx)).toEqual({ ok: false, code: 'unexpectedEnd' });
    expect(controlSourceToCanonical('=Somme([Qté])', ctx)).toEqual({ ok: false, code: 'aggregateContext' });   // pas de groupe dans un formulaire (M1)
  });
  it('record source text', () => {
    const T = ['Clients', 'Selections'], Q = ['Ventes'];
    expect(toSourceRef('clients', T, Q)).toEqual({ kind: 'table', name: 'Clients' }); expect(toSourceRef('Ventes', T, Q)).toEqual({ kind: 'query', name: 'Ventes' });
    for (const s of ['select * from Clients', '  TRANSFORM Sum(x) SELECT …', 'PARAMETERS [p] Text; SELECT 1']) expect(toSourceRef(s, T, Q)).toMatchObject({ kind: 'sql' });
    expect(toSourceRef('Selections', T, Q)).toEqual({ kind: 'table', name: 'Selections' });
    expect(toSourceRef('Zz', T, Q)).toBeNull(); expect(toSourceRef('', T, Q)).toBeNull();
    expect(fromSourceRef({ kind: 'table', name: 'Clients' })).toBe('Clients'); expect(fromSourceRef({ kind: 'sql', sql: 'SELECT 1' })).toBe('SELECT 1');
    expect(fromSourceRef(null)).toBe('');
  });
  it('column widths in cm, stored in twips (A2 Lookup tab text)', () => {
    expect(columnWidthsToStored('0;2,5', fr)).toBe('0;1417'); expect(columnWidthsToDisplay('0;1417', fr)).toBe('0cm;2,5cm');
    expect(columnWidthsToStored('x', fr)).toBeNull(); expect(columnWidthsToStored('', fr)).toBe(''); expect(columnWidthsToDisplay('', fr)).toBe('');
    expect(columnWidthsToDisplay('a;b', fr)).toBe('a;b');   // valeur écrite hors de BaseCraft : montrée telle quelle
  });
  it('font portability', () => { expect(fontWarning('Comic Sans MS')).toBe('sheet.fontNotPortable'); expect(fontWarning('carlito')).toBeNull(); expect(fontWarning('Arial')).toBeNull(); });
});

describe('empty cell sheet (L5)', () => {
  const d0 = insertCells(insertCells(createLayout(doc, membersOf(doc, ['Nom', 'Ville']), 'stacked', { headerSection: 'formHeader' }), 'Nom', 'right'), 'Ville', 'right');
  const cells = emptyCellsOf(d0);
  const cellT = (i: number): PropTarget => ({ kind: 'cell', layout: cells[i].layout, row: cells[i].row, col: cells[i].col });
  const names = (tab: 'format' | 'other', ts: PropTarget[], d = d0) => sheetRows(d, 'form', ts, tab, false, 'CV').map((r) => r.d.name);
  it('two empty cells to work with', () => { expect(cells.length).toBeGreaterThanOrEqual(2); });
  it('targets, kind, existence', () => {
    expect(targetsOf({ kind: 'controls', names: [], cells: [cells[0]] })).toEqual([cellT(0)]);
    expect(targetKind(d0, 'form', cellT(0))).toBe('emptyCell');
    expect(sheetRows(d0, 'form', [{ kind: 'cell', layout: 'zz', row: 0, col: 0 }], 'format', false)).toEqual([]);
    expect(sheetRows(d0, 'form', [{ kind: 'cell', layout: cells[0].layout, row: 0, col: 0 }], 'format', false)).toEqual([]);   // not an empty cell
  });
  it('catalog: Tag on controls and emptyCell, margins and anchors not', () => {
    expect(desc('Tag').appliesTo).toEqual(expect.arrayContaining([...CONTROL_KINDS, 'emptyCell']));
    for (const n of ['TopMargin', 'HorizontalAnchor', 'ControlSource', 'Caption']) expect(desc(n).appliesTo).not.toContain('emptyCell');
  });
  it('rows of the format and other tabs', () => {
    const sides = ['Top', 'Bottom', 'Left', 'Right'];
    expect(names('format', [cellT(0)]).sort()).toEqual(['Width', 'Height', 'Top', 'Left', 'BackStyle', 'BackColor', 'GridlineColor',
      ...sides.flatMap((x) => [`GridlineStyle${x}`, `GridlineWidth${x}`, `${x}Padding`])].sort());
    expect(names('other', [cellT(0)])).toEqual(['Name', 'Tag']);
    const ro = sheetRows(d0, 'form', [cellT(0)], 'all', false).filter((r) => r.readOnly).map((r) => r.d.name).sort();
    expect(ro).toEqual(['Left', 'Name', 'Top']);
  });
  it('values: defaults, stored props, derived name, mixed', () => {
    const val = (dd: DesignDoc, t: PropTarget, n: string) => readProp(dd, 'form', t, desc(n), 'CV');
    expect(val(d0, cellT(0), 'BackStyle')).toBe('transparent'); expect(val(d0, cellT(0), 'TopPadding')).toBe(0);
    expect(val(d0, cellT(0), 'Width')).toBe(cells[0].rect.width);
    expect(val(d0, cellT(1), 'Name')).toBe('CV2');
    const d1 = setCellProp(d0, cells[0], 'BackColor', '#ff0000');
    expect(val(d1, cellT(0), 'BackColor')).toBe('#ff0000');
    expect(sheetRows(d1, 'form', [cellT(0), cellT(1)], 'format', false).find((r) => r.d.name === 'BackColor')!.value).toBe(MIXED);
    expect(readLayouts(d1)).toHaveLength(1);
  });
  it('a mixed selection shows the controls only', () => {
    const t = targetsOf({ kind: 'controls', names: ['Nom'], cells: [cells[0]] });
    expect(t).toEqual([ctlT('Nom')]);
    expect(() => sheetRows(d0, 'form', t, 'format', false)).not.toThrow();
  });
  it('checkPropValue: a cell width is 0..MAX_TWIPS', () => {
    expect(checkPropValue(d0, cellT(0), desc('Width'), 0)).toBeNull();
    expect(checkPropValue(d0, cellT(0), desc('Width'), -1)).not.toBeNull();
  });
});

describe('fontLabel', () => {
  const i18n = i18next.createInstance();
  void i18n.init({ resources: { fr: { translation: frJson } }, lng: 'fr', interpolation: { escapeValue: false }, initAsync: false });
  const t = i18n.t.bind(i18n);
  it('les polices du thème montrent leur famille et leur rôle', () => {
    expect(fontLabel('(Body)', DEFAULT_THEME, t)).toBe('Inter (Détail)');
    expect(fontLabel('(Headings)', DEFAULT_THEME, t)).toBe('Inter (En-têtes)');
    expect(fontLabel('Carlito', DEFAULT_THEME, t)).toBe('Carlito');
  });
});

describe('picture rows (F3a)', () => {
  const rows = (kind: ControlKind) => {
    const d: DesignDoc = { ...doc, sections: [{ kind: 'detail', height: 2268, props: {}, controls: [ctl(kind, 'X')] }] };
    return sheetRows(d, 'form', [ctlT('X')], 'all', false).map((r) => r.d.name);
  };
  it('pictureRows: five rows for an image (capture 16 order) or a form/report, two for a command button', () => {
    expect(pictureRows({}, 'image')).toEqual(['PictureType', 'Picture', 'PictureTiling', 'SizeMode', 'PictureAlignment']);
    expect(pictureRows({}, 'commandButton')).toEqual(['PictureType', 'Picture']);
    expect(pictureRows({}, 'form')).toEqual(['PictureType', 'Picture', 'PictureTiling', 'PictureAlignment', 'PictureSizeMode']);
    expect(pictureRows({}, 'report')).toEqual(['PictureType', 'Picture', 'PictureTiling', 'PictureAlignment', 'PictureSizeMode']);
  });
  it('the sheet shows the picture rows for an image, a form and a report', () => {
    const img = rows('image');
    expect(img.filter((n) => n.startsWith('Picture') || n === 'SizeMode')).toEqual(['PictureType', 'Picture', 'PictureTiling', 'SizeMode', 'PictureAlignment']);
    expect(rows('commandButton').filter((n) => n.startsWith('Picture'))).toEqual(['PictureType', 'Picture']);
    expect(sheetRows(doc, 'form', [{ kind: 'doc' }], 'all', false).map((r) => r.d.name).filter((n) => n.startsWith('Picture'))).toEqual(['PictureType', 'Picture', 'PictureTiling', 'PictureAlignment', 'PictureSizeMode']);
    expect(sheetRows(doc, 'report', [{ kind: 'doc' }], 'all', false).map((r) => r.d.name).filter((n) => n.startsWith('Picture'))).toEqual(['PictureType', 'Picture', 'PictureTiling', 'PictureAlignment', 'PictureSizeMode']);
  });
  it('pictureLabel', () => {
    expect(pictureLabel({ PictureType: 'shared', Picture: 'logo' })).toBe('logo');
    expect(pictureLabel({ Picture: 'data:image/png;base64,AAAA' }, '(Incorporé)')).toBe('(Incorporé)');
    expect(pictureLabel({})).toBe('');
    expect(pictureLabel({ PictureType: 'shared' })).toBe('');
  });
});

describe('setPictureType: one edit sets the type and clears the picture', () => {
  const img = (props: Record<string, unknown>): DesignDoc => ({ ...doc, sections: [{ kind: 'detail', height: 2268, props: {}, controls: [{ ...ctl('image', 'Img'), props }] }] });
  const t = [ctlT('Img')];
  const props = (d: DesignDoc) => d.sections[0]!.controls[0]!.props;
  it('shared keeps a gallery name, clears anything else; embedded clears a name but keeps a data URL', () => {
    expect(props(setPictureType(img({ Picture: 'Logo' }), 'form', t, 'shared', new Set(['Logo'])))).toEqual({ PictureType: 'shared', Picture: 'Logo' });
    expect(props(setPictureType(img({ Picture: 'data:image/png;base64,AA' }), 'form', t, 'shared', new Set(['Logo'])))).toEqual({ PictureType: 'shared' });
    expect(props(setPictureType(img({ PictureType: 'shared', Picture: 'Logo' }), 'form', t, 'embedded', null))).toEqual({});
    expect(props(setPictureType(img({ PictureType: 'shared', Picture: 'data:image/png;base64,AA' }), 'form', t, 'embedded', null))).toEqual({ Picture: 'data:image/png;base64,AA' });
  });
  it('a single undo restores both properties', () => {
    const d0 = img({ Picture: 'data:image/png;base64,AA' });
    const s = designerReducer(initDesigner(d0), { type: 'edit', apply: (d) => setPictureType(d, 'form', t, 'shared', new Set()) });
    expect(props(s.doc)).toEqual({ PictureType: 'shared' });
    expect(props(designerReducer(s, { type: 'undo' }).doc)).toEqual(props(d0));
  });
});

describe('chart rows (F4)', () => {
  const chartDoc: DesignDoc = { ...doc, sections: doc.sections.map((s) => (s.kind === 'detail' ? { ...s, controls: [ctl('chart', 'Graphique1')] } : s)) };
  const names = (tab: 'format' | 'data') => sheetRows(chartDoc, 'form', [ctlT('Graphique1')], tab, false).map((r) => r.d.name);
  it('chartRows : format puis données', () => {
    // ordre des captures 12 et 13 (Type, fond, bordure, légende, titre, sous-titre, titres d'axes, axe des abscisses, axe des ordonnées)
    expect(chartRows()).toEqual(['ChartType', 'ChartBackStyle', 'ChartBackColor', 'ChartBorderStyle', 'ChartBorderWidth', 'ChartBorderColor',
      'HasLegend', 'LegendPosition', 'LegendFontColor', 'LegendFontSize', 'HasTitle', 'ChartTitle', 'TitleFontName', 'TitleFontColor', 'TitleFontSize',
      'HasSubtitle', 'Subtitle', 'SubtitleFontColor', 'SubtitleFontSize', 'HasAxisTitles', 'AxisTitleX', 'AxisTitleY', 'AxisSecTitle', 'AxisXFontColor', 'AxisXFontSize',
      'AxisRange', 'AxisMin', 'AxisMax', 'AxisFormat', 'AxisUnits', 'AxisFontColor', 'AxisFontSize',
      'AxisSecRange', 'AxisSecMin', 'AxisSecMax', 'AxisSecFormat', 'AxisSecUnits', 'AxisSecFontColor', 'AxisSecFontSize']);
    expect(chartRows('data')).toEqual(['ChartSource', 'ChartAxis', 'ChartDateGroup', 'ChartLegend', 'ChartValues', 'ChartSeries']);
  });
  it('la feuille montre les lignes du graphique en tête de leur onglet', () => {
    expect(names('format').slice(0, chartRows().length)).toEqual(chartRows());
    expect(names('format').length).toBeGreaterThan(chartRows().length);
    expect(names('data').slice(0, 6)).toEqual(chartRows('data'));
  });
  it('valeurs par défaut', () => {
    const dflt = (n: string) => defaultFor(desc(n), 'chart');
    expect([dflt('HasTitle'), dflt('LegendPosition'), dflt('HasLegend'), dflt('HasAxisTitles')]).toEqual([true, 'top', true, true]);
    expect([dflt('TitleFontSize'), dflt('LegendFontSize'), dflt('HasSubtitle'), dflt('AxisRange'), dflt('AxisUnits'), dflt('ChartBorderStyle')]).toEqual([14, 10, false, 'auto', 'none', 'transparent']);
  });
  it('les lignes génériques de fond et de bordure ne doublonnent pas celles du graphique', () => {
    expect(names('format')).not.toContain('BackStyle');
    expect(names('format')).not.toContain('BorderStyle');
  });
  it('résumés en lecture seule', () => {
    const agg = (a: string) => ({ sum: 'Somme' })[a] ?? a;
    expect(chartSummary('ChartSource', { kind: 'table', name: 'Commandes' }, agg)).toBe('Commandes');
    expect(chartSummary('ChartAxis', ['Client'], agg)).toBe('Client');
    expect(chartSummary('ChartValues', [{ field: 'Montant', agg: 'sum' }], agg)).toBe('Montant (Somme)');
    expect(chartSummary('ChartValues', 'texte', agg)).toBe('');
    expect(chartSummary('ChartSeries', [{ field: 'Remise', type: 'line', secondary: true }, { field: 'M' }], agg)).toBe('Remise (line, 2), M (column)');
  });
});

describe('lien maître/détail : graphique de formulaire seulement, sous-formulaire partout', () => {
  const ctl = (kind: 'chart' | 'subform', name: string) => ({ kind, name, left: 0, top: 0, width: 100, height: 100, props: {} });
  const d = { formatVersion: '1.0', recordSource: null, props: {},
    sections: [{ kind: 'detail', height: 1000, props: {}, controls: [ctl('chart', 'G'), ctl('subform', 'S')] }] } as unknown as Parameters<typeof sheetRows>[0];
  const names = (k: 'form' | 'report', n: string) => sheetRows(d, k, [{ kind: 'control', name: n }], 'data', false).map((x) => x.d.name);
  it('rows', () => {
    expect(names('form', 'G')).toEqual(expect.arrayContaining(['LinkMasterFields', 'LinkChildFields']));
    expect(names('report', 'G')).not.toContain('LinkMasterFields');
    expect(names('report', 'G')).not.toContain('LinkChildFields');
    expect(names('report', 'S')).toEqual(expect.arrayContaining(['LinkMasterFields', 'LinkChildFields']));
  });
});
