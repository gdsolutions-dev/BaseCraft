import { describe, expect, it } from 'vitest';
import { clients, f, t } from '../../shared/test-fixtures';
import { designOf, designReducer, emptyDesign, fromDesign, longFieldNames, savedModel, toSaveRequest, withDefaultPrimaryKey } from './design-model';

describe('design model', () => {
  it('rename keeps sourceName; new rows have none', () => {
    let m = fromDesign(clients); m = designReducer(m, { type: 'setName', index: 1, name: 'Nom complet' });
    m = designReducer(m, { type: 'addRow' }); m = designReducer(m, { type: 'setName', index: m.rows.length - 1, name: 'Note' });
    expect(toSaveRequest(m, 'Clients', false).mapping).toContainEqual({ name: 'Nom complet', sourceName: 'Nom' });
    expect(toSaveRequest(m, 'Clients', false).mapping).toContainEqual({ name: 'Note', sourceName: null });
  });
  it('table properties: set (dirty), cleared (absent), the rule follows renamed fields, a swap stays a swap', () => {
    let m = designReducer(fromDesign(clients), { type: 'setTableProp', name: 'validationRule', value: '[Nom] <> [Email]' });
    expect(m.dirty).toBe(true);
    m = designReducer(m, { type: 'setTableProp', name: 'validationText', value: 'Non' });
    m = designReducer(m, { type: 'setName', index: 1, name: 'Email' });
    m = designReducer(m, { type: 'setName', index: 5, name: 'Nom' });
    const req = toSaveRequest(m, 'Clients', false);
    expect(req.design).toMatchObject({ validationRule: '[Nom] <> [Email]', validationText: 'Non' }); // source names: alterTable renames
    expect(savedModel(m, req).validationRule).toBe('[Email] <> [Nom]'); // the model as stored, once
    m = designReducer(m, { type: 'setTableProp', name: 'validationText', value: '' });
    expect(toSaveRequest(m, 'Clients', false).design).not.toHaveProperty('validationText');
    m = designReducer(m, { type: 'setInvalid', index: -1, key: 'validationRule', code: 'unexpectedEnd' });
    expect(designReducer(m, { type: 'deleteRows', indices: [0] }).invalid).toEqual({ 'table:validationRule': 'unexpectedEnd' });
  });
  it('indexes: setName renames inside them, deleteRows drops the field and an index left empty; sent with source names', () => {
    const ix = (name: string, ...fields: string[]) => ({ name, fields: fields.map((n) => ({ name: n, desc: false })), unique: false });
    let m = fromDesign({ ...clients, indexes: [ix('NE', 'Nom', 'Email'), ix('A', 'Âge')] });
    m = designReducer(m, { type: 'setName', index: 1, name: 'Email' });
    m = designReducer(m, { type: 'setName', index: 5, name: 'Nom' }); // a swap
    const named = (x: typeof m) => designOf(x, 'Clients').indexes;
    expect(named(m)).toEqual([ix('NE', 'Email', 'Nom'), ix('A', 'Âge')]);
    const req = toSaveRequest(m, 'Clients', false);
    expect(req.design.indexes).toEqual([ix('NE', 'Nom', 'Email'), ix('A', 'Âge')]); // source names: alterTable renames
    expect(named(savedModel(m, req))).toEqual(named(m)); // the model as stored, once
    m = designReducer(m, { type: 'deleteRows', indices: [2] });
    expect(named(m)).toEqual([ix('NE', 'Email', 'Nom')]);
    const next = { ...clients, fields: m.rows.map((r) => ({ name: r.name, props: { ...r.props, indexed: 'yesDuplicates' as const } })), indexes: [] };
    m = designReducer(m, { type: 'setIndexes', design: next });
    expect([m.dirty, m.indexes, m.rows.every((r) => r.props.indexed === 'yesDuplicates')]).toEqual([true, undefined, true]);
  });
  it('blank trailing rows are ignored on save',() => expect(toSaveRequest(designReducer(fromDesign(clients), { type: 'addRow' }), 'Clients', false).design.fields).toHaveLength(clients.fields.length));
  it('a nameless row that was touched is kept, so the save reports it', () => {
    const m = designReducer(designReducer(emptyDesign(), { type: 'addRow' }), { type: 'setProp', index: 0, key: 'description', value: 'x' });
    expect(toSaveRequest(m, 'T', false).design.fields).toEqual([{ name: '', props: expect.objectContaining({ description: 'x' }) }]);
  });
  it('setType resets type-specific props but keeps caption', () => {
    let m = designReducer(fromDesign(clients), { type: 'setProp', index: 1, key: 'caption', value: 'Nom du client' });
    m = designReducer(m, { type: 'setType', index: 1, fieldType: 'longText' });
    expect(m.rows[1].props).toMatchObject({ type: 'longText', caption: 'Nom du client' }); expect(m.rows[1].props.size).toBeUndefined();
  });
  it('invalid expressions are tracked per row and property, and leave with their row', () => {
    let m = fromDesign(clients);
    expect(m.invalid).toEqual({});
    const key = m.rows[2].key;
    m = designReducer(m, { type: 'setInvalid', index: 2, key: 'validationRule', code: 'unexpectedEnd' });
    expect(m.invalid).toEqual({ [`${key}:validationRule`]: 'unexpectedEnd' });
    expect(m.dirty).toBe(true);
    expect(designReducer(m, { type: 'setInvalid', index: 2, key: 'validationRule', code: null }).invalid).toEqual({});
    expect(designReducer(m, { type: 'deleteRows', indices: [2] }).invalid).toEqual({});
    expect(designReducer(m, { type: 'deleteRows', indices: [1] }).invalid).toEqual(m.invalid);
  });
  it('a type change drops the errors of the row on properties the new type does not have (no save blocked by a hidden error)', () => {
    let m = fromDesign(clients); // row 1: Nom, short text
    const key = m.rows[1].key;
    m = designReducer(m, { type: 'setInvalid', index: 1, key: 'inputMask', code: 'maskUnclosedQuote' });
    m = designReducer(m, { type: 'setInvalid', index: 1, key: 'validationRule', code: 'unexpectedEnd' });
    expect(designReducer(m, { type: 'setType', index: 1, fieldType: 'number' }).invalid).toEqual(m.invalid); // both still shown
    expect(designReducer(m, { type: 'setType', index: 1, fieldType: 'longText' }).invalid).toEqual({ [`${key}:validationRule`]: 'unexpectedEnd' });
    m = designReducer(m, { type: 'setInvalid', index: 1, key: 'defaultValue', code: 'unexpectedEnd' });
    expect(designReducer(m, { type: 'setType', index: 1, fieldType: 'autoNumber' }).invalid).toEqual({}); // Task 7 M3, scenario 2
    m = designReducer(m, { type: 'setInvalid', index: 2, key: 'inputMask', code: 'maskNoInput' });
    expect(designReducer(m, { type: 'setType', index: 1, fieldType: 'yesNo' }).invalid).toEqual({ // other rows kept
      [`${key}:validationRule`]: 'unexpectedEnd', [`${key}:defaultValue`]: 'unexpectedEnd', [`${m.rows[2].key}:inputMask`]: 'maskNoInput',
    });
  });
  it('an unreadable Lookup tab entry leaves when its row is hidden (Text Box, List Box) or its type takes no lookup', () => {
    const lookup = { kind: 'values' as const, values: ['a'], limitToList: false };
    let m = fromDesign(t('T', [f('A', 'shortText', { lookup }), f('B', 'shortText', { lookup })]));
    const [a, b] = [m.rows[0].key, m.rows[1].key];
    for (const key of ['boundColumn', 'columnWidths', 'listRows', 'listWidth']) {
      m = designReducer(m, { type: 'setInvalid', index: 0, key, code: 'badCount' });
      m = designReducer(m, { type: 'setInvalid', index: 1, key, code: 'badCount' });
    }
    m = designReducer(m, { type: 'setInvalid', index: 0, key: 'validationRule', code: 'unexpectedEnd' });
    const all = m.invalid;
    // List Box: no List Rows nor List Width
    expect(designReducer(m, { type: 'setProp', index: 0, key: 'lookup', value: { ...lookup, displayControl: 'listBox' } }).invalid).toEqual(
      Object.fromEntries(Object.entries(all).filter(([k]) => k !== `${a}:listRows` && k !== `${a}:listWidth`)));
    // Text Box: no lookup row at all; other properties and rows kept
    expect(designReducer(m, { type: 'setProp', index: 0, key: 'lookup', value: undefined }).invalid).toEqual(
      Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(`${a}:`) || k === `${a}:validationRule`)));
    // a type with a lookup keeps them; a type without one drops them
    expect(designReducer(m, { type: 'setType', index: 1, fieldType: 'number' }).invalid).toEqual(all);
    expect(designReducer(m, { type: 'setType', index: 1, fieldType: 'dateTime' }).invalid).toEqual(
      Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(`${b}:`))));
  });
  it('default primary key gets a unique name at the top', () => {
    const m = withDefaultPrimaryKey(fromDesign(t('T', [f('N°', 'shortText')])), 'N°');
    expect(m.rows[0]).toMatchObject({ name: 'N°1', props: { type: 'autoNumber', primaryKey: true } });
    expect(m.rows[0].sourceName).toBeNull();
  });
  it('default primary key reuses an existing autoNumber field', () => {
    const m = withDefaultPrimaryKey(fromDesign(t('T', [f('A', 'shortText'), f('Id', 'autoNumber', { primaryKey: false })])), 'N°');
    expect(m.rows.map((r) => [r.name, r.props.primaryKey])).toEqual([['A', false], ['Id', true]]);
  });
  it('togglePrimaryKey on several rows makes a composite key', () => {
    const two = fromDesign(t('L', [f('A', 'shortText'), f('B', 'shortText')]));
    const on = designReducer(two, { type: 'togglePrimaryKey', indices: [0, 1] });
    expect(on.rows.map(r => r.props.primaryKey)).toEqual([true, true]);
    expect(designReducer(on, { type: 'togglePrimaryKey', indices: [0, 1] }).rows.map(r => r.props.primaryKey)).toEqual([false, false]);
  });
  it('togglePrimaryKey moves the key to the selected row', () => {
    const m = designReducer(fromDesign(t('L', [f('A', 'shortText', { primaryKey: true }), f('B', 'shortText')])), { type: 'togglePrimaryKey', indices: [1] });
    expect(m.rows.map(r => r.props.primaryKey)).toEqual([false, true]);
    expect(m.rows[1].props.indexed).toBe('yesNoDuplicates');
  });
  it('becoming autoNumber makes the field the unique key; leaving it keeps key and index (R7)', () => {
    const m = designReducer(fromDesign(t('L', [f('A', 'number')])), { type: 'setType', index: 0, fieldType: 'autoNumber' });
    expect(m.rows[0].props).toMatchObject({ primaryKey: true, indexed: 'yesNoDuplicates' });
    expect(designReducer(m, { type: 'setType', index: 0, fieldType: 'number' }).rows[0].props).toMatchObject({ type: 'number', primaryKey: true, indexed: 'yesNoDuplicates' });
  });
  it('clearing the caption removes it from the saved design', () => {
    let m = designReducer(fromDesign(clients), { type: 'setProp', index: 1, key: 'caption', value: 'Client' });
    m = designReducer(m, { type: 'setProp', index: 1, key: 'caption', value: '' });
    expect('caption' in toSaveRequest(m, 'Clients', false).design.fields[1].props).toBe(false);
  });
  it('a deleted field re-added under the same name is a new field', () => {
    let m = designReducer(fromDesign(clients), { type: 'deleteRows', indices: [1] });
    m = designReducer(m, { type: 'addRow' });
    m = designReducer(m, { type: 'setName', index: m.rows.length - 1, name: 'Nom' });
    expect(toSaveRequest(m, 'Clients', false).mapping).toContainEqual({ name: 'Nom', sourceName: null });
  });
  it('moveRow keeps sourceName and the new order', () => {
    const m = designReducer(designReducer(fromDesign(clients), { type: 'setName', index: 1, name: 'Client' }), { type: 'moveRow', from: 1, to: 4 });
    const req = toSaveRequest(m, 'Clients', false);
    expect(req.design.fields.map(x => x.name)).toEqual(['N°', 'Âge', 'Actif', 'Solde', 'Client', 'Email']);
    expect(req.mapping[4]).toEqual({ name: 'Client', sourceName: 'Nom' });
    expect(m.selected).toBe(4);
  });
  it('dirty follows edits, not selection; deleteRows keeps the selection in range', () => {
    const m = designReducer(fromDesign(clients), { type: 'select', index: 5 });
    expect(m.dirty).toBe(false);
    const d = designReducer(m, { type: 'deleteRows', indices: [4, 5] });
    expect(d).toMatchObject({ dirty: true, selected: 3 });
    expect(d.rows.map(r => r.name)).toEqual(['N°', 'Nom', 'Âge', 'Actif']);
  });
  it('round-trips table description, extra and unknown keys', () => {
    const src = { ...t('T', [f('A', 'shortText', { future: 1 } as never)]), description: 'd', extra: { x: 1 } };
    const req = toSaveRequest(fromDesign(src), 'T', true);
    expect(req).toEqual({ originalName: 'T', allowDataLoss: true, design: src, mapping: [{ name: 'A', sourceName: 'A' }] });
    expect(toSaveRequest(emptyDesign(), 'N', false)).toMatchObject({ originalName: null, design: { name: 'N', fields: [] } });
  });
  it('after a save, a rename or a swap maps each field to itself (a second save changes nothing)', () => {
    let m = fromDesign(clients);
    m = designReducer(m, { type: 'setName', index: 1, name: 'Email' });
    m = designReducer(m, { type: 'setName', index: 5, name: 'Nom' });
    m = designReducer(m, { type: 'setName', index: 3, name: 'Active' });
    const first = toSaveRequest(m, 'Clients', false);
    expect(first.mapping).toContainEqual({ name: 'Email', sourceName: 'Nom' });
    const after = savedModel(m, first);
    expect(after.dirty).toBe(false);
    expect(toSaveRequest(after, 'Clients', false).mapping.every((x) => x.sourceName === x.name)).toBe(true);
    expect(savedModel({ ...emptyDesign(), selected: 3 }, toSaveRequest(emptyDesign(), 'N', false))).toMatchObject({ originalName: 'N', selected: 0 });
  });
});

