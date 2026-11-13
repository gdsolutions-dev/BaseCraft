// A6: a Long Text field set to Rich Text (Table Design), a form text box on it edited with the Home › Text Formatting buttons (Bold,
// Bullets, indents, direction, colours); the value is kept as sanitized HTML; a hostile stored value runs nothing; the datasheet
// shows its text; the report prints its formatting.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { inFile, launchApp, seedBase, seedForm } from './helpers';
import { saveObject } from '../../src/main/db/objects';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const SHOTS = process.env.BASECRAFT_E2E_SHOTS;   // a folder: screenshots of the form and the report are written there
const HOSTILE = `<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script><b onclick="window.__pwn=1">sûr</b> <a href="javascript:window.__pwn=1">lien</a>`;

const box: ControlDef = { kind: 'textBox', name: 'Texte', left: 100, top: 100, width: 6000, height: 2000, props: { ControlSource: 'Texte', TabIndex: 0 } };
const FORM: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Notes' }, props: { Width: 6400 },
  sections: [{ kind: 'detail', height: 2300, props: {}, controls: [box] }],
};
const REPORT = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Notes' }, props: { grouping: [], Width: 6994 },
  sections: [{ kind: 'detail', height: 1200, props: {}, controls: [{ kind: 'textBox', name: 'Texte', left: 0, top: 0, width: 5000, height: 1000, props: { ControlSource: 'Texte', CanGrow: true } }] }],
};
const seed = (name: string) => seedBase(name, (db) => {
  createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'longText')]));
  db.prepare(`INSERT INTO "Notes"("Texte") VALUES (NULL), (?)`).run(HOSTILE);
  seedForm(db, 'Fiche', FORM);
  const ok = saveObject(db, 'report', 'Etat', REPORT, null);
  if (!ok.ok) throw new Error(ok.reason);
});
const cur = (p: Page) => p.locator('.doc:not([hidden])');

