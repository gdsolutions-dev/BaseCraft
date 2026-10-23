import { describe, expect, it } from 'vitest';
import type { ControlDef, ControlKind, DesignDoc, SectionDef } from '../../shared/design/model';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import type { RecordSnapshot } from './record-controller';
import { controlEnabled, controlStyle, errorsByControl, optionGroupValue, tabSequence } from './run-model';

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
