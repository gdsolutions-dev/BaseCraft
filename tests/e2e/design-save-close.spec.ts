// Ctrl+S then the tab's close right away, the save still under way (a slow machine): Access's save is over before the close,
// so the tab closes, saved, without a question. It was refused silently (the click did nothing: recette-f3a on the CI).
import { test, expect, type ElectronApplication } from '@playwright/test';
import type { DesignDoc } from '../../src/shared/design/model';
import { saveObject } from '../../src/main/db/objects';
import { launchApp, seedBase, seedForm } from './helpers';

const FICHE: DesignDoc = {
  formatVersion: '1.0', recordSource: null, props: { Width: 6000 },
  sections: [{ kind: 'detail', height: 2000, props: {}, controls: [{ kind: 'label', name: 'Titre', left: 300, top: 300, width: 2000, height: 340, props: { Caption: 'Titre' } }] }],
};

const ETAT: DesignDoc = {
  formatVersion: '1.0', recordSource: null,
  props: { Width: 9000, pageSetup: { orientation: 'portrait', margins: { top: 567, right: 567, bottom: 567, left: 567 } } },
  sections: [{ kind: 'detail', height: 2000, props: {}, controls: [{ kind: 'label', name: 'Titre', left: 300, top: 300, width: 2000, height: 340, props: { Caption: 'Titre' } }] }],
};

/** objects.save answered 1.5 s late by the main process. */
const slowSave = (app: ElectronApplication) => app.evaluate(({ ipcMain }) => {
  const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers;
  const real = handlers.get('bc:objects:save')!;
  handlers.set('bc:objects:save', async (...a: unknown[]) => { await new Promise((r) => setTimeout(r, 1500)); return real(...a); });
});

for (const kind of ['form', 'report'] as const) {
  test(`${kind} design: closed while its Ctrl+S is still saving, the tab closes once saved, without a question`, async () => {
    const base = seedBase(`design-save-close-${kind}`, (db) => {
      if (kind === 'form') seedForm(db, 'Fiche', FICHE);
      else { const r = saveObject(db, 'report', 'Fiche', ETAT, null); if (!r.ok) throw new Error(r.reason); }
    });
    const { app, page } = await launchApp({ args: [base] });
    try {
      await page.getByTestId(`nav-item-${kind}-Fiche`).click({ button: 'right' });
      await page.getByTestId('nav-menu-design').click();
      await page.getByTestId('ctl-Titre').click();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByTestId(`doc-tab-${kind}-Fiche`)).toContainText('•');
      await slowSave(app);
      await page.keyboard.press('Control+s');
      await page.getByTestId(`doc-tab-close-${kind}-Fiche`).click();
      await expect(page.getByTestId(`doc-tab-${kind}-Fiche`)).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByTestId('modal')).toHaveCount(0);
      const left = await page.evaluate(async (k) => {
        const d = await (window as unknown as { basecraft: { objects: { get(k: string, n: string): Promise<{ definition: DesignDoc }> } } }).basecraft.objects.get(k, 'Fiche');
        return d.definition.sections.find((x) => x.kind === 'detail')!.controls[0]!.left;
      }, kind);
      expect(left).toBeGreaterThan(300);   // saved with the nudge
    } finally { await app.close(); }
  });
}
