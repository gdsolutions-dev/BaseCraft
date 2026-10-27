import { describe, expect, it } from 'vitest';
import type { ControlDef, ControlKind, SectionDef } from '../../shared/design/model';
import { validateDesignDoc } from '../../shared/design/model';
import type { FieldProps, FieldType } from '../../shared/field-types';
import type { RecordSourceRef, SourceField, SourceInfo } from '../../shared/record-source';
import { clients } from '../../shared/test-fixtures';
import { findControl } from '../designer/designer-model';
import { autoForm, autoTabOrder, firstFreeName, formLabels, controlKindFor, emptyFormDoc, fieldControls, nextFreeTop, nextTabIndex, parseFormDoc, shouldReload, toggleHeaderFooter, uniqueFormName, type FormLabels } from './form-def';

const PREFIX: Record<ControlKind, string> = { label: 'Étiquette', textBox: 'Texte', checkBox: 'Case', optionGroup: 'Cadre', optionButton: 'Option',
  comboBox: 'Modifiable', listBox: 'Liste', commandButton: 'Commande', subform: 'Enfant', image: 'Image', line: 'Trait', rectangle: 'Rectangle',
  pageBreak: 'SautPage', tabControl: 'OngletCtl' };
const labels: FormLabels = { prefix: (k) => PREFIX[k], tabPage: (n) => `Page${n}` };
const at = { section: 1, left: 1701, top: 0 };
const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField =>
  ({ name, type, props: { type, required: false, indexed: 'no', primaryKey: false, ...props } });
const ctl = (kind: ControlKind, name: string, props: Record<string, unknown> = {}, g: Partial<ControlDef> = {}): ControlDef =>
  ({ kind, name, left: 0, top: 0, width: 1418, height: 340, props, ...g });
const sectionWith = (...controls: ControlDef[]): SectionDef => ({ kind: 'detail', height: 2268, props: {}, controls });

