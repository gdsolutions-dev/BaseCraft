import { describe, expect, it } from 'vitest';
import { propertiesFor } from '../../shared/design/properties';
import type { DesignDoc } from '../../shared/design/model';
import { chrome, formWinOf } from './form-window';

const doc = (props: Record<string, unknown>) => ({ formatVersion: '1.0', props, sections: [] }) as unknown as DesignDoc;

describe('form window properties', () => {
  it('are in the form\'s property sheet, tabs as Access', () => {
    const tab = (n: string) => propertiesFor('form').find((d) => d.name === n)?.tab;
    expect(['AutoResize', 'AutoCenter', 'BorderStyle', 'ControlBox', 'MinMaxButtons', 'CloseButton'].map(tab)).toEqual(Array(6).fill('format'));
    expect([tab('PopUp'), tab('Modal')]).toEqual(['other', 'other']);
  });
  it('default to a sizable, resizing window with every button', () => {
    expect(formWinOf(doc({}), 3)).toMatchObject({ popup: false, modal: false, autoResize: true, autoCenter: false, border: 'sizable', minMax: 'both', closeButton: true, controlBox: true, token: 3 });
  });
  it('chrome: a dialog border has no minimize or maximize, none has no bar, a sizable one resizes', () => {
    const c = (p: Record<string, unknown>) => chrome(formWinOf(doc(p), 0));
    expect(c({ BorderStyle: 'dialog' })).toMatchObject({ bar: true, min: false, max: false, close: true, resize: false });
    expect(c({ BorderStyle: 'none' })).toMatchObject({ bar: false, close: false, resize: false });
    expect(c({ MinMaxButtons: 'min', CloseButton: false })).toMatchObject({ min: true, max: false, close: false, resize: true });
    expect(c({ ControlBox: false })).toMatchObject({ bar: true, min: false, close: false });
  });
});
