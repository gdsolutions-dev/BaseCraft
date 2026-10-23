import { describe, expect, it } from 'vitest';
import type { ControlDef, ControlKind, DesignDoc } from '../../shared/design/model';
import { defaultProps, type FieldType } from '../../shared/field-types';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import { datasheetColumns, firstRun, initialView, openingMode, runViewFor, visibleRange } from './views';

const ctl = (kind: ControlKind, name: string, props: Record<string, unknown> = {}, children?: ControlDef[]): ControlDef =>
  ({ kind, name, left: 0, top: 0, width: 1500, height: 300, props, ...(children ? { children } : {}) });
const label = (caption: string): ControlDef => ctl('label', `${caption}_L`, { Caption: caption });
const sf = (name: string, type: FieldType): SourceField => ({ name, type, props: defaultProps(type), origin: { table: 'Clients', field: name } });
const info: SourceInfo = { fields: [sf('N°', 'autoNumber'), sf('Nom', 'shortText'), sf('Ville', 'shortText')], updatable: true, keyTable: 'Clients', parameters: [] };
const docWith = (props: Record<string, unknown>, controls: ControlDef[] = []): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props,
  sections: [
    { kind: 'formHeader', height: 500, props: {}, controls: [ctl('textBox', 'Titre', { TabIndex: 0 })] },
    { kind: 'detail', height: 2000, props: {}, controls },
    { kind: 'formFooter', height: 0, props: {}, controls: [] },
  ],
});
const doc = docWith({}, [
  ctl('textBox', 'Ville', { ControlSource: 'Ville', TabIndex: 2 }, [label('Ville:')]),
  ctl('textBox', 'Nom', { ControlSource: 'Nom', TabIndex: 1 }, [label('Nom du client :')]),
  ctl('rectangle', 'Cadre'),
  ctl('textBox', 'Total', { ControlSource: '=1+1', TabStop: false }),   // no TabIndex: after, in document order; Tab Stop does not matter
  ctl('textBox', 'N°', { ControlSource: 'N°', TabIndex: 0 }, [label('N°')]),
  ctl('commandButton', 'Ok'),
]);

describe('form views', () => {
  it('visible range', () => {
    expect(visibleRange(0, 300, 30, 1000)).toEqual([0, 12]);
    expect(visibleRange(2980 * 30, 300, 30, 3000)).toEqual([2978, 2992]);
    expect(visibleRange(2990 * 30, 300, 30, 3000)).toEqual([2988, 3000]);
    expect(visibleRange(0, 300, 30, 0)).toEqual([0, 0]);
    expect(visibleRange(-50, 300, 30, 10)).toEqual([0, 10]);   // overscrolled (elastic): from the first row
  });

  it('datasheet columns follow tab order and label captions', () => {
    const cols = datasheetColumns(doc, info);
    expect(cols.map((c) => c.title)).toEqual(['N°', 'Nom du client', 'Ville', 'Total']);
    expect(cols.map((c) => c.field)).toEqual(['N°', 'Nom', 'Ville', null]);
    expect(cols[0]).toEqual({ control: 'N°', field: 'N°', title: 'N°', width: 100 });
  });

  it('datasheet columns: an option group is one column (not its options), a control with no label shows its name', () => {
    const d = docWith({}, [ctl('optionGroup', 'Choix', { ControlSource: 'Ville' }, [ctl('optionButton', 'Un', { OptionValue: 1 })]), ctl('checkBox', 'Coche')]);
    expect(datasheetColumns(d, info).map((c) => c.title)).toEqual(['Choix', 'Coche']);
  });

  it('initial view', () => {
    expect(initialView(docWith({ DefaultView: 'datasheet' }))).toBe('datasheet');
    expect(initialView(docWith({ DefaultView: 'continuous' }))).toBe('continuous');
    expect(initialView(docWith({}))).toBe('single');
    expect(initialView(docWith({ DefaultView: 'bizarre' }))).toBe('single');
    // Access: a form with a subform in its Detail cannot be shown as Continuous Forms (Single Form instead); in its header it can
    expect(initialView(docWith({ DefaultView: 'continuous' }, [ctl('subform', 'Lignes')]))).toBe('single');
    expect(runViewFor('run', docWith({ DefaultView: 'continuous' }, [ctl('subform', 'Lignes')]))).toBe('single');
    const inHeader = docWith({ DefaultView: 'continuous' });
    inHeader.sections[0].controls.push(ctl('subform', 'Lignes'));
    expect(initialView(inHeader)).toBe('continuous');
  });

  it('view from the tab mode', () => {
    expect(runViewFor('run', docWith({ DefaultView: 'continuous' }))).toBe('continuous');
    expect(runViewFor('run', docWith({ DefaultView: 'datasheet' }))).toBe('single');
    expect(runViewFor('datasheet', docWith({}))).toBe('datasheet');
    expect(openingMode(docWith({ DefaultView: 'datasheet' }))).toBe('datasheet');
    expect(openingMode(docWith({}))).toBe('run');
  });

  it('the opening view is decided once per tab', () => {
    expect(firstRun('docA')).toBe(true);
    expect(firstRun('docA')).toBe(false);
    expect(firstRun('docB')).toBe(true);
  });
});
