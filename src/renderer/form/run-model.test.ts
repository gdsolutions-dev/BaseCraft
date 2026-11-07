import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyCells } from './EmptyCells';
import type { ControlDef, ControlKind, DesignDoc, SectionDef } from '../../shared/design/model';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import type { RecordSnapshot } from './record-controller';
import { createLayout, membersOf } from '../../shared/design/layout-edit';
import { ctlAttrs, hasLabel, labelTarget, type RunCtx } from './controls/run-ctx';
import { twipsToPx } from '../designer/units';
import { BUILTIN_THEMES, DEFAULT_THEME, shade } from '../../shared/design/theme';
import { cssFamily } from '../../shared/fonts';
import { controlEnabled, controlLook, controlStyle, gridlineStyle, errorsByControl, layoutLabels, optionGroupValue, tabSequence } from './run-model';

const ctl = (kind: ControlKind, name: string, props: Record<string, unknown> = {}, at = { left: 0, top: 0, width: 1000, height: 300 }): ControlDef =>
  ({ kind, name, ...at, props });
const sectionWith = (...controls: ControlDef[]): SectionDef => ({ kind: 'detail', height: 2000, props: {}, controls });
const bound = (field: string, props: Record<string, unknown> = {}): ControlDef => ctl('textBox', field, { ControlSource: field, ...props });
const calcCtl = (src: string): ControlDef => ctl('textBox', 'Calc', { ControlSource: src });
const opt = (name: string, value: number): ControlDef => ctl('optionButton', name, { OptionValue: value });
const group = (options: ControlDef[]): ControlDef => ({ ...ctl('optionGroup', 'G', { ControlSource: 'Choix' }), children: options });
const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField =>
  ({ name, type, props: { ...defaultProps(type), ...props } as FieldProps, origin: { table: 'Clients', field: name } });
const info: SourceInfo = { fields: [sf('Nom', 'shortText'), sf('Email', 'shortText')], updatable: true, keyTable: 'Clients', parameters: [] };
const doc: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [sectionWith(bound('Nom'))] };
const snap = { status: 'ready', editable: true, busy: false, info } as RecordSnapshot;

