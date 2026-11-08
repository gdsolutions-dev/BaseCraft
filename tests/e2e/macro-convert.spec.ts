// D4: Macro Design › Tools › Convert Macros to Python — the dialog, the generated module (structure, names, exports),
// the converted function giving the same effects as the macro, the save-first question, the gates and the TODO count.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { saveObject } from '../../src/main/db/objects';
import type { BasecraftApi } from '../../src/shared/api';
import type { MacroItem } from '../../src/shared/macro/model';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(p[k]));
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const ok = (r: { ok: boolean } | { ok: false; reason?: string }) => { if (!r.ok) throw new Error(String((r as { reason?: string }).reason)); };
const macro = (db: DatabaseSync, name: string, items: MacroItem[]) => ok(saveObject(db, 'macro', name, { formatVersion: '1.0', items }, null));

const MCONV: MacroItem[] = [
  act('SetTempVar', { Name: 'x', Expression: '5' }),
  { k: 'if', branches: [{ cond: '[TempVars]![x] > 3', items: [act('SetTempVar', { Name: 'y', Expression: '"big" & "!"' })] }],
    else: [act('SetTempVar', { Name: 'y', Expression: '"small"' })] },
  { k: 'comment', text: 'done' },
  act('RunCode', { FunctionName: 'remise(2)' }),
  act('OnError', { GoTo: 'macroName', MacroName: 'Err' }),
  { k: 'submacro', name: 'Err', items: [act('MessageBox', { Message: 'oops' })] },
];
const base = () => seedBase('macro-convert', (db) => {
  ok(saveObject(db, 'module', 'Calculs', { formatVersion: '1.0', source: 'def remise(x):\n    return x * 2\n', exports: [{ name: 'remise', params: ['x'] }] }, null));
  macro(db, 'MConv', MCONV);
  macro(db, 'MInconnu', [act('ImportXML', { DataSource: 'x.xml', ImportOptions: '1' }), act('Beep')]);
});

type Mod = { source: string; exports: { name: string; params: string[] }[] };
const getModule = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('module', n), name)
  .then((r) => r.definition as Mod);
const modules = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.list('module')).then((l) => l.map((m) => m.name));
const imm = (page: Page, line: string) => page.evaluate((l) => (window as unknown as { __bcPython: { immediate(l: string): Promise<string> } }).__bcPython.immediate(l), line);

