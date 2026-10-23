import { describe, expect, it, vi } from 'vitest';
import type { LookupData } from '../../shared/api';
import type { ControlDef } from '../../shared/design/model';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import type { RecordSourceRef, SourceField, SourceInfo, SourcePage, SourcePageRequest } from '../../shared/record-source';
import { lookupList } from '../datasheet/datasheet-cells';
import { columnWidthsOf, LIST_PEEK, listOptions, listWindow, loadRowSource, outOfList, prefixMatch, rowOfText, rowOfValue } from './row-source';

const combo = (props: Record<string, unknown>): ControlDef => ({ kind: 'comboBox', name: 'Client', left: 0, top: 0, width: 2000, height: 300, props: { ControlSource: 'Client', ...props } });
const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField => ({ name, type, props: { ...defaultProps(type), ...props } as FieldProps });
const dataOf = (texts: string[]): LookupData => ({ rows: texts.map((x, i) => ({ value: i + 1, display: [x] })), widths: [1440] });
const ctx = { locale: 'fr-FR', lang: 'fr' as const, tables: ['Clients', 'Gros'], queries: [] };

const fakeApi = {
  lastPage: undefined as SourcePageRequest | undefined,
  lastDescribe: undefined as RecordSourceRef | undefined,
  describeError: undefined as unknown,
  parameters: [] as SourceInfo['parameters'],
  async describe(ref: RecordSourceRef): Promise<SourceInfo> {
    this.lastDescribe = ref;
    if (this.describeError) { const e = this.describeError; this.describeError = undefined; throw e; }
    return { fields: [sf('N°', 'autoNumber'), sf('Nom', 'shortText', { caption: 'Le nom' })], updatable: true, keyTable: 'Clients', parameters: this.parameters };
  },
  async page(ref: RecordSourceRef, req: SourcePageRequest): Promise<SourcePage> {
    this.lastPage = req;
    if (ref.kind === 'table' && ref.name === 'Gros') return { rows: [[1, 'Un']], rowids: [1], total: 6000 };
    return { rows: [[1, 'Dupont'], [2, 'Martin']], rowids: [1, 2], total: 2 };
  },
};

