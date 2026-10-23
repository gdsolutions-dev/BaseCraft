// Règle de validation de la table (niveau enregistrement, comme Access) : stockage, couche d'écriture, contrôle des données.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable, tableDesign, writeTableMetadata } from './schema';
import { insertRow, updateRow } from './write-layer';
import { alterTable } from './alter';
import { countViolations } from './rules';
import { runAction } from '../query/action';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import { validateDesign, type TableDesign } from '../../shared/field-types';
import { designReducer, fromDesign, savedModel, toSaveRequest } from '../../renderer/table-design/design-model';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });

let dir: string;
let db: DatabaseSync;
const fr = localeInfo('fr-FR');
const now = () => new Date(2026, 9, 23);
const RULE = '[DateLivraison] >= [DateCommande]';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bctrule-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const commandes = (rule?: string, text?: string): TableDesign => ({
  ...t('Commandes', [f('N°', 'autoNumber'), f('DateCommande', 'dateTime'), f('DateLivraison', 'dateTime')]),
  ...(rule ? { validationRule: rule } : {}), ...(text ? { validationText: text } : {}),
});
async function setRule(table: string, rule: string, text?: string): Promise<void> {
  createTable(db, { ...commandes(rule, text), name: table });
}
async function insert(table: string, values: Record<string, string | null>) {
  const r = await insertRow(db, tableDesign(db, table), values, fr, now);
  return r.ok ? r : { ok: false as const, errors: r.errors, message: r.errors[0]?.message, field: r.errors[0]?.field, code: r.errors[0]?.code };
}

