import { describe, expect, it } from 'vitest';
import type { ControlDef } from '../../shared/design/model';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import { boundField, controlTexts, isUnbound } from './control-values';

const NBSP = String.fromCharCode(0xa0); // fr-FR percent (as in format.test.ts)
const bound = (field: string, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind: 'textBox', name: field, left: 0, top: 0, width: 1000, height: 300, props: { ControlSource: field, ...props } });
const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField =>
  ({ name, type, props: { ...defaultProps(type), ...props } as FieldProps });
const info: SourceInfo = { fields: [sf('Prix', 'number'), sf('Nom', 'shortText')], updatable: true, keyTable: 'T', parameters: [] };

describe('boundField', () => {
  it('a field name, case ignored', () => expect(boundField(bound('prix'), info)?.name).toBe('Prix'));
  it('none for an expression, an empty source, an unknown field', () => {
    expect(boundField(bound('=[Prix]'), info)).toBeNull();
    expect(boundField(bound(''), info)).toBeNull();
    expect(boundField({ ...bound(''), props: {} }, info)).toBeNull();
    expect(boundField(bound('Absent'), info)).toBeNull();
  });
});

describe('controlTexts', () => {
  it('control texts use control format then field format', () => {
    expect(controlTexts(bound('Prix', { Format: 'percent' }), sf('Prix', 'number', { numberSize: 'double', format: 'fixed' }), 0.5, undefined, { locale: 'fr-FR', lang: 'fr' }).display).toBe(`50,00${NBSP}%`);
    expect(controlTexts(bound('Prix'), sf('Prix', 'number', { numberSize: 'double' }), 0.5, '0,7', { locale: 'fr-FR', lang: 'fr' })).toEqual({ display: '0,7', edit: '0,7' });
  });
  it('empty control format falls back, decimal places stored as text', () => {
    const frCtx = { locale: 'fr-FR', lang: 'fr' as const };
    expect(controlTexts(bound('P', { Format: '' }), sf('P', 'number', { numberSize: 'double', format: 'fixed' }), 2, undefined, frCtx).display).toBe('2,00');
    expect(controlTexts(bound('P', { Format: 'fixed', DecimalPlaces: '0' }), sf('P', 'number', { numberSize: 'double' }), 2, undefined, frCtx).display).toBe('2');
  });
  it('field format and edit text when the control sets none; a typed null is blank', () => {
    const frCtx = { locale: 'fr-FR', lang: 'fr' as const };
    expect(controlTexts(bound('P'), sf('P', 'number', { numberSize: 'double', format: 'fixed', decimalPlaces: 1 }), 2.26, undefined, frCtx))
      .toEqual({ display: '2,3', edit: '2,26' });
    expect(controlTexts(bound('P', { DecimalPlaces: 'auto' }), sf('P', 'number', { numberSize: 'double', format: 'fixed', decimalPlaces: 1 }), 2, undefined, frCtx).display)
      .toBe('2,00');
    expect(controlTexts(bound('P'), sf('P', 'number'), 2, null, frCtx)).toEqual({ display: '', edit: '' });
  });
});

describe('isUnbound', () => {
  it('an input control without Control Source, combo and list boxes included (Access: a search list)', () => {
    for (const kind of ['textBox', 'checkBox', 'optionGroup', 'comboBox', 'listBox'] as const) expect(isUnbound({ ...bound(''), kind, props: {} })).toBe(true);
    expect(isUnbound({ ...bound('Nom'), kind: 'comboBox' })).toBe(false);
    expect(isUnbound({ ...bound(''), kind: 'label', props: {} })).toBe(false);
  });
});
