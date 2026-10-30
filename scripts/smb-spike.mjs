// SMB spike (C3 Task 1, gate G1): concurrent writers on one SQLite file on a network share, with BaseCraft's settings
// (journal_mode=DELETE, synchronous=FULL, busy_timeout=5000, BEGIN IMMEDIATE with two busy retries 250 ms apart, R7),
// plus a presence probe measuring how late a new file shows up on another machine (R5). Every command prints one report
// block to paste back and exits 0 on VERDICT: OK, 1 on VERDICT: FAIL.
//   node smb-spike.mjs init  <file>
//   node smb-spike.mjs run   <file> --label <machine> [--workers 4] [--seconds 600] [--no-presence]
//   node smb-spike.mjs check <file>                                after every machine's run has ended
//   node smb-spike.mjs smoke <dir> [--workers 3] [--seconds 5]     init + run + check in <dir>, on one machine
// ponytail: no dependency, no TypeScript: it runs from a USB stick with Node 24 alone (or ELECTRON_RUN_AS_NODE=1 BaseCraft).
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { crc32 } from 'node:zlib';

const SCRIPT = fileURLToPath(import.meta.url);
const BUSY_RETRIES = 2;
const BUSY_RETRY_MS = 250;

const open = (file) => {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL'); // the timeout first: journal_mode locks
  return db;
};
const isBusy = (e) => (e?.errcode ?? 0) % 256 === 5; // SQLITE_BUSY and its extended codes
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const payload = () => randomBytes(1500).toString('base64').slice(0, 200 + Math.floor(Math.random() * 1801));
const rollback = (db) => { try { db.exec('ROLLBACK'); } catch { /* no transaction left */ } };

function init(file) {
  if (existsSync(file)) throw new Error(`${file} already exists`);
  rmSync(`${file}.spike-users`, { recursive: true, force: true }); // an earlier run's machines must not show as present
  const db = open(file);
  try {
    db.exec(`CREATE TABLE rows (id INTEGER PRIMARY KEY, writer TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL,
               crc INTEGER NOT NULL, UNIQUE (writer, seq));
             CREATE TABLE counters (writer TEXT PRIMARY KEY, n INTEGER NOT NULL);`);
  } finally { db.close(); }
  return { lines: ['init: created'], reasons: [] };
}