describe('table validation rule', () => {
  it('record rule blocks the write', async () => {
    await setRule('Commandes', RULE, 'Livraison avant commande');
    expect(await insert('Commandes', { DateCommande: '2026-10-23', DateLivraison: '2026-10-01' }))
      .toMatchObject({ ok: false, message: 'Livraison avant commande', field: '', code: 'validation' });
    expect(await insert('Commandes', { DateCommande: '2026-10-23', DateLivraison: null })).toMatchObject({ ok: true });
    expect(await insert('Commandes', { DateCommande: '2026-10-01', DateLivraison: '2026-10-23' })).toMatchObject({ ok: true });
  });

  it('without a validation text: no message (the renderer shows fieldError.tableRule)', async () => {
    await setRule('Commandes', RULE);
    const r = await insert('Commandes', { DateCommande: '2026-10-23', DateLivraison: '2026-10-01' });
    expect(r).toMatchObject({ ok: false, field: '', code: 'validation' });
    expect((r as { message?: string }).message).toBeUndefined();
  });

  it('update merges stored values', async () => {
    await setRule('Commandes', RULE, 'Livraison avant commande');
    const ok = await insert('Commandes', { DateCommande: '2026-10-10', DateLivraison: '2026-10-20' });
    if (!ok.ok) throw new Error('insert');
    const d = tableDesign(db, 'Commandes');
    expect(await updateRow(db, d, ok.rowid, { DateLivraison: '2026-10-01' }, fr, now))
      .toEqual({ ok: false, errors: [{ field: '', code: 'validation', message: 'Livraison avant commande', table: 'Commandes' }] });
    expect(await updateRow(db, d, ok.rowid, { DateLivraison: '2026-10-15' }, fr, now)).toMatchObject({ ok: true });
  });

  it('applies to action queries', async () => {
    await setRule('Commandes', RULE, 'Livraison avant commande');
    await insert('Commandes', { DateCommande: '2026-10-10', DateLivraison: '2026-10-20' });
    await insert('Commandes', { DateCommande: '2026-09-01', DateLivraison: '2026-09-20' });
    const ctx = { info: fr, writeSeq: () => 0, now };
    const sql = { kind: 'sql' as const, sql: 'UPDATE Commandes SET DateLivraison = #2026-10-05#' };
    expect(await runAction(db, sql, {}, { skipFailures: false, replaceTable: false }, ctx)).toMatchObject({
      ok: false, reason: 'rowErrors', failed: 1, total: 2, errors: [{ field: '', code: 'validation', message: 'Livraison avant commande' }],
      byCause: { conversion: 0, key: 0, lock: 0, validation: 1 },
    });
  });

  it('refuses other tables and aggregates', () => {
    const withRule = (rule: string) => commandes(rule);
    const bad = expect.objectContaining({ code: 'invalidExpression', prop: 'validationRule' });
    expect(validateDesign(withRule('DCount("*","Clients") > 0'))).toContainEqual(bad);
    expect(validateDesign(withRule('Sum([DateCommande]) > 0'))).toContainEqual(bad);
    expect(validateDesign(withRule('[Clients].[Nom] Is Not Null'))).toContainEqual(bad);
    expect(validateDesign(withRule('[Inconnu] > 0'))).toContainEqual(bad);
    expect(validateDesign(withRule('[datelivraison] >= [DateCommande]'))).toEqual([]);
  });

  it('field rename rewrites the rule', async () => {
    await setRule('Commandes', RULE, 'Livraison avant commande');
    let m = fromDesign(tableDesign(db, 'Commandes'));
    m = designReducer(m, { type: 'setName', index: 1, name: 'Commandée' });
    const req = toSaveRequest(m, 'Commandes', false);
    expect(req.design.validationRule).toBe(RULE); // sent with the source names: alterTable follows the renames
    expect(savedModel(m, req).validationRule).toBe('[DateLivraison] >= [Commandée]'); // the model as stored
    expect(await alterTable(db, 'Commandes', req.design, req.mapping, { allowDataLoss: false, info: fr })).toEqual({ ok: true });
    expect(tableDesign(db, 'Commandes')).toMatchObject({ validationRule: '[DateLivraison] >= [Commandée]', validationText: 'Livraison avant commande' });
  });

  it('alterTable follows renames in the old rule text for every caller; a swap stays a swap; a rename alone asks nothing', async () => {
    await setRule('Commandes', RULE);
    await insert('Commandes', { DateCommande: '2026-10-23', DateLivraison: '2026-10-24' });
    db.prepare(`UPDATE Commandes SET DateLivraison = '2026-10-01 00:00:00'`).run(); // breaks the rule (written outside the write layer)
    const d = tableDesign(db, 'Commandes');
    const names = ['N°', 'DateLivraison', 'DateCommande']; // a swap of the two dates' names
    const design = { ...d, fields: d.fields.map((x, i) => ({ ...x, name: names[i]! })) };
    const mapping = d.fields.map((x, i) => ({ name: names[i]!, sourceName: x.name }));
    expect(await alterTable(db, 'Commandes', design, mapping, { allowDataLoss: false, info: fr })).toEqual({ ok: true });
    expect(tableDesign(db, 'Commandes').validationRule).toBe('[DateCommande] >= [DateLivraison]');
  });

  it('a rule that cannot be computed: expressionError with no field, in the write layer and in action queries', async () => {
    createTable(db, { ...t('Articles', [f('N°', 'autoNumber'), f('Nom', 'shortText')]), validationRule: '[Nom] * 2 > 1' });
    expect(await insert('Articles', { Nom: 'abc' })).toMatchObject({ ok: false, field: '', code: 'expressionError' });
    const ctx = { info: fr, writeSeq: () => 0, now };
    expect(await runAction(db, { kind: 'sql', sql: 'INSERT INTO Articles (Nom) VALUES ("abc")' }, {}, { skipFailures: false, replaceTable: false }, ctx))
      .toMatchObject({ ok: false, reason: 'rowErrors', errors: [{ field: '', code: 'expressionError', table: 'Articles' }] });
  });

  it('round trip and unknown keys kept', () => {
    createTable(db, { ...commandes(RULE, 'Texte'), description: 'Les commandes', extra: { futur: 1 } });
    const d = tableDesign(db, 'Commandes');
    expect(d).toMatchObject({ description: 'Les commandes', validationRule: RULE, validationText: 'Texte', extra: { futur: 1 } });
    expect(d.extra).not.toHaveProperty('validationRule');
    writeTableMetadata(db, { ...d, validationRule: undefined, validationText: undefined });
    const back = tableDesign(db, 'Commandes');
    expect(back.validationRule).toBeUndefined();
    expect(back.validationText).toBeUndefined();
    expect(back.extra).toEqual({ futur: 1 });
  });

  it('existing data: save asks, Test Validation Rules counts the table rule', async () => {
    createTable(db, commandes());
    await insert('Commandes', { DateCommande: '2026-10-23', DateLivraison: '2026-10-01' });
    await insert('Commandes', { DateCommande: '2026-10-01', DateLivraison: '2026-10-23' });
    const design = { ...tableDesign(db, 'Commandes'), validationRule: RULE };
    const mapping = design.fields.map((x) => ({ name: x.name, sourceName: x.name }));
    expect(await alterTable(db, 'Commandes', design, mapping, { allowDataLoss: false, info: fr }))
      .toEqual({ ok: false, reason: 'validationExisting', field: '', rows: 1 });
    expect(await alterTable(db, 'Commandes', design, mapping, { allowDataLoss: false, info: fr, acceptExistingViolations: true })).toEqual({ ok: true });
    expect(await countViolations(db, tableDesign(db, 'Commandes'), '', fr)).toBe(1);
  });
});
