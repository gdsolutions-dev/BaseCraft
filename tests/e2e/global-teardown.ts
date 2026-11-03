import { rmSync } from 'node:fs';

/** Removes the run's temporary folder (playwright.config.ts). A file an app still holds is left: the next clean-up takes it. */
export default function globalTeardown(): void {
  const dir = process.env.BASECRAFT_E2E_TMP;
  try { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* still held: left for later */ }
}
