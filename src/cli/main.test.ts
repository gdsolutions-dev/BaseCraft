import { describe, expect, it } from 'vitest';
import { run } from './main';

describe('cli entry', () => {
  it('prints the version and exits 0', () => {
    const out: string[] = [];
    expect(run(['--version'], { out: (s) => out.push(s), err: () => {} })).toBe(0);
    expect(out.join('')).toMatch(/^basecraft-cli \d+\.\d+\.\d+/);
  });
  it('exits 2 on no arguments', () => {
    expect(run([], { out: () => {}, err: () => {} })).toBe(2);
  });
});

describe('unexpected errors', () => {
  it('new in a missing directory prints a message, not a stack', async () => {
    const os = await import('node:os'), path = await import('node:path');
    const err: string[] = [];
    expect(run(['new', path.join(os.tmpdir(), 'bccli-nodir', 'x.basecraft')], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toMatch(/\S/);
    expect(err.join('')).not.toMatch(/\n\s+at /);
  });
});

describe('new on an existing file', () => {
  it('says the file already exists', async () => {
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-')), 'x.basecraft');
    const err: string[] = [];
    run(['new', p], { out: () => {}, err: () => {} });
    expect(run(['new', p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toBe(`${p} already exists\n`);
  });
});
