import { describe, expect, it, vi } from 'vitest';
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
import { tmp } from './test-tmp';

const names = (p: string) => { const db = new DatabaseSync(p); registerFunctions(db); const n = listTables(db).map((t) => t.name); db.close(); return n; };
const id = { name: 'ID', type: 'autoNumber' };

describe('applyScript', () => {
  it('creates a table with its fields in one run', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = await applyScript(p, [{ op: 'table.create', name: 'Clients', fields: [id, { name: 'Nom', type: 'shortText', size: 50 }] }], CANON);
    expect(r).toEqual({ ok: true, applied: 1, activeContent: false });
    expect(names(p)).toContain('Clients');
    expect(fs.existsSync(`${p}.cli-tmp`)).toBe(false);
  });
  it('leaves the file byte-identical when an op fails', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    const r = await applyScript(p, [
      { op: 'table.create', name: 'A', fields: [id] },
      { op: 'table.create', name: 'B', fields: [{ name: 'X', type: 'noSuchType' }] },
    ], CANON);
    expect(r).toMatchObject({ ok: false, index: 1, op: 'table.create' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    expect(fs.existsSync(`${p}.cli-tmp`)).toBe(false);
  });
  it('stores an NFD table name in NFC', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    await applyScript(p, [{ op: 'table.create', name: 'E\u0301te\u0301', fields: [id] }], CANON);
    expect(names(p)).toContain('\u00c9t\u00e9');
  });
  it('refuses a name conflict and an unknown op', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const ops = [{ op: 'table.create', name: 'A', fields: [id] }];
    await applyScript(p, ops, CANON);
    expect(await applyScript(p, ops, CANON)).toMatchObject({ ok: false, index: 0 });
    expect(await applyScript(p, [{ op: 'nope' }], CANON)).toMatchObject({ ok: false, message: 'unknown op: nope' });
  });
  it('refuses a second run while the file is locked', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    const l = acquireLock(p, 'other-session');
    expect(l.status).toBe('acquired');
    const r = await applyScript(p, [{ op: 'table.create', name: 'A', fields: [id] }], CANON);
    expect(r).toMatchObject({ ok: false, index: -1, op: 'lock' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    if (l.status === 'acquired') l.lock.release();
  });
  it('refuses to run when the lock file cannot be created (read-only folder)', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    const real = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(((f: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(f).endsWith('.lock')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return (real as (...a: unknown[]) => void)(f, ...rest);
    }) as typeof fs.writeFileSync);
    try {
      const r = await applyScript(p, [{ op: 'table.create', name: 'A', fields: [id] }], CANON);
      expect(r).toMatchObject({ ok: false, index: -1, op: 'lock', message: expect.stringContaining('EACCES') });
    } finally { spy.mockRestore(); }
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
  it('overwrites a stale temp file', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    fs.writeFileSync(`${p}.cli-tmp`, 'junk');
    expect(await applyScript(p, [{ op: 'table.create', name: 'A', fields: [id] }], CANON)).toEqual({ ok: true, applied: 1, activeContent: false });
  });
});

