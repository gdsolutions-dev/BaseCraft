import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { applyAutoCorrect, applyPropertyUpdates } from './autocorrect';
import { logLabels } from '../../shared/autocorrect/labels';
import { getObject, saveObject } from './objects';
import { inTransactionAsync } from './tx';
import { createTable, quoteIdent, renameTable, setFieldLookup, tableDesign } from './schema';
import { saveStartupOptions, startupOptions } from './startup';
import { seedSales } from '../query/test-db';
import type { AutoCorrectPlan } from '../../shared/autocorrect/plan';
import en from '../../shared/i18n/en.json';
import { localeInfo } from '../../shared/locale-format';
import { f, t } from '../../shared/test-fixtures';

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcac-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  seedSales(db);
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});
const LABELS = logLabels(en.autoCorrect);
const LOG = 'Name AutoCorrect Log';
const fr = localeInfo('fr-FR');
const plan = (p: Partial<AutoCorrectPlan>): AutoCorrectPlan => ({ objects: [], lookups: [], entries: [], corrected: [], failed: [], ...p });
const rows = (name: string) => db.prepare(`SELECT * FROM ${quoteIdent(name)} ORDER BY rowid`).all().map((r) => Object.values(r));

describe('applyAutoCorrect', () => {
  it('a plan naming an object that does not exist throws, and the rename is rolled back', async () => {
    const bad = plan({ objects: [{ kind: 'query', name: 'Absent', definition: { formatVersion: '1.0', sql: 'SELECT 1;' } }] });
    await expect(inTransactionAsync(db, async () => { renameTable(db, 'Clients', 'Clientele'); await applyAutoCorrect(db, bad, null, fr); })).rejects.toThrow('unknown object');
    expect(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get('Clients')).toBeDefined();
    expect(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get('Clientele')).toBeUndefined();
  });

  it('writes the definitions, the lookups (other keys kept) and the startup form; no log asked, none written', async () => {
    expect(saveObject(db, 'query', 'QLyon', { formatVersion: '1.0', sql: 'SELECT * FROM Clients;' }, null)).toEqual({ ok: true });
    setFieldLookup(db, 'Commandes', 'Client', { kind: 'table', table: 'QLyon', limitToList: true });
    saveStartupOptions(db, { ...startupOptions(db), startupForm: 'F' });
    const p = plan({
      objects: [{ kind: 'query', name: 'QLyon', definition: { formatVersion: '1.0', sql: 'SELECT *\nFROM [Clientèle];' } }],
      lookups: [{ table: 'Commandes', field: 'client', lookup: { kind: 'table', table: 'QLyon2', limitToList: true } }],
      startupForm: 'F2',
      entries: [{ kind: 'query', name: 'QLyon', control: '', property: 'SQL', old: 'a', new: 'b' }],
    });
    expect(await applyAutoCorrect(db, p, null, fr)).toEqual({});
    expect(getObject(db, 'query', 'QLyon')!.definition).toEqual({ formatVersion: '1.0', sql: 'SELECT *\nFROM [Clientèle];' });
    const client = tableDesign(db, 'Commandes').fields.find((x) => x.name === 'Client')!;
    expect(client.props).toMatchObject({ type: 'number', numberSize: 'longInteger', lookup: { kind: 'table', table: 'QLyon2', limitToList: true } });
    expect(startupOptions(db).startupForm).toBe('F2');
    expect(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(LOG)).toBeUndefined();
  });

  it('logs each entry into a created table, a failed one with the failure text', async () => {
    const p = plan({ entries: [{ kind: 'table', name: 'Commandes', control: 'Client', property: 'RowSource', old: 'QA', new: 'QB' },
      { kind: 'macro', name: 'M', control: 'items[2]', property: 'FormName', old: 'F', new: null },
      { kind: 'macro', name: 'M', control: 'items[3]', property: 'FormName', old: 'F', new: null, reason: 'meaning' as const },
      { kind: 'query', name: 'Q', control: '', property: 'SQL', old: 'a', new: null, reason: 'dependency' as const }] });
    expect(await applyAutoCorrect(db, p, LABELS, fr)).toEqual({ logTable: LOG });
    expect(tableDesign(db, LOG).fields.map((x) => [x.name, x.props.type, x.props.size, x.props.defaultValue])).toEqual([
      ['Object Type', 'shortText', 255, undefined], ['Object Name', 'shortText', 255, undefined], ['Control Name', 'shortText', 255, undefined],
      ['Property Name', 'shortText', 255, undefined], ['Old Value', 'longText', undefined, undefined], ['New Value', 'longText', undefined, undefined],
      ['Time', 'dateTime', undefined, 'Now()']]);
    expect(rows(LOG).map((r) => r.slice(0, 6))).toEqual([['Table', 'Commandes', 'Client', 'RowSource', 'QA', 'QB'],
      ['Macro', 'M', 'items[2]', 'FormName', 'F', en.autoCorrect.log.failed.unreadable],
      ['Macro', 'M', 'items[3]', 'FormName', 'F', en.autoCorrect.log.failed.meaning],
      ['Query', 'Q', null, 'SQL', 'a', en.autoCorrect.log.failed.dependency]]);
  });

  it('an existing table of that name: used when it has the seven fields (any case), else logSkipped', async () => {
    const entries = [{ kind: 'query' as const, name: 'Q', control: '', property: 'SQL', old: 'a', new: 'b' }];
    createTable(db, t('name autocorrect log', [f('object type', 'shortText'), f('Object Name', 'shortText'), f('Control Name', 'shortText'),
      f('Property Name', 'shortText'), f('Old Value', 'longText'), f('New Value', 'longText'), f('TIME', 'dateTime', { defaultValue: 'Now()' }), f('Note', 'shortText')]));
    expect(await applyAutoCorrect(db, plan({ entries }), LABELS, fr)).toEqual({ logTable: 'name autocorrect log' });
    expect(rows('name autocorrect log').map((r) => [...r.slice(0, 6), r[7]])).toEqual([['Query', 'Q', null, 'SQL', 'a', 'b', null]]);
    db.exec(`DROP TABLE ${quoteIdent('name autocorrect log')}`);
    createTable(db, t(LOG, [f('Object Type', 'shortText')]));
    expect(await applyAutoCorrect(db, plan({ entries }), LABELS, fr)).toEqual({ logSkipped: true, logTable: LOG }); // the message names it (final Minor 3)
    expect(rows(LOG)).toEqual([]);
    // No entries: nothing to log, no table made.
    db.exec(`DROP TABLE ${quoteIdent(LOG)}`);
    expect(await applyAutoCorrect(db, plan({}), LABELS, fr)).toEqual({});
    expect(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(LOG)).toBeUndefined();
    // A query of that name: skipped too, named.
    saveObject(db, 'query', LOG, { formatVersion: '1.0', sql: 'SELECT * FROM Clients;' }, null);
    expect(await applyAutoCorrect(db, plan({ entries }), LABELS, fr)).toEqual({ logSkipped: true, logTable: LOG });
  });
});