test('Rich Text: field property, edit with the ribbon, kept after reopen; hostile value inert; datasheet text; report formatting', async () => {
  test.setTimeout(240_000);
  const base = seed('rich-text');
  const problems: string[] = [];
  const watch = (page: Page) => {
    page.on('dialog', (d) => { problems.push(`dialog ${d.message()}`); void d.dismiss(); });
    page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console ${m.text()}`); });
  };

  // 1. Table Design: Texte becomes Rich Text
  let { app, page } = await launchApp({ args: [base], env: FR });
  watch(page);
  try {
    await page.getByTestId('nav-item-Notes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-1-name').click();
    await expect(page.getByTestId('prop-textFormat')).toHaveValue('plain');
    await expect(page.getByTestId('prop-textFormat').locator('option')).toHaveText([fr.fieldProp.textFormats.plain, fr.fieldProp.textFormats.rich]);
    await page.getByTestId('design-row-0-name').click();
    await expect(page.getByTestId('prop-textFormat')).toHaveCount(0);   // an AutoNumber has none
    await page.getByTestId('design-row-1-name').click();
    await page.getByTestId('prop-textFormat').selectOption('rich');
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-save').click();
    // the hostile value is not valid Rich Text: the conversion says it is changed (sanitized)
    await expect(page.getByTestId('modal')).toContainText(fr.designer.lossy_one.replace('{{count}}', '1'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);

    // 2. the form: a rich box; the buttons are off in the other controls and in the datasheet, on in the box
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await page.getByTestId('ribbon-tab-home').click();
    const editor = cur(page).getByTestId('form-ctl-Texte');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    for (const id of ['bullets', 'numbering', 'indentIncrease', 'indentDecrease', 'textDirection', 'textBold', 'textHighlight', 'textFontColor']) {
      await expect(page.getByTestId(`cmd-${id}`), id).toBeDisabled();
    }
    await editor.click();
    for (const id of ['bullets', 'numbering', 'indentIncrease', 'indentDecrease', 'textDirection', 'textBold', 'textItalic', 'textUnderline', 'textHighlight', 'textFontColor']) {
      await expect(page.getByTestId(`cmd-${id}`), id).toBeEnabled();
    }
    await page.keyboard.type('Bonjour');
    await page.keyboard.press('Control+a');
    await page.getByTestId('cmd-textBold').click();
    await expect(editor.locator('b')).toHaveText('Bonjour');
    await expect(page.getByTestId('cmd-textBold')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cmd-textHighlight').click();
    await page.getByTestId('rich-back-choices-fff2a8').click();
    await expect(editor.locator('[style*="background-color"], font[style*="background"]').first()).toBeVisible();
    await expect(editor).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.getByTestId('cmd-bullets').click();
    await page.keyboard.type('premier');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');
    await page.getByTestId('cmd-indentIncrease').click();
    await expect(editor.locator('ul ul')).toHaveCount(1);   // indented in a list: a nested list
    await page.getByTestId('cmd-textDirection').click();
    await expect(editor.locator('[dir="rtl"]')).toHaveCount(1);
    await page.getByTestId('cmd-textDirection').click();
    await expect(editor.locator('[dir="rtl"]')).toHaveCount(0);
    await page.getByTestId('cmd-textFontColor').click();
    await page.getByTestId('rich-fore-choices-c8261a').click();
    await page.keyboard.type('!');   // a colour chosen at the caret applies to what is typed next
    await expect(editor.locator('font[color]')).toContainText('!');
    if (SHOTS) await cur(page).getByTestId('form-run').screenshot({ path: join(SHOTS, 'form-rich.png') });
    await page.getByTestId('cmd-save').click();
    await expect(page.getByTestId('doc-tab-form-Fiche')).not.toContainText('•');
  } finally {
    await app.close();
  }
  const stored = inFile<{ Texte: string }>(base, `SELECT "Texte" FROM "Notes" WHERE "N°" = 1`)[0]!.Texte;
  expect(stored).toMatch(/<b[^>]*>Bonjour<\/b>/);
  expect(stored).toContain('background-color');
  expect(stored).toContain('<ul>');
  expect(stored).toContain('premier');
  expect(stored).not.toMatch(/<script|onerror|onclick|javascript:/i);

  // a value written behind the application's back (a base received by e-mail): hostile
  const raw = new DatabaseSync(base);
  raw.prepare('UPDATE "Notes" SET "Texte" = ? WHERE "N°" = 2').run(HOSTILE);
  raw.close();

  // 3. reopened: the formatting is there; the hostile record renders inert
  ({ app, page } = await launchApp({ args: [base], env: FR }));
  watch(page);
  try {
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    const editor = cur(page).getByTestId('form-ctl-Texte');
    await expect(editor.locator('b, [style*="background"]').first()).toContainText('Bonjour');
    await expect(editor.locator('ul li').first()).toContainText('premier');
    await cur(page).getByTestId('form-run').getByRole('button', { name: fr.datasheet.nav.next }).click();
    await expect(editor).toContainText('sûr');
    await expect(editor.locator('b')).toHaveText('sûr');
    await expect(editor.locator('img, script, a')).toHaveCount(0);
    await expect(editor).not.toContainText('alert');
    expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined();
    expect(await editor.evaluate((e) => e.innerHTML)).not.toMatch(/onerror|onclick|javascript:|<script/i);
    if (SHOTS) await cur(page).getByTestId('form-run').screenshot({ path: join(SHOTS, 'form-hostile.png') });

    // 4. the datasheet shows the text, not the tags
    await page.getByTestId('nav-item-Notes').dblclick();
    const cell = (row: number) => page.getByTestId(`glide-cell-2-${row}`);
    await expect(cell(0)).toContainText('Bonjour');
    await expect(cell(0)).toContainText('premier');
    // (the grid draws the text of the value on its canvas, see the screenshot; its accessible cell holds the HTML that is edited)
    await expect(cell(1)).toContainText('sûr');
    if (SHOTS) await page.getByTestId('data-grid-canvas').first().screenshot({ path: join(SHOTS, 'datasheet-rich.png') });

    // 5. the report prints the formatting of the first record, the hostile one inert
    await page.getByTestId('nav-item-report-Etat').dblclick();
    const paper = cur(page).locator('.bc-page');
    await expect(paper.first().locator('.bc-rich').first()).toBeVisible();
    await expect(paper.first().locator('.bc-rich ul li').first()).toContainText('premier');
    await expect(paper.first().locator('.bc-rich b').first()).toContainText('Bonjour');
    expect(await paper.first().locator('.bc-rich b').first().evaluate((e) => getComputedStyle(e).fontWeight)).toBe('700');
    await expect(paper.first().locator('.bc-rich [style*="background-color"]').first()).toBeVisible();
    await expect(paper.first().locator('.bc-rich b', { hasText: 'sûr' })).toHaveText('sûr');
    await expect(paper.first().locator('.bc-rich img, .bc-rich script, .bc-rich a')).toHaveCount(0);
    if (SHOTS) await paper.first().screenshot({ path: join(SHOTS, 'report-rich.png') });
    expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined();
  } finally {
    await app.close();
  }
  expect(problems).toEqual([]);
});
