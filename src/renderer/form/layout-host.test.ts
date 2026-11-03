import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ControlDef, DesignDoc, SectionDef } from '../../shared/design/model';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import { localeInfo } from '../../shared/locale-format';
import type { SourceField } from '../../shared/record-source';
import type { DesignerHost } from '../designer/Designer';
import { FORM_TOOLS, formSectionMenu, preview } from './form-host';
import { FORM_LAYOUT_RESTRICT } from '../designer/designer-restrict';
import { layoutHost, viewHost } from './layout-host';
import type { LiveData } from './live-records';
import { publishSettings } from '../settings-store';
import { DEFAULT_SETTINGS } from '../../shared/settings-defaults';

const display = { lang: 'fr' as const, region: localeInfo('fr-FR') };
const base: DesignerHost = {
  target: 'form', tools: FORM_TOOLS, sectionLabel: () => 'Détail', newControls: () => [], sectionMenu: formSectionMenu,
  renderControl: (c) => preview(c, display, 'Indépendant'),
  sheet: { display, fields: [], tables: [], queries: [], objects: () => [] },
};
const sf = (name: string, type: FieldType): SourceField => ({ name, type, props: defaultProps(type) as FieldProps });
const data: LiveData = { info: { fields: [sf('Nom', 'shortText'), sf('Actif', 'yesNo'), sf('Choix', 'number')], updatable: true, parameters: [] },
  rows: [['dupont', -1, 2], ['martin', 0, 1]], notice: null };
const ctl = (kind: ControlDef['kind'], props: Record<string, unknown> = {}, children?: ControlDef[]): ControlDef =>
  ({ kind, name: `${kind}1`, left: 0, top: 0, width: 1000, height: 300, props, ...(children && { children }) });
const sec = (...controls: ControlDef[]): SectionDef => ({ kind: 'detail', height: 2000, props: {}, controls });
const html = (n: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, n));
const show = (h: DesignerHost, c: ControlDef, s = sec(c)) => html(h.renderControl(c, s));

describe('layoutHost', () => {
  it('the same host for the same data and row, a new one when the row or the data changes', () => {
    const h = layoutHost(base, data, 0);
    expect(layoutHost(base, data, 0)).toBe(h);
    expect(layoutHost(base, data, 1)).not.toBe(h);
    expect(layoutHost(base, { ...data }, 0)).not.toBe(h);
    expect(h).toMatchObject({ tools: base.tools, sheet: base.sheet, sectionMenu: base.sectionMenu, target: 'form' });
  });
  it('a bound text box shows the current record, formatted', () => {
    const c = ctl('textBox', { ControlSource: 'Nom', Format: '>' });
    expect(show(layoutHost(base, data, 0), c)).toContain('DUPONT');
    expect(show(layoutHost(base, data, 1), c)).toContain('MARTIN');
    expect(show(base, c)).toContain('Nom');   // le mode Création montre la source
  });
  it('a date follows the four-digit year option as the host is made (O2 R1, R11)', () => {
    const d: LiveData = { info: { fields: [sf('Le', 'dateTime')], updatable: true, parameters: [] }, rows: [['2026-03-05 00:00:00']], notice: null };
    const c = ctl('textBox', { ControlSource: 'Le', Format: 'dd/mm/yy' });
    expect(show(layoutHost(base, d, 0), c)).toContain('05/03/26<');
    try {
      publishSettings({ ...DEFAULT_SETTINGS, fourDigitYearAll: true });
      expect(show(layoutHost(base, { ...d }, 0), c)).toContain('05/03/2026');
    } finally {
      publishSettings({ ...DEFAULT_SETTINGS });
    }
  });
  it('a bound check box is ticked from the record', () => {
    const c = ctl('checkBox', { ControlSource: 'Actif' });
    expect(show(layoutHost(base, data, 0), c)).toContain('is-on');
    expect(show(layoutHost(base, data, 1), c)).not.toContain('is-on');
  });
  it('composites keep their Design placeholder', () => {
    for (const c of [ctl('subform', { SourceObject: 'Lignes' }), ctl('optionGroup', { Caption: 'Mode' }), ctl('tabControl', { Pages: ['A', 'B'] }), ctl('label', { Caption: 'Titre' })])
      expect(show(layoutHost(base, data, 0), c)).toBe(show(base, c));
  });
  it('a calculated text box shows its localized expression, as in Design view', () => {
    const c = ctl('textBox', { ControlSource: '=IIf([Prix]>1.5,1,0)' });
    expect(show(layoutHost(base, data, 0), c)).toBe(show(base, c));
    expect(show(base, c)).toContain('VraiFaux');   // la forme française, pas l'expression enregistrée
  });
  it('an option button of a group keeps its Design look (its value is the group\'s)', () => {
    const b = { ...ctl('optionButton', { ControlSource: 'Actif', OptionValue: 2 }), name: 'Opt' };
    const g = ctl('optionGroup', { ControlSource: 'Choix' }, [b]);
    expect(show(layoutHost(base, data, 0), b, sec(g))).toBe(show(base, b, sec(g)));
  });
  it('a value that cannot be shown falls back to the placeholder, never throws', () => {
    const odd: LiveData = { ...data, rows: [new Proxy([], { get: () => { throw new Error('x'); } })] };
    const c = ctl('textBox', { ControlSource: 'Nom' });
    expect(show(layoutHost(base, odd, 0), c)).toBe(show(base, c));
  });
});

