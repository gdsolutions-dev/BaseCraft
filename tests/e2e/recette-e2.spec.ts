// Recette of batch E2 (exact structure), without Access: Ventes-complet.accdb is imported with its committed export folder
// (tests/fixtures/access/Ventes-complet.export); Table Design shows the keys, the two-field index, the rules, defaults, caption and lookup
// that structure.json holds; the datasheets show the lookup's list, refuse a Quantité the rule forbids, and deleting customer Dupont
// cascades to his two orders. Skipped when the owner's Ventes-complet.accdb is absent (untracked).
import { test } from '@playwright/test';
import { checkBehaviour, checkTableDesign, copyComplet, EXPORT_DIR, hasComplet, importComplet, launch, removeTemp } from './recette-e2-common';

test.skip(!hasComplet, "Ventes-complet.accdb is not committed: copy it from the owner's originals");

test('recette E2: the export folder gives the exact structure in Table Design', async () => {
  test.setTimeout(240_000);
  const { dir, path } = copyComplet();
  const { app, page } = await launch(path, EXPORT_DIR);
  try {
    await importComplet(page, 'folder');
    await checkTableDesign(page);
  } finally {
    await app.close();
    removeTemp(dir);
  }
});

test('recette E2: the lookup in the datasheet, a refused Quantité, the cascade delete of a customer', async () => {
  test.setTimeout(240_000);
  const { dir, path } = copyComplet();
  const { app, page } = await launch(path, EXPORT_DIR);
  try {
    await importComplet(page, 'folder');
    await checkBehaviour(page);
  } finally {
    await app.close();
    removeTemp(dir);
  }
});