/** One child process: writes and reads until `deadline`, then sends its numbers to the parent. */
function worker(file, writer, deadline) {
  const db = open(file);
  const r = { commits: 0, lastSeq: 0, busyRetries: 0, busyGiveUps: 0, errorCount: 0, errors: [], crcMismatches: 0,
    maxCommitMs: 0, p95CommitMs: 0, dataVersionChanges: 0 };
  const times = [];
  const q = {
    seq: db.prepare('SELECT max(seq) AS m FROM rows WHERE writer = ?'),
    insert: db.prepare('INSERT INTO rows (writer, seq, payload, crc) VALUES (?, ?, ?, ?)'),
    counter: db.prepare('INSERT INTO counters VALUES (?, ?) ON CONFLICT (writer) DO UPDATE SET n = excluded.n'),
    maxId: db.prepare('SELECT max(id) AS m FROM rows'),
    pick: db.prepare('SELECT id FROM rows WHERE id >= ? ORDER BY id LIMIT 1'),
    rewrite: db.prepare('UPDATE rows SET payload = ?, crc = ? WHERE id = ?'),
    count: db.prepare('SELECT count(*) AS n FROM rows'),
    page: db.prepare('SELECT payload, crc FROM rows WHERE id >= ? ORDER BY id LIMIT 50'),
    version: db.prepare('PRAGMA data_version'),
  };
  const lastSeq = () => q.seq.get(writer).m ?? 0; // a rerun with the same label continues its sequence
  const randomId = () => 1 + Math.floor(Math.random() * (q.maxId.get().m ?? 0));
  let seq = lastSeq();
  let version;

  /** One immediate transaction (R7); false when still busy after the retries. */
  const write = (body) => {
    const t0 = performance.now();
    for (let attempt = 0; ; attempt++) {
      try { db.exec('BEGIN IMMEDIATE'); break; } catch (e) {
        if (!isBusy(e)) throw e;
        if (attempt === BUSY_RETRIES) { r.busyGiveUps++; return false; }
        r.busyRetries++;
        sleep(BUSY_RETRY_MS);
      }
    }
    try { body(); db.exec('COMMIT'); } catch (e) {
      rollback(db);
      if (!isBusy(e)) throw e;
      r.busyGiveUps++;
      return false;
    }
    times.push(performance.now() - t0);
    r.commits++;
    return true;
  };

  while (Date.now() < deadline) {
    const dice = Math.random();
    try {
      if (dice < 0.7) {
        const p = payload();
        if (write(() => { q.insert.run(writer, seq + 1, p, crc32(p)); q.counter.run(writer, seq + 1); })) seq++;
      } else if (dice < 0.9) {
        write(() => {
          const row = q.pick.get(randomId());
          if (!row) return;
          const p = payload();
          q.rewrite.run(p, crc32(p), row.id);
        });
      } else {
        q.count.get();
        for (const row of q.page.all(randomId())) if (crc32(row.payload) !== row.crc) r.crcMismatches++;
        const v = q.version.get().data_version;
        if (version !== undefined && v !== version) r.dataVersionChanges++;
        version = v;
      }
    } catch (e) {
      r.errorCount++;
      if (r.errors.length < 5) r.errors.push(String(e?.message ?? e));
      rollback(db);
      try { seq = lastSeq(); } catch { /* the next iteration reports it */ } // a commit may have landed despite its error
      sleep(100);
    }
    sleep(Math.random() * 10); // back-to-back commits starve the other writers' busy handler (one worker would do all the work)
  }
  db.close();
  times.sort((a, b) => a - b);
  r.lastSeq = seq;
  r.maxCommitMs = Math.round(times.at(-1) ?? 0);
  r.p95CommitMs = Math.round(times[Math.floor((times.length - 1) * 0.95)] ?? 0);
  process.send(r, () => process.disconnect());
}

/**
 * R5's measurement, on this machine's clock only: every second `<label>.json` gets a new counter; every 5 s a new
 * `<label>-<k>.probe` is created, then announced in the json. Reading the other machines' json files tells how long an
 * announced file takes to appear to existsSync and readdirSync, and the longest wait between two new counter values.
 */
