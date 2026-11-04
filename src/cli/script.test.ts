import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CANON } from '../shared/coerce';
import { registerFunctions } from '../main/db/file-format';
import { acquireLock } from '../main/db/lock';
import { listTables } from '../main/db/schema';
import { newBase } from './new-base';
import { applyScript } from './script';
import { OP_HANDLERS } from './ops';
import { run } from './main';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-')), 'x.basecraft');
const names = (p: string) => { const db = new DatabaseSync(p); registerFunctions(db); const n = listTables(db).map((t) => t.name); db.close(); return n; };
const id = { name: 'ID', type: 'autoNumber' };

describe('applyScript', () => {
  it('creates a table with its fields in one run', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = applyScript(p, [{ op: 'table.create', name: 'Clients', fields: [id, { name: 'Nom', type: 'shortText', size: 50 }] }], CANON);
    expect(r).toEqual({ ok: true, applied: 1 });
    expect(names(p)).toContain('Clients');
    expect(fs.existsSync(`${p}.cli-tmp`)).toBe(false);
  });
  it('leaves the file byte-identical when an op fails', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    const r = applyScript(p, [
      { op: 'table.create', name: 'A', fields: [id] },
      { op: 'table.create', name: 'B', fields: [{ name: 'X', type: 'noSuchType' }] },
    ], CANON);
    expect(r).toMatchObject({ ok: false, index: 1, op: 'table.create' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    expect(fs.existsSync(`${p}.cli-tmp`)).toBe(false);
  });
  it('stores an NFD table name in NFC', () => {
    const p = tmp(); newBase(p, '0.3.1');
    applyScript(p, [{ op: 'table.create', name: 'E\u0301te\u0301', fields: [id] }], CANON);
    expect(names(p)).toContain('\u00c9t\u00e9');
  });
  it('refuses a name conflict and an unknown op', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const ops = [{ op: 'table.create', name: 'A', fields: [id] }];
    applyScript(p, ops, CANON);
    expect(applyScript(p, ops, CANON)).toMatchObject({ ok: false, index: 0 });
    expect(applyScript(p, [{ op: 'nope' }], CANON)).toMatchObject({ ok: false, message: 'unknown op: nope' });
  });
  it('refuses a second run while the file is locked', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    const l = acquireLock(p, 'other-session');
    expect(l.status).toBe('acquired');
    const r = applyScript(p, [{ op: 'table.create', name: 'A', fields: [id] }], CANON);
    expect(r).toMatchObject({ ok: false, index: -1, op: 'lock' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    if (l.status === 'acquired') l.lock.release();
  });
  it('overwrites a stale temp file', () => {
    const p = tmp(); newBase(p, '0.3.1');
    fs.writeFileSync(`${p}.cli-tmp`, 'junk');
    expect(applyScript(p, [{ op: 'table.create', name: 'A', fields: [id] }], CANON)).toEqual({ ok: true, applied: 1 });
  });
});

