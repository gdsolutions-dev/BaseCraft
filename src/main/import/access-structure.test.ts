import { describe, expect, it } from 'vitest';
import type { ExportField, ExportIndex, ExportTable } from '../../shared/access-export';
import { defaultProps, validateDesign, type FieldDef, type TableDesign } from '../../shared/field-types';
import { usableProps } from '../db/schema';
import { withStructure } from './access-structure';

const fd = (name: string, p: Partial<FieldDef['props']> & Pick<FieldDef['props'], 'type'>): FieldDef =>
  ({ name, props: { ...defaultProps(p.type), primaryKey: false, indexed: 'no', ...p } });
const base: TableDesign = { name: 'Clients', fields: [
  { name: 'N°', props: { type: 'autoNumber', required: false, indexed: 'no', primaryKey: true } },
  fd('Nom', { type: 'shortText', size: 50 }), fd('Client', { type: 'number', numberSize: 'longInteger' }) ] };

const field = (o: Partial<ExportField> & { name: string }): ExportField =>
  ({ type: 10, size: 50, attributes: 2, required: false, allowZeroLength: false, defaultValue: '', validationRule: '', validationText: '', props: {}, ...o });
const table = (o: Partial<ExportTable> = {}): ExportTable =>
  ({ name: 'Clients', validationRule: '', validationText: '', description: '', fields: [], indexes: [], ...o });
const f = (name: string, desc = false) => ({ name, desc });
const ix = (o: Partial<ExportIndex> & { name: string }): ExportIndex => ({ primary: false, unique: false, foreign: false, fields: [], ...o });