describe('applyPropertyUpdates', () => {
  const form = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Commandes' }, props: {}, sections: [{ kind: 'detail', height: 1, props: {}, controls: [
    { kind: 'textBox', name: 'Montant', left: 0, top: 0, width: 1, height: 1, props: { ControlSource: 'Montant', Format: 'Standard' } }] }] };
  const props = (kind: 'form' | 'report', name: string) => (getObject(db, kind, name)!.definition as typeof form).sections[0]!.controls[0]!.props;

  it('writes the values in one transaction and skips a missing object or control', () => {
    saveObject(db, 'form', 'FC', form, null);
    const items = [{ kind: 'form' as const, name: 'FC', control: 'Montant', prop: 'Format' as const, value: 'Monétaire' },
      { kind: 'form' as const, name: 'FC', control: 'Montant', prop: 'DecimalPlaces' as const, value: '2' },
      { kind: 'form' as const, name: 'FC', control: 'Absent', prop: 'Format' as const, value: 'x' },
      { kind: 'report' as const, name: 'Absent', control: 'Montant', prop: 'Format' as const, value: 'x' }];
    expect(applyPropertyUpdates(db, items)).toBe(2);
    expect(props('form', 'FC')).toEqual({ ControlSource: 'Montant', Format: 'Monétaire', DecimalPlaces: '2' });
    expect(applyPropertyUpdates(db, [{ ...items[0]!, value: '' }])).toBe(1);
    expect(props('form', 'FC')).toEqual({ ControlSource: 'Montant', DecimalPlaces: '2' });
  });
});