describe('table description from the Properties dialog', () => {
  it('replaces the loaded one without dirtying the design; the next save writes it', () => {
    const m = designReducer(fromDesign({ ...clients, description: 'Ancienne' }), { type: 'setDescription', description: 'Nouvelle' });
    expect(m).toMatchObject({ description: 'Nouvelle', dirty: false });
    expect(toSaveRequest(m, 'Clients', false).design.description).toBe('Nouvelle');
    const edited = designReducer(designReducer(m, { type: 'addRow' }), { type: 'setDescription', description: '' });
    expect(edited.dirty).toBe(true); // the user's own edits stay pending
    expect(toSaveRequest(edited, 'Clients', false).design.description).toBeUndefined();
  });
  it('a load answered after a Properties save keeps the newer description the tab carries', () => {
    expect(fromDesign({ ...clients, description: 'Ancienne' }, 'Nouvelle').description).toBe('Nouvelle');
    expect(fromDesign({ ...clients, description: 'Ancienne' }, '').description).toBe(''); // cleared from Properties
    expect(fromDesign({ ...clients, description: 'Ancienne' }).description).toBe('Ancienne');
  });
});

describe('field names over 64 characters', () => {
  it('a new or renamed field name over 64 code points (after NFC) is flagged; a kept long name is not', () => {
    const long = 'L'.repeat(100);
    let m = fromDesign(t('Ext', [f(long, 'longText'), f('Court', 'longText')]));
    expect(longFieldNames(m)).toEqual([]);
    m = designReducer(m, { type: 'setName', index: 1, name: 'x'.repeat(65) });
    m = designReducer(m, { type: 'addRow' });
    m = designReducer(m, { type: 'setName', index: 2, name: 'e\u0301'.repeat(64) }); // 64 once composed
    expect(longFieldNames(m).map((r) => r.name)).toEqual(['x'.repeat(65)]);
    m = designReducer(m, { type: 'setName', index: 0, name: long + 'x' });
    expect(longFieldNames(m)).toHaveLength(2);
  });
});
