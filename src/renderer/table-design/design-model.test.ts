import { describe, expect, it } from 'vitest';
import { clients, f, t } from '../../shared/test-fixtures';
import { designReducer, emptyDesign, fromDesign, savedModel, toSaveRequest, withDefaultPrimaryKey } from './design-model';

describe('design model', () => {
  it('rename keeps sourceName; new rows have none', () => {
    let m = fromDesign(clients); m = designReducer(m, { type: 'setName', index: 1, name: 'Nom complet' });
    m = designReducer(m, { type: 'addRow' }); m = designReducer(m, { type: 'setName', index: m.rows.length - 1, name: 'Note' });
    expect(toSaveRequest(m, 'Clients', false).mapping).toContainEqual({ name: 'Nom complet', sourceName: 'Nom' });
    expect(toSaveRequest(m, 'Clients', false).mapping).toContainEqual({ name: 'Note', sourceName: null });
  });
  it('blank trailing rows are ignored on save', () => expect(toSaveRequest(designReducer(fromDesign(clients), { type: 'addRow' }), 'Clients', false).design.fields).toHaveLength(clients.fields.length));
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
