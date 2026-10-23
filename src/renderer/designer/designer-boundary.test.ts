import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Le concepteur est générique (formulaires A4, états A5) : il n'importe jamais le dossier form.
const BAD = /(from|import)\s*\(?\s*['"][^'"]*\bform(\/|['"])/;

it('the boundary pattern', () => {
  for (const s of ["import { x } from '../form/form-def';", "from '../form'", "import('../form/x')"]) expect(s).toMatch(BAD);
  for (const s of ["from './format-commands'", "from '../shared/design/model'", "from './PropertySheetForm'"]) expect(s).not.toMatch(BAD);
});
it('designer never imports form', () => {
  const dir = 'src/renderer/designer';
  for (const f of readdirSync(dir).filter((x) => x !== 'designer-boundary.test.ts')) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(BAD);
});
