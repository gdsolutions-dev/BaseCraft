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
import type { MacroDef } from '../../shared/macro/model';
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
