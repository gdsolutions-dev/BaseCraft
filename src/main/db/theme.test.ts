import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BUILTIN_THEMES, DEFAULT_THEME } from '../../shared/design/theme';
import { createBaseFile, openBaseFile, readOptions, updateOptions } from './file-format';
import { baseTheme, saveBaseTheme } from './theme';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bctheme-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

it('a new base has the default theme', () => {
  expect(baseTheme(db)).toEqual(DEFAULT_THEME);
});

it('round trip; other option keys (startup, unknown) are kept', () => {
  updateOptions(db, (o) => { o.startup = { v: 2 }; o.future = { a: 1 }; });
  saveBaseTheme(db, BUILTIN_THEMES[2]!);
  expect(baseTheme(db)).toEqual(BUILTIN_THEMES[2]);
  expect(readOptions(db)).toMatchObject({ startup: { v: 2 }, future: { a: 1 } });
});

it('a corrupt or empty section reads as the default, never throws', () => {
  for (const bad of ['junk', {}, [1], 7, null]) {
    updateOptions(db, (o) => { o.theme = bad; });
    expect(baseTheme(db)).toEqual(DEFAULT_THEME);
  }
});

it('saving stores only the known keys', () => {
  const t = BUILTIN_THEMES[2]!;
  saveBaseTheme(db, { ...t, extra: 1, colors: { ...t.colors, light: { ...t.colors.light, extraColor: '#fff' } } } as never);
  const raw = readOptions(db).theme as Record<string, unknown>;
  expect(raw).not.toHaveProperty('extra');
  expect((raw.colors as { light: object }).light).not.toHaveProperty('extraColor');
  expect(baseTheme(db)).toEqual(t);
});
