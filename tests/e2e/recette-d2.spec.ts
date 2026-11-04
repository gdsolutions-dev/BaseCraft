// Recette D2: a button typed =calculer() in the Property Sheet runs a module typed in the editor over 1 200 rows; a Python Before Update
// cancels a save with a message; a dialog form suspends the caller, which then reads its value; an error opens the module at its line;
// Python creates no file next to the base. The scenario lives in recette-d-shared.ts (also run by recette-d).
import { test, expect } from '@playwright/test'
import { files, FR, runD2, seedD2 } from './recette-d-shared'
import { launchApp, seedBase } from './helpers'

test('Recette D2: Python button over 1 200 rows, Before Update, dialog form, Débogage, no file written', async () => {
  test.setTimeout(480_000)
  const base = seedBase('recette-d2', seedD2)
  const before = files(base)
  const { app, page } = await launchApp({ args: [base], env: FR })
  try {
    await runD2(page)
  } finally { await app.close() }
  // 5. nothing new next to the base
  expect(files(base)).toEqual(before)
})
