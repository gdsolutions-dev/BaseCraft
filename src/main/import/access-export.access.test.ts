// Needs Microsoft Access (Windows): skipped elsewhere. The export script drives Access through COM.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { ACCESS_PASSWORD } from '../../../tests/fixtures/access/expected';
import { readAccessExport, runAccessExport } from './access-export';

const accessInstalled = process.platform === 'win32' && spawnSync('reg', ['query', 'HKCR\\Access.Application'], { stdio: 'ignore' }).status === 0;
const ROOT = join(__dirname, '../../..');
const SCRIPT = join(ROOT, 'resources/access-export.ps1');
const HOSTILE = join(ROOT, 'tests/helpers/make-hostile-access.ps1');
const FIX = join(ROOT, 'tests/fixtures/access');
const complet = join(FIX, 'Ventes-complet.accdb');

type Manifest = { format: number; source: string; errors: unknown[]; objects: { type: string; name: string; file: string }[] };
type Structure = { tables: { name: string; indexes: { primary: boolean; foreign: boolean; fields: { name: string; desc: boolean }[] }[] }[] };
const TIMEOUT = 120_000;

const tmp = fs.mkdtempSync(join(os.tmpdir(), 'bcaexp-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
let n = 0;
const fresh = () => { const d = join(tmp, String(++n)); fs.mkdirSync(d); return d; };
const sha256 = (p: string) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const processAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// The pid line comes after the copy's 'step 0 0' line, so it is not always the first line.
const pidOf = (stdout: string[]) => Number(/^pid (\d+)$/.exec(stdout.find((l) => /^pid \d+$/.test(l))!)![1]);
const manifest = (out: string) => JSON.parse(fs.readFileSync(join(out, 'manifest.json'), 'utf8')) as Manifest;
const structure = (out: string) => JSON.parse(fs.readFileSync(join(out, 'structure.json'), 'utf8')) as Structure;
const allText = (dir: string): string => fs.readdirSync(dir, { withFileTypes: true })
  .map((e) => (e.isDirectory() ? allText(join(dir, e.name)) : fs.readFileSync(join(dir, e.name), 'latin1') + fs.readFileSync(join(dir, e.name), 'utf8'))).join('\n');

// Runs a child with a time box; on timeout, ends the Access instance the child announced (its id only), then the child.
const exec = (file: string, args: string[], stdin: string) => new Promise<{ code: number | null; stdout: string[]; stderr: string }>((resolve) => {
  const c = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { windowsHide: true });
  let out = ''; let err = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { err += d; });
  c.stdin.end(stdin + '\n');
  const timer = setTimeout(() => {
    const m = /^pid (\d+)/m.exec(out);
    if (m) try { process.kill(Number(m[1])); } catch { /* already gone */ }
    c.kill();
  }, 100_000);
  c.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: out.split(/\r?\n/).filter(Boolean), stderr: err.trim() }); });
});
// Every run must leave nothing behind: no src-* folder beside the out folder, and the Access instance it announced is gone.
const run = async (source: string, password = '', outDir = fresh()) => {
  const r = { ...(await exec(SCRIPT, ['-Source', source, '-Out', outDir], password)), out: outDir };
  expect(fs.readdirSync(dirname(outDir)).filter((f) => f.startsWith('src-'))).toEqual([]);
  if (r.stdout.some((l) => /^pid \d+$/.test(l))) expect(processAlive(pidOf(r.stdout))).toBe(false);
  if (r.code === 0) expect(r.stdout.at(-1)).toBe('done'); else expect(r.stdout).not.toContain('done');
  return r;
};
const buildHostile = async (extra: string[] = []) => {
  const dir = fresh(); const path = join(dir, 'hostile.accdb'); const sentinel = join(dir, 'sentinel.txt');
  const r = await exec(HOSTILE, ['-Out', path, '-Sentinel', sentinel, ...extra], '');
  if (r.code !== 0 || !fs.existsSync(path)) throw new Error(`hostile base not built: ${r.stderr}`);
  return { path, sentinel };
};