function startPresence(file, label) {
  const dir = `${file}.spike-users`;
  const own = path.join(dir, `${label}.json`);
  const list = () => { try { return readdirSync(dir); } catch { return []; } };
  const isOwnProbe = (f) => f.startsWith(`${label}-`) && /^\d+\.probe$/.test(f.slice(label.length + 1));
  for (const f of list()) if (f === `${label}.json` || isOwnProbe(f)) rmSync(path.join(dir, f), { force: true });
  const s = { counter: 0, probe: 0, writeErrors: 0, readErrors: 0, maxStaleReadMs: 0, maxExistsMs: 0, maxListMs: 0, probesSeen: 0 };
  const others = new Map(); // label -> { counter, at, probe }
  const pending = new Map(); // probe file name -> { announced, exists?, listed? }
  let nextBeat = 0;

  const tick = () => {
    const now = Date.now();
    if (now >= nextBeat) {
      nextBeat = now + 1000;
      s.counter++;
      try {
        mkdirSync(dir, { recursive: true });
        if (s.counter % 5 === 0) { writeFileSync(path.join(dir, `${label}-${s.probe + 1}.probe`), ''); s.probe++; }
        writeFileSync(own, JSON.stringify({ counter: s.counter, probe: s.probe }));
      } catch { s.writeErrors++; }
    }
    const names = list();
    for (const f of names) {
      if (!f.endsWith('.json') || f === `${label}.json`) continue;
      let j;
      try { j = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { s.readErrors++; continue; } // vanished or half-written
      const other = f.slice(0, -5);
      const o = others.get(other);
      if (!o) { others.set(other, { counter: j.counter, at: now, probe: j.probe }); continue; } // its current probe is not timed
      if (j.counter !== o.counter) { s.maxStaleReadMs = Math.max(s.maxStaleReadMs, now - o.at); o.counter = j.counter; o.at = now; }
      if (j.probe !== o.probe) { o.probe = j.probe; pending.set(`${other}-${j.probe}.probe`, { announced: now }); }
    }
    for (const [name, p] of pending) {
      p.exists ??= existsSync(path.join(dir, name)) ? now : undefined;
      p.listed ??= names.includes(name) ? now : undefined;
      if (p.exists === undefined || p.listed === undefined) continue;
      s.maxExistsMs = Math.max(s.maxExistsMs, p.exists - p.announced);
      s.maxListMs = Math.max(s.maxListMs, p.listed - p.announced);
      s.probesSeen++;
      pending.delete(name);
    }
  };
  const timer = setInterval(() => { try { tick(); } catch { s.readErrors++; } }, 200);

  return () => {
    clearInterval(timer);
    const oldest = Math.max(0, ...[...pending.values()].map((p) => Date.now() - p.announced));
    const seen = others.size ? [...others.keys()].sort().join(', ') : 'none';
    return [`presence: other machines seen: ${seen}`,
      `presence: maxNewFileLagMs ${Math.max(s.maxExistsMs, s.maxListMs)} (existsSync ${s.maxExistsMs}, readdirSync ${s.maxListMs}), ` +
        `probes seen ${s.probesSeen}, unresolved ${pending.size}${pending.size ? ` (oldest ${oldest} ms)` : ''}`,
      `presence: maxStaleReadMs ${s.maxStaleReadMs}, beats ${s.counter}, write errors ${s.writeErrors}, read errors ${s.readErrors}`];
  };
}

async function run(file, label, workers, seconds, presence) {
  if (!existsSync(file)) throw new Error(`${file} not found (run init first)`);
  const deadline = Date.now() + seconds * 1000;
  const stopPresence = presence ? startPresence(file, label) : () => ['presence: off'];
  console.error(`smb-spike: ${workers} workers for ${seconds} s on ${file}…`);
  const results = await Promise.all(Array.from({ length: workers }, (_, i) => new Promise((resolve) => {
    const writer = `${label}-${i}`;
    let result;
    let stderr = '';
    const child = fork(SCRIPT, ['worker', file, writer, String(deadline)], { stdio: ['ignore', 'inherit', 'pipe', 'ipc'] });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('message', (m) => { result = m; });
    const crash = () => stderr.split('\n').find((l) => /error/i.test(l))?.trim() ?? '';
    child.on('error', (e) => resolve({ writer, result, exit: e.message, crash: crash() }));
    child.on('exit', (code, signal) => resolve({ writer, result, exit: signal ?? code, crash: crash() }));
  })));
  const lines = [];
  const reasons = [];
  for (const { writer, result: r, exit, crash } of results) {
    if (!r) { lines.push(`worker ${writer}: no result (exit ${exit}) ${crash}`); reasons.push(`${writer}: no result`); continue; }
    lines.push(`worker ${writer}: commits ${r.commits}, lastSeq ${r.lastSeq}, busyRetries ${r.busyRetries}, ` +
      `busyGiveUps ${r.busyGiveUps}, errors ${r.errorCount}, crcMismatches ${r.crcMismatches}, maxCommitMs ${r.maxCommitMs}, ` +
      `p95CommitMs ${r.p95CommitMs}, dataVersionChanges ${r.dataVersionChanges}`);
    for (const e of r.errors) lines.push(`  error: ${e}`);
    if (r.errorCount) reasons.push(`${writer}: ${r.errorCount} errors`);
    if (r.crcMismatches) reasons.push(`${writer}: ${r.crcMismatches} crc mismatches read`);
  }
  return { lines: [...lines, ...stopPresence()], reasons };
}

function check(file) {
  if (!existsSync(file)) throw new Error(`${file} not found`);
  const lines = [];
  const reasons = [];
  const db = open(file);
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check).join('; ');
    lines.push(`integrity_check: ${integrity}`);
    if (integrity !== 'ok') reasons.push('integrity_check');
    const rows = new Map(db.prepare('SELECT writer, count(*) AS n, max(seq) AS m FROM rows GROUP BY writer').all().map((r) => [r.writer, r]));
    const counters = new Map(db.prepare('SELECT writer, n FROM counters').all().map((r) => [r.writer, r.n]));
    let lost = 0;
    for (const w of [...new Set([...rows.keys(), ...counters.keys()])].sort()) {
      const n = rows.get(w)?.n ?? 0, m = rows.get(w)?.m ?? 0, c = counters.get(w) ?? 0;
      const ok = n === m && m === c; // seq runs 1..n without a gap, and the counter committed with the last one
      lines.push(`writer ${w}: rows ${n}, max seq ${m}, counter ${c}${ok ? '' : '  MISMATCH'}`);
      if (!ok) { lost += Math.max(m, c) - n; reasons.push(`${w}: rows, max seq and counter differ`); }
    }
    lines.push(`lost commits: ${lost}`);
    let bad = 0;
    const ids = [];
    for (const r of db.prepare('SELECT id, payload, crc FROM rows').iterate()) {
      if (crc32(r.payload) !== r.crc) { bad++; if (ids.length < 5) ids.push(r.id); }
    }
    lines.push(`crc mismatches: ${bad}${ids.length ? ` (ids ${ids.join(', ')})` : ''}`);
    if (bad) reasons.push('crc mismatches');
  } finally { db.close(); }
  return { lines, reasons };
}