describe('withStructure', () => {
  it('field properties are carried', () => {
    const { design, lines } = withStructure(base, table({ fields: [field({ name: 'Nom', required: true, allowZeroLength: true,
      defaultValue: '"x"', validationRule: 'Len([Nom])>0', validationText: 'Vide', props: { Caption: 'Nom du client', Description: 'd', Format: '>', InputMask: 'LLL' } })] }));
    expect(design.fields[1].props).toMatchObject({ required: true, allowZeroLength: true, defaultValue: '"x"', validationRule: 'Len([Nom])>0',
      validationText: 'Vide', caption: 'Nom du client', description: 'd', format: '>', inputMask: 'LLL' });
    expect(lines).toEqual([]);
  });

  it('empty strings are absent properties; DecimalPlaces 255 is auto, TextFormat 1 is rich', () => {
    const d: TableDesign = { name: 'T', fields: [fd('Q', { type: 'number', numberSize: 'integer' }), fd('M', { type: 'longText' })] };
    const { design } = withStructure(d, table({ name: 'T', fields: [
      field({ name: 'Q', props: { Caption: '', DecimalPlaces: 255 } }), field({ name: 'M', props: { TextFormat: 1 } })] }));
    expect(design.fields[0].props).toMatchObject({ decimalPlaces: 'auto' });
    expect('caption' in design.fields[0].props).toBe(false);
    expect(design.fields[1].props.textFormat).toBe('rich');
    expect(withStructure(d, table({ name: 'T', fields: [field({ name: 'Q', props: { DecimalPlaces: 2 } })] })).design.fields[0].props.decimalPlaces).toBe(2);
  });

  it('an expression BaseCraft refuses is dropped and reported, the rest is kept', () => {
    const { design, lines } = withStructure(base, table({ fields: [field({ name: 'Nom', defaultValue: 'PasUneFonction(', props: { Caption: 'C' } })] }));
    expect(design.fields[1].props.defaultValue).toBeUndefined(); expect(design.fields[1].props.caption).toBe('C');
    expect(lines).toEqual([{ code: 'propertyDropped', object: base.name, part: 'Nom', reason: 'defaultValue' }]);
    expect(validateDesign(design)).toEqual([]);
  });

  it('a refused rule and a refused mask are dropped, each with its reason', () => {
    const { design, lines } = withStructure(base, table({ fields: [field({ name: 'Nom', validationRule: 'Nope(', props: { InputMask: '\\' } })] }));
    expect(design.fields[1].props.validationRule).toBeUndefined();
    expect(lines).toContainEqual({ code: 'propertyDropped', object: base.name, part: 'Nom', reason: 'validationRule' });
    expect(validateDesign(design)).toEqual([]);
  });

  it('indexes: one field is the Indexed property, several an IndexDef, foreign ones left out, a missing field dropped', () => {
    const { design, lines } = withStructure(base, table({ indexes: [
      ix({ name: 'Nom', unique: true, fields: [f('Nom')] }), ix({ name: 'NomClient', fields: [f('Nom'), f('Client', true)] }),
      ix({ name: 'FK', foreign: true, fields: [f('Client')] }), ix({ name: 'Photo', fields: [f('Photo')] }) ] }));
    expect(design.fields[1].props.indexed).toBe('yesNoDuplicates');
    expect(design.fields[2].props.indexed).toBe('no');
    expect(design.indexes).toEqual([{ name: 'NomClient', unique: false, fields: [{ name: 'Nom', desc: false }, { name: 'Client', desc: true }] }]);
    expect(lines).toEqual([{ code: 'indexDropped', object: base.name, part: 'Photo' }]);
  });

  it('a one-field index that is not unique is yesDuplicates', () => {
    const { design } = withStructure(base, table({ indexes: [ix({ name: 'Nom', fields: [f('nom')] })] }));
    expect(design.fields[1].props.indexed).toBe('yesDuplicates');
  });

  it('a key that is not the AutoNumber: the AutoNumber stays the key, the Access key is a unique index', () => {
    const { design, lines } = withStructure(base, table({ indexes: [ix({ name: 'PrimaryKey', primary: true, unique: true, fields: [f('Nom')] })] }));
    expect(design.fields.map((x) => x.props.primaryKey)).toEqual([true, false, false]);
    expect(design.fields[1].props.indexed).toBe('yesNoDuplicates');
    expect(lines).toEqual([{ code: 'keyApproximated', object: base.name, part: 'Nom' }]);
  });

  it('a several-field key beside the AutoNumber becomes a unique IndexDef named as in Access', () => {
    const { design, lines } = withStructure(base, table({ indexes: [ix({ name: 'PrimaryKey', primary: true, unique: true, fields: [f('Nom'), f('Client')] })] }));
    expect(design.indexes).toEqual([{ name: 'PrimaryKey', unique: true, fields: [{ name: 'Nom', desc: false }, { name: 'Client', desc: false }] }]);
    expect(lines).toEqual([{ code: 'keyApproximated', object: base.name, part: 'Nom, Client' }]);
    expect(validateDesign(design)).toEqual([]);
  });

  it('the AutoNumber as the exact Access key: nothing to report', () => {
    const { design, lines } = withStructure(base, table({ indexes: [ix({ name: 'PrimaryKey', primary: true, unique: true, fields: [f('N°')] })] }));
    expect(lines).toEqual([]); expect(design.fields.map((x) => x.props.primaryKey)).toEqual([true, false, false]);
  });

  it('a table without AutoNumber takes the Access key, of one field or of several', () => {
    const plain: TableDesign = { name: 'T', fields: [fd('A', { type: 'shortText', size: 5 }), fd('B', { type: 'number', numberSize: 'integer' }), fd('C', { type: 'yesNo' })] };
    const one = withStructure(plain, table({ name: 'T', indexes: [ix({ name: 'PrimaryKey', primary: true, unique: true, fields: [f('B')] })] }));
    expect(one.design.fields.map((x) => x.props.primaryKey)).toEqual([false, true, false]); expect(one.lines).toEqual([]);
    expect(validateDesign(one.design)).toEqual([]);
    const two = withStructure(plain, table({ name: 'T', indexes: [ix({ name: 'PrimaryKey', primary: true, unique: true, fields: [f('A'), f('C')] })] }));
    expect(two.design.fields.map((x) => x.props.primaryKey)).toEqual([true, false, true]);
    expect(validateDesign(two.design)).toEqual([]);
  });

  it('lookups: value list, table or query, field list; a list box; an unknown row source type is dropped', () => {
    const lk = (props: ExportField['props']) => withStructure(base, table({ fields: [field({ name: 'Client', props })] }));
    const values = lk({ DisplayControl: 111, RowSourceType: 'Value List', RowSource: '"a";"b c";d', BoundColumn: 1, ColumnCount: 1, LimitToList: true });
    expect(values.design.fields[2].props.lookup).toEqual({ kind: 'values', values: ['a', 'b c', 'd'], limitToList: true, displayControl: 'comboBox', boundColumn: 1, columnCount: 1 });
    const tbl = lk({ DisplayControl: 111, RowSourceType: 'Table/Query', RowSource: 'SELECT [N°], Nom FROM Clients; ', BoundColumn: 1, ColumnCount: 2,
      ColumnHeads: false, ColumnWidths: '0;1440', ListRows: 16, ListWidth: '0twip', LimitToList: true, AllowValueListEdits: false });
    expect(tbl.design.fields[2].props.lookup).toEqual({ kind: 'table', table: 'SELECT [N°], Nom FROM Clients; ', limitToList: true, displayControl: 'comboBox',
      boundColumn: 1, columnCount: 2, columnHeads: false, columnWidths: [0, 1440], listRows: 16, listWidth: 0, allowValueListEdits: false });
    expect(lk({ DisplayControl: 110, RowSourceType: 'Field List', RowSource: 'Clients' }).design.fields[2].props.lookup)
      .toEqual({ kind: 'fieldList', table: 'Clients', limitToList: false, displayControl: 'listBox' });
    const bad = lk({ DisplayControl: 111, RowSourceType: 'Autre', RowSource: 'x' });
    expect(bad.design.fields[2].props.lookup).toBeUndefined();
    expect(bad.lines).toEqual([{ code: 'propertyDropped', object: base.name, part: 'Client', reason: 'lookup' }]);
    // a text box has no lookup, and says nothing
    const none = lk({ DisplayControl: 109, RowSourceType: 'Table/Query', RowSource: 'x' });
    expect(none.design.fields[2].props.lookup).toBeUndefined(); expect(none.lines).toEqual([]);
    expect(validateDesign(tbl.design)).toEqual([]);
  });

  it('a lookup on a type that takes none is dropped and reported', () => {
    const d: TableDesign = { name: 'T', fields: [fd('D', { type: 'dateTime' })] };
    const { design, lines } = withStructure(d, table({ name: 'T', fields: [field({ name: 'D', props: { DisplayControl: 111, RowSourceType: 'Value List', RowSource: 'a' } })] }));
    expect(design.fields[0].props.lookup).toBeUndefined();
    expect(lines).toEqual([{ code: 'propertyDropped', object: 'T', part: 'D', reason: 'lookup' }]);
  });

  it('the table rule and its text are carried; a refused one is dropped without part', () => {
    const ok = withStructure(base, table({ description: 'Les clients', validationRule: '[Nom]<>"x"', validationText: 'Non' }));
    expect(ok.design).toMatchObject({ description: 'Les clients', validationRule: '[Nom]<>"x"', validationText: 'Non' }); expect(ok.lines).toEqual([]);
    const bad = withStructure(base, table({ validationRule: '[Autre]>1', validationText: 'Non' }));
    expect(bad.design.validationRule).toBeUndefined(); expect(bad.design.validationText).toBe('Non');
    expect(bad.lines).toEqual([{ code: 'propertyDropped', object: base.name, reason: 'validationRule' }]);
  });

  it('an index BaseCraft refuses is dropped from the last; a design still invalid comes back unchanged', () => {
    const many = Array.from({ length: 33 }, (_, i) => ix({ name: `I${i}`, fields: [f('Nom'), f('Client')] }));
    const { design, lines } = withStructure(base, table({ indexes: many }));
    expect(validateDesign(design)).toEqual([]); expect(design.indexes!.length).toBe(32);
    expect(lines).toEqual([{ code: 'indexDropped', object: base.name }]); // past the cap: one table-level line
    const long = withStructure(base, table({ validationText: 'x'.repeat(300) }));
    expect(long.design).toBe(base); expect(long.applied).toBe(false); expect(long.lines).toEqual([{ code: 'propertyDropped', object: base.name, reason: 'validationTextSize' }]);
  });

  it('the input design is never changed', () => {
    const before = JSON.stringify(base);
    withStructure(base, table({ fields: [field({ name: 'Nom', required: true })], indexes: [ix({ name: 'Nom', fields: [f('Nom')] })] }));
    expect(JSON.stringify(base)).toBe(before);
  });

  it('a lookup createTable refuses is dropped alone and reported, the caption and the table are kept', () => {
    const ok: ExportField['props'] = { DisplayControl: 111, RowSourceType: 'Value List', RowSource: 'a;b', BoundColumn: 1, ColumnCount: 1, ListRows: 8 };
    for (const bad of [{ BoundColumn: 0 }, { ColumnCount: 0 }, { ListRows: 300 }, { ColumnWidths: '40000' }] as ExportField['props'][]) {
      const { design, lines, applied } = withStructure(base, table({ fields: [field({ name: 'Client', props: { ...ok, ...bad, Caption: 'Le client' } })] }));
      const props = design.fields[2].props;
      expect(props.lookup).toBeUndefined(); expect(props.caption).toBe('Le client');
      expect(lines).toEqual([{ code: 'propertyDropped', object: base.name, part: 'Client', reason: 'lookup' }]);
      expect(applied).toBe(true);
      expect(design.fields.every((x) => usableProps(x.props as unknown as Record<string, unknown>))).toBe(true); expect(validateDesign(design)).toEqual([]);
    }
  });

  it('a field whose props are still refused after its lookup is gone falls back to its input props', () => {
    const wrong = { ...base, fields: [base.fields[0], { name: 'Nom', props: { ...base.fields[1].props, indexed: 'bad' as never } }, base.fields[2]] };
    const r = withStructure(wrong, table({ fields: [field({ name: 'Nom', props: { Caption: 'C' } })] }));
    expect(r.design.fields[1].props).toEqual(wrong.fields[1].props);
    expect(r.lines).toContainEqual({ code: 'propertyDropped', object: base.name, part: 'Nom' });
  });

  it('a Yes/No default written as a word becomes True or False; nothing else is converted', () => {
    const d: TableDesign = { name: 'T', fields: [fd('B', { type: 'yesNo' }), fd('S', { type: 'shortText', size: 5 })] };
    const dflt = (word: string, name = 'B') => withStructure(d, table({ name: 'T', fields: [field({ name, defaultValue: word })] }));
    for (const [w, v] of [['Yes', 'True'], ['no', 'False'], [' ON ', 'True'], ['Off', 'False']]) expect(dflt(w).design.fields[0].props.defaultValue).toBe(v);
    const text = dflt('No', 'S');
    expect(text.design.fields[1].props.defaultValue).toBeUndefined();
    expect(text.lines).toEqual([{ code: 'propertyDropped', object: 'T', part: 'S', reason: 'defaultValue' }]);
    expect(dflt('Yes Or No').design.fields[0].props.defaultValue).toBeUndefined(); // untouched, so refused as an expression with field references
  });

  it('a primary index with no field next to an AutoNumber gives no line and no index', () => {
    const { design, lines } = withStructure(base, table({ indexes: [ix({ name: 'PrimaryKey', primary: true, unique: true, fields: [] })] }));
    expect(lines).toEqual([]); expect(design.indexes).toBeUndefined();
  });

  it('DecimalPlaces outside 0..15 (255 apart) or not an integer is not carried', () => {
    const d: TableDesign = { name: 'T', fields: [fd('Q', { type: 'number', numberSize: 'integer' })] };
    for (const n of [16, -1, 2.5]) {
      const r = withStructure(d, table({ name: 'T', fields: [field({ name: 'Q', props: { DecimalPlaces: n } })] }));
      expect(r.design.fields[0].props.decimalPlaces).toBe(d.fields[0].props.decimalPlaces); expect(r.lines).toEqual([]);
    }
    expect(withStructure(d, table({ name: 'T', fields: [field({ name: 'Q', props: { DecimalPlaces: 15 } })] })).design.fields[0].props.decimalPlaces).toBe(15);
  });

  it('one bad index does not drop the valid ones after it', () => {
    const { design, lines } = withStructure(base, table({ indexes: [ix({ name: 'bad.name', fields: [f('Nom'), f('Client')] }),
      ix({ name: 'A', fields: [f('Nom'), f('Client')] }), ix({ name: 'B', fields: [f('Client'), f('Nom')] }), ix({ name: 'C', unique: true, fields: [f('Nom'), f('N°')] })] }));
    expect(lines).toEqual([{ code: 'indexDropped', object: base.name, part: 'bad.name' }]);
    expect(design.indexes!.map((x) => x.name)).toEqual(['A', 'B', 'C']);
    const dup = withStructure(base, table({ indexes: [ix({ name: 'A', fields: [f('Nom'), f('Client')] }), ix({ name: 'a', fields: [f('Client'), f('Nom')] }), ix({ name: 'B', fields: [f('Nom'), f('N°')] })] }));
    expect(dup.lines).toEqual([{ code: 'indexDropped', object: base.name, part: 'a' }]); expect(dup.design.indexes!.map((x) => x.name)).toEqual(['A', 'B']);
  });

  it('indexes past the cap are one table-level line, and are not examined one by one', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ix({ name: `I${i}`, fields: [f('Nom'), f('Client')] }));
    const t0 = performance.now();
    const { design, lines } = withStructure(base, table({ indexes: many }));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(validateDesign(design)).toEqual([]);
    expect(design.indexes).toHaveLength(32);
    expect(lines).toEqual([{ code: 'indexDropped', object: base.name }]);
  });
});
