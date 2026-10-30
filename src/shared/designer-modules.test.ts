import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, it } from 'vitest';
import { DESIGNER_MODULES } from './designer-modules';

/** Every .ts/.tsx of the renderer but tests, src/renderer/design/** and the designers themselves (forward slashes). */
function renderFiles(dir = 'src/renderer'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return p === 'src/renderer/design' ? [] : renderFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !DESIGNER_MODULES.includes(p) ? [p] : [];
  });
}
/** `import type` statements are erased at build: they pull nothing in. */
const withoutTypeImports = (code: string) => code.replace(/^\s*import\s+type\b[\s\S]*?from\s*['"][^'"]*['"];?/gm, '');

it('every designer module exists', () => { for (const m of DESIGNER_MODULES) expect(existsSync(m), m).toBe(true); });
// a path in a variable: tsconfig.node (src/shared) does not follow it into the renderer's .tsx (no jsx there)
const RUNTIME_ENTRY = '../renderer/design/entry.runtime';
it('the Runtime entry has no designer', async () => { expect((await import(RUNTIME_ENTRY)).design).toBeNull(); });
it('only designers and design/ import a designer', () => {   // a run view cannot pull one in unnoticed
  const stems = DESIGNER_MODULES.filter((m) => !m.endsWith('design/entry.ts')).map((m) => basename(m).replace(/\.tsx?$/, ''));
  const IMPORT = new RegExp(`(from|import)\\s*\\(?\\s*['"][^'"]*/(${stems.join('|')})['"]`);
  expect(withoutTypeImports("import type {\n  X,\n} from '../form/FormDesignView';\nimport { y } from './a';")).not.toMatch(IMPORT);
  for (const s of ["import { y } from '../query/SqlView';", "import '../form/FormDesignView';", "await import('./EditListDialog')"]) expect(s).toMatch(IMPORT);
  for (const f of renderFiles()) expect(withoutTypeImports(readFileSync(f, 'utf8')), f).not.toMatch(IMPORT);
});
