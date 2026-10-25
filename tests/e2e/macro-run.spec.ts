// B1 Task 8: running a macro — Database Tools › Run Macro, its actions (OpenForm with a Where Condition, MessageBox, OpenReport),
// the Action Failed dialog, and an unsafe action blocked while the content is disabled.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { saveObject } from '../../src/main/db/objects';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { FACTURES_ROWS } from '../../src/shared/report/fixtures/factures';
import { launchApp, layoutFromDom, seedBase, seedForm, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => p[k]!);
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const macro = (db: DatabaseSync, name: string, items: MacroItem[]) => {
  const r = saveObject(db, 'macro', name, { formatVersion: '1.0', items }, null);
  if (!r.ok) throw new Error(r.reason);
};
const box = (name: string, top: number): ControlDef => ({ kind: 'textBox', name, left: 1701, top, width: 2268, height: 340, props: { ControlSource: name } });
const FCLIENTS: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 1200, props: {}, controls: [box('Nom', 100), box('Ville', 600)] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
};
const montants = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page('Commandes', { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values[2])));

/** Database Tools › Run Macro, `name` typed and picked in the list, OK. */
async function runMacro(page: Page, name: string) {
  await page.getByTestId('ribbon-tab-databaseTools').click();
  await page.getByTestId('cmd-runMacro').click();
  await expect(page.getByTestId('run-macro-dialog')).toBeVisible();
  await page.getByTestId('run-macro-name').fill(name);
  await page.getByTestId('run-macro-name-list').getByRole('option', { name, exact: true }).click();
  await page.getByTestId('run-macro-ok').click();
}

const FIRST_CLIENT = String(FACTURES_ROWS[0]![1]);
const base = () => seedBase('macros', (db) => {
  seedSales(db);
  seedForm(db, 'FClients', FCLIENTS);
  seedReportsE2E(db);
  macro(db, 'MLyon', [act('SetTempVar', { Name: 'v', Expression: '"Lyon"' }),
    act('OpenForm', { FormName: 'FClients', View: 'form', WhereCondition: '[Ville] = [TempVars]![v]' }),
    act('MessageBox', { Message: '="Clients de " & [TempVars]![v]', Beep: 'no', Type: 'information' })]);
  macro(db, 'MEtat', [act('OpenReport', { ReportName: 'Factures par client', View: 'preview', WhereCondition: `[Client] = "${FIRST_CLIENT}"` })]);
  macro(db, 'MAbsent', [act('OpenForm', { FormName: 'Absent', View: 'form' })]);
  macro(db, 'MParis', [act('OpenForm', { FormName: 'FClients', View: 'form', WhereCondition: '[Ville] = "Paris"' })]);
  macro(db, 'MSql', [act('RunSQL', { SQLStatement: 'UPDATE Commandes SET Montant = Montant * 2;' })]);
});

test('Run Macro: TempVars in a Where Condition and a MessageBox; OpenReport with a condition; an unknown form fails the action', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await runMacro(page, 'MLyon');
    await expect(page.getByTestId('macro-msgbox')).toBeVisible();
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Clients de Lyon');
    await expect(page.getByTestId('modal')).toContainText(fr.macro.msgbox.defaultTitle);
    await page.getByTestId('macro-msgbox-ok').click();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');

    await runMacro(page, 'MEtat'); // the report shows the first client's group only
    const text = (await layoutFromDom(page)).pages.flatMap((p) => p.bands.flatMap((b) => b.lines.map((l) => l[0]))).join(' ');
    expect(text).toContain(FIRST_CLIENT);
    for (const other of ['Dupont', 'Martin', 'Durand'].filter((c) => c !== FIRST_CLIENT)) expect(text).not.toContain(other);

    await runMacro(page, 'MAbsent');
    const failed = page.getByTestId('macro-failed');
    await expect(failed).toBeVisible();
    await expect(page.getByTestId('macro-failed-action')).toHaveText(fr.macro.action.OpenForm);
    await expect(page.getByTestId('macro-failed-args')).toContainText('Absent');
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.notFound, { name: 'Absent' }));
    await page.getByTestId('macro-failed-stop').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('untrusted base: RunSQL is blocked, the dismissed security bar comes back, nothing is written', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR, untrusted: true });
  try {
    await page.getByTestId('banner-dismiss-content').click();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    const before = await montants(page);

    await runMacro(page, 'MSql');
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.blocked, { action: fr.macro.action.RunSQL }));
    await expect(page.getByTestId('banner-content')).toBeVisible();
    await page.getByTestId('macro-failed-stop').click();
    expect(await montants(page)).toEqual(before);
  } finally {
    await app.close();
  }
});

test('OpenForm with a condition on the open form saves the record being edited first', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await runMacro(page, 'MLyon');
    await page.getByTestId('macro-msgbox-ok').click();
    await expect(page.getByTestId('form-ctl-Nom')).toHaveValue('Dupont');
    await page.getByTestId('form-ctl-Nom').fill('Dupond');
    await expect(page.getByTestId('form-dirty')).toBeVisible();

    await runMacro(page, 'MParis'); // the same tab, read again under the new condition
    await expect(page.getByTestId('form-ctl-Nom')).toHaveValue('Durand');
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    const noms = await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page('Clients', { offset: 0, limit: 10 })
      .then((p) => p.rows.map((r) => r.values[1])));
    expect(noms[0]).toBe('Dupond');
  } finally {
    await app.close();
  }
});