describe('script command', () => {
  it('runs a spec file and reports a refusal with its op', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const spec = path.join(path.dirname(p), 's.json');
    fs.writeFileSync(spec, JSON.stringify([{ op: 'table.create', fields: [id] }]));
    const err: string[] = [];
    expect(await run(['script', spec, p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toMatch(/^op #0 table\.create: /);
    fs.writeFileSync(spec, JSON.stringify([{ op: 'table.create', name: 'A', fields: [id] }]));
    expect(await run(['script', spec, p], { out: () => {}, err: () => {} })).toBe(0);
    expect(await run(['script', path.join(path.dirname(p), 'missing.json'), p], { out: () => {}, err: () => {} })).toBe(2);
  });

  it('exits 2 for a target without the .basecraft extension', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const bad = p.replace(/\.basecraft$/, '.txt'); fs.copyFileSync(p, bad);
    const spec = path.join(path.dirname(p), 's.json'); fs.writeFileSync(spec, '[]');
    expect(await run(['script', spec, bad], { out: () => {}, err: () => {} })).toBe(2);
  });
  it('exits 2 and leaves no lock for a missing base', async () => {
    const p = tmp();
    const spec = path.join(path.dirname(p), 's.json'); fs.writeFileSync(spec, '[]');
    const err: string[] = [];
    expect(await run(['script', spec, p], { out: () => {}, err: (s) => err.push(s) })).toBe(2);
    expect(err.join('')).toBe(`file not found: ${p}
`);
    expect(fs.readdirSync(path.dirname(p))).toEqual(['s.json']);
  });
  it('refuses invalid field properties without touching the file', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    const r = await applyScript(p, [{ op: 'table.create', name: 'A', fields: [id, { name: 'X', type: 'shortText', format: 5 }] }], CANON);
    expect(r).toMatchObject({ ok: false, index: 0, message: 'invalid field properties: X' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
});

describe('robustness', () => {
  const quiet = { out: () => {}, err: () => {} };
  const spec = (p: string, text = '[]') => { const s = path.join(path.dirname(p), 's.json'); fs.writeFileSync(s, text); return s; };
  const leftovers = (p: string) => fs.readdirSync(path.dirname(p)).filter((f) => /\.(lock|cli-tmp)$/.test(f));
  const setMeta = (p: string, key: string, value: string) => { const db = new DatabaseSync(p); db.prepare('UPDATE bc_meta SET value = ? WHERE key = ?').run(value, key); db.close(); };

  it('turns a throwing handler into a refusal', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p);
    OP_HANDLERS.boom = () => { throw new Error('boom'); };
    try { expect(await applyScript(p, [{ op: 'boom' }], CANON)).toEqual({ ok: false, index: 0, op: 'boom', message: 'boom' }); } finally { delete OP_HANDLERS.boom; }
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    expect(leftovers(p)).toEqual([]);
  });
  it.each([['garbage', 'this is not sqlite'], ['empty', '']])('refuses a %s .basecraft file untouched', async (_n, content) => {
    const p = tmp(); fs.writeFileSync(p, content);
    const err: string[] = [];
    expect(await run(['script', spec(p), p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toBe(`not a BaseCraft base: ${p}
`);
    expect(fs.readFileSync(p).toString()).toBe(content);
    expect(leftovers(p)).toEqual([]);
  });
  it('refuses an older format and tells to upgrade', async () => {
    const p = tmp(); newBase(p, '0.3.1'); setMeta(p, 'format_minor', '0');
    const before = fs.readFileSync(p); const err: string[] = [];
    expect(await run(['script', spec(p), p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toBe(`${p} uses format 1.0; open it in BaseCraft to upgrade it first
`);
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    expect(leftovers(p)).toEqual([]);
  });
  it('refuses a newer format', async () => {
    const p = tmp(); newBase(p, '0.3.1'); setMeta(p, 'format_major', '9');
    const err: string[] = [];
    expect(await run(['script', spec(p), p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toMatch(/uses format 9\.4, newer than this basecraft-cli supports \(1\.4\)/);
  });
  it('leaves the file untouched for an empty script', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = fs.readFileSync(p), mtime = fs.statSync(p).mtimeMs, ino = fs.statSync(p).ino;
    expect(await applyScript(p, [], CANON)).toEqual({ ok: true, applied: 0, activeContent: false });
    expect(await run(['script', spec(p), p], quiet)).toBe(0);
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    expect(fs.statSync(p).mtimeMs).toBe(mtime);
    expect(fs.statSync(p).ino).toBe(ino);
  });
  it('says a stale lock looks stale and names the lock file', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    fs.writeFileSync(`${p}.lock`, JSON.stringify({ user: 'bob', host: os.hostname(), pid: 1, sessionId: 'dead', heartbeatAt: new Date(Date.now() - 3_600_000).toISOString() }));
    const r = await applyScript(p, [{ op: 'table.create', name: 'A', fields: [id] }], CANON);
    expect(r).toMatchObject({ ok: false, index: -1, op: 'lock' });
    expect((r as { message: string }).message).toContain('looks stale');
    expect((r as { message: string }).message).toContain(`${p}.lock`);
  });
});

describe('activeContent', () => {
  const macro = (items: unknown[]) => ({ op: 'macro.create', name: 'M', items });
  const act = async (ops: unknown[]) => { const p = tmp(); newBase(p, '0.3.1'); return { p, r: await applyScript(p, ops as never, CANON) }; };
  it('is true for a RunSQL macro', async () => {
    expect((await act([macro([{ k: 'action', action: 'RunSQL', args: { SQLStatement: 'DELETE FROM Clients' } }])])).r).toEqual({ ok: true, applied: 1, activeContent: true });
  });
  it('is true for any macro, even a harmless one (the application counts every macro)', async () => {
    expect((await act([macro([{ k: 'comment', text: 'x' }])])).r).toMatchObject({ ok: true, activeContent: true });
  });
  it('is false for a script without macro, event or action query', async () => {
    expect((await act([{ op: 'table.create', name: 'A', fields: [id] }, { op: 'query.create', name: 'Q', sql: 'SELECT ID FROM A' }])).r).toMatchObject({ ok: true, activeContent: false });
  });
  it('is true for an event on a form, and read from the file for an empty script', async () => {
    const doc = { formatVersion: '1.0', recordSource: null, props: { OnOpen: { embedded: { formatVersion: '1.0', items: [] } } }, sections: [{ kind: 'detail', height: 1000, props: {}, controls: [] }] };
    const { p, r } = await act([{ op: 'form.create', name: 'F', layout: 'doc', doc }]);
    expect(r).toMatchObject({ ok: true, activeContent: true });
    expect(await applyScript(p, [], CANON)).toEqual({ ok: true, applied: 0, activeContent: true });
  });
  it('run() prints the notice on stdout only when true, and nothing otherwise', async () => {
    const spec = (ops: unknown[]) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-')), 's.json'); fs.writeFileSync(f, JSON.stringify(ops)); return f; };
    const go = async (ops: unknown[]) => { const p = tmp(); newBase(p, '0.3.1'); const out: string[] = [], err: string[] = []; const code = await run(['script', spec(ops), p], { out: (s) => out.push(s), err: (s) => err.push(s) }); return { code, out: out.join(''), err: err.join('') }; };
    expect(await go([macro([{ k: 'comment', text: 'x' }])])).toEqual({ code: 0, out: 'This file contains active content; BaseCraft will ask to enable it when opened.\n', err: '' });
    expect(await go([{ op: 'table.create', name: 'A', fields: [id] }])).toEqual({ code: 0, out: '', err: '' });
  });
});
