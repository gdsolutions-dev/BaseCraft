import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs, { existsSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { localFrontEnd } from './front-end-copy';
import type { RiskProbe } from './location-risk';
import { acquireLock, type HeldLock } from './lock';
import { saveObject } from './objects';
import { saveStartupOptions } from './startup';
import { DEFAULT_STARTUP } from '../../shared/startup';

// A front-end Ventes.basecraft in `share` (a network location for localFrontEnd through networkDirs), copied into `cache`.
let dir: string;
let share: string;
let cache: string;
let fe: string;
let uuid: string;
let held: HeldLock | null = null;
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const FORM = { formatVersion: '1.0', recordSource: null, props: {}, sections: [] };
const onShare = () => ({ networkDirs: [share] });

function base(p: string, frontEnd: boolean): string {
  createBaseFile(p, '0.0.0');
  const db = openBaseFile(p, 'write', '0.0.0').db;
  try {
    if (frontEnd) saveStartupOptions(db, { ...DEFAULT_STARTUP, frontEnd: true });
    return (db.prepare(`SELECT value FROM bc_meta WHERE key = 'db_uuid'`).get() as { value: string }).value;
  } finally { db.close(); }
}
/** The designer republishes: a new form in the original, its modification time moved on. */
function republish(name: string, at: number): void {
  const db = openBaseFile(fe, 'write', '0.0.0').db;
  try { saveObject(db, 'form', name, FORM, null); } finally { db.close(); }
  utimesSync(fe, at, at);
}
const forms = (p: string) => {
  const db = new DatabaseSync(p, { readOnly: true });
  try { return (db.prepare(`SELECT name FROM bc_objects WHERE kind = 'form' ORDER BY name`).all() as { name: string }[]).map((o) => o.name); } finally { db.close(); }
};

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcfecopy-')));
  share = join(dir, 'share');
  cache = join(dir, 'front-ends');
  fs.mkdirSync(share);
  fe = join(share, 'Ventes.basecraft');
  uuid = base(fe, true);
});
afterEach(() => {
  held?.release();
  held = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the Runtime\'s local copy of a front-end (C3 R14)', () => {
  it('a front-end on a share is copied once, then reused', () => {
    const p = localFrontEnd(fe, cache, probe, onShare());
    expect(p).toBe(join(cache, uuid, 'Ventes.basecraft'));
    expect(existsSync(`${p}.origin.json`)).toBe(true);
    const m = statSync(p).mtimeMs;
    expect(localFrontEnd(fe, cache, probe, onShare())).toBe(p);
    expect(statSync(p).mtimeMs).toBe(m);
  });

  it('a republished original is copied again, an open copy is not replaced', () => { // Review Focus 5
    const p = localFrontEnd(fe, cache, probe, onShare());
    republish('FNouveau', 1_000_000);
    expect(localFrontEnd(fe, cache, probe, onShare())).toBe(p);
    expect(forms(p)).toEqual(['FNouveau']);
    republish('FAutre', 500_000); // an older date: different is enough
    const r = acquireLock(p, 'live');
    if (r.status !== 'acquired') throw new Error(r.status);
    held = r.lock;
    expect(localFrontEnd(fe, cache, probe, onShare())).toBe(p);
    expect(forms(p)).toEqual(['FNouveau']); // the open copy kept
    held.release();
    held = null;
    expect(localFrontEnd(fe, cache, probe, onShare())).toBe(p);
    expect(forms(p)).toEqual(['FAutre', 'FNouveau']); // the next opening takes it
  });

  it('a window that opens the copy while it is being made keeps it: the original opens', () => { // fix round 1
    const p = localFrontEnd(fe, cache, probe, onShare());
    republish('FNouveau', 1_000_000);
    let reads = 0;
    // the first lock check finds none; another window takes the copy's lock before the second (beforeReplace)
    const readText = (f: string) => {
      if (++reads === 2) { const r = acquireLock(p, 'late'); if (r.status === 'acquired') held = r.lock; }
      return fs.readFileSync(f, 'utf8');
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(localFrontEnd(fe, cache, probe, { ...onShare(), lockDeps: { readText } })).toBe(fe);
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: 'bc:targetInUse' }));
    } finally { log.mockRestore(); }
    expect(held).not.toBeNull();
    expect(forms(p)).toEqual([]); // the open copy untouched
  });

  it('two originals of one db_uuid and file name never share a copy', () => { // fix round 1: a test share and a prod share
    const share2 = join(dir, 'share2');
    fs.mkdirSync(share2);
    const fe2 = join(share2, 'Ventes.basecraft');
    fs.copyFileSync(fe, fe2);
    utimesSync(fe, 1_000_000, 1_000_000);
    utimesSync(fe2, 1_000_000, 1_000_000); // same size, same date: only the origin tells them apart
    const p = localFrontEnd(fe, cache, probe, { networkDirs: [share, share2] });
    expect(localFrontEnd(fe2, cache, probe, { networkDirs: [share, share2] })).toBe(p);
    expect(JSON.parse(fs.readFileSync(`${p}.origin.json`, 'utf8'))).toMatchObject({ original: fe2 }); // copied again for fe2
    const r = acquireLock(p, 'live');
    if (r.status !== 'acquired') throw new Error(r.status);
    held = r.lock;
    expect(localFrontEnd(fe, cache, probe, { networkDirs: [share, share2] })).toBe(fe); // fe2's copy is open: fe in place
    expect(localFrontEnd(fe2, cache, probe, { networkDirs: [share, share2] })).toBe(p);
  });

  it('a base that is not a front-end, or on a local disk, opens in place', () => {
    const plain = join(share, 'Plain.basecraft');
    base(plain, false);
    expect(localFrontEnd(plain, cache, probe, onShare())).toBe(plain);
    expect(localFrontEnd(fe, cache, probe)).toBe(fe);
    expect(existsSync(cache)).toBe(false);
  });

  it('a copy that fails opens the original', () => {
    writeFileSync(cache, 'not a folder');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(localFrontEnd(fe, cache, probe, onShare())).toBe(fe);
      expect(log).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
});