describe('script command', () => {
  it('runs a spec file and reports a refusal with its op', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const spec = path.join(path.dirname(p), 's.json');
    fs.writeFileSync(spec, JSON.stringify([{ op: 'table.create', fields: [id] }]));
    const err: string[] = [];
    expect(run(['script', spec, p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toMatch(/^op #0 table\.create: /);
    fs.writeFileSync(spec, JSON.stringify([{ op: 'table.create', name: 'A', fields: [id] }]));
    expect(run(['script', spec, p], { out: () => {}, err: () => {} })).toBe(0);
    expect(run(['script', path.join(path.dirname(p), 'missing.json'), p], { out: () => {}, err: () => {} })).toBe(2);
  });

  it('exits 2 for a target without the .basecraft extension', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const bad = p.replace(/\.basecraft$/, '.txt'); fs.copyFileSync(p, bad);
    const spec = path.join(path.dirname(p), 's.json'); fs.writeFileSync(spec, '[]');
    expect(run(['script', spec, bad], { out: () => {}, err: () => {} })).toBe(2);
  });
  it('exits 2 and leaves no lock for a missing base', () => {
    const p = tmp();
    const spec = path.join(path.dirname(p), 's.json'); fs.writeFileSync(spec, '[]');
    const err: string[] = [];
    expect(run(['script', spec, p], { out: () => {}, err: (s) => err.push(s) })).toBe(2);
    expect(err.join('')).toBe(`file not found: ${p}
`);
    expect(fs.readdirSync(path.dirname(p))).toEqual(['s.json']);
  });
  it('refuses invalid field properties without touching the file', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    const r = applyScript(p, [{ op: 'table.create', name: 'A', fields: [id, { name: 'X', type: 'shortText', format: 5 }] }], CANON);
    expect(r).toMatchObject({ ok: false, index: 0, message: 'invalid field properties: X' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
});

describe('robustness', () => {
  const quiet = { out: () => {}, err: () => {} };
  const spec = (p: string, text = '[]') => { const s = path.join(path.dirname(p), 's.json'); fs.writeFileSync(s, text); return s; };
  const leftovers = (p: string) => fs.readdirSync(path.dirname(p)).filter((f) => /\.(lock|cli-tmp)$/.test(f));
  const setMeta = (p: string, key: string, value: string) => { const db = new DatabaseSync(p); db.prepare('UPDATE bc_meta SET value = ? WHERE key = ?').run(value, key); db.close(); };

  it('turns a throwing handler into a refusal', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    OP_HANDLERS.boom = () => { throw new Error('boom'); };
    try { expect(applyScript(p, [{ op: 'boom' }], CANON)).toEqual({ ok: false, index: 0, op: 'boom', message: 'boom' }); } finally { delete OP_HANDLERS.boom; }
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    expect(leftovers(p)).toEqual([]);
  });
  it.each([['garbage', 'this is not sqlite'], ['empty', '']])('refuses a %s .basecraft file untouched', (_n, content) => {
    const p = tmp(); fs.writeFileSync(p, content);
    const err: string[] = [];
    expect(run(['script', spec(p), p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toBe(`not a BaseCraft base: ${p}
`);
    expect(fs.readFileSync(p).toString()).toBe(content);
    expect(leftovers(p)).toEqual([]);
  });
  it('refuses an older format and tells to upgrade', () => {
    const p = tmp(); newBase(p, '0.3.1'); setMeta(p, 'format_minor', '0');
    const before = fs.readFileSync(p); const err: string[] = [];
    expect(run(['script', spec(p), p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toBe(`${p} uses format 1.0; open it in BaseCraft to upgrade it first
`);
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    expect(leftovers(p)).toEqual([]);
  });
  it('refuses a newer format', () => {
    const p = tmp(); newBase(p, '0.3.1'); setMeta(p, 'format_major', '9');
    const err: string[] = [];
    expect(run(['script', spec(p), p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toMatch(/uses format 9\.3, newer than this basecraft-cli supports \(1\.3\)/);
  });
  it('leaves the file untouched for an empty script', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p), mtime = fs.statSync(p).mtimeMs, ino = fs.statSync(p).ino;
    expect(applyScript(p, [], CANON)).toEqual({ ok: true, applied: 0 });
    expect(run(['script', spec(p), p], quiet)).toBe(0);
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    expect(fs.statSync(p).mtimeMs).toBe(mtime);
    expect(fs.statSync(p).ino).toBe(ino);
  });
  it('says a stale lock looks stale and names the lock file', () => {
    const p = tmp(); newBase(p, '0.3.1');
    fs.writeFileSync(`${p}.lock`, JSON.stringify({ user: 'bob', host: os.hostname(), pid: 1, sessionId: 'dead', heartbeatAt: new Date(Date.now() - 3_600_000).toISOString() }));
    const r = applyScript(p, [{ op: 'table.create', name: 'A', fields: [id] }], CANON);
    expect(r).toMatchObject({ ok: false, index: -1, op: 'lock' });
    expect((r as { message: string }).message).toContain('looks stale');
    expect((r as { message: string }).message).toContain(`${p}.lock`);
  });
});
