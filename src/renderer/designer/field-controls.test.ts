import { describe, expect, it } from 'vitest';
import type { DesignDoc } from '../../shared/design/model';
import type { FieldProps } from '../../shared/field-types';
import type { SourceField } from '../../shared/record-source';
import { designerReducer, initDesigner } from './designer-model';
import { boundControlWithLabel, controlKindFor } from './field-controls';
import { MAX_TWIPS } from './units';

const field = (name: string, props: Partial<FieldProps> = {}): SourceField => ({ name, type: props.type ?? 'shortText',
  props: { type: 'shortText', required: false, indexed: 'no', primaryKey: false, ...props } });
const doc: DesignDoc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [
  { kind: 'detail', height: 2268, props: {}, controls: [
    { kind: 'textBox', name: 'Nom', left: 1418, top: 0, width: 2268, height: 340, props: { TabIndex: 0 } },
    { kind: 'label', name: 'Titre', left: 0, top: 500, width: 2268, height: 340, props: {} }] },
] };
const opts = { objectKind: 'form' as const, labelSuffix: 'Étiquette' };

describe('field controls', () => {
  it('kind as Access picks it', () => {
    expect(controlKindFor(field('A'))).toBe('textBox');
    expect(controlKindFor(field('A', { type: 'yesNo' }))).toBe('checkBox');
    expect(controlKindFor(field('A', { lookup: { kind: 'values', values: ['a'], limitToList: false } }))).toBe('comboBox');
    expect(controlKindFor(field('A', { lookup: { kind: 'values', values: ['a'], limitToList: false, displayControl: 'listBox' } }))).toBe('listBox');
    expect(controlKindFor(field('A', { lookup: { kind: 'table', table: 'T', boundField: 'x', limitToList: false } }))).toBe('textBox');   // ancien lookup
    expect(controlKindFor(field('A', { type: 'dateTime', lookup: { kind: 'values', values: ['a'], limitToList: false } }))).toBe('textBox');   // type sans lookup
  });
  it('bound text box with its attached label on the left', () => {
    const [c] = boundControlWithLabel(doc, field('Ville', { caption: 'Commune' }), { section: 0, left: 2000, top: 600 }, opts);
    expect(c).toMatchObject({ kind: 'textBox', name: 'Ville', left: 2000, top: 600, width: 2268, height: 340, props: { ControlSource: 'Ville', TabIndex: 1 } });
    expect(c.children).toEqual([{ kind: 'label', name: 'Ville_Étiquette', left: 2000 - 1418, top: 600, width: 1361, height: 340, props: { Caption: 'Commune:' } }]);
  });
  it('names made unique; label kept inside the section; no TabIndex in a report', () => {
    const [c] = boundControlWithLabel(doc, field('nom'), { section: 0, left: 100, top: 0 }, { ...opts, objectKind: 'report' });
    expect(c.name).toBe('nom1'); expect(c.props.ControlSource).toBe('nom'); expect(c.left).toBe(1418); expect(c.children![0].left).toBe(0);
    expect(c.props).not.toHaveProperty('TabIndex'); expect(c.children![0].props.Caption).toBe('nom:');
  });
  it('a drop near the bottom grows the section; never beyond the Access limit', () => {
    const at = { section: 0, left: 2000, top: 2200 };
    const s = designerReducer(initDesigner(doc, 'form'), { type: 'insert', section: 0, controls: boundControlWithLabel(doc, field('Ville'), at, opts) });
    expect(s.doc.sections[0].height).toBe(2200 + 340);
    const [c] = boundControlWithLabel(doc, field('Ville'), { section: 0, left: MAX_TWIPS, top: MAX_TWIPS }, opts);
    expect(c.top + c.height).toBe(MAX_TWIPS); expect(c.left + c.width).toBe(MAX_TWIPS); expect(c.children![0].top).toBe(c.top);
  });
  it('check box is narrow', () => expect(boundControlWithLabel(doc, field('Actif', { type: 'yesNo' }), { section: 0, left: 2000, top: 0 }, opts)[0]).toMatchObject({ kind: 'checkBox', width: 284 }));
  it('lookup copied one to one', () => {
    const [v] = boundControlWithLabel(doc, field('Pays', { lookup: { kind: 'values', values: ['FR', 'BE'], limitToList: true, columnCount: 1, columnWidths: [0, 1417], boundColumn: 1 } }),
      { section: 0, left: 2000, top: 0 }, opts);
    expect(v.props).toEqual({ ControlSource: 'Pays', TabIndex: 1, RowSourceType: 'valueList', RowSource: 'FR;BE', BoundColumn: 1, ColumnCount: 1, ColumnWidths: '0;1417', LimitToList: true });
    const [t] = boundControlWithLabel(doc, field('Client', { type: 'number', lookup: { kind: 'table', table: 'Clients', limitToList: true, displayControl: 'listBox' } }),
      { section: 0, left: 2000, top: 0 }, opts);
    const [h] = boundControlWithLabel(doc, field('Ville', { lookup: { kind: 'values', values: ['Nom', 'Lyon'], limitToList: false, columnHeads: true } }),
      { section: 0, left: 2000, top: 0 }, opts);
    expect(h.props.ColumnHeads).toBe(true);
    expect(t.kind).toBe('listBox'); expect(t.props).toEqual({ ControlSource: 'Client', TabIndex: 1, RowSourceType: 'tableQuery', RowSource: 'Clients' });   // LimitToList : zone de liste déroulante seulement
  });
});
