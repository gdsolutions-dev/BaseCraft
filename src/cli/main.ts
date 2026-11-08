import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { version } from '../../package.json';
import { BaseFileError } from '../main/db/file-format';
import { COMMANDS } from './commands';
import { CliUsageError } from './errors';
import { assertBaseExtension, newBase } from './new-base';
import { applyScript, checkTarget, parseScript } from './script';
import { CANON } from '../shared/coerce';

export interface CliIo { out(s: string): void; err(s: string): void }

/** Exit codes: 0 success, 1 operation refused, 2 usage error. */
export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    if (argv[0] === '--version') { io.out(`basecraft-cli ${version}\n`); return 0; }
    if (argv[0] === 'new') {
      if (argv.length !== 2) throw new CliUsageError('usage: basecraft-cli new FILE');
      newBase(argv[1], version);
      return 0;
    }
    if (argv[0] === 'script') {
      if (argv.length !== 3) throw new CliUsageError('usage: basecraft-cli script SPEC.json FILE.basecraft');
      assertBaseExtension(argv[2]);
      if (!fs.statSync(argv[2], { throwIfNoEntry: false })?.isFile()) throw new CliUsageError(`file not found: ${argv[2]}`);
      let text: string;
      try { text = fs.readFileSync(argv[1], 'utf8'); } catch (e) { throw new CliUsageError(`cannot read ${argv[1]}: ${(e as Error).message}`); }
      let ops: ReturnType<typeof parseScript>;
      try { ops = parseScript(text); } catch (e) {
        if (e instanceof CliUsageError) throw new CliUsageError(`${argv[1]}: ${e.message}`);
        throw e;
      }
      checkTarget(argv[2]);
      const r = await applyScript(argv[2], ops, CANON);
      if (r.ok) { if (r.activeContent) io.out('This file contains active content; BaseCraft will ask to enable it when opened.\n'); return 0; }
      io.err(`${r.index >= 0 ? `op #${r.index} ${r.op}: ` : ''}${r.message}
`);
      return 1;
    }
    if (argv[0] === 'commands' && argv.length === 1) { io.out(`${JSON.stringify(COMMANDS, null, 2)}
`); return 0; }
    if (argv[0] === 'describe' && argv.length === 2) {
      const c = COMMANDS.find((x) => x.id === argv[1]);
      if (!c) throw new CliUsageError(`unknown command: ${argv[1]}`);
      io.out(`${JSON.stringify(c, null, 2)}
`);
      return 0;
    }
    throw new CliUsageError('usage: basecraft-cli --version | new FILE | script SPEC.json FILE | commands | describe ID');
  } catch (e) {
    if (e instanceof CliUsageError) { io.err(`${e.message}\n`); return e.code; }
    if (e instanceof BaseFileError) { io.err(e.code === 'exists' ? `${argv[1]} already exists
` : `${e.message}
`); return 1; }
    io.err(`${e instanceof Error ? e.message : String(e)}
`); return 1;
  }
}

// Only when this module is the process entry (the tests import `run` and never reach this).
// realpath so an npm bin shim, a symlink or a renamed copy still counts.
const entry = process.argv[1];
const isEntry = (): boolean => {
  try { return !!entry && import.meta.url === pathToFileURL(fs.realpathSync(entry)).href; } catch { return false; }
};
if (isEntry()) {
  process.exitCode = await run(process.argv.slice(2), { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) });
}