async function openDesign(page: Page, name: string) {
  await page.getByTestId(`nav-item-macro-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(page.locator('[data-testid="macro-design"]:visible')).toBeVisible();
}
/** Convert, accept or change the options, OK, then the done message (and the TODO message when `todo`). */
async function convert(page: Page, name: string, module: string, opts: { comments?: boolean; todo?: number; clashes?: string[] } = {}) {
  await page.getByTestId('cmd-convertMacros').click();
  await expect(page.getByTestId('convert-macros-dialog')).toBeVisible();
  await expect(page.getByTestId('convert-error-handling')).toBeChecked();
  await expect(page.getByTestId('convert-comments')).toBeChecked();
  if (opts.comments === false) await page.getByTestId('convert-comments').uncheck();
  await page.getByTestId('convert-macros-ok').click();
  await expect(page.getByTestId('modal')).toContainText(fill(fr.macro.convert.done, { macro: name, module }), { timeout: 120_000 });
  await page.getByTestId('modal-btn-ok').click();
  if (opts.todo) {
    await expect(page.getByTestId('modal')).toContainText(fill(fr.macro.convert.todo, { count: opts.todo }));
    await page.getByTestId('modal-btn-ok').click();
  }
  for (const fn of opts.clashes ?? []) {   // the same function names as the first conversion: the module editor's warning
    await expect(page.getByTestId('modal')).toContainText(fill(fr.module.functionClash, { name: fn, fn, other: 'Converted_Macro_MConv' }));
    await page.getByTestId('modal-btn-ok').click();
  }
  await expect(page.getByTestId('modal')).toHaveCount(0);
}

test('Convert Macros to Python: dialog, generated module, numbering, cancel; the converted function gives the macro\'s effects', async () => {
  test.setTimeout(240_000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openDesign(page, 'MConv');
    await expect(page.getByTestId('cmd-convertMacros')).toBeEnabled();
    await expect(page.getByTestId('cmd-convertMacros')).toContainText(fr.ribbon.cmd.convertMacros);

    await convert(page, 'MConv', 'Converted_Macro_MConv', { comments: false });
    await expect(page.getByTestId('nav-item-module-Converted_Macro_MConv')).toBeVisible();
    const m = await getModule(page, 'Converted_Macro_MConv');
    for (const s of ['def MConv():', 'def MConv_Err():', 'tempvars["x"] = 5', 'if eval_cond("[TempVars]![x] > 3"):', 'eval_expr(', 'Calculs.remise(2)', 'import Calculs'])
      expect(m.source, s).toContain(s);
    expect(m.source).not.toContain('# done');
    expect(m.exports.map((e) => e.name)).toEqual(['MConv', 'MConv_Err']);

    await convert(page, 'MConv', 'Converted_Macro_MConv_2', { clashes: ['MConv', 'MConv_Err'] });
    expect((await getModule(page, 'Converted_Macro_MConv_2')).source).toContain('# done');

    // Cancel creates nothing
    await page.getByTestId('cmd-convertMacros').click();
    await page.getByTestId('convert-macros-cancel').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await modules(page)).sort()).toEqual(['Calculs', 'Converted_Macro_MConv', 'Converted_Macro_MConv_2']);

    // parity: the macro, then the converted function, leave the same temporary variables
    await page.getByTestId('cmd-macroRun').click();
    await expect.poll(() => imm(page, '?tempvars["y"]'), { timeout: 120_000 }).toBe('big!');
    await imm(page, 'tempvars.clear()');
    expect(await imm(page, '?tempvars["y"]')).toBe('None');
    await imm(page, 'import Converted_Macro_MConv');
    await imm(page, 'Converted_Macro_MConv.MConv()');
    expect(await imm(page, '?tempvars["y"]')).toBe('big!');
    expect(await imm(page, '?tempvars["x"]')).toBe('5');
  } finally {
    await app.close();
  }
});

test('Convert Macros to Python: a new macro asks to save first; an unconvertible action is counted; a read-only base disables the button', async () => {
  test.setTimeout(240_000);
  const file = base();
  const { app, page } = await launchApp({ args: [file], env: FR });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createMacro').click();
    await page.getByTestId('macro-catalog-item-Beep').dblclick();
    await page.getByTestId('cmd-convertMacros').click();
    await expect(page.getByTestId('modal')).toContainText(fr.macro.convert.saveFirst);
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(await modules(page)).toEqual(['Calculs']);

    await page.getByTestId('cmd-convertMacros').click();
    await page.getByTestId('modal-btn-yes').click();
    await page.getByTestId('modal-input').fill('MNeuf');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('convert-macros-dialog')).toBeVisible();
    await page.getByTestId('convert-macros-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.macro.convert.done, { macro: 'MNeuf', module: 'Converted_Macro_MNeuf' }), { timeout: 120_000 });
    await page.getByTestId('modal-btn-ok').click();
    expect((await getModule(page, 'Converted_Macro_MNeuf')).source).toContain('def MNeuf():\n    try:\n        docmd.beep()');

    await openDesign(page, 'MInconnu');
    await convert(page, 'MInconnu', 'Converted_Macro_MInconnu', { todo: 1 });
    const src = (await getModule(page, 'Converted_Macro_MInconnu')).source;
    expect(src).toContain('# TODO(convert): ImportXML');
    expect(src).toContain('raise NotImplementedError');

    // a second instance finds the base locked: read-only, the button is off
    const second = await launchApp({ args: [file], env: FR, waitOpen: false });
    try {
      await expect(second.page.getByTestId('nav-item-macro-MConv')).toBeVisible();
      await second.page.getByTestId('nav-item-macro-MConv').click({ button: 'right' });
      await second.page.getByTestId('nav-menu-design').click();
      await expect(second.page.getByTestId('macro-design')).toBeVisible();
      await expect(second.page.getByTestId('cmd-convertMacros')).toBeDisabled();
    } finally {
      await second.app.close();
    }
  } finally {
    await app.close();
  }
});
