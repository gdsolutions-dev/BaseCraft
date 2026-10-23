import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const docTabs = (page: Page) => page.locator('[data-testid^="doc-tab-"]:not([data-testid^="doc-tab-close"])');
const selected = (page: Page, tab: string) => expect(page.getByTestId(`ribbon-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');

/** Saves a query (valid SQL: A3 checks it), a form and a report (opaque: their views come with A3-A5) and reads them again. */
async function seedObjects(page: Page) {
  for (const [kind, name] of [['query', 'Liste'], ['form', 'Saisie'], ['report', 'Factures']] as const) {
    const r = await page.evaluate(([k, n]) =>
      (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.save(k, n,
        k === 'query' ? { formatVersion: '1.0', sql: 'SELECT * FROM [Clients];' } : { formatVersion: '1.0', sections: [] }, null), [kind, name] as const);
    expect(r).toEqual({ ok: true });
  }
  await page.reload();
  await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
}

test('a planned command: disabled but focusable, its tooltip names the batch on hover and on focus, activating it does nothing', async () => {
  const base = seedBase('ruban', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    const query = page.getByTestId('cmd-createMacro'); // a placeholder (stage B; queries, forms and reports delivered by A3, A4 and A5)
    await expect(query).toHaveAccessibleName(fr.ribbon.cmd.createMacro);
    await expect(page.getByTestId('cmd-labels')).toHaveAccessibleName(fr.ribbon.cmd.labels); // the French labels laid out (« Macro » reads the same in English): the hover lands on it
    await expect(query).toHaveAttribute('aria-disabled', 'true');
    await expect(query).toHaveAttribute('data-planned', 'B');
    await expect(query).not.toHaveAttribute('disabled');
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    await query.hover();
    await expect(page.getByRole('tooltip')).toHaveText(fr.ribbon.planned.B);
    await expect(query).toHaveAccessibleDescription(fr.ribbon.planned.B); // aria-describedby
    await query.click({ force: true }); // Playwright would wait for an aria-disabled button to become enabled
    await expect(docTabs(page)).toHaveCount(0);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await page.mouse.move(600, 600);
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    // keyboard: Tab reaches it from the previous command (Labels, a placeholder), and the tooltip shows on focus
    await page.getByTestId('cmd-queryWizard').focus();
    await expect(page.getByRole('tooltip')).toHaveText(fr.ribbon.planned.later);
    await page.getByTestId('cmd-labels').focus();
    await page.keyboard.press('Tab');
    await expect(query).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(fr.ribbon.planned.B);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(docTabs(page)).toHaveCount(0);
    // Escape dismisses the tooltip without moving the focus (WCAG 1.4.13)
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(query).toBeFocused();

    // stages, and an icon-only button whose tooltip also names it; implemented commands keep their behaviour
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importAccess').hover();
    await expect(page.getByRole('tooltip')).toHaveText("Prévu à l'étape E — Import Access");
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-textBold').hover();
    await expect(page.getByRole('tooltip')).toHaveText(`${fr.ribbon.cmd.textBold}${fr.ribbon.planned.later}`); // no label shown: the tooltip names it
    await page.getByTestId('cmd-replace').hover();
    await expect(page.getByRole('tooltip')).toHaveText(`${fr.ribbon.cmd.replace}${fr.ribbon.planned.later}`);
    await expect(page.getByTestId('cmd-replace')).toHaveAccessibleName(fr.ribbon.cmd.replace);
    await expect(page.getByTestId('cmd-replace')).toHaveAccessibleDescription(fr.ribbon.planned.later); // the name is not read twice
    await expect(page.getByTestId('cmd-textBold')).toHaveAccessibleName(fr.ribbon.cmd.textBold);
    await expect(page.getByTestId('cmd-sortAsc')).toBeDisabled(); // no document: an implemented command, disabled as before
    await expect(page.getByTestId('cmd-sortAsc')).not.toHaveAttribute('data-planned');
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTableDesign').click();
    await expect(docTabs(page)).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('C10: a contextual tab is selected when its context opens; leaving gives back the tab selected before', async () => {
  const base = seedBase('contextes', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await seedObjects(page);
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('nav-item-Clients').dblclick();
    // Datasheet: Table Fields and Table appear without taking the ribbon away (as in Access)
    await expect(page.getByTestId('ribbon-tab-tableFields')).toHaveText(fr.ribbon.tab.tableFields);
    await expect(page.getByTestId('ribbon-tab-table')).toBeVisible();
    await selected(page, 'externalData');

    await page.getByTestId('status-view-design').click();
    await selected(page, 'design');
    await expect(page.getByTestId('ribbon-tab-design')).toHaveText('Création de tableau');
    await expect(page.getByTestId('ribbon-tab-tableFields')).toHaveCount(0);
    const groups = () => page.locator('[data-testid^="ribbon-group-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(await groups()).toEqual(['view', 'tools', 'showHide', 'tableEvents', 'relationships'].map((g) => `ribbon-group-${g}`));
    await page.getByTestId('status-view-datasheet').click();
    await selected(page, 'externalData');
    await expect(page.getByTestId('ribbon-tab-design')).toHaveCount(0);

    // a form in Design view: Form Design, Arrange, Format; its Run view (the fallback view) has none
    await page.getByTestId('nav-item-form-Saisie').dblclick();
    await expect(page.getByTestId('ribbon-tab-formDesign')).toHaveCount(0);
    await page.getByTestId('status-view-design').click();
    await selected(page, 'formDesign');
    for (const id of ['arrange', 'format']) await expect(page.getByTestId(`ribbon-tab-${id}`)).toBeVisible();
    await page.getByTestId('ribbon-tab-format').click();
    await page.getByTestId('doc-tab-Clients').click(); // back to the datasheet: the tab chosen before the form took over
    await selected(page, 'externalData');

    // a report: Print Preview in its Run view, Report Design / Arrange / Format / Page Setup in Design view
    await page.getByTestId('nav-item-report-Factures').dblclick();
    await selected(page, 'printPreview');
    await page.getByTestId('status-view-design').click();
    await selected(page, 'reportDesign');
    const tabs = await page.locator('.rtabs [role="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(tabs).toEqual(['home', 'create', 'externalData', 'databaseTools', 'help', 'reportDesign', 'arrange', 'format', 'pageSetup'].map((x) => `ribbon-tab-${x}`));

    // a query in Design view
    await page.getByTestId('nav-item-query-Liste').dblclick();
    await page.getByTestId('status-view-design').click();
    await selected(page, 'queryDesign');

    // closing every document gives back the tab selected before the documents took over
    for (const id of ['query-Liste', 'report-Factures', 'form-Saisie', 'Clients']) await page.getByTestId(`doc-tab-close-${id}`).click();
    await expect(docTabs(page)).toHaveCount(0);
    await selected(page, 'externalData');

    // a new table in Design view, then closed: back to Create
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTableDesign').click();
    await selected(page, 'design');
    await page.locator('[data-testid^="doc-tab-close-"]').click();
    await selected(page, 'create');
  } finally {
    await app.close();
  }
});

test('C10: the Relationships window takes the ribbon and gives it back; the Table tab opens Table Properties', async () => {
  const base = seedBase('onglet-table', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-relationships').click();
    await selected(page, 'relationshipDesign');
    await expect(page.locator('[aria-modal="true"]')).toBeVisible(); // Add Tables opens on an empty layout, as Show Table does in Access
    await page.keyboard.press('Escape');
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await page.getByTestId('cmd-closeRelationships').click();
    await expect(docTabs(page)).toHaveCount(0);
    await selected(page, 'databaseTools');

    await page.getByTestId('nav-item-Clients').dblclick();
    await selected(page, 'databaseTools'); // a datasheet shows Table Fields and Table without selecting them (C13)
    await page.getByTestId('ribbon-tab-table').click();
    const cmd = page.getByTestId('cmd-tableProperties');
    await expect(cmd).not.toHaveAttribute('data-planned');
    await expect(cmd).toBeEnabled();
    await cmd.click();
    await expect(page.getByTestId('object-properties-name')).toHaveText('Clients');
    await page.getByTestId('object-properties-description').fill('Fichier clients');
    await page.getByTestId('object-properties-ok').click();
    await expect(page.getByTestId('object-properties')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-Clients')).toHaveAttribute('title', 'Fichier clients');
    await cmd.click();
    await expect(page.getByTestId('object-properties-description')).toHaveValue('Fichier clients');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('object-properties')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

/** Every command button of the shown tab: none overlaps another, no label leaves its button; the tabs fit the window. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const box = (e: Element) => e.getBoundingClientRect();
    const inside = (a: DOMRect, b: DOMRect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    const meet = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const tab = document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-testid');
    const buttons = [...document.querySelectorAll('.rbody [data-testid^="cmd-"]')];
    buttons.forEach((b, i) => {
      const id = b.getAttribute('data-testid');
      for (const s of b.querySelectorAll('span, svg')) {
        if (getComputedStyle(s).display === 'none') continue; // small buttons drop their label below 1100 px (named by title / tooltip)
        if (!inside(box(s), box(b))) out.push(`${tab}: ${id} label or icon clipped`);
      }
      for (const c of buttons.slice(i + 1)) if (meet(box(b), box(c))) out.push(`${tab}: ${id} overlaps ${c.getAttribute('data-testid')}`);
    });
    const groups = [...document.querySelectorAll('.rbody [data-testid^="ribbon-group-"]')];
    groups.forEach((g, i) => {
      for (const c of groups.slice(i + 1)) if (meet(box(g), box(c))) out.push(`${tab}: group ${g.getAttribute('data-testid')} overlaps ${c.getAttribute('data-testid')}`);
      const label = g.querySelector('.rlabel');
      if (label && label.scrollWidth > label.clientWidth + 1) out.push(`${tab}: ${g.getAttribute('data-testid')} label clipped`);
    });
    const tabs = [...document.querySelectorAll('.rtabs > button')];
    tabs.forEach((t, i) => {
      if (box(t).right > window.innerWidth || t.scrollWidth > t.clientWidth + 1) out.push(`tab ${t.getAttribute('data-testid')} clipped`);
      for (const c of tabs.slice(i + 1)) if (meet(box(t), box(c))) out.push(`tab ${t.getAttribute('data-testid')} overlaps ${c.getAttribute('data-testid')}`);
    });
    return out;
  });
}

/** The window at `width` (900: its minimum size, main/index.ts); the page gets what the frame leaves. */
async function resize(app: ElectronApplication, page: Page, width: number) {
  await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 720), width);
  await expect.poll(() => page.evaluate((w) => Math.abs(window.innerWidth - w) <= 20, width)).toBe(true); // frame and DPI rounding
}

test('the ribbon stays usable at 900 px and 1280 px: no overlap, no clipped label, scroll arrows when the groups do not fit', async () => {
  test.setTimeout(120000);
  const base = seedBase('largeur', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await seedObjects(page);
    const problems: string[] = [];
    const check = async (tabs: string[]) => {
      for (const id of tabs) {
        await page.getByTestId(`ribbon-tab-${id}`).click();
        await selected(page, id);
        problems.push(...(await layoutProblems(page)));
      }
    };
    const contexts: [string, () => Promise<void>, string[]][] = [
      ['no document', async () => {}, ['home', 'create', 'externalData', 'databaseTools', 'help']],
      ['table datasheet', () => page.getByTestId('nav-item-Clients').dblclick(), ['tableFields', 'table']],
      ['table design', () => page.getByTestId('status-view-design').click(), ['design']],
      ['query design', async () => { await page.getByTestId('nav-item-query-Liste').dblclick(); await page.getByTestId('status-view-design').click(); }, ['queryDesign']],
      ['form design', async () => { await page.getByTestId('nav-item-form-Saisie').dblclick(); await page.getByTestId('status-view-design').click(); }, ['formDesign', 'arrange', 'format']],
      ['report preview', () => page.getByTestId('nav-item-report-Factures').dblclick(), ['printPreview']],
      ['report design', () => page.getByTestId('status-view-design').click(), ['reportDesign', 'pageSetup']],
    ];
    for (const width of [900, 1280]) {
      await resize(app, page, width);
      for (const id of ['query-Liste', 'report-Factures', 'form-Saisie', 'Clients']) {
        const close = page.getByTestId(`doc-tab-close-${id}`);
        if (await close.count()) await close.click();
      }
      for (const [, open, tabs] of contexts) { await open(); await check(tabs); }
      // the report designer's tab row is the longest: every tab still fits the window
      problems.push(...(await layoutProblems(page)));
    }
    expect(problems).toEqual([]);

    // at 900 px Home does not fit: an arrow scrolls it, the other arrow comes back
    await resize(app, page, 900);
    await page.getByTestId('ribbon-tab-home').click();
    await expect(page.getByTestId('ribbon-scroll-left')).toHaveCount(0);
    await page.getByTestId('ribbon-scroll-right').click();
    await expect.poll(() => page.locator('.rbody').evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
    await expect(page.getByTestId('ribbon-scroll-left')).toBeVisible();
    // keyboard focus brings a hidden command into view
    await page.getByTestId('cmd-zoom').focus();
    const [zoom, body] = await Promise.all([page.getByTestId('cmd-zoom').boundingBox(), page.locator('.rbody').boundingBox()]);
    expect(zoom!.x + zoom!.width).toBeLessThanOrEqual(body!.x + body!.width + 1);
  } finally {
    await app.close();
  }
});

/** Tabs through every command of the shown tab, forward then back: the focused one stays whole inside the ribbon body and under
 *  no scroll arrow, and a placeholder's tooltip is aligned with one edge of its button, inside the window. */
async function focusProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  const check = () => page.evaluate(() => new Promise<string[]>((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const out: string[] = [];
    const el = document.activeElement!;
    const id = `${document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-testid')}: ${el.getAttribute('data-testid')}`;
    const r = el.getBoundingClientRect();
    const across = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const body = document.querySelector('.rbody')!.getBoundingClientRect();
    if (r.left < body.left + 0.5 || r.right > body.right - 0.5) out.push(`${id} cut by the ribbon's edge`);
    for (const a of document.querySelectorAll('.rscroll')) if (across(r, a.getBoundingClientRect()) > 0.5) out.push(`${id} under ${a.getAttribute('data-testid')}`);
    const tip = document.getElementById(el.getAttribute('aria-describedby') ?? '');
    if (tip && !tip.hidden) {
      const t = tip.getBoundingClientRect();
      if (Math.abs(t.left - r.left) > 1 && Math.abs(t.right - r.right) > 1) out.push(`${id} tooltip ${Math.round(t.left)}..${Math.round(t.right)} not aligned with its button ${Math.round(r.left)}..${Math.round(r.right)}`);
      if (t.left < 0 || t.right > document.documentElement.clientWidth) out.push(`${id} tooltip leaves the window`);
    }
    done(out);
  }))));
  const inRibbon = () => page.evaluate(() => !!document.activeElement?.closest('.rbody'));
  const commands = page.locator('.rbody [data-testid^="cmd-"]:not(:disabled)');
  for (const [start, key] of [[commands.first(), 'Tab'], [commands.last(), 'Shift+Tab']] as const) {
    await start.focus();
    while (await inRibbon()) { problems.push(...(await check())); await page.keyboard.press(key); }
  }
  return problems;
}

test('keyboard focus: a focused command is never under a scroll arrow or cut by the ribbon edge; a tooltip stays under its button', async () => {
  test.setTimeout(120000);
  const base = seedBase('focus', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-Clients').dblclick(); // a datasheet: the implemented Home commands are enabled, so in the Tab order
    await expect(docTabs(page)).toHaveCount(1);
    const problems: string[] = [];
    for (const width of [900, 1280]) {
      await resize(app, page, width);
      for (const id of ['home', 'create', 'externalData']) {
        await page.getByTestId(`ribbon-tab-${id}`).click();
        problems.push(...(await focusProblems(page)).map((p) => `${width}px ${p}`));
      }
    }
    expect(problems).toEqual([]);
  } finally {
    await app.close();
  }
});