describe('form definition', () => {
  it('parse keeps unknown keys, drops bad controls', () => {
    const { doc, dropped } = parseFormDoc({ formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { zz: 1 }, sections: [
      { kind: 'detail', height: 2268, props: {}, controls: [ctl('textBox', 'Nom', { zz: 2 }), ctl('textBox', 'nom'), { kind: 'blob', name: 'X' }, { ...ctl('label', 'Neg'), left: -5 }] }] });
    expect(dropped).toBe(3); expect(doc.props.zz).toBe(1); expect(doc.sections.map((s) => s.kind)).toEqual(['formHeader', 'detail', 'formFooter']);
    expect(findControl(doc, 'Nom')!.control.props.zz).toBe(2);
  });
  it('drops a child alone, a control beyond MAX_TWIPS, keeps other kinds of sections after the form ones', () => {
    const { doc, dropped } = parseFormDoc({ formatVersion: '1.0', recordSource: null, props: {}, zz: 'doc', sections: [
      { kind: 'pageHeader', height: 0, props: {}, controls: [] },
      { kind: 'detail', height: 100, props: {}, zz: 's', controls: [{ ...ctl('optionGroup', 'G'), children: [ctl('optionButton', 'O1'), { ...ctl('optionButton', 'O2'), width: 'x' }] },
        { ...ctl('textBox', 'Loin'), left: 40000 }] }] });
    expect(dropped).toBe(2);
    expect(doc.sections.map((s) => s.kind)).toEqual(['formHeader', 'detail', 'formFooter', 'pageHeader']);
    expect(findControl(doc, 'G')!.control.children!.map((c) => c.name)).toEqual(['O1']);
    expect((doc as unknown as { zz: string }).zz).toBe('doc'); expect((doc.sections[1] as unknown as { zz: string }).zz).toBe('s');
    expect(doc.sections[0]).toMatchObject({ height: 0, props: { Visible: false }, controls: [] });
  });
  it('a bad section height is repaired (integer twips in 0..MAX_TWIPS), not refused', () => {
    const at = (height: unknown) => parseFormDoc({ formatVersion: '1.0', sections: [{ kind: 'detail', height, props: {}, controls: [] }] }).doc.sections[1].height;
    expect([at(-5), at(12.6), at('x'), at(99999), at(null)]).toEqual([0, 13, 0, 31680, 0]);
    expect(() => parseFormDoc({ formatVersion: '1.0', sections: [{ kind: 'zz', height: 0, props: {}, controls: [] }] })).toThrow(expect.objectContaining({ code: 'invalidDefinition' }));
  });
  it('unreadable definition', () => { for (const d of [null, 'x', { formatVersion: '2.0', sections: [] }, { formatVersion: '1.0' }]) expect(() => parseFormDoc(d)).toThrow(expect.objectContaining({ code: 'invalidDefinition' })); });
  it('absent record source and missing props are tolerated; a bad one is flagged', () => { const r = parseFormDoc({ formatVersion: '1.0', sections: [] });
    expect(r).toMatchObject({ badSource: false, dropped: 0 }); expect(r.doc.recordSource).toBeNull(); expect(r.doc.props).toEqual({});
    const bad = parseFormDoc({ formatVersion: '1.0', recordSource: { kind: 'zz' }, sections: [] }); expect(bad.badSource).toBe(true); expect(bad.doc.recordSource).toBeNull(); });
  it('empty form', () => {
    const d = emptyFormDoc({ kind: 'table', name: 'Clients' });
    expect(d).toMatchObject({ formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 } });
    expect(d.sections.map((s) => [s.kind, s.height, s.props.Visible])).toEqual([['formHeader', 0, false], ['detail', 2268, undefined], ['formFooter', 0, false]]);
  });
  it('field controls by type', () => {
    expect(controlKindFor(sf('Actif', 'yesNo'))).toBe('checkBox'); expect(controlKindFor(sf('Notes', 'longText'))).toBe('textBox');
    expect(controlKindFor(sf('Client', 'number', { lookup: { kind: 'table', table: 'Clients', boundColumn: 1, columnCount: 2, columnWidths: [0, 1417], limitToList: true } }))).toBe('comboBox');
    expect(controlKindFor(sf('Statut', 'shortText', { lookup: { kind: 'values', values: ['A', 'B'], limitToList: false, displayControl: 'listBox' } }))).toBe('listBox');
    expect(controlKindFor(sf('Client', 'number', { lookup: { kind: 'table', table: 'Clients', boundField: 'N°', displayFields: ['Nom'], limitToList: true } }))).toBe('textBox');   // legacy lookup
    expect(controlKindFor(sf('Champ', 'shortText', { lookup: { kind: 'fieldList', table: 'Clients', limitToList: false } }))).toBe('textBox');
    const [c] = fieldControls(emptyFormDoc(null), sf('Nom', 'shortText', { caption: 'Nom du client' }), { section: 1, left: 1701, top: 0 }, labels);
    expect(c).toMatchObject({ kind: 'textBox', name: 'Nom', props: { ControlSource: 'Nom' }, children: [{ kind: 'label', props: { Caption: 'Nom du client:' } }] });
    expect(c.children![0].props.BorderStyle).toBeUndefined();   // catalog label default (C3), not written
  });
  it('lookup becomes row source (A2 Access columns, one to one)', () => {
    const [c] = fieldControls(emptyFormDoc(null), sf('Client', 'number', { lookup: { kind: 'table', table: 'Clients', boundColumn: 1, columnCount: 2, columnWidths: [0, 1417], limitToList: true } }), at, labels);
    expect(c).toMatchObject({ kind: 'comboBox', props: { RowSourceType: 'tableQuery', RowSource: 'Clients', BoundColumn: 1, ColumnCount: 2, ColumnWidths: '0;1417', LimitToList: true } });
    const [v] = fieldControls(emptyFormDoc(null), sf('Statut', 'shortText', { lookup: { kind: 'values', values: ['Ouverte', 'Fermée'], limitToList: false } }), at, labels);
    expect(v.props).toMatchObject({ RowSourceType: 'valueList', RowSource: 'Ouverte;Fermée', LimitToList: false }); expect(v.props.ColumnCount).toBeUndefined();
    const [l] = fieldControls(emptyFormDoc(null), sf('Statut', 'shortText', { lookup: { kind: 'values', values: ['A'], limitToList: true, displayControl: 'listBox' } }), at, labels);
    expect(l.kind).toBe('listBox'); expect(l.props.LimitToList).toBeUndefined();
  });
  it('next free top and next tab index', () => {
    expect(nextFreeTop(sectionWith())).toBe(0);
    expect(nextFreeTop(sectionWith(ctl('textBox', 'A', {}, { top: 500 }), ctl('label', 'B', {}, { top: 0, height: 100 })))).toBe(500 + 340 + 113);
    expect(nextTabIndex(sectionWith())).toBe(0);
    expect(nextTabIndex(sectionWith(ctl('textBox', 'A', { TabIndex: 4 }), ctl('label', 'B'), ctl('commandButton', 'C')))).toBe(5);
  });
  it('auto tab order', () => { const s = autoTabOrder(sectionWith(ctl('textBox', 'A', {}, { left: 0, top: 500 }), ctl('textBox', 'B', {}, { left: 0, top: 0 }), ctl('textBox', 'C', {}, { left: 2000, top: 10 })));
    expect(Object.fromEntries(s.controls.map((c) => [c.name, c.props.TabIndex]))).toEqual({ B: 0, C: 1, A: 2 }); });   // B and C share a line (57 twips)
  it('auto tab order leaves controls without a tab stop alone', () => {
    const s = autoTabOrder(sectionWith(ctl('label', 'L'), ctl('textBox', 'T', {}, { top: 100 })));
    expect(s.controls.map((c) => c.props.TabIndex)).toEqual([undefined, 0]);
  });
  it('reload rule: first load; another save (token bump) when not dirty; never our own save, a rename or over edits', () => {
    expect(shouldReload(null, 0, false)).toBe(true);
    expect(shouldReload({ token: 1 }, 2, false)).toBe(true);    // saved elsewhere
    expect(shouldReload({ token: 2 }, 2, false)).toBe(false);   // our own save (token remembered) or a rename (same token)
    expect(shouldReload({ token: 1 }, 2, true)).toBe(false);    // the designer's edits are kept
  });
  it('header/footer toggle', () => { const d = toggleHeaderFooter(emptyFormDoc(null)); expect(d.sections[0]).toMatchObject({ height: 567, props: { Visible: true } });
    expect(toggleHeaderFooter(d).sections[2].props.Visible).toBe(false); });
  it('hiding removes both sections and their controls, as Access does (the host confirms first)', () => {
    const d = toggleHeaderFooter(emptyFormDoc(null));
    const withCtl = { ...d, sections: d.sections.map((s, i) => (i === 0 ? { ...s, props: { ...s.props, zz: 1 }, controls: [ctl('label', 'Titre')] } : s)) };
    const hidden = toggleHeaderFooter(withCtl);
    expect(hidden.sections[0]).toEqual({ kind: 'formHeader', height: 0, props: { Visible: false, zz: 1 }, controls: [] });
    expect(hidden.sections[2]).toMatchObject({ height: 0, props: { Visible: false }, controls: [] });
    expect(hidden.sections[1]).toBe(withCtl.sections[1]);
  });

  const tbl = (name: string): RecordSourceRef => ({ kind: 'table', name });
  const clientsInfo: SourceInfo = { updatable: true, keyTable: 'Clients', parameters: [],
    fields: [...clients.fields, { name: 'Notes', props: { type: 'longText', required: false, indexed: 'no', primaryKey: false } }].map((x) => ({ name: x.name, type: x.props.type, props: x.props })) };
  it('auto form', () => {
    const info = { ...clientsInfo, fields: clientsInfo.fields.slice(0, 6) };
    const d = autoForm(tbl('Clients'), 'Clients', info, labels);
    expect(d.props.DefaultView).toBe('single'); expect(d.sections[0].controls[0]).toMatchObject({ kind: 'label', props: { Caption: 'Clients', FontWeight: 'bold' } });
    expect(d.sections[1].controls.map((c) => c.name)).toEqual(['N°', 'Nom', 'Âge', 'Actif', 'Solde', 'Email']);
    expect(d.sections[1].controls.find((c) => c.name === 'Actif')!.kind).toBe('checkBox');
    expect(JSON.stringify(d)).not.toMatch(/"#[0-9a-f]{6}"/);   // couleurs de thème seulement
    expect(validateDesignDoc(d)).toEqual([]); expect(parseFormDoc(JSON.parse(JSON.stringify(d))).dropped).toBe(0);
  });
  it("auto form on a join: a column named Table.Field gets a valid control name, its Control Source stays the column (B4)", () => {
    const f = (name: string) => ({ name, type: 'autoNumber' as const, props: { type: 'autoNumber' as const, required: false, indexed: 'no' as const, primaryKey: false } });
    const d = autoForm({ kind: 'query', name: 'QSaisie' }, 'QSaisie', { updatable: true, parameters: [], fields: [f('Commandes.N°'), f('Clients.N°')] }, labels);
    expect(d.sections[1].controls.map((c) => [c.name, c.props.ControlSource])).toEqual([['Commandes_N°', 'Commandes.N°'], ['Clients_N°', 'Clients.N°']]);
    expect(validateDesignDoc(d)).toEqual([]); expect(parseFormDoc(JSON.parse(JSON.stringify(d))).dropped).toBe(0);
  });
  it('auto form layout: columnar, 0,15 cm apart, labels at 0,5 cm, controls at 3,5 cm, widths by type, Width fitted', () => {
    const d = autoForm(tbl('Clients'), 'Clients', clientsInfo, labels);
    expect(d.recordSource).toEqual(tbl('Clients'));
    const [header, detail, footer] = d.sections;
    expect(header).toMatchObject({ kind: 'formHeader', height: 680, props: { Visible: true } });
    expect(header.controls[0].props).toEqual({ Caption: 'Clients', FontSize: 16, FontWeight: 'bold' });   // colors, BackStyle, BorderStyle: catalog defaults
    expect(footer).toMatchObject({ kind: 'formFooter', height: 284, props: { Visible: true }, controls: [] });
    const geo = detail.controls.map((c) => [c.name, c.left, c.top, c.width, c.height]);
    // Short Text 50 -> 10 cm clamped to 8; 255 -> 8; Number, Currency 3 cm; Yes/No: its box; Long Text 8 x 1,8 cm
    expect(geo).toEqual([['N°', 1985, 85, 1701, 340], ['Nom', 1985, 510, 4536, 340], ['Âge', 1985, 935, 1701, 340], ['Actif', 1985, 1360, 284, 340],
      ['Solde', 1985, 1785, 1701, 340], ['Email', 1985, 2210, 4536, 340], ['Notes', 1985, 2635, 4536, 1021]]);
    expect(detail.controls.map((c) => [c.children![0].left, c.children![0].top])).toEqual(geo.map((g) => [284, g[2]]));
    expect(detail.controls.map((c) => c.props.TabIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(detail.height).toBe(2635 + 1021 + 85);
    expect(d.props.Width).toBe(1985 + 4536 + 284);
    const short = autoForm(tbl('T'), 'T', { ...clientsInfo, fields: [{ name: 'Code', type: 'shortText', props: { type: 'shortText', size: 4, required: false, indexed: 'no', primaryKey: false } },
      { name: 'Le', type: 'dateTime', props: { type: 'dateTime', required: false, indexed: 'no', primaryKey: false } }] }, labels);
    expect(short.sections[1].controls.map((c) => c.width)).toEqual([1134, 1701]);   // 4 x 0,2 cm -> at least 2 cm; Date 3 cm
  });
  it('auto form: a field named like the title label still gets unique names', () => {
    const d = autoForm(tbl('T'), 'T', { ...clientsInfo, fields: [{ name: 'Auto_Header0', type: 'number', props: { type: 'number', required: false, indexed: 'no', primaryKey: false } }] }, labels);
    expect(validateDesignDoc(d)).toEqual([]);
  });
  it('auto form: fields beyond the Detail limit start another column, nothing overlaps', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `Champ${i}`, type: 'shortText' as const, props: { type: 'shortText' as const, size: 10, required: false, indexed: 'no' as const, primaryKey: false } }));
    const d = autoForm(tbl('T'), 'T', { ...clientsInfo, fields: [...many, clientsInfo.fields[6]] }, labels);   // and a Long Text last
    const detail = d.sections[1];
    expect(validateDesignDoc(d)).toEqual([]); expect(parseFormDoc(JSON.parse(JSON.stringify(d))).dropped).toBe(0);
    const boxes = detail.controls.flatMap((c) => [c, ...c.children!]);
    expect(boxes.every((b) => b.top + b.height <= 31680 && b.left + b.width <= 31680)).toBe(true);
    const overlap = (a: typeof boxes[0], b: typeof boxes[0]) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
    expect(boxes.some((a, i) => boxes.slice(i + 1).some((b) => overlap(a, b)))).toBe(false);
    const lefts = [...new Set(detail.controls.map((c) => c.left))];
    expect(lefts).toEqual([1985, 1985 + 1134 + 284 + 1985 - 284]);   // a second column: after the first one's widest control
    expect(detail.controls[0].top).toBe(85); expect(detail.controls.find((c) => c.left === lefts[1])!.top).toBe(85);
    expect(detail.height).toBeLessThanOrEqual(31680);
    expect(d.props.Width).toBe(Math.max(...detail.controls.map((c) => c.left + c.width)) + 284);
    expect(detail.controls.map((c) => c.props.TabIndex)).toEqual(detail.controls.map((_, i) => i));   // down the first column, then the second
  });
  it('unique form name', () => {
    expect(uniqueFormName(['Clients', 'clients1'], 'Clients')).toBe('Clients2');
    expect(uniqueFormName(['Commandes'], 'Clients')).toBe('Clients');
    expect(firstFreeName(['formulaire1', 'Formulaire3'], (n) => `Formulaire${n}`)).toBe('Formulaire2');
  });
  it('form labels from i18next', () => { const l = formLabels((k, o) => `${k}${o ? JSON.stringify(o) : ''}`);
    expect([l.prefix('textBox'), l.tabPage(2)]).toEqual(['designer.ctlPrefix.textBox', 'form.tabPage{"n":2}']); });
});
