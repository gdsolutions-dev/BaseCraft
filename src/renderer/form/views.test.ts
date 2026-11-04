import { describe, expect, it } from 'vitest';
import type { ControlDef, ControlKind, DesignDoc } from '../../shared/design/model';
import { defaultProps, type FieldType } from '../../shared/field-types';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import { cmToTwips, flattenControls } from '../../shared/design/model';
import { pxToTwips, twipsToPx } from '../designer/units';
import { readLayouts } from '../../shared/design/layout';
import { createLayout, membersOf, removeLayout } from '../../shared/design/layout-edit';
import { allowsLayout, datasheetColumns, firstRun, initialView, openingMode, runViewFor, visibleRange, withColumnWidths } from './views';

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

  it('datasheet columns: un contrôle membre d’une disposition prend la largeur naturelle de son champ, pas celle de la colonne de données', () => {
    const inf: SourceInfo = { ...info, fields: [sf('N°', 'autoNumber'), sf('Date', 'dateTime'), sf('Libre', 'number')] };
    const d = docWith({}, [
      { ...ctl('textBox', 'N°', { ControlSource: 'N°', LayoutID: 'S' }), width: 4536 },
      { ...ctl('textBox', 'Date', { ControlSource: 'Date', LayoutID: 'S' }), width: 4536 },
      { ...ctl('textBox', 'Libre', { ControlSource: 'Libre' }), width: 2000 },   // hors disposition : sa Width
    ]);
    expect(datasheetColumns(d, inf).map((c) => c.width)).toEqual([twipsToPx(cmToTwips(3)), twipsToPx(cmToTwips(3)), twipsToPx(2000)]);
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

  const lab = (name: string, caption: string) => ctl('label', name, { Caption: caption });
  const tabular = (cells: string[]) => ({ id: 'T', kind: 'tabular', left: 0, tops: { formHeader: 0, detail: 0 }, cols: [800, 900],
    rows: [{ section: 'formHeader', height: 200 }, { section: 'detail', height: 250 }],
    cells: [{ row: 0, col: 0, control: 'Étiquette1' }, { row: 0, col: 1, control: 'Étiquette2' }, { row: 1, col: 0, control: cells[0] }, { row: 1, col: 1, control: cells[1] }] });

  it('datasheet columns: Tabulaire, titre de l’étiquette d’en-tête détachée', () => {
    const d = docWith({ Layouts: [tabular(['Nom', 'Ville'])] }, [ctl('textBox', 'Nom', { ControlSource: 'Nom' }), ctl('textBox', 'Ville', { ControlSource: 'Ville' })]);
    d.sections[0].controls = [lab('Étiquette1', 'Client :'), lab('Étiquette2', 'Cité:')];
    expect(datasheetColumns(d, info).map((c) => c.title)).toEqual(['Client', 'Cité']);
  });

  it('datasheet columns: Empilé, titre de l’étiquette de la colonne 0 détachée', () => {
    const st = { id: 'S', kind: 'stacked', left: 0, tops: { detail: 0 }, cols: [1000, 3000], rows: [{ section: 'detail', height: 300 }],
      cells: [{ row: 0, col: 0, control: 'Étiquette1' }, { row: 0, col: 1, control: 'Ville' }] };
    const s = docWith({ Layouts: [st] }, [lab('Étiquette1', 'Cité :'), ctl('textBox', 'Ville', { ControlSource: 'Ville' })]);
    expect(datasheetColumns(s, info).map((c) => c.title)).toEqual(['Cité']);
  });

  it('datasheet columns: l’étiquette attachée l’emporte sur celle d’une disposition ; sans étiquette ni disposition, le nom', () => {
    const d = docWith({ Layouts: [tabular(['Nom', 'Ville'])] }, [ctl('textBox', 'Nom', { ControlSource: 'Nom' }, [label('Attachée :')]), ctl('textBox', 'Ville', { ControlSource: 'Ville' })]);
    d.sections[0].controls = [lab('Étiquette1', 'Client :'), lab('Étiquette2', 'Cité:')];
    expect(datasheetColumns(d, info).map((c) => c.title)).toEqual(['Attachée', 'Cité']);
    expect(datasheetColumns(docWith({}, [ctl('textBox', 'Nom', { ControlSource: 'Nom' })]), info).map((c) => c.title)).toEqual(['Nom']);
  });

  it('datasheet columns: Empilé puis Supprimer la disposition, les titres restent les légendes', () => {
    const laid = createLayout(doc, membersOf(doc, ['N°', 'Nom', 'Ville']), 'stacked', { headerSection: 'formHeader' });
    const d = removeLayout(laid, readLayouts(laid)[0].id);
    expect(datasheetColumns(d, info).map((c) => c.title)).toEqual(['N°', 'Nom du client', 'Ville', 'Total']);
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

  it('Layout view is allowed unless AllowLayoutView is false', () => {
    expect(allowsLayout(docWith({}))).toBe(true);
    expect(allowsLayout(docWith({ AllowLayoutView: true }))).toBe(true);
    expect(allowsLayout(docWith({ AllowLayoutView: false }))).toBe(false);
    // L3: a report's too
    expect(allowsLayout(docWith({}), 'report')).toBe(true);
    expect(allowsLayout(docWith({ AllowLayoutView: true }), 'report')).toBe(true);
    expect(allowsLayout(docWith({ AllowLayoutView: false }), 'report')).toBe(false);
  });

  it('the opening view is decided once per tab', () => {
    expect(firstRun('docA')).toBe(true);
    expect(firstRun('docA')).toBe(false);
    expect(firstRun('docB')).toBe(true);
  });
});

describe('datasheet columns: ColumnWidth', () => {
  const inf: SourceInfo = { ...info, fields: [sf('N°', 'autoNumber'), sf('Libre', 'number')] };
  const w = (props: Record<string, unknown>, layout = false) =>
    datasheetColumns(docWith({}, [{ ...ctl('textBox', 'N°', { ControlSource: layout ? 'N°' : 'Libre', ...(layout ? { LayoutID: 'S' } : {}), ...props }), width: 4536 }]), inf)[0].width;
  it('a valid ColumnWidth wins, on a layout member and on a free control', () => {
    expect(w({ ColumnWidth: 2268 }, true)).toBe(twipsToPx(2268));
    expect(w({ ColumnWidth: 2268 })).toBe(twipsToPx(2268));
  });
  it('an invalid one (0, negative, fractional, text) counts as absent', () => {
    for (const v of [0, -5, 1.5, '2268']) {
      expect(w({ ColumnWidth: v }, true)).toBe(twipsToPx(cmToTwips(3)));
      expect(w({ ColumnWidth: v })).toBe(twipsToPx(4536));
    }
  });
});

describe('withColumnWidths', () => {
  const d = docWith({}, [ctl('textBox', 'A', { ColumnWidth: 900 }), ctl('tabControl', 'Onglets', {}, [ctl('textBox', 'B')])]);
  const find = (x: DesignDoc, n: string) => flattenControls(x.sections.flatMap((s) => s.controls)).find((c) => c.name === n)!;
  it('sets ColumnWidth (px -> twips, rounded) on the named controls at any depth, others untouched', () => {
    const out = withColumnWidths(d, { A: 150, B: 100.4, Inconnu: 80 });
    expect(find(out, 'A').props.ColumnWidth).toBe(pxToTwips(150));
    expect(find(out, 'B').props.ColumnWidth).toBe(pxToTwips(100.4));
    expect(find(out, 'Onglets').props.ColumnWidth).toBeUndefined();
    expect(find(d, 'B').props.ColumnWidth).toBeUndefined();   // the input is not mutated
  });
  it('the same doc when nothing changes (equal value, unknown name, no widths)', () => {
    expect(withColumnWidths(d, {})).toBe(d);
    expect(withColumnWidths(d, { Inconnu: 80 })).toBe(d);
    expect(withColumnWidths(d, { A: twipsToPx(900) })).toBe(d);
  });
});