function mountLine(file) {
  if (os.platform() !== 'linux') return [];
  try {
    const dir = realpathSync(path.dirname(file));
    const unescape = (s) => s.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
    let best;
    for (const line of readFileSync('/proc/mounts', 'utf8').split('\n')) {
      const at = unescape(line.split(' ')[1] ?? '');
      const under = at && (dir === at || dir.startsWith(at.endsWith('/') ? at : `${at}/`));
      if (under && (!best || at.length >= best.at.length)) best = { at, line };
    }
    return [`mount: ${best?.line ?? '?'}`];
  } catch (e) { return [`mount: ? (${e.message})`]; }
}

const USAGE = 'usage: smb-spike.mjs init <file> | run <file> --label <machine> [--workers 4] [--seconds 600] [--no-presence]' +
  ' | check <file> | smoke <dir> [--workers 3] [--seconds 5]';

async function main() {
  const { positionals: [command, target, ...rest], values: v } = parseArgs({ allowPositionals: true, options: {
    label: { type: 'string' }, workers: { type: 'string' }, seconds: { type: 'string' }, 'no-presence': { type: 'boolean' } } });
  if (command === 'worker') return worker(target, rest[0], Number(rest[1]));
  const workers = Number(v.workers ?? (command === 'smoke' ? 3 : 4));
  const seconds = Number(v.seconds ?? (command === 'smoke' ? 5 : 600));
  const label = command === 'smoke' ? 'x' : v.label;
  const valid = target && ['init', 'run', 'check', 'smoke'].includes(command) && Number.isInteger(workers) && workers >= 1 &&
    workers <= 64 && seconds > 0 && (command !== 'run' || /^[\w.-]+$/.test(label ?? ''));
  if (!valid) { console.error(USAGE); process.exitCode = 2; return; }

  const file = path.resolve(command === 'smoke' ? path.join(target, 'smb-spike.sqlite') : target);
  const lines = ['===== BASECRAFT SMB SPIKE REPORT v1 =====', `command: ${command}`, `label: ${label ?? '-'}`,
    `date: ${new Date().toISOString()}`, `system: ${os.platform()} ${os.release()} ${os.arch()}`,
    `node: ${process.version}, sqlite: ${process.versions.sqlite}`, `file: ${file}`];
  const reasons = [];
  const add = (r) => { lines.push(...r.lines); reasons.push(...r.reasons); };
  try {
    if (command === 'smoke') mkdirSync(target, { recursive: true });
    lines.push(...mountLine(file));
    if (command === 'init' || command === 'smoke') add(init(file));
    if (command === 'run' || command === 'smoke') add(await run(file, label, workers, seconds, !v['no-presence']));
    if (command === 'check' || command === 'smoke') add(check(file));
  } catch (e) { reasons.push(`error: ${e?.message ?? e}`); }
  lines.push(`VERDICT: ${reasons.length ? 'FAIL' : 'OK'}`, ...reasons.map((r) => `  reason: ${r}`), '===== END =====');
  console.log(lines.join('\n'));
  process.exitCode = reasons.length ? 1 : 0;
}

await main();
