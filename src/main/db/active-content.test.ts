import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { saveObject } from './objects';
import { tableDesign } from './schema';
import { seedSales } from '../query/test-db';
import { autoForm, emptyFormDoc } from '../../renderer/form/form-def';
import type { DesignDoc } from '../../shared/design/model';
import { FACTURES_REPORT } from '../../shared/report/fixtures/factures';
import type { MacroDef, MacroItem } from '../../shared/macro/model';
import { activeContent } from './active-content';
import { ApprovalStore, contentState } from '../trust';

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcactive-'));
  const p = path.join(dir, 'a.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  seedSales(db);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const macroDef: MacroDef = { formatVersion: '1.0', items: [{ k: 'action', action: 'MessageBox', args: { Message: '"Bonjour"', Beep: 'true' } }] };
const save = (kind: Parameters<typeof saveObject>[1], name: string, def: unknown) => expect(saveObject(db, kind, name, def, null)).toEqual({ ok: true });

it('select queries and plain forms are not active content', () => {
  save('query', 'QClientsLyon', { formatVersion: '1.0', sql: 'SELECT * FROM Clients WHERE Ville = "Lyon";' });
  save('query', 'QCassée', { formatVersion: '1.0', sql: 'UPDATE ((' }); // unparsable: cannot run
  const d = tableDesign(db, 'Clients');
  const info = { fields: d.fields.map((x) => ({ name: x.name, type: x.props.type, props: x.props, origin: { table: d.name, field: x.name } })), updatable: true, keyTable: d.name, parameters: [] };
  save('form', 'FClients', autoForm({ kind: 'table', name: 'Clients' }, 'Clients', info, { prefix: (k) => k, tabPage: (n) => `P${n}` }));
  expect(activeContent(db)).toEqual({ present: false, fingerprint: '' });
});

it('macros, action queries and event properties are', () => {
  save('macro', 'M', macroDef);
  const a = activeContent(db);
  expect(a.present).toBe(true);
  expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  save('query', 'QMaj', { formatVersion: '1.0', sql: 'UPDATE Clients SET Ville = "Lyon";' });
  const b = activeContent(db);
  expect(b.fingerprint).not.toBe(a.fingerprint);
  save('query', 'QCréer', { formatVersion: '1.0', sql: 'SELECT * INTO Copie FROM Clients;' }); // make table
  expect(activeContent(db).fingerprint).not.toBe(b.fingerprint);
});

it('stable: key order and listing order do not matter', () => {
  save('macro', 'B', macroDef);
  save('module', 'A', { formatVersion: '1.0', code: 'x' });
  const a = activeContent(db).fingerprint;
  db.exec('DELETE FROM bc_objects');
  save('module', 'A', { code: 'x', formatVersion: '1.0' });
  save('macro', 'B', { items: [{ args: { Beep: 'true', Message: '"Bonjour"' }, action: 'MessageBox', k: 'action' }], formatVersion: '1.0' });
  expect(activeContent(db).fingerprint).toBe(a);
});

it('an external change changes it', () => {
  save('macro', 'M', macroDef);
  const before = activeContent(db).fingerprint;
  db.prepare("UPDATE bc_objects SET name = 'M2' WHERE kind = 'macro'").run();
  const after = activeContent(db);
  expect(after.fingerprint).not.toBe(before);
  // nothing in the file decides trust
  db.prepare("INSERT OR REPLACE INTO bc_meta (key, value) VALUES ('options', '{\"trusted\":true}')").run();
  const store = new ApprovalStore(path.join(dir, 'trust.json'));
  expect(contentState(activeContent(db), 'u', path.join(dir, 'a.basecraft'), { store, cfg: { trustedFolders: [] }, platform: process.platform })).toBe('disabled');
});

it('a form event property counts', () => {
  const doc = emptyFormDoc(null);
  doc.sections[1]!.controls.push({ kind: 'commandButton', name: 'Ok', left: 0, top: 0, width: 1000, height: 400, props: { OnClick: '' } });
  save('form', 'F', doc);
  expect(activeContent(db).present).toBe(false); // empty: no event
  doc.sections[1]!.controls[0]!.props.OnClick = 'M';
  expect(saveObject(db, 'form', 'F', doc, 'F')).toEqual({ ok: true });
  const a = activeContent(db);
  expect(a.present).toBe(true);
  doc.sections[1]!.controls[0]!.props.OnClick = 'M2';
  expect(saveObject(db, 'form', 'F', doc, 'F')).toEqual({ ok: true });
  expect(activeContent(db).fingerprint).not.toBe(a.fingerprint);
});

const act = (action: string): MacroItem => ({ k: 'action', action, args: {} });
/** An empty form whose control B has these properties. */
const formWith = (props: Record<string, unknown>): DesignDoc => {
  const doc = emptyFormDoc(null);
  doc.sections[1]!.controls.push({ kind: 'commandButton', name: 'B', left: 0, top: 0, width: 1000, height: 400, props });
  return doc;
};
/** What a base written by B1 holds: a macro, an action query, a form with one OnClick, a report without events. */
function seedB1Shaped(): void {
  save('macro', 'M', { formatVersion: '1.0', items: [{ k: 'action', action: 'OpenForm', args: { FormName: 'FClients' } }] });
  save('query', 'QMaj', { formatVersion: '1.0', sql: 'UPDATE Clients SET Ville = "Lyon";' });
  save('form', 'F', formWith({ OnClick: 'M' }));
  save('report', 'R', FACTURES_REPORT);
}

// Event catalogue growth (B2) must not move the fingerprint of content B1 could write: the golden value was taken on 2205973, before B2.
it('B1-shaped content keeps its B1 fingerprint', () => {
  seedB1Shaped();
  expect(activeContent(db).fingerprint).toBe('fd09ae43a8113802802ccb1233d4abf3632e697e0dc2a0217a92e61f5fdca5f6');
});

it('an embedded macro is active content and changes the fingerprint', () => {
  save('form', 'F2', formWith({ OnClick: { embedded: { formatVersion: '1.0', items: [act('Beep')] } } }));
  const a = activeContent(db).fingerprint;
  expect(saveObject(db, 'form', 'F2', formWith({ OnClick: { embedded: { formatVersion: '1.0', items: [act('Quit')] } } }), 'F2')).toEqual({ ok: true });
  expect(activeContent(db).fingerprint).not.toBe(a);
});

it('a section On Format counts', () => {
  const report: DesignDoc = structuredClone(FACTURES_REPORT);
  save('report', 'R', report);
  expect(activeContent(db).present).toBe(false);
  const detail = report.sections.find((s) => s.kind === 'detail')!;
  detail.props.OnFormat = 'M';
  expect(saveObject(db, 'report', 'R', report, 'R')).toEqual({ ok: true });
  expect(activeContent(db).present).toBe(true);
});

// B2 narrowed where some events apply (R2: OnCurrent no longer on reports, OnGotFocus not on the form object, control events
// on forms only): a value B1 could store there is still active content — no B1 event name drops out of the fingerprint.
it('event names no longer offered at a place still count there', () => {
  const report: DesignDoc = structuredClone(FACTURES_REPORT);
  report.props.OnCurrent = 'M';
  save('report', 'R', report);
  expect(activeContent(db).present).toBe(true);
  db.exec('DELETE FROM bc_objects');
  const doc = emptyFormDoc(null);
  doc.props.OnGotFocus = 'M';
  save('form', 'F', doc);
  expect(activeContent(db).present).toBe(true);
  db.exec('DELETE FROM bc_objects');
  const r2: DesignDoc = structuredClone(FACTURES_REPORT);
  r2.sections.find((s) => s.controls.length)!.controls[0]!.props.OnClick = 'M';
  save('report', 'R', r2);
  expect(activeContent(db).present).toBe(true);
});
