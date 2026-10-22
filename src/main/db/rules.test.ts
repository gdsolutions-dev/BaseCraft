import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable, quoteIdent } from './schema';
import { insertRow, updateRow } from './write-layer';
import { alterTable } from './alter';
import { applyDefaults, checkRules, countViolations } from './rules';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import { validateDesign } from '../../shared/field-types';

let dir: string;
let db: DatabaseSync;
const fr = localeInfo('fr-FR');
const now = () => new Date(2026, 9, 21, 15, 30, 0);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcrules-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const rowsOf = (name: string) => db.prepare(`SELECT * FROM ${quoteIdent(name)} ORDER BY rowid`).all();

describe('rules (brief)', () => {
  it('default applied when absent, not when null', async () => {
    const d = t('T', [f('N°', 'autoNumber'), f('Qté', 'number', { defaultValue: '1' }), f('Le', 'dateTime', { defaultValue: 'Date()' })]);
    createTable(db, d);
    expect(await insertRow(db, d, {}, fr, now)).toMatchObject({ values: [1, 1, '2026-10-21 00:00:00'] });
    const r = await insertRow(db, d, { Qté: null }, fr, now);
    expect(r.ok && r.values[1]).toBeNull();
  });
  it('validation: Null passes, rule fails with text', async () => {
    const d = t('T', [f('N°', 'autoNumber'), f('Qté', 'number', { validationRule: '>0', validationText: 'Quantité positive' })]);
    createTable(db, d);
    expect((await insertRow(db, d, {}, fr, now)).ok).toBe(true);
    expect(await insertRow(db, d, { Qté: '-1' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'Qté', code: 'validation', message: 'Quantité positive' }] });
    expect((await insertRow(db, d, { Qté: '3' }, fr, now)).ok).toBe(true);
  });
  it('Is Not Null blocks empty', async () => {
    const d = t('T', [f('N°', 'autoNumber'), f('Nom', 'shortText', { validationRule: 'Is Not Null' })]);
    createTable(db, d);
    expect(await insertRow(db, d, {}, fr, now)).toEqual({ ok: false, errors: [{ field: 'Nom', code: 'validation' }] });
    expect(rowsOf('T')).toHaveLength(0);
  });
  it('update checks only changed fields', async () => {
    const d = t('T', [f('N°', 'autoNumber'), f('Qté', 'number', { validationRule: '>0' }), f('Nom', 'shortText')]);
    createTable(db, d);
    db.prepare('INSERT INTO "T" ("Qté", "Nom") VALUES (0, \'a\')').run(); // existing invalid row (rule added later)
    expect((await updateRow(db, d, 1, { Nom: 'b' }, fr, now)).ok).toBe(true);
    expect(await updateRow(db, d, 1, { Qté: '-2' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'Qté', code: 'validation' }] });
  });
  it('alter reports existing violations unless accepted', async () => {
    const plain = t('T', [f('N°', 'autoNumber'), f('Qté', 'number')]);
    createTable(db, plain);
    for (let i = 0; i < 2; i++) await insertRow(db, plain, { Qté: '0' }, fr, now);
    const ruled = t('T', [f('N°', 'autoNumber'), f('Qté', 'number', { validationRule: '>0' })]);
    const mapping = [{ name: 'N°', sourceName: 'N°' }, { name: 'Qté', sourceName: 'Qté' }];
    expect(await alterTable(db, 'T', ruled, mapping, { allowDataLoss: false, info: fr })).toEqual({ ok: false, reason: 'validationExisting', field: 'Qté', rows: 2 });
    expect(await countViolations(db, plain, 'Qté')).toBe(0); // the rule was not saved
    expect(await alterTable(db, 'T', ruled, mapping, { allowDataLoss: false, info: fr, acceptExistingViolations: true })).toEqual({ ok: true });
    expect(rowsOf('T')).toEqual([{ 'N°': 1, 'Qté': 0 }, { 'N°': 2, 'Qté': 0 }]);
    // an unchanged rule is not checked again
    expect(await alterTable(db, 'T', ruled, mapping, { allowDataLoss: false, info: fr })).toEqual({ ok: true });
  });
  it('design rejects invalid expressions and foreign refs', () => {
    expect(validateDesign(t('T', [f('A', 'number', { validationRule: '> 1 +' })]))).toContainEqual({ code: 'invalidExpression', field: 'A', prop: 'validationRule' });
    expect(validateDesign(t('T', [f('A', 'number', { validationRule: '> [B]' }), f('B', 'number')]))).toContainEqual({ code: 'invalidExpression', field: 'A', prop: 'validationRule' });
    expect(validateDesign(t('T', [f('A', 'number', { defaultValue: '1 +' })]))).toContainEqual({ code: 'invalidExpression', field: 'A', prop: 'defaultValue' });
    expect(validateDesign(t('T', [f('A', 'number', { validationRule: '>0 And [a] < 10', defaultValue: '2*3' })]))).toEqual([]);
  });
});

describe('rules', () => {
  const d = t('T', [f('N°', 'autoNumber'), f('Qté', 'number', { defaultValue: '1/0', validationRule: 'Between 1 And 5' }), f('Nom', 'shortText', { defaultValue: '"x" & "y"' })]);
  it('applyDefaults fills absent fields only', async () => {
    const ok = t('T', [f('Nom', 'shortText', { defaultValue: '"x" & "y"' }), f('Ok', 'yesNo', { defaultValue: 'True' })]);
    expect(await applyDefaults(ok, {}, fr, now)).toEqual({ Nom: 'xy', Ok: true });
    expect(await applyDefaults(ok, { Nom: 'a' }, fr, now)).toEqual({ Nom: 'a', Ok: true });
  });
  it('an evaluation error is expressionError', async () => {
    createTable(db, d);
    expect(await insertRow(db, d, {}, fr, now)).toEqual({ ok: false, errors: [{ field: 'Qté', code: 'expressionError' }] });
    const bad = t('T', [f('Nom', 'shortText', { validationRule: '> 1 / 0' })]);
    expect(await checkRules(bad, { Nom: 'a' }, ['Nom'], now)).toEqual([{ field: 'Nom', code: 'expressionError' }]);
  });
  it('checkRules ignores unchanged fields and names like __proto__', async () => {
    const odd = t('T', [f('__proto__', 'number', { validationRule: '>0' }), f('constructor', 'number', { validationRule: 'Is Not Null' })]);
    expect(await checkRules(odd, { __proto__: -1 } as unknown as Record<string, number>, ['constructor'], now)).toEqual([{ field: 'constructor', code: 'validation' }]);
    expect(await checkRules(odd, JSON.parse('{"__proto__": -1, "constructor": 1}'), ['__proto__', 'constructor'], now)).toEqual([{ field: '__proto__', code: 'validation' }]);
  });
  it('the rule sees the stored value after coerce (regional input)', async () => {
    const dd = t('T', [f('N°', 'autoNumber'), f('P', 'number', { numberSize: 'double', validationRule: '< 2' })]);
    createTable(db, dd);
    expect((await insertRow(db, dd, { P: '1,5' }, fr, now)).ok).toBe(true);
    expect((await insertRow(db, dd, { P: '2,5' }, fr, now)).ok).toBe(false);
  });
});
