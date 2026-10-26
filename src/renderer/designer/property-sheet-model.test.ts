import { describe, expect, it } from 'vitest';
import { CONTROL_KINDS, type ControlDef, type ControlKind, type DesignDoc } from '../../shared/design/model';
import { defaultFor, PROPERTY_CATALOG, type PropertyDescriptor } from '../../shared/design/properties';
import { localeInfo } from '../../shared/locale-format';
import { checkPropValue, columnWidthsToDisplay, columnWidthsToStored, controlSourceToCanonical, controlSourceToDisplay, fontWarning, fromSourceRef,
  MIXED, readProp, sheetRows, targetKind, targetsOf, toSourceRef } from './property-sheet-model';
import type { PropTarget } from './designer-model';
import { FACTURES_REPORT } from '../../shared/report/fixtures/factures';
import { EVENTS } from '../../shared/design/events';

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