describe('row source', () => {
  it('column widths are stored twips', () => {
    expect(columnWidthsOf(combo({ ColumnWidths: '0;1417' }))).toEqual([0, 1417]);
    expect(columnWidthsOf(combo({}))).toBeUndefined();
    expect(columnWidthsOf(combo({ ColumnWidths: '0;2,5cm' }))).toBeUndefined();
  });

  it('value list in columns, bound value converted', async () => {
    const { data } = await loadRowSource(combo({ RowSourceType: 'valueList', RowSource: '1;Lyon;2;Paris', ColumnCount: 2, ColumnWidths: '0;1417' }), sf('Code', 'number'), fakeApi, ctx);
    expect(data.rows).toEqual([{ value: 1, display: ['Lyon'] }, { value: 2, display: ['Paris'] }]);
    expect(data.widths).toEqual([1417]);
    expect((await loadRowSource(combo({ RowSourceType: 'valueList', RowSource: ' Ouverte ; Fermée ;' }), null, fakeApi, ctx)).data.rows.map((r) => r.display)).toEqual([['Ouverte'], ['Fermée']]);
  });

  it('value list: a bound number item is shown in the region', async () => {
    const { data } = await loadRowSource(combo({ RowSourceType: 'valueList', RowSource: '1.5;2' }), sf('Taux', 'number', { numberSize: 'double' }), fakeApi, ctx);
    expect(data.rows).toEqual([{ value: 1.5, display: ['1,5'] }, { value: 2, display: ['2'] }]);
  });

  it('Column Heads: the first row of a value list, the captions of a table (else names), the visible columns only', async () => {
    const v = await loadRowSource(combo({ RowSourceType: 'valueList', RowSource: 'Code;Ville;1;Lyon', ColumnCount: 2, ColumnWidths: '0;1417', ColumnHeads: true }), null, fakeApi, ctx);
    expect(v.data).toEqual({ rows: [{ value: '1', display: ['Lyon'] }], widths: [1417], heads: ['Ville'] });
    const tq = await loadRowSource(combo({ RowSource: 'Clients', ColumnCount: 2, ColumnHeads: true }), null, fakeApi, ctx);
    expect(tq.data.heads).toEqual(['N°', 'Le nom']);
    expect((await loadRowSource(combo({ RowSource: 'Clients', ColumnCount: 2 }), null, fakeApi, ctx)).data.heads).toBeUndefined();
  });

  it('table source: first visible column is the text', async () => {
    const { data } = await loadRowSource(combo({ RowSourceType: 'tableQuery', RowSource: 'clients', ColumnCount: 2, ColumnWidths: '0;1701', BoundColumn: 1 }), null, fakeApi, ctx);
    expect(lookupList(data).text.get(2)).toBe('Martin');
    expect(lookupList(data).text.get(99)).toBeUndefined();
    expect(data.widths).toEqual([1701]);
    expect(fakeApi.lastPage).toMatchObject({ offset: 0, limit: 5000 });
  });

  it('more than 5000 rows is cut and says so', async () =>
    expect((await loadRowSource(combo({ RowSourceType: 'tableQuery', RowSource: 'Gros' }), null, fakeApi, ctx)).truncated).toBe(true));

  it('prefix match is case/accent aware like Access', () => {
    const o = listOptions(dataOf(['Élise', 'Emma']));
    expect(prefixMatch(o, 'em')).toBe(1);
    expect(prefixMatch(o, 'EL')).toBe(0);
    expect(prefixMatch(o, 'z')).toBe(-1);
    expect(prefixMatch(o, '')).toBe(-1);
  });

  it('unknown table -> empty list and an error, no throw', async () => {
    const r = await loadRowSource(combo({ RowSourceType: 'tableQuery', RowSource: 'Zz' }), null, fakeApi, ctx);
    expect(r.data.rows).toEqual([]);
    expect(r.error).toBeDefined();
  });

  it('a query name and a SQL text as Row Source', async () => {
    await loadRowSource(combo({ RowSourceType: 'tableQuery', RowSource: 'Ventes', ColumnCount: 1 }), null, fakeApi, { ...ctx, queries: ['Ventes'] });
    expect(fakeApi.lastDescribe).toEqual({ kind: 'query', name: 'Ventes' });
    const r = await loadRowSource(combo({ RowSourceType: 'tableQuery', RowSource: 'SELECT Nom FROM Clients' }), null, fakeApi, ctx);
    expect(fakeApi.lastDescribe).toEqual({ kind: 'sql', sql: 'SELECT Nom FROM Clients' });
    expect(r.data.rows.map((x) => x.display)).toEqual([['1'], ['2']]);
  });

  it('an invalid SQL Row Source gives an empty list and its error', async () => {
    fakeApi.describeError = new Error('bc:invalidQuery');
    const r = await loadRowSource(combo({ RowSourceType: 'tableQuery', RowSource: 'SELECT FROM' }), null, fakeApi, ctx);
    expect(r.data.rows).toEqual([]);
    expect(String(r.error)).toContain('bc:invalidQuery');
  });

  it('a parameterized list asks once; cancel gives an empty list', async () => {
    fakeApi.parameters = [{ name: 'p', type: 'number' }];
    try {
      const ask = vi.fn(async () => ({ p: '1' }));
      await loadRowSource(combo({ RowSourceType: 'tableQuery', RowSource: 'Q' }), null, fakeApi, { ...ctx, queries: ['Q'] }, ask);
      expect(ask).toHaveBeenCalledOnce(); expect(fakeApi.lastPage!.params).toEqual({ p: '1' });
      fakeApi.lastPage = undefined;
      const r = await loadRowSource(combo({ RowSourceType: 'tableQuery', RowSource: 'Q' }), null, fakeApi, { ...ctx, queries: ['Q'] }, async () => null);
      expect(r.data.rows).toEqual([]); expect(r.error).toBeUndefined(); expect(fakeApi.lastPage).toBeUndefined();
    } finally { fakeApi.parameters = []; }
  });

  it('no Row Source -> empty list, no error', async () => {
    const none = await loadRowSource(combo({}), null, fakeApi, ctx);
    expect(none).toEqual({ data: { rows: [], widths: [1440] }, truncated: false });
  });

  it('the row of a typed text (case and accents ignored) and of a stored or typed value', () => {
    const d = dataOf(['Dupont', 'Élise']);
    expect(rowOfText(d, 'elise')).toBe(1);
    expect(rowOfText(d, 'Eli')).toBe(-1);
    expect(rowOfValue(d, 2, String)).toBe(1);
    expect(rowOfValue(d, '1', String)).toBe(0);
    expect(rowOfValue(d, 'Dupont', String)).toBe(-1);
    expect(rowOfValue(d, null, String)).toBe(-1);
  });

  it('the exact value first, without converting each row (a map built once per list)', () => {
    const d = dataOf(['Dupont', 'Martin']);
    const editOf = vi.fn(String);
    expect(rowOfValue(d, 2, editOf)).toBe(1);
    expect(rowOfValue(d, 1, editOf)).toBe(0);
    expect(editOf).not.toHaveBeenCalled();
    expect(rowOfValue(d, '2', editOf)).toBe(1);   // an edit text: converted
  });

  it('out of the list: a text typed against the shown texts, a value picked or stored against the bound values', () => {
    const d = dataOf(['Dupont', 'Martin']);   // bound values 1 and 2
    expect(outOfList(d, '2', '2', String)).toBe(true);           // « 2 » typed: no row shows it, even though a hidden N° is 2
    expect(outOfList(d, '2', undefined, String)).toBe(false);    // written by a row pick (its edit text)
    expect(outOfList(d, 'martin', 'martin', String)).toBe(false);
    expect(outOfList(d, 'Zola', 'Zola', String)).toBe(true);
    expect(outOfList(d, '', '', String)).toBe(false);
    expect(outOfList(d, null, undefined, String)).toBe(false);
  });
});

describe('listWindow', () => {
  it('every row on the current record; on another row of Continuous Forms, at most LIST_PEEK from its value (the last ones near the end)', () => {
    expect(listWindow(5000, 10, false)).toEqual([0, 5000]);
    expect(listWindow(5000, -1, true)).toEqual([0, LIST_PEEK]);
    expect(listWindow(5000, 10, true)).toEqual([10, 10 + LIST_PEEK]);
    expect(listWindow(5000, 4999, true)).toEqual([5000 - LIST_PEEK, 5000]);
    expect(listWindow(3, 2, true)).toEqual([0, 3]);
  });
});
