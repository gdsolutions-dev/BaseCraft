// No Access and no PowerShell needed: a small Node script stands in for the export script.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { join, relative, win32 } from 'node:path';
import { exportArgs, powershellPath, readAccessExport, regPath, runAccessExport } from './access-export';

const FIXTURE = join(__dirname, '../../../tests/fixtures/access/Ventes-complet.export');
const SRC = 'Ventes-complet.accdb';
const tmp = fs.mkdtempSync(join(os.tmpdir(), 'bcexp-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
let n = 0;
const fresh = () => { const d = join(tmp, String(++n)); fs.mkdirSync(d); return d; };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// A copy of the fixture folder with some files replaced: a string is the new text, a function maps the parsed JSON.
function copyWith(edits: Record<string, string | ((j: Json) => Json)>): string {
  const d = fresh();
  fs.cpSync(FIXTURE, d, { recursive: true });
  for (const [f, e] of Object.entries(edits)) {
    const p = join(d, f);
    fs.writeFileSync(p, typeof e === 'string' ? e : JSON.stringify(e(JSON.parse(fs.readFileSync(p, 'utf8')))));
  }
  return d;
}
function dropKey(j: Json, path: string): Json {
  const keys = path.split('.');
  let o: any = j; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const k of keys.slice(0, -1)) o = o[k];
  delete o[keys.at(-1)!];
  return j;
}
const withFile = (m: Json, i: number, file: string): Json => { m.objects[i].file = file; return m; };

// `command` standing in for PowerShell: prints `lines`, writes its argv and stdin to `seen.json`, exits with `code`
// (after `delayMs` more when given: it then stays alive until killed).
function fake(lines: string[], code: number, delayMs = 0) {
  const parent = fresh();
  const out = join(parent, 'out');
  fs.mkdirSync(out);
  const seen = join(parent, 'seen.json');
  const script = join(parent, 'fake.js');
  fs.writeFileSync(script, `const fs = require('fs'); let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ argv: process.argv.slice(2), stdin }));
  for (const l of ${JSON.stringify(lines)}) console.log(l);
  process.exitCode = ${code};
  if (${delayMs} > 0) setTimeout(() => {}, ${delayMs});
});`);
  const source = join(parent, SRC);
  const args = [script, '-Source', source, '-Out', out];
  return { script, source, out, parent, seen, command: { file: process.execPath, args } };
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// idle node processes the tests spawn; ended after each test, so a failed assertion leaks none
const children: ReturnType<typeof spawn>[] = [];
const child = () => { const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']); children.push(c); return c; };
afterEach(() => { for (const c of children.splice(0)) c.kill(); });

describe('access-export', () => {
  it('readAccessExport: the committed folder of Ventes-complet', () => {
    const r = readAccessExport(FIXTURE, SRC);
    expect(r.ok && r.export.tables.map((t) => t.name).sort()).toEqual(['Clients', 'Commandes', 'Divers']);
    expect(r.ok && r.export.manifest.objects.length).toBe(6);
  });
  it('readAccessExport: another source, truncated JSON, a wrong format number, a missing key', () => {
    expect(readAccessExport(FIXTURE, 'Autre.accdb')).toEqual({ ok: false, reason: 'otherSource' });
    expect(readAccessExport(copyWith({ 'structure.json': '{"tables":[' }), SRC)).toEqual({ ok: false, reason: 'badFolder' });
    expect(readAccessExport(copyWith({ 'manifest.json': (m) => ({ ...m, format: 2 }) }), SRC)).toEqual({ ok: false, reason: 'badFolder' });
    expect(readAccessExport(copyWith({ 'structure.json': (s) => dropKey(s, 'tables.0.fields.0.required') }), SRC)).toEqual({ ok: false, reason: 'badFolder' });
  });
  describe('a manifest file naming something outside the folder is refused', () => {
    // A real file outside the export folder: without the containment check each of these would reach it.
    const setup = () => {
      const dir = copyWith({});
      const target = join(tmp, `target-${n}.txt`);
      fs.writeFileSync(target, 'secret');
      const sibling = `${dir}x`;
      fs.mkdirSync(sibling);
      fs.writeFileSync(join(sibling, 'f.txt'), 'secret');
      return { dir, target, sibling };
    };
    const bad = (dir: string, file: string) => {
      const mp = join(dir, 'manifest.json');
      fs.writeFileSync(mp, JSON.stringify(withFile(JSON.parse(fs.readFileSync(mp, 'utf8')), 0, file)));
      expect(readAccessExport(dir, SRC)).toEqual({ ok: false, reason: 'badFolder' });
    };
    it('.. with backslashes', () => { const t = setup(); bad(t.dir, `..\\${relative(tmp, t.target)}`); });
    it('.. with forward slashes', () => { const t = setup(); bad(t.dir, `../${relative(tmp, t.target)}`); });
    it('the absolute path', () => { const t = setup(); bad(t.dir, t.target); });
    it('a sibling folder whose name starts with the export folder name', () => { const t = setup(); bad(t.dir, `../${relative(tmp, t.sibling)}/f.txt`); });
    it.runIf(process.platform === 'win32')('a drive-relative path', () => {
      const t = setup();
      bad(t.dir, `${t.dir.slice(0, 2)}..\\${relative(tmp, t.target)}`); // resolves to <folder>\..\target
    });
    it.runIf(process.platform === 'win32')('a UNC path', () => {
      const t = setup();
      bad(t.dir, `\\\\localhost\\${t.target[0]}$\\${t.target.slice(3)}`);
    });
    it('a missing file', () => { const t = setup(); bad(t.dir, 'queries/missing.sql'); });
    it('a directory', () => { const t = setup(); bad(t.dir, 'queries'); });
    it('a link or junction leading out of the folder', () => {
      const t = setup();
      fs.symlinkSync(t.sibling, join(t.dir, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
      bad(t.dir, 'link/f.txt');
    });
  });
  it('readAccessExport: a JSON file over 10 MB is refused', () => {
    const big = copyWith({ 'structure.json': `{"tables":[],"pad":"${'x'.repeat(10 * 1024 * 1024 + 1)}"}` });
    expect(readAccessExport(big, SRC)).toEqual({ ok: false, reason: 'badFolder' });
  });
  it('runAccessExport: steps, exit codes', async () => {
    const ticks: number[] = [];
    expect(await runAccessExport({ ...fake(['pid 0', 'step 1 2', 'step 2 2', 'done'], 0), tick: (d) => ticks.push(d) })).toEqual({ ok: true });
    expect(ticks).toEqual([1, 2]);
    // 'step 0 0' lines only keep the run alive: they are no progress.
    const t2: number[] = [];
    await runAccessExport({ ...fake(['pid 0', 'step 0 0', 'step 0 0', 'step 0 2', 'step 1 2', 'done'], 0), tick: (d) => t2.push(d) });
    expect(t2).toEqual([0, 1]);
    expect(await runAccessExport(fake([], 2))).toEqual({ ok: false, reason: 'noAccess' });
    expect(await runAccessExport(fake([], 3))).toEqual({ ok: false, reason: 'cannotOpen' });
    expect(await runAccessExport(fake(['pid 0'], 1))).toEqual({ ok: false, reason: 'failed' });
  });
  it('system executables: absolute paths under SystemRoot, with a fallback', () => {
    const old = process.env.SystemRoot;
    try {
      process.env.SystemRoot = 'D:\\Win';
      expect(regPath().startsWith('D:')).toBe(true); expect(regPath()).toMatch(/System32[\\/]reg\.exe$/);
      expect(powershellPath().startsWith('D:')).toBe(true); expect(powershellPath()).toMatch(/System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
      delete process.env.SystemRoot;
      expect(regPath()).toMatch(/^C:[\\/]Windows[\\/]System32[\\/]reg\.exe$/);
      expect(win32.isAbsolute(powershellPath())).toBe(true); expect(powershellPath()).toMatch(/powershell\.exe$/);
    } finally { if (old === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = old; }
  });
  it('exportArgs: the PowerShell arguments, no password', () => {
    expect(exportArgs('s.ps1', 'a.accdb', 'out')).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 's.ps1', '-Source', 'a.accdb', '-Out', 'out']);
    expect(exportArgs.length).toBe(3);
  });
  it('runAccessExport: the password goes through stdin, never the arguments', async () => {
    const f = fake(['done'], 0);
    await runAccessExport({ ...f, password: 'S3cret!' });
    const seen = JSON.parse(fs.readFileSync(f.seen, 'utf8'));
    expect(seen.stdin).toBe('S3cret!\n');
  });
  it('runAccessExport: silence past the limit is a timeout; only the reported process and the script are ended, src-* is deleted', async () => {
    const bystander = child();
    const victim = child();
    const f = fake([`pid ${victim.pid}`], 0, 60_000);
    const hex = '0123456789abcdef0123456789abcdef';
    fs.mkdirSync(join(f.parent, `src-${hex}`));
    fs.writeFileSync(join(f.parent, `src-${hex}`, 'db.accdb'), 'x');
    fs.mkdirSync(join(f.parent, 'src-other'));
    fs.mkdirSync(join(f.parent, 'source'));
    fs.writeFileSync(join(f.parent, `src-${hex.split('').reverse().join('')}`), 'x'); // a file of the right name
    expect(await runAccessExport({ ...f, timeoutMs: 3000 })).toEqual({ ok: false, reason: 'timeout' });
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(victim.pid!)).toBe(false);
    expect(alive(bystander.pid!)).toBe(true);
    expect(fs.readdirSync(f.parent).filter((x) => x.startsWith('src-') || x === 'source').sort())
      .toEqual(['source', 'src-other', `src-${hex.split('').reverse().join('')}`].sort());
    expect(fs.existsSync(f.out)).toBe(true);
  }, 30_000);
  it('runAccessExport: aborting the signal takes the watchdog path (processes ended, src-* deleted, timeout), also when already aborted', async () => {
    const victim = child();
    const f = fake([`pid ${victim.pid}`], 0, 60_000);
    const hex = '0123456789abcdef0123456789abcdef';
    fs.mkdirSync(join(f.parent, `src-${hex}`));
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1500);
    expect(await runAccessExport({ ...f, signal: ac.signal })).toEqual({ ok: false, reason: 'timeout' });
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(victim.pid!)).toBe(false);
    expect(fs.existsSync(join(f.parent, `src-${hex}`))).toBe(false);
    const g = fake([], 0, 60_000);
    expect(await runAccessExport({ ...g, signal: AbortSignal.abort() })).toEqual({ ok: false, reason: 'timeout' });
  }, 15_000);
  it('runAccessExport: a stop before the pid line waits for it, then ends the reported process', async () => {
    const victim = child();
    const f = fake([], 0, 60_000);
    fs.writeFileSync(f.script, `setTimeout(() => console.log('pid ${victim.pid}'), 500); setTimeout(() => {}, 60000); process.stdin.resume();`);
    expect(await runAccessExport({ ...f, signal: AbortSignal.abort() })).toEqual({ ok: false, reason: 'timeout' });
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(victim.pid!)).toBe(false);
  }, 15_000);
});