describe('run model', () => {
  it('tab sequence', () => expect(tabSequence(sectionWith(ctl('textBox', 'A', { TabIndex: 1 }), ctl('textBox', 'B', { TabIndex: 0 }),
    ctl('textBox', 'C', { TabStop: false }), ctl('textBox', 'D', { Visible: false })))).toEqual(['B', 'A']));

  it('tab sequence: input controls only, document order without a TabIndex', () =>
    expect(tabSequence(sectionWith(ctl('label', 'L'), ctl('checkBox', 'Y'), ctl('commandButton', 'X'), ctl('rectangle', 'R')))).toEqual(['Y', 'X']));

  it('tab sequence: no disabled control; combo and list boxes and subforms stop', () =>
    expect(tabSequence(sectionWith(ctl('textBox', 'A'), ctl('textBox', 'B', { Enabled: false }), ctl('comboBox', 'C'), ctl('listBox', 'D'), ctl('subform', 'E'),
      ctl('checkBox', 'F'), ctl('subform', 'G', { TabStop: false })))).toEqual(['A', 'C', 'D', 'E', 'F']));

  it('tab sequence: page-1 TabIndex order is its own and leaves page 0 alone', () => {
    const mk = (a: number, b: number): SectionDef => sectionWith({ ...ctl('tabControl', 'Onglets'), children: [
      ctl('textBox', 'P0', { TabIndex: 0 }), ctl('textBox', 'Q1', { PageIndex: 1, TabIndex: a }), ctl('textBox', 'Q2', { PageIndex: 1, TabIndex: b })] });
    expect(tabSequence(mk(1, 0), { Onglets: 1 })).toEqual(['Onglets', 'Q2', 'Q1']);
    expect(tabSequence(mk(0, 1), { Onglets: 1 })).toEqual(['Onglets', 'Q1', 'Q2']);
    expect(tabSequence(mk(1, 0))).toEqual(tabSequence(mk(0, 1)));
  });

  it('tab sequence: a tab control is its strip, then the controls of its page shown, in their TabIndex order', () => {
    const tabs: ControlDef = { ...ctl('tabControl', 'Onglets', { Pages: ['Un', 'Deux'] }), children: [
      ctl('textBox', 'P1b', { TabIndex: 1 }), ctl('textBox', 'P1a', { TabIndex: 0 }), ctl('label', 'L'),
      ctl('textBox', 'P2', { PageIndex: 1 }), ctl('textBox', 'P1off', { TabStop: false })] };
    const s = sectionWith(ctl('textBox', 'Avant', { TabIndex: 0 }), tabs, ctl('textBox', 'Après', { TabIndex: 1 }));
    expect(tabSequence(s)).toEqual(['Avant', 'Après', 'Onglets', 'P1a', 'P1b']);
    expect(tabSequence(s, { Onglets: 1 })).toEqual(['Avant', 'Après', 'Onglets', 'P2']);
    expect(tabSequence(sectionWith(ctl('textBox', 'X', { TabIndex: 1 }), { ...tabs, props: { ...tabs.props, TabIndex: 0 } }))).toEqual(['Onglets', 'P1a', 'P1b', 'X']);
  });

  it('orphan errors', () => {
    const r = errorsByControl([{ field: 'Nom', code: 'required' }, { field: 'Email', code: 'duplicate' }], doc, info);
    expect(Object.keys(r.byControl)).toEqual(['Nom']);
    expect(r.orphan).toEqual([{ field: 'Email', code: 'duplicate' }]);
  });

  it('a field error never goes to an unbound control of the same name (its errors are the form own)', () => {
    const d: DesignDoc = { ...doc, sections: [sectionWith(ctl('textBox', 'Email'))] };
    expect(errorsByControl([{ field: 'Email', code: 'duplicate' }], d, info)).toEqual({ byControl: {}, orphan: [{ field: 'Email', code: 'duplicate' }] });
  });

  it('errors find a bound control nested in a group or a tab page, case ignored', () => {
    const nested: DesignDoc = { ...doc, sections: [sectionWith({ ...ctl('tabControl', 'Onglets'), children: [ctl('textBox', 'Courriel', { ControlSource: 'email' })] })] };
    expect(errorsByControl([{ field: 'Email', code: 'duplicate' }], nested, info).byControl).toEqual({ Courriel: { field: 'Email', code: 'duplicate' } });
  });

  it('style', () => {
    expect(controlStyle(ctl('textBox', 'X', { BackColor: 'theme:accent', FontSize: 12 }, { left: 567, top: 0, width: 1134, height: 340 })))
      .toMatchObject({ left: 37.8, width: 75.6, background: 'var(--bc-accent)', fontSize: 16 });
    expect(controlStyle(ctl('label', 'L'))).toMatchObject({ background: 'transparent', borderStyle: 'none' });   // catalog label defaults (C3)
    expect(controlStyle(ctl('textBox', 'Y', { BackColor: 'red' })).background).toBe('var(--bc-surface)');   // invalid -> descriptor default
    expect(controlStyle(ctl('rectangle', 'R', { BorderStyle: 'solid', BorderWidth: 0 }))).toMatchObject({ borderWidth: 1 });
    expect(controlStyle(ctl('textBox', 'F')).fontFamily).toBe('"Inter Variable", "Inter", sans-serif');
    expect(controlStyle(ctl('textBox', 'G', { FontName: 'Arial' })).fontFamily).toBe('"Liberation Sans", sans-serif');
  });

  it('style: alignment, a fixed color, bold', () => {
    expect(controlStyle(ctl('textBox', 'A', { TextAlign: 'right', BackColor: '#ffcc00', FontWeight: 'bold' })))
      .toMatchObject({ textAlign: 'right', background: '#ffcc00', fontWeight: 700 });
    expect(controlStyle(ctl('textBox', 'B', { BackStyle: 'transparent' })).background).toBe('transparent');
  });

  it('enabled/locked', () => {
    expect(controlEnabled(bound('N°'), snap, sf('N°', 'autoNumber'))).toEqual({ disabled: false, readOnly: true });
    expect(controlEnabled(bound('Nom', { Enabled: false }), snap, sf('Nom', 'shortText')).disabled).toBe(true);
    expect(controlEnabled(calcCtl('=1'), snap, null).readOnly).toBe(true);
    expect(controlEnabled(bound('Nom'), snap, sf('Nom', 'shortText'))).toEqual({ disabled: false, readOnly: false });
    expect(controlEnabled(bound('Nom', { Locked: true }), snap, sf('Nom', 'shortText')).readOnly).toBe(true);
    expect(controlEnabled(bound('Nom'), { ...snap, busy: true }, sf('Nom', 'shortText')).readOnly).toBe(true);
    expect(controlEnabled(bound('Nom'), { ...snap, editable: false }, sf('Nom', 'shortText')).readOnly).toBe(true);
    const computed = { ...sf('Total', 'number'), origin: undefined };   // a computed column of a query
    expect(controlEnabled(bound('Total'), { ...snap, info: { ...info, fields: [computed] } }, computed).readOnly).toBe(true);
  });

  it('a join query: a control on a field of another table than the key table is read-only', () => {
    const ville = { ...sf('Ville', 'shortText'), origin: { table: 'Villes', field: 'Nom' } };
    const join = { ...snap, info: { ...info, fields: [...info.fields, ville] } };
    expect(controlEnabled(bound('Ville'), join, ville).readOnly).toBe(true);
    expect(controlEnabled(bound('Nom'), join, join.info.fields[0]).readOnly).toBe(false);
  });

  it('unbound text box, check box and option group: editable whatever the record (Locked still locks); calculated: read-only', () => {
    for (const kind of ['textBox', 'checkBox', 'optionGroup'] as const) {
      expect(controlEnabled(ctl(kind, 'U'), { ...snap, editable: false, info: null }, null)).toEqual({ disabled: false, readOnly: false });
      expect(controlEnabled(ctl(kind, 'U', { Locked: true }), snap, null).readOnly).toBe(true);
    }
    expect(controlEnabled(calcCtl('=1'), snap, null).readOnly).toBe(true);
    expect(controlEnabled(bound('Absent'), snap, null).readOnly).toBe(true);   // bound to an unknown field: #Name?
  });

  it('option group value', () => {
    expect(optionGroupValue(group([opt('A', 1), opt('B', 2)]), 2)).toBe('B');
    expect(optionGroupValue(group([opt('A', 1), opt('B', 2)]), '1')).toBe('A');
    expect(optionGroupValue(group([opt('A', 1), opt('B', 2)]), null)).toBeNull();
    expect(optionGroupValue(group([opt('A', 1)]), 9)).toBeNull();
  });
});

