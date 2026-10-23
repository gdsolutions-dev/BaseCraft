import { describe, expect, it } from 'vitest';
import type { ControlDef, ControlKind, DesignDoc } from '../../shared/design/model';
import { designerReducer, findControl, initDesigner, type Selection } from './designer-model';
import { currentValue, decimalStep, fillAction, formatAction, formatCommands, outlineAction, selectionSet } from './format-commands';

const ctl = (kind: ControlKind, name: string, props: Record<string, unknown> = {}): ControlDef => ({ kind, name, left: 0, top: 0, width: 1418, height: 340, props });
const doc: DesignDoc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [
  { kind: 'detail', height: 2268, props: {}, controls: [ctl('textBox', 'Nom'), ctl('label', 'Titre'), ctl('line', 'Ligne')] }] };
const sel = (...names: string[]): Selection => ({ kind: 'controls', names });
const ctlT = (name: string) => ({ kind: 'control' as const, name });
const withProps = (d: DesignDoc, byName: Record<string, Record<string, unknown>>): DesignDoc => ({ ...d, sections: d.sections.map((s) => ({
  ...s, controls: s.controls.map((c) => (byName[c.name] ? { ...c, props: { ...c.props, ...byName[c.name] } } : c)) })) });

describe('Format tab commands', () => {
  it('bold toggles on the selection, off when every target is already bold', () => {
    expect(formatAction(doc, 'form', sel('Nom', 'Titre'), 'bold')).toEqual({ type: 'setProp', targets: [ctlT('Nom'), ctlT('Titre')], name: 'FontWeight', value: 'bold' });
    expect(formatAction(withProps(doc, { Nom: { FontWeight: 'bold' }, Titre: { FontWeight: 'bold' } }), 'form', sel('Nom', 'Titre'), 'bold')).toMatchObject({ value: 'normal' });
    expect(formatAction(withProps(doc, { Nom: { FontItalic: true } }), 'form', sel('Nom', 'Titre'), 'italic')).toMatchObject({ name: 'FontItalic', value: true });
    expect(formatAction(withProps(doc, { Nom: { FontUnderline: true } }), 'form', sel('Nom'), 'underline')).toMatchObject({ name: 'FontUnderline', value: false });
  });
  it('only the controls the property applies to', () => {
    expect(formatAction(doc, 'form', sel('Nom', 'Ligne'), 'alignCenter')).toEqual({ type: 'setProp', targets: [ctlT('Nom')], name: 'TextAlign', value: 'center' });
    expect(formatAction(doc, 'form', sel('Ligne'), 'bold')).toBeNull(); expect(formatAction(doc, 'form', { kind: 'doc' }, 'bold')).toBeNull();
    expect(formatAction(doc, 'form', sel('Titre'), 'currencyFormat')).toBeNull();   // Format : zones de texte et listes déroulantes
  });
  it('number formats and decimals', () => {
    expect(formatAction(doc, 'form', sel('Nom'), 'currencyFormat')).toMatchObject({ name: 'Format', value: 'currency' });
    expect(formatAction(doc, 'form', sel('Nom'), 'percentFormat')).toMatchObject({ name: 'Format', value: 'percent' });
    expect(formatAction(doc, 'form', sel('Nom'), 'commaFormat')).toMatchObject({ name: 'Format', value: 'standard' });
    expect(formatAction(doc, 'form', sel('Nom'), 'increaseDecimals')).toMatchObject({ name: 'DecimalPlaces', value: '3' });   // 'auto' counts as 2
    expect(formatAction(withProps(doc, { Nom: { DecimalPlaces: '0' } }), 'form', sel('Nom'), 'decreaseDecimals')).toMatchObject({ name: 'DecimalPlaces', value: '0' });
    expect([decimalStep('0', -1), decimalStep('15', 1), decimalStep('auto', -1)]).toEqual(['0', '15', '1']);
  });
  it('decimals step each control from its own value (one undo step)', () => {
    const d = { ...doc, sections: [{ ...doc.sections[0], controls: [...doc.sections[0].controls, ctl('textBox', 'Prix', { DecimalPlaces: '5' })] }] };
    const a = formatAction(d, 'form', sel('Nom', 'Prix'), 'increaseDecimals')!;
    expect(a.type).toBe('edit');
    const s = designerReducer(initDesigner(d), a);
    expect([findControl(s.doc, 'Nom')!.control.props.DecimalPlaces, findControl(s.doc, 'Prix')!.control.props.DecimalPlaces]).toEqual(['3', '6']);
    expect(s.past).toHaveLength(1);
  });
  it('several properties are one undo step', () => {
    const a = selectionSet(doc, 'form', sel('Titre'), { BackColor: 'theme:accent', BackStyle: 'normal' })!;
    expect(a.type).toBe('edit'); const s = designerReducer(initDesigner(doc), a);
    expect(findControl(s.doc, 'Titre')!.control.props).toMatchObject({ BackColor: 'theme:accent', BackStyle: 'normal' }); expect(s.past).toHaveLength(1);
    expect(selectionSet(doc, 'form', sel('Ligne'), { FontName: 'Carlito' })).toBeNull();
  });
  it('shape outline makes a transparent border solid, and only that one', () => {
    expect(outlineAction(doc, 'form', sel('Nom'), 'theme:accent')).toEqual({ type: 'setProp', targets: [ctlT('Nom')], name: 'BorderColor', value: 'theme:accent' });
    const d = withProps(doc, { Titre: { BorderStyle: 'transparent' }, Ligne: { BorderStyle: 'dashed' } });
    const s = designerReducer(initDesigner(d), outlineAction(d, 'form', sel('Titre', 'Ligne'), '#ff0000')!);
    expect(findControl(s.doc, 'Titre')!.control.props).toMatchObject({ BorderColor: '#ff0000', BorderStyle: 'solid' });
    expect(findControl(s.doc, 'Ligne')!.control.props).toMatchObject({ BorderColor: '#ff0000', BorderStyle: 'dashed' });
    expect(s.past).toHaveLength(1);
  });
  it('the current value is shown only when every target has it (none for a mixed selection)', () => {
    expect(currentValue(withProps(doc, { Nom: { FontSize: 14 }, Titre: { FontSize: 14 } }), 'form', sel('Nom', 'Titre', 'Ligne'), 'FontSize')).toBe(14);
    expect(currentValue(withProps(doc, { Nom: { FontSize: 14 } }), 'form', sel('Nom', 'Titre'), 'FontSize')).toBeUndefined();
    expect(currentValue(doc, 'form', sel('Ligne'), 'FontSize')).toBeUndefined();
  });
  it('a report: its own defaults (a text box has a transparent border, made solid by the outline)', () => {
    const rep: DesignDoc = { ...doc, sections: [{ ...doc.sections[0], controls: [ctl('textBox', 'Total')] }] };
    const s = designerReducer(initDesigner(rep, 'report'), outlineAction(rep, 'report', sel('Total'), 'theme:accent')!);
    expect(findControl(s.doc, 'Total')!.control.props).toEqual({ BorderColor: 'theme:accent', BorderStyle: 'solid' });
    expect(outlineAction(rep, 'form', sel('Total'), 'theme:accent')).toMatchObject({ type: 'setProp', name: 'BorderColor' });   // solid already in a form
    expect(formatAction(rep, 'report', sel('Total'), 'alignRight')).toEqual({ type: 'setProp', targets: [ctlT('Total')], name: 'TextAlign', value: 'right' });
  });
  it('background colour on a report: a transparent box becomes normal (else the colour would not show), only that one, one undo step', () => {
    const rep: DesignDoc = { ...doc, sections: [{ ...doc.sections[0], controls: [ctl('textBox', 'Total'), ctl('label', 'Titre', { BackStyle: 'normal' })] }] };
    const s = designerReducer(initDesigner(rep, 'report'), fillAction(rep, 'report', sel('Total', 'Titre'), 'theme:danger')!);
    expect(findControl(s.doc, 'Total')!.control.props).toEqual({ BackColor: 'theme:danger', BackStyle: 'normal' });
    expect(findControl(s.doc, 'Titre')!.control.props).toEqual({ BackStyle: 'normal', BackColor: 'theme:danger' });
    expect(s.past).toHaveLength(1);
    expect(fillAction(doc, 'form', sel('Nom'), 'theme:danger')).toEqual({ type: 'setProp', targets: [ctlT('Nom')], name: 'BackColor', value: 'theme:danger' });
    expect(fillAction(doc, 'form', sel('Ligne'), 'theme:danger')).toBeNull();
  });
  it('without a selected control only Select All and Object are registered (the ribbon greys the others)', () => {
    const none = formatCommands(() => initDesigner(doc), () => {}, () => {}, 0);
    expect(Object.keys(none).sort()).toEqual(['objectList', 'selectAll']);
    expect(Object.keys(formatCommands(() => initDesigner(doc), () => {}, () => {}, 1))).toEqual(expect.arrayContaining(['bold', 'font', 'shapeOutline', 'decreaseDecimals']));
  });
});
