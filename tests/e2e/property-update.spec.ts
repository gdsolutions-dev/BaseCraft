// O4 Task 9: property update options — a field's Format changed in Table Design is offered to the form controls that carry their own.
import { test, expect, type Page } from '@playwright/test';
import { saveObject } from '../../src/main/db/objects';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { launchApp, seedBase, inFile } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const vis = (page: Page, id: string) => page.locator('.doc:not([hidden])').getByTestId(id);
const box = (name: string, top: number, props: Record<string, unknown>): ControlDef => ({ kind: 'textBox', name, left: 1418, top, width: 2268, height: 340, props });
const FCOMMANDES: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Commandes' }, props: {}, sections: [
  { kind: 'detail', height: 2835, props: {}, controls: [box('Montant', 0, { ControlSource: 'Montant', Format: 'standard', TabIndex: 0 }), box('Le', 567, { ControlSource: 'Le', TabIndex: 1 })] }] };

const seed = (name: string) => seedBase(name, (db) => { seedSales(db); seedSalesRelation(db); saveObject(db, 'form', 'FCommandes', FCOMMANDES, null); });
const format = (path: string) => {
  const d = JSON.parse(inFile<{ definition: string }>(path, "SELECT definition FROM bc_objects WHERE kind = 'form' AND name = 'FCommandes'")[0]!.definition) as DesignDoc;
  return d.sections[0]!.controls[0]!.props.Format;
};
async function setMontantFormat(page: Page, shown: string) {
  await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await vis(page, 'design-row-2-name').click();
  await vis(page, 'prop-format').fill(shown);
  await page.keyboard.press('Control+s');
}

test('Format changed in Table Design: Oui updates the control, Non leaves it; the option off offers nothing', async () => {
  const path = seed('pu-format.basecraft');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await setMontantFormat(page, 'Monétaire');
    await expect(page.getByTestId('modal')).toContainText('Formulaire FCommandes › Montant (« Standard »)');
    await expect(page.getByTestId('property-update-target-0')).toBeChecked();
    await page.getByTestId('property-update-yes').click();
    await expect.poll(() => format(path)).toBe('currency');

    // the control now carries the new value: Euro is offered again, and No leaves it
    await vis(page, 'prop-format').fill('Euro');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText('Formulaire FCommandes › Montant (« Monétaire »)');
    await page.getByTestId('property-update-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(format(path)).toBe('currency');

    // the control shows the update in its Design view
    await page.getByTestId('nav-item-form-FCommandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await vis(page, 'ctl-Montant').click();
    await expect(vis(page, 'prop-Format')).toHaveValue('currency'); // the Property Sheet shows the named format's id

    // option off (Options › Concepteurs d'objets): nothing is offered
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-designers').click();
    await page.getByTestId('opt-property-update').uncheck();
    await page.getByTestId('bs-back').click();
    await page.getByTestId('doc-tab-Commandes').click();
    await vis(page, 'prop-format').fill('Standard');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Commandes')).not.toContainText('•');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(format(path)).toBe('currency');
  } finally { await app.close(); }
});