describe('layout labels', () => {
  // Nom (étiquette « Nom du client : ») et Ville en Empilé ; Code et Pays en Tabulaire (étiquettes dans l'en-tête)
  const field = (name: string, top: number): ControlDef => ({ ...bound(name), top, children: [{ ...ctl('label', `L${name}`, { Caption: `${name} :` }), top }] });
  const d0: DesignDoc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [
    { kind: 'formHeader', height: 500, props: {}, controls: [] },
    { ...sectionWith(field('Nom', 0), field('Ville', 500), field('Code', 1000), field('Pays', 1500)) }] };
  const st = createLayout(d0, membersOf(d0, ['Nom', 'Ville']), 'stacked', { headerSection: 'formHeader' });
  const both = createLayout(st, membersOf(st, ['Code', 'Pays']), 'tabular', { headerSection: 'formHeader' });
  it('maps each Stacked label to its control; Tabular header labels (another section) are not linked', () =>
    expect(layoutLabels(both)).toEqual({ LNom: 'Nom', LVille: 'Ville' }));
  it('no layout: none', () => expect(layoutLabels(d0)).toEqual({}));
});

describe('layout labels: control names that are Object.prototype keys', () => {
  const named = (name: string, top: number): ControlDef => ({ ...bound(name), name, top, children: [{ ...ctl('label', `L${name}`, { Caption: name }), top }] });
  const plain: DesignDoc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [sectionWith(named('constructor', 0), named('toString', 500), ctl('textBox', 'valueOf'))] };
  const laid = createLayout(plain, membersOf(plain, ['constructor', 'toString']), 'stacked', { headerSection: 'formHeader' });
  it('a form with or without a layout computes its labels, links and names without throwing', () => {
    for (const d of [plain, laid]) {
      const x = { errors: {}, lists: {}, stops: new Set(), id: (n: string) => `v-${n}`, events: () => ({}), labels: layoutLabels(d) } as unknown as RunCtx;
      const s = d.sections[0];
      const targets = s.controls.map((c) => labelTarget(c, s, x)?.name ?? null);
      expect(targets).toEqual(d === laid ? [null, null, null, 'constructor', 'toString'] : [null, null, null]);
      expect(s.controls.map((c) => hasLabel(c, x))).toEqual(d === laid ? [true, true, false, false, false] : [true, true, false]);
      expect(ctlAttrs(s.controls[2], x)['aria-label']).toBe('valueOf');
    }
  });
});

