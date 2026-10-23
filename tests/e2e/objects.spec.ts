import { test, expect } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import { clients } from '../../src/shared/test-fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));

test('navigation pane: query, form and report categories; a saved form opens its Form view, a report its Print Preview', async () => {
  const base = seedBase('objets', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await expect(page.getByTestId('nav-item-Clients')).toBeVisible();
    for (const k of ['query', 'form', 'report']) {
      await expect(page.getByTestId(`nav-group-${k}`)).toBeVisible();
      await expect(page.getByTestId(`nav-count-${k}`)).toHaveText('0');
    }

    const save = (kind: 'form' | 'query', name: string) => page.evaluate(([k, n]) =>
      (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.save(k, n,
        k === 'query' ? { formatVersion: '1.0', sql: 'SELECT * FROM [Clients];' } : { formatVersion: '1.0', sections: [] }, null), [kind, name] as const);
    expect(await save('form', 'Saisie clients')).toEqual({ ok: true });
    expect(await save('query', 'CLIENTS')).toEqual({ ok: false, reason: 'nameExists' }); // a query cannot take a table's name
    await page.reload(); // the renderer reads the objects again from the open base
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });

    const item = page.getByTestId('nav-group-form').getByTestId('nav-item-form-Saisie clients');
    await expect(item).toBeVisible();
    await expect(page.getByTestId('nav-count-form')).toHaveText('1');
    await item.dblclick();
    await expect(page.getByTestId('doc-tab-form-Saisie clients')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-Saisie clients')).toHaveAccessibleName(/Saisie clients.*Formulaire/);
    await expect(page.getByTestId('doc-tab-close-form-Saisie clients')).toHaveAccessibleName(/Formulaire/);
    await expect(page.getByTestId('form-run')).toBeVisible(); // an empty unbound form: the definition has no record source

    // a report's Run view is Print Preview (A5), no longer the fallback view
    expect(await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.save('report', 'Ventes',
      { formatVersion: '1.0', recordSource: null, props: {}, sections: [] }, null))).toEqual({ ok: true });
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Ventes').dblclick();
    await expect(page.getByTestId('doc-tab-report-Ventes')).toBeVisible();
    await expect(page.getByTestId('preview-page-of')).toHaveText('Page 1 sur 1');
    await expect(page.getByTestId('doc-unavailable')).toHaveCount(0);
    await page.getByTestId('doc-tab-close-report-Ventes').click();

    // copy, then rename and delete the copy from the context menu
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-copy').click();
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-paste').click();
    await page.getByTestId('paste-ok').click();
    const copy = page.getByTestId('nav-item-form-Copie de Saisie clients');
    await expect(copy).toBeVisible();
    await copy.click({ button: 'right' });
    await page.getByTestId('nav-menu-rename').click();
    await page.getByTestId('modal-input').fill('Saisie 2');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-form-Saisie 2')).toBeVisible();
    await page.getByTestId('nav-item-form-Saisie 2').click({ button: 'right' });
    await page.getByTestId('nav-menu-delete').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('nav-item-form-Saisie 2')).toHaveCount(0);
    await expect(page.getByTestId('nav-count-form')).toHaveText('1');

    // a table copies too: structure and data
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-copy').click();
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-paste').click();
    await expect(page.getByTestId('paste-name')).toHaveValue('Copie de Clients');
    await page.getByTestId('paste-ok').click();
    await expect(page.getByTestId('nav-item-Copie de Clients')).toBeVisible();
    await expect(page.getByTestId('nav-count-table')).toHaveText('2');
  } finally {
    await app.close();
  }
});

test('Shift+F9 (Requery) refreshes the active datasheet with rows added elsewhere; F5 is not refresh', async () => {
  const base = seedBase('rafraichir', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('nav-record-count')).toHaveText('0');
    const r = await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.insert('Clients', { Nom: 'Dupont' }));
    expect(r).toMatchObject({ ok: true });
    await expect(page.getByTestId('nav-record-count')).toHaveText('0'); // nothing told the datasheet
    await page.keyboard.press('F5');
    await expect(page.getByTestId('nav-record-count')).toHaveText('0');
    await page.keyboard.press('Shift+F9');
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await page.getByTestId('cmd-viewDesign').click();
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.mode.design);
    await page.getByTestId('ribbon-tab-home').click(); // Design view shows its contextual tab
    await expect(page.getByTestId('cmd-refresh')).toBeDisabled(); // the design view registers no refresh
  } finally {
    await app.close();
  }
});

test('table designer: a field name over 64 characters shows a message under the field and is not saved', async () => {
  const base = seedBase('long', () => {});
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTableDesign').click();
    await page.getByTestId('design-row-0-name').fill('x'.repeat(65));
    await expect(page.getByTestId('design-row-0-name-error')).toHaveText(fr.designError.nameTooLong);
    await page.getByTestId('design-row-0-name').fill('x'.repeat(64));
    await expect(page.getByTestId('design-row-0-name-error')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
