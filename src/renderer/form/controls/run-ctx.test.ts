import { describe, expect, it } from 'vitest';
import type { CellInput } from '../../../shared/coerce';
import type { ControlDef } from '../../../shared/design/model';
import { defaultProps, type FieldProps } from '../../../shared/field-types';
import type { SourceInfo } from '../../../shared/record-source';
import { lookupList } from '../../datasheet/datasheet-cells';
import type { RecordSnapshot } from '../record-controller';
import { listChoose, listCurrent, type RunCtx } from './run-ctx';

const info: SourceInfo = { fields: [{ name: 'Client', type: 'number', props: { ...defaultProps('number'), numberSize: 'longInteger' } as FieldProps, origin: { table: 'Commandes', field: 'Client' } }],
  updatable: true, keyTable: 'Commandes', parameters: [] };
const combo: ControlDef = { kind: 'comboBox', name: 'Client', left: 0, top: 0, width: 2000, height: 300, props: { ControlSource: 'Client' } };
const data = lookupList({ rows: [{ value: 1, display: ['Dupont'] }, { value: 2, display: ['Martin'] }], widths: [1417] });

function ctx(pending: Record<string, CellInput>, typed: Record<string, string> = {}) {
  const edits: [string, CellInput][] = [];
  const x = {
    snap: { status: 'ready', values: [1], pending, isNew: false } as unknown as RecordSnapshot, info, defaults: {}, results: {},
    display: { locale: 'fr-FR', lang: 'fr' }, t: (k: string) => k, unbound: {}, typed,
    lists: { Client: { data, options: [], truncated: false } },
    edit: (f: { name: string }, v: CellInput) => { edits.push([f.name, v]); },
    setTyped: (n: string, v: string | undefined) => { if (v === undefined) delete typed[n]; else typed[n] = v; },
  } as unknown as RunCtx;
  return { x, edits, typed };
}

describe('combo and list box value', () => {
  it('the stored value shows its row', () => expect(listCurrent(combo, ctx({}).x)).toEqual({ row: 0, text: 'Dupont' }));

  it('a text typed that is a hidden bound value stays as typed (never replaced by that row)', () => {
    expect(listCurrent(combo, ctx({ Client: '2' }, { Client: '2' }).x)).toEqual({ row: -1, text: '2' });
    expect(listCurrent(combo, ctx({ Client: '2' }).x)).toEqual({ row: 1, text: 'Martin' });   // written by a row pick
  });

  it('a row picked writes its bound value and forgets the text typed; a text in no row is kept as typed', () => {
    const c = ctx({}, { Client: '2' });
    listChoose(combo, c.x, 1, 'Martin');
    expect(c.edits).toEqual([['Client', '2']]);
    expect(c.typed).toEqual({});
    listChoose(combo, c.x, -1, '2');
    expect(c.edits[1]).toEqual(['Client', '2']);
    expect(c.typed).toEqual({ Client: '2' });
  });
});
