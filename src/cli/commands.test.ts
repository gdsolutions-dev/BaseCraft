import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from './main';
import { OP_HANDLERS } from './ops';

describe('commands and describe', () => {
  it('lists one entry per operation handler, as JSON', () => {
    const out: string[] = [];
    expect(run(['commands'], { out: (s) => out.push(s), err: () => {} })).toBe(0);
    const ids = JSON.parse(out.join('')).map((c: { id: string }) => c.id);
    expect(ids.sort()).toEqual(Object.keys(OP_HANDLERS).sort());
  });
  it('describe prints the parameters of one command', () => {
    const out: string[] = [];
    expect(run(['describe', 'relation.create'], { out: (s) => out.push(s), err: () => {} })).toBe(0);
    expect(out.join('')).toContain('parentTable');
  });
  it('describe on an unknown id exits 2', () => {
    expect(run(['describe', 'nope'], { out: () => {}, err: () => {} })).toBe(2);
  });
  it('script on a missing spec file exits 2 and names the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-'));
    const target = path.join(dir, 'x.basecraft');
    fs.writeFileSync(target, '');
    const err: string[] = [];
    expect(run(['script', 'missing.json', target], { out: () => {}, err: (s) => err.push(s) })).toBe(2);
    expect(err.join('')).toContain('missing.json');
  });
  it('script on a spec file with invalid JSON exits 2 and names the spec file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-'));
    const target = path.join(dir, 'x.basecraft');
    fs.writeFileSync(target, '');
    const spec = path.join(dir, 'spec.json');
    fs.writeFileSync(spec, '[');
    const err: string[] = [];
    expect(run(['script', spec, target], { out: () => {}, err: (s) => err.push(s) })).toBe(2);
    expect(err.join('')).toContain(spec);
    expect(err.join('')).toContain('JSON');
  });
  it('script on a directory named x.basecraft exits 2 with file not found', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-'));
    const target = path.join(dir, 'x.basecraft');
    fs.mkdirSync(target);
    const err: string[] = [];
    expect(run(['script', 'spec.json', target], { out: () => {}, err: (s) => err.push(s) })).toBe(2);
    expect(err.join('')).toContain(`file not found: ${target}`);
  });
});
