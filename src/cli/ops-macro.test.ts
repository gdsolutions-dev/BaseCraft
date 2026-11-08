import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { CANON } from '../shared/coerce';
import { getObject } from '../main/db/objects';
import { registerFunctions } from '../main/db/file-format';
import { newBase } from './new-base';
import { applyScript } from './script';
import { tmp } from './test-tmp';

const run = async (ops: unknown[]) => { const p = tmp(); newBase(p, '0.3.1'); return { p, r: await applyScript(p, ops as never, CANON) }; };
const message = (r: { ok: boolean }): string => ('message' in r ? String(r.message) : '');
const read = (p: string, kind: 'macro' | 'form' | 'report', name: string) => { const db = new DatabaseSync(p); registerFunctions(db); try { return getObject(db, kind, name); } finally { db.close(); } };
const open = { k: 'action', action: 'OpenForm', args: { FormName: 'FClients' } };
const macro = (name: string, items: unknown[] = [open]) => ({ op: 'macro.create', name, items });
const nested = (n: number): unknown => (n === 0 ? { k: 'comment', text: 'x' } : { k: 'group', name: 'g', items: [nested(n - 1)] });

describe('macro.create', () => {
  it('saves a macro with one comment and one action, with its description', async () => {
    const { p, r } = await run([{ ...macro('MOuvrir', [{ k: 'comment', text: 'open the form' }, open]), description: 'd' }]);
    expect(r).toMatchObject({ ok: true, applied: 1 });
    expect(read(p, 'macro', 'MOuvrir')?.definition).toMatchObject({ formatVersion: '1.0', items: [{ k: 'comment' }, { k: 'action' }] });
  });
  it('refuses an action outside the closed catalogue, naming its path', async () => {
    const { r } = await run([macro('M', [{ k: 'comment', text: 'a' }, { k: 'action', action: 'NoSuchAction', args: {} }])]);
    expect(r).toMatchObject({ ok: false, index: 0 });
    expect(message(r)).toMatch(/items\[1\]\.action/);
  });
  it('refuses a shape issue with its path and code', async () => {
    expect(message((await run([macro('M', [{ k: 'bogus' }])])).r)).toBe('items[0]: shape');
  });
  it('refuses nesting deeper than 32 levels', async () => {
    const { r } = await run([macro('M', [nested(40)])]);
    expect(r.ok).toBe(false);
    expect(message(r)).toMatch(/tooDeep/);
  });
  it('refuses non-array items, a duplicate name and an invalid name', async () => {
    expect(message((await run([{ op: 'macro.create', name: 'M', items: 'x' }])).r)).toBe('"items" must be an array');
    expect(message((await run([macro('M'), macro('m')])).r)).toBe('macro name already used: m');
    expect(message((await run([macro('a.b')])).r)).toBe('invalid macro name: a.b');
  });
});

const eventDoc = (props: Record<string, unknown>, controlProps: Record<string, unknown> = {}, kind = 'detail') => ({
  formatVersion: '1.0', recordSource: null, props,
  sections: [{ kind, height: 1000, props: {}, controls: [{ kind: 'commandButton', name: 'Cmd', left: 0, top: 0, width: 1000, height: 300, props: controlProps }] }],
});
const form = (props: Record<string, unknown>, controlProps: Record<string, unknown> = {}) => ({ op: 'form.create', name: 'F', layout: 'doc', doc: eventDoc(props, controlProps) });
const withSub = { op: 'macro.create', name: 'M', items: [{ k: 'submacro', name: 'Sub', items: [{ k: 'comment', text: 'x' }] }] };

describe('event bindings', () => {
  it('binds OnOpen to a macro created earlier in the same script, case-insensitively', async () => {
    const { p, r } = await run([macro('MOuvrir'), form({ OnOpen: 'mouvrir' }, { OnClick: 'MOuvrir' })]);
    expect(r.ok).toBe(true);
    expect((read(p, 'form', 'F')!.definition as { props: unknown }).props).toEqual({ OnOpen: 'mouvrir' });
  });
  it('binds M.Sub and an embedded macro', async () => {
    expect((await run([withSub, form({ OnOpen: 'm.sub' }, { OnClick: { embedded: { formatVersion: '1.0', items: [{ k: 'comment', text: 'x' }] } } })])).r.ok).toBe(true);
  });
  it('refuses a missing macro, file unchanged', async () => {
    const { p, r } = await run([form({ OnOpen: 'Absent' })]);
    expect(r).toMatchObject({ ok: false, index: 0 });
    expect(message(r)).toMatch(/macro not found: Absent/);
    expect(read(p, 'form', 'F')).toBeNull();
  });
  it('refuses a macro created later than the form', async () => {
    expect((await run([form({ OnOpen: 'M' }), macro('M')])).r.ok).toBe(false);
  });
  it('refuses M.Sub when Sub is not a submacro of M', async () => {
    expect(message((await run([macro('M'), form({}, { OnClick: 'M.Sub' })])).r)).toMatch(/submacro not found: M\.Sub/);
  });
  it('refuses an unknown event name', async () => {
    expect(message((await run([macro('M'), form({ OnBanana: 'M' })])).r)).toMatch(/unknown event OnBanana/);
  });
  it('refuses a bad Python call with its code', async () => {
    expect(message((await run([form({ OnOpen: '=Foo(' })])).r)).toMatch(/design\.props\.OnOpen: badFunctionCall/);
  });
  it('refuses a bare text that is not a macro reference, and an invalid embedded macro', async () => {
    expect(message((await run([form({ OnOpen: 'not a name!' })])).r)).toMatch(/OnOpen: badMacroName/);
    expect(message((await run([form({ OnOpen: { embedded: { formatVersion: '1.0', items: [{ k: 'bogus' }] } } })])).r)).toMatch(/OnOpen\.embedded\.items\[0\]: shape/);
  });
  it('refuses an event on a target that does not take it', async () => {
    expect(message((await run([macro('M'), form({ OnFormat: 'M' })])).r)).toMatch(/OnFormat does not apply/);
    const rep = { op: 'report.create', name: 'R', layout: 'doc', doc: eventDoc({}, { OnClick: 'M' }) };
    expect(message((await run([macro('M'), rep])).r)).toMatch(/OnClick does not apply/);
  });
  it('accepts a report event on the report and on a report section', async () => {
    const doc = eventDoc({ OnOpen: 'M', OnNoData: 'M' });
    (doc.sections[0].props as Record<string, unknown>).OnFormat = 'M';
    expect((await run([macro('M'), { op: 'report.create', name: 'R', layout: 'doc', doc }])).r.ok).toBe(true);
  });
});