describe.skipIf(!accessInstalled)('access-export.ps1', () => {
  let hostile: { path: string; sentinel: string };
  beforeAll(async () => { hostile = await buildHostile(); expect(fs.existsSync(hostile.sentinel)).toBe(false); }, TIMEOUT);

  it('a hostile base: exported, nothing of it ran', async () => {
    const before = sha256(hostile.path);
    const r = await run(hostile.path);
    expect(r.code).toBe(0); expect(r.stdout.at(-1)).toBe('done');
    expect(fs.existsSync(hostile.sentinel)).toBe(false);
    expect(sha256(hostile.path)).toBe(before);
    expect(fs.readdirSync(dirname(hostile.path)).filter((f) => /\.laccdb$/i.test(f))).toEqual([]);
    expect(processAlive(pidOf(r.stdout))).toBe(false);
    const m = manifest(r.out);
    expect(m.objects.map((o) => `${o.type} ${o.name}`).sort()).toEqual(['form Demarrage', 'macro AutoExec', 'module ModHostile']);
  }, TIMEOUT);

  // Control: without it the proof above could pass because the hostile base is inert. Opened by Access with macros
  // enabled (AutomationSecurity low), its AutoExec runs the function and then blocks on a message box: end our instance by id.
  it('control: the hostile base does run its code when macros are enabled', async () => {
    const db = join(fresh(), 'control.accdb'); fs.copyFileSync(hostile.path, db);
    const sentinel = join(dirname(hostile.path), 'sentinel.txt');
    const script = join(dirname(db), 'control.ps1');
    fs.writeFileSync(script, [
      'param($Db)',
      '$a = New-Object -ComObject Access.Application',
      '$a.Visible = $false; $a.AutomationSecurity = 1',
      "Add-Type -Namespace Win -Name U -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);'",
      '[uint32]$p = 0; [void][Win.U]::GetWindowThreadProcessId([IntPtr]$a.hWndAccessApp(), [ref]$p); "pid $p"',
      '$a.OpenCurrentDatabase($Db)',
    ].join('\n'));
    const c = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, db], { windowsHide: true });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += 'E:' + d; });
    try {
      for (let i = 0; i < 60 && !fs.existsSync(sentinel); i++) await new Promise((r) => setTimeout(r, 500));
      expect(fs.existsSync(sentinel), out).toBe(true);
    } finally {
      const m = /^pid (\d+)/m.exec(out);
      if (m) try { process.kill(Number(m[1])); } catch { /* already gone */ }
      c.kill();
      fs.rmSync(sentinel, { force: true });
    }
  }, TIMEOUT);

  it.skipIf(!fs.existsSync(complet))('Ventes-complet.accdb: structure, queries and SaveAsText files', async () => {
    const src = join(fresh(), 'Ventes-complet.accdb'); fs.copyFileSync(complet, src);
    const r = await run(src); const s = structure(r.out); const m = manifest(r.out);
    expect(r.code).toBe(0);
    expect(m).toMatchObject({ format: 1, source: 'Ventes-complet.accdb', errors: [] });
    expect(m.objects.map((o) => `${o.type} ${o.name}`).sort()).toEqual(
      ['form FClients', 'macro MOuvrirEtat', 'module ModOutils', 'query QParVille', 'query QTotaux', 'report ECommandes']);
    expect(s.tables.map((t) => t.name).sort()).toEqual(['Clients', 'Commandes', 'Divers']);
    const cmd = s.tables.find((t) => t.name === 'Commandes')!;
    expect(cmd.indexes.find((i) => i.primary)!.fields).toEqual([{ name: 'N°', desc: false }]);
    expect(cmd.indexes.some((i) => !i.primary && !i.foreign && i.fields.length === 2)).toBe(true); // the owner's two-field index
    expect(fs.readFileSync(join(r.out, m.objects.find((o) => o.name === 'QParVille')!.file), 'utf8')).toMatch(/\[Quelle ville \?\]/);
    for (const o of m.objects) expect(fs.statSync(join(r.out, o.file)).size).toBeGreaterThan(0);
  }, TIMEOUT);

  it('a protected file: exit 3 without its password, exported with it, the password nowhere in the folder', async () => {
    const src = join(fresh(), 'Ventes-mdp.accdb'); fs.copyFileSync(join(FIX, 'Ventes-mdp.accdb'), src);
    const bad = await run(src);
    expect(bad.code).toBe(3);
    expect(bad.stderr).not.toContain(src);
    const r = await run(src, ACCESS_PASSWORD);
    expect(r.code).toBe(0);
    expect(allText(r.out) + r.stdout.join('\n') + r.stderr).not.toContain(ACCESS_PASSWORD);
    expect(processAlive(pidOf(r.stdout))).toBe(false);
  }, TIMEOUT);

  it('a file that is not Access: exit 3, no Access process left', async () => {
    const src = join(fresh(), 'notes.accdb'); fs.writeFileSync(src, 'this is not an Access file\n'.repeat(500));
    const r = await run(src);
    expect(r.code).toBe(3);
    expect(r.stderr).not.toContain(src);
    expect(processAlive(pidOf(r.stdout))).toBe(false);
  }, TIMEOUT);

  it('a password with a semicolon is refused (Jet cannot hold one): exit 3, the password nowhere', async () => {
    const src = join(fresh(), 'Ventes-mdp.accdb'); fs.copyFileSync(join(FIX, 'Ventes-mdp.accdb'), src);
    const r = await run(src, 'a;b"c');
    expect(r.code).toBe(3);
    expect(r.stderr).not.toContain('a;b'); expect(r.stderr).not.toContain(src);
  }, TIMEOUT);

  it('stderr is one line without any path of the user, even when the paths hold a space', async () => {
    const base = join(fresh(), 'Jane Doe Private'); const sdir = join(base, 'My Docs'); const out = join(base, 'My Out');
    fs.mkdirSync(sdir, { recursive: true }); fs.mkdirSync(out);
    const src = join(sdir, 'notes.accdb'); fs.writeFileSync(src, 'this is not an Access file\n'.repeat(500));
    const cases = [await run(src, '', out), await run(join(sdir, 'nope.accdb'), '', out), await run(src, '', join(base, 'no such out'))];
    expect(cases.map((r) => r.code)).toEqual([3, 3, 1]);
    for (const r of cases) {
      expect(r.stderr).not.toMatch(/Jane Doe|My Docs|My Out|no such out|notes|nope|Users|bcaexp/i);
      expect(r.stderr).not.toContain('\n'); expect(r.stderr.length).toBeGreaterThan(0);
    }
  }, TIMEOUT);

  it('a pass-through query: its credentials never reach the manifest', async () => {
    const pt = await buildHostile(['-Passthrough']);
    const r = await run(pt.path);
    expect(r.code).toBe(0);
    const q = manifest(r.out).objects.find((o) => o.name === 'PT') as { connect: string } | undefined;
    expect(q).toBeDefined();
    const text = fs.readFileSync(join(r.out, 'manifest.json'), 'utf8');
    expect(text).not.toContain('secret'); expect(text).not.toMatch(/UID|PWD|DSN/i);
    expect(q!.connect).toBe('ODBC');
  }, TIMEOUT);

  // A stand-in for the owner's Access: a second instance, started by this test, with a database open. The export must
  // neither use it nor disturb it. The test ends it by its own id.
  it('an Access that is already running is left untouched', async () => {
    const dir = fresh(); const db = join(dir, 'standin.accdb'); const ps = join(dir, 'standin.ps1');
    fs.writeFileSync(ps, [
      '$a = New-Object -ComObject Access.Application',
      "Add-Type -Namespace Win -Name U -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);'",
      '[uint32]$p = 0; [void][Win.U]::GetWindowThreadProcessId([IntPtr]$a.hWndAccessApp(), [ref]$p); "pid $p"',
      `$a.NewCurrentDatabase('${db}'); $v = $a.Visible; "ready $v"`,
      '[void][Console]::In.ReadLine()',
      '"state $($a.CurrentProject.FullName) $($a.Visible) $v"',
      '[void][Console]::In.ReadLine()',
    ].join('\n'));
    const c = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps], { windowsHide: true });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    let sid = 0;
    try {
      for (let i = 0; i < 120 && !/^ready/m.test(out); i++) await new Promise((r) => setTimeout(r, 500));
      expect(out).toMatch(/^ready/m);
      sid = Number(/^pid (\d+)/m.exec(out)![1]);
      const r = await run(hostile.path);
      expect(r.code).toBe(0);
      expect(pidOf(r.stdout)).not.toBe(sid);
      expect(processAlive(sid)).toBe(true);
      c.stdin.write('\n');
      for (let i = 0; i < 40 && !/^state/m.test(out); i++) await new Promise((r) => setTimeout(r, 500));
      const st = /^state (.*) (\S+) (\S+)$/m.exec(out);
      expect(st, out).not.toBeNull();
      expect(st![1].toLowerCase()).toBe(db.toLowerCase());   // its database is still the current one
      expect(st![2]).toBe(st![3]);                           // its visibility is unchanged
    } finally {
      if (sid) try { process.kill(sid); } catch { /* already gone */ }
      c.kill();
    }
  }, TIMEOUT);

  it('names a path cannot hold: files are numbered, names are in the manifest', async () => {
    const weird = await buildHostile(['-WeirdQuery']);
    const r = await run(weird.path);
    expect(r.code).toBe(0);
    const q = manifest(r.out).objects.find((o) => o.type === 'query')!;
    expect(q.name).toBe('a/b:c?');
    expect(q.file).toBe('queries/1.sql');
    expect(fs.readFileSync(join(r.out, q.file), 'utf8')).toMatch(/SELECT/i);
  }, TIMEOUT);
  it.skipIf(!fs.existsSync(complet))('runAccessExport + readAccessExport on Ventes-complet', async () => {
    const parent = fresh(); const out = join(parent, 'out'); fs.mkdirSync(out);
    const ticks: number[] = [];
    expect(await runAccessExport({ script: SCRIPT, source: complet, out, tick: (d) => ticks.push(d) })).toEqual({ ok: true });
    expect(ticks).toEqual([0, 1, 2, 3, 4, 5, 6]); // 'step 0 <total>' first; the 'step 0 0' keep-alive lines are no tick
    expect(fs.readdirSync(parent).filter((f) => f.startsWith('src-'))).toEqual([]);
    const r = readAccessExport(out, 'Ventes-complet.accdb');
    expect(r.ok && r.export.tables.map((t) => t.name).sort()).toEqual(['Clients', 'Commandes', 'Divers']);
    expect(r.ok && r.export.manifest.objects.length).toBe(6);
  }, TIMEOUT);
});

