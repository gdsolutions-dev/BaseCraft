import { afterEach, expect, it } from 'vitest';
import type { Value } from '../../shared/expr/ast';
import type { ControlDef } from '../../shared/design/model';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import type { RecordSnapshot } from './record-controller';
import { clearRecordClipboard, copiedRecord, copyRecord, pasteTargets } from './record-clipboard';

afterEach(clearRecordClipboard);

it('nothing copied, then a copy that later changes of the source do not reach, then cleared', () => {
  expect(copiedRecord()).toBeNull();
  const m = new Map([['nom', { t: 'str', v: 'A' } as const]]);
  copyRecord(m);
  m.set('nom', { t: 'str', v: 'B' });
  expect(copiedRecord()?.get('nom')).toEqual({ t: 'str', v: 'A' });
  copyRecord(new Map());
  expect(copiedRecord()?.size).toBe(0);
  clearRecordClipboard();
  expect(copiedRecord()).toBeNull();
});

const sf = (name: string, type: FieldType): SourceField => ({ name, type, props: defaultProps(type) as FieldProps, origin: { table: 'T', field: name } });
const info: SourceInfo = { fields: [sf('N°', 'autoNumber'), sf('Nom', 'shortText'), sf('Ville', 'shortText'), sf('Pays', 'shortText'), sf('Autre', 'shortText')], updatable: true, keyTable: 'T', parameters: [] };
const snap = { status: 'ready', editable: true, busy: false, info } as RecordSnapshot;
const box = (name: string, src: string, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind: 'textBox', name, props: { ControlSource: src, ...props }, left: 0, top: 0, width: 1000, height: 300 }) as ControlDef;
const str = (v: string): Value => ({ t: 'str', v });

it('paste targets: a plain bound box kept; AutoNumber, calculated, locked, disabled and a field with no control skipped', () => {
  const copied = new Map<string, Value>([['n°', str('1')], ['nom', str('A')], ['ville', str('B')], ['pays', str('C')], ['autre', str('D')], ['calc', str('E')]]);
  const controls = [box('N°', 'N°'), box('Calc', '=1+1'), box('Ville', 'Ville', { Locked: true }), box('Pays', 'Pays', { Enabled: false }), box('Nom', 'Nom'), box('Nom2', 'Nom')];
  // 'Autre' is copied but has no control on this form
  expect(pasteTargets(controls, snap, info, copied).map((t) => [t.f.name, t.v])).toEqual([['Nom', str('A')]]);
});
