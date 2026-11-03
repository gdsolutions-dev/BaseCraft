// O4 Task 1: File › Options — « Options de correction automatique de nom » (three database options, R2 dependencies) and
// « Concepteurs d'objets » › « Afficher les boutons d'options de mise à jour des propriétés ».
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inFile, launchApp, openDbOptions, seedSalesE2E } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const startupOf = (path: string) => (JSON.parse(inFile<{ value: string }>(path, `SELECT value FROM bc_meta WHERE key = 'options'`)[0]!.value) as { startup: Record<string, unknown> }).startup;
const settingsFile = (dir: string) => { try { return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')); } catch { return {}; } };
async function openOptions(page: Page) {
  await page.getByTestId('ribbon-tab-file').click();
  await openDbOptions(page);
}

test('the section follows the ribbon section; defaults, dependencies, kept after a relaunch', async () => {
  const path = seedSalesE2E('options-o4.basecraft');
  const first = await launchApp({ args: [path], env: FR });
  let again: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    const { page } = first;
    await openOptions(page);
    await expect(page.getByTestId('opt-db-autocorrect')).toBeVisible();   // the section renders once the options are read
    const heads = await page.locator('[data-testid="opt-db"] h2').allTextContents();
    expect(heads.indexOf('Options de correction automatique de nom')).toBe(heads.indexOf("Options de la barre d'outils et du ruban") + 1);
    await expect(page.getByTestId('opt-db-autocorrect')).toContainText('Suivi des informations de correction automatique de nom');
    await expect(page.getByTestId('opt-db-ac-track')).toBeChecked();
    await expect(page.getByTestId('opt-db-ac-perform')).toBeChecked();
    await expect(page.getByTestId('opt-db-ac-log')).not.toBeChecked();
    await expect(page.getByTestId('opt-db-autocorrect')).toContainText('Effectuer la correction automatique de nom');
    await expect(page.getByTestId('opt-db-autocorrect')).toContainText('Historique de la correction automatique de nom');

    await page.getByTestId('opt-db-ac-log').check();
    await expect.poll(() => startupOf(path)).toMatchObject({ trackNameAutoCorrect: true, performNameAutoCorrect: true, logNameAutoCorrect: true });
    await page.getByTestId('opt-db-ac-track').uncheck();
    await expect(page.getByTestId('opt-db-ac-perform')).not.toBeChecked();
    await expect(page.getByTestId('opt-db-ac-perform')).toBeDisabled();
    await expect(page.getByTestId('opt-db-ac-log')).not.toBeChecked();
    await expect(page.getByTestId('opt-db-ac-log')).toBeDisabled();
    await expect.poll(() => startupOf(path)).toMatchObject({ trackNameAutoCorrect: false, performNameAutoCorrect: false, logNameAutoCorrect: false });
    await page.getByTestId('opt-db-ac-track').check();
    await expect(page.getByTestId('opt-db-ac-perform')).toBeEnabled();
    await expect(page.getByTestId('opt-db-ac-perform')).not.toBeChecked();   // stays off
    await expect(page.getByTestId('opt-db-ac-log')).toBeDisabled();   // its parent is off
    await expect.poll(() => startupOf(path)).toMatchObject({ trackNameAutoCorrect: true, performNameAutoCorrect: false, logNameAutoCorrect: false });
    await first.app.close();

    again = await launchApp({ args: [path], env: FR });
    await openOptions(again.page);
    await expect(again.page.getByTestId('opt-db-ac-track')).toBeChecked();
    await expect(again.page.getByTestId('opt-db-ac-perform')).not.toBeChecked();
    await expect(again.page.getByTestId('opt-db-ac-log')).toBeDisabled();
  } finally {
    await again?.app.close();
    await first.app.close().catch(() => undefined);
  }
});

test('« Concepteurs d\'objets »: the property update switch is on, written at once, kept after a relaunch', async () => {
  const first = await launchApp({ env: FR });
  let again: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    await first.page.getByTestId('bs-options').click();
    await first.page.getByTestId('opt-cat-designers').click();
    await expect(first.page.getByTestId('opt-property-update')).toBeChecked();
    await expect(first.page.getByTestId('opt-panel')).toContainText("Afficher les boutons d'options de mise à jour des propriétés");
    await first.page.getByTestId('opt-property-update').uncheck();
    await expect.poll(() => settingsFile(first.userDataDir).propertyUpdateOptions).toBe(false);
    await first.app.close();
    again = await launchApp({ userDataDir: first.userDataDir, env: FR });
    await again.page.getByTestId('bs-options').click();
    await again.page.getByTestId('opt-cat-designers').click();
    await expect(again.page.getByTestId('opt-property-update')).not.toBeChecked();
  } finally {
    await again?.app.close();
    await first.app.close().catch(() => undefined);
  }
});

test('a read-only base: the three boxes are disabled', async () => {
  const path = seedSalesE2E('options-o4-ro.basecraft');
  const holder = await launchApp({ args: [path], env: FR });   // takes the lock
  try {
    const { app, page } = await launchApp({ args: [path], env: FR });   // finds it held: read-only
    try {
      await openOptions(page);
      for (const id of ['track', 'perform', 'log']) await expect(page.getByTestId(`opt-db-ac-${id}`)).toBeDisabled();
    } finally {
      await app.close();
    }
  } finally {
    await holder.app.close();
  }
});