describe('margins and gridlines', () => {
  it('a margin is the text inset, only on text-bearing kinds', () => {
    expect(controlLook(ctl('textBox', 'A', { LeftMargin: 90 })).paddingLeft).toBe(`calc(var(--bc-ix, 0px) + ${twipsToPx(90)}px)`);
    expect(controlLook(ctl('textBox', 'A')).paddingLeft).toBeUndefined();
    expect(controlLook(ctl('checkBox', 'C', { LeftMargin: 90 })).paddingLeft).toBeUndefined();
  });

  it('a margin adds to the stylesheet inset (None < Narrow < Medium < Wide); margin 0 adds nothing', () => {
    for (const kind of ['textBox', 'label'] as const) {
      const look = controlLook(ctl(kind, 'A', { LeftMargin: 30, TopMargin: 30 }));
      expect(look.paddingLeft).toBe('calc(var(--bc-ix, 0px) + 2px)');
      expect(look.paddingTop).toBe('calc(var(--bc-iy, 0px) + 2px)');
      const none = controlLook(ctl(kind, 'A', { LeftMargin: 0 }));
      expect(none.paddingLeft).toBeUndefined();
      expect(none.paddingTop).toBeUndefined();
    }
  });

  it('gridlineStyle: null by default, else borders on the cell rectangle (control grown by its padding)', () => {
    expect(gridlineStyle(ctl('textBox', 'A'))).toBeNull();
    const g = gridlineStyle(ctl('textBox', 'A', { GridlineStyleTop: 'solid', GridlineWidthTop: 2, GridlineColor: '#ff0000', LeftPadding: 90, TopPadding: 30 },
      { left: 1000, top: 500, width: 1000, height: 300 }))!;
    expect(g.borderTop).toBe('2px solid #ff0000');
    expect(g.borderBottom).toBeUndefined();
    expect(g).toMatchObject({ position: 'absolute', pointerEvents: 'none', left: twipsToPx(910), top: twipsToPx(470), width: twipsToPx(1090), height: twipsToPx(330) });
  });
});

describe('empty cells in Form view (L5)', () => {
  const lay = { id: 'L1', kind: 'stacked', left: 200, tops: { detail: 100 }, cols: [1000], rows: [{ section: 'detail', height: 300 }, { section: 'detail', height: 300 }],
    cells: [{ row: 0, col: 0, control: null, props: { BackStyle: 'normal', BackColor: '#ff0000', GridlineStyleTop: 'solid' } }, { row: 1, col: 0, control: null }] };
  const d = { formatVersion: '1.0', recordSource: null, props: { Layouts: [lay] }, sections: [{ kind: 'detail', height: 2000, props: {}, controls: [ctl('textBox', 'A')] }] } as unknown as DesignDoc;
  const html = renderToStaticMarkup(createElement(EmptyCells, { doc: d, section: d.sections[0] }));
  it('a formatted cell draws its back colour and a gridline sibling; a bare one nothing', () => {
    expect(html).toContain('data-testid="form-cell-L1-0-0"');
    expect(html).toContain('form-cell-grid-L1-0-0');
    expect(html).toContain('background:#ff0000');
    expect(html).not.toContain('L1-1-0');
    expect(html).not.toMatch(/tabindex|role=/i);
  });
  it('no tab stop is added', () => expect(tabSequence(d.sections[0])).toEqual(['A']));
});

describe('style with the effective theme (F2)', () => {
  const second = BUILTIN_THEMES.find((t) => t.name === 'Océan')!;
  const box = ctl('textBox', 'T', { ForeColor: 'theme:accent1@-25', FontName: '(Headings)' });
  it('a slot reference follows the theme and the mode; the headings font follows the theme', () => {
    const light = controlStyle(box, { theme: second, mode: 'light' }), dark = controlStyle(box, { theme: second, mode: 'dark' });
    expect(light.color).toBe(shade(second.colors.light.accent1, 0.25));
    expect(dark.color).toBe(shade(second.colors.dark.accent1, 0.25));
    expect(String(light.fontFamily)).toContain(cssFamily(second.fonts.major));
    expect(controlStyle(box, { theme: DEFAULT_THEME, mode: 'light' }).color).not.toBe(light.color);
    expect(controlStyle(box, { theme: DEFAULT_THEME, mode: 'light' }).fontFamily).toBe('"Inter Variable", "Inter", sans-serif');
  });
  it('a hex stays, a UI token stays a variable, without a context too', () => {
    const hex = ctl('textBox', 'H', { ForeColor: '#abcdef' });
    expect(controlStyle(hex, { theme: second, mode: 'dark' }).color).toBe('#abcdef');
    expect(controlStyle(hex, { theme: second, mode: 'light' }).color).toBe('#abcdef');
    expect(controlStyle(ctl('textBox', 'U'), { theme: second, mode: 'dark' }).background).toBe('var(--bc-surface)');
  });
  it('a theme font that is not embedded falls back without throwing', () => {
    const odd = { ...second, fonts: { name: 'x', major: 'Comic Sans MS', minor: 'Comic Sans MS' } };
    expect(() => controlStyle(box, { theme: odd, mode: 'light' })).not.toThrow();
  });
});