describe('viewHost (Création ↔ Page : le même concepteur, seuls l\'hôte et les gestes changent)', () => {
  it('Design view: the base host, no restriction', () => expect(viewHost('design', base, data, 0)).toEqual({ host: base }));
  it('Layout view: the live host and the restrictions, the same objects at each render', () => {
    const v = viewHost('layout', base, data, 1);
    expect(v.host).toBe(layoutHost(base, data, 1));
    expect(v.restrict).toBe(FORM_LAYOUT_RESTRICT);
    expect(v.restrict).toEqual({ toolbox: false, sectionBars: true, events: true });   // la boîte à outils reste (L2b)
  });
  it('Layout view before the records are read: the Design placeholders, already restricted', () =>
    expect(viewHost('layout', base, null, 0)).toEqual({ host: base, restrict: FORM_LAYOUT_RESTRICT }));
});

describe('extraDetailRows (Mode Page : un formulaire continu répète le Détail)', () => {
  const form = (DefaultView: string, controls: ControlDef[] = []): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { DefaultView },
    sections: [{ kind: 'detail', height: 600, props: {}, controls }] });
  const c = ctl('textBox', { ControlSource: 'Nom' });
  it('Single form, Design view, records not read yet: no copies', () => {
    expect(viewHost('layout', base, data, 0, form('single')).host.extraDetailRows).toBeUndefined();
    expect(viewHost('layout', base, data, 0).host.extraDetailRows).toBeUndefined();
    expect(viewHost('design', base, data, 0, form('continuous')).host).toBe(base);
    expect(viewHost('layout', base, null, 0, form('continuous')).host).toBe(base);
  });
  it('Continuous form with a subform in the Detail stays single: no copies', () =>
    expect(viewHost('layout', base, data, 0, form('continuous', [ctl('subform')])).host.extraDetailRows).toBeUndefined());
  it('Continuous form: the records after the current one, the same host at each render', () => {
    const h = viewHost('layout', base, data, 0, form('continuous')).host;
    expect(viewHost('layout', base, data, 0, form('continuous')).host).toBe(h);
    expect(h.extraDetailRows?.count).toBe(1);
    expect(html(h.extraDetailRows!.render(c, sec(c), 1))).toContain('martin');
    expect(html(h.renderControl(c, sec(c)))).toContain('dupont');
    expect(viewHost('layout', base, data, 1, form('continuous')).host.extraDetailRows?.count).toBe(0);
  });
  it('a copy that cannot be shown falls back to the placeholder', () => {
    const odd: LiveData = { ...data, rows: [['x'], new Proxy([], { get: () => { throw new Error('x'); } })] };
    const h = layoutHost(base, odd, 0, true);
    expect(html(h.extraDetailRows!.render(c, sec(c), 1))).toBe(show(base, c));
  });
});
