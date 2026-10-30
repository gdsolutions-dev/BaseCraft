import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, addRecentFile, readSettings, lastBaseToOpen, dialogDir, DEFAULT_SETTINGS, SETTING_CHECKS, type AppSettings } from './settings';

const tmp = () => mkdtempSync(join(tmpdir(), 'bc-set-'));
const abs = process.platform === 'win32' ? 'C:\\Bases' : '/home/u/bases';

describe('settings', () => {
  it('a missing or corrupt file gives the defaults', () => {
    expect(loadSettings(tmp())).toEqual(DEFAULT_SETTINGS);
    const dir = tmp();
    writeFileSync(join(dir, 'settings.json'), 'not json');
    expect(loadSettings(dir)).toEqual(DEFAULT_SETTINGS);
  });
  it('round-trips and ignores invalid values', () => {
    const dir = tmp();
    const s: AppSettings = { ...DEFAULT_SETTINGS, locale: 'fr', theme: 'dark', recentFiles: ['a'], defaultFolder: abs, recentCount: 0, openLast: true, confirmDocumentDeletions: false };
    saveSettings(dir, s);
    expect(loadSettings(dir)).toEqual(s);
    writeFileSync(join(dir, 'settings.json'), '{"locale":"xx","theme":3,"recentFiles":"z"}');
    expect(loadSettings(dir)).toEqual(DEFAULT_SETTINGS);
  });
  it('reads each key alone, a wrong value gives its default', () => {
    expect(readSettings({ recentCount: '12', openLast: 'yes', confirmActionQueries: false, defaultFolder: 'relative/dir', theme: 'dark', other: 1 }))
      .toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', confirmActionQueries: false });
    for (const n of [-1, 51, 2.5, NaN]) expect(readSettings({ recentCount: n }).recentCount).toBe(10);
    expect(readSettings({ recentCount: 0 }).recentCount).toBe(0);
    expect(readSettings({ recentFiles: ['a', 3, 'b'] }).recentFiles).toEqual(['a', 'b']);
    expect(readSettings({ recentFiles: Array.from({ length: 80 }, (_, i) => `f${i}`) }).recentFiles).toHaveLength(50);
    expect(readSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it('a pre-O1 file keeps its values and gets the new defaults', () => {
    const files = Array.from({ length: 10 }, (_, i) => `C:\\b${i}.basecraft`);
    const dir = tmp();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ locale: 'en', theme: 'light', recentFiles: files }));
    expect(loadSettings(dir)).toEqual({ ...DEFAULT_SETTINGS, locale: 'en', theme: 'light', recentFiles: files });
  });
  it('defaultFolder: absolute or empty', () => {
    expect(SETTING_CHECKS.defaultFolder(abs)).toBe(true);
    expect(SETTING_CHECKS.defaultFolder('')).toBe(true);
    for (const v of ['bases', 'a\0b', 'x'.repeat(4097), 3]) expect(SETTING_CHECKS.defaultFolder(v)).toBe(false);
  });
  it('the recent list keeps 50: newest first, deduped', () => {
    let s: AppSettings = DEFAULT_SETTINGS;
    for (let i = 0; i < 60; i++) s = addRecentFile(s, `C:\\b${i}.basecraft`, 'win32');
    s = addRecentFile(s, 'c:\\B55.BASECRAFT', 'win32');
    expect(s.recentFiles).toHaveLength(50);
    expect(s.recentFiles[0]).toBe('c:\\B55.BASECRAFT');
    expect(s.recentFiles.filter((p) => p.toLowerCase() === 'c:\\b55.basecraft')).toHaveLength(1);
  });
  it('the last base opens only when asked, valid and present', async () => {
    const a = join(abs, 'a.basecraft'), b = join(abs, 'b.basecraft');
    const s = { ...DEFAULT_SETTINGS, openLast: true, recentFiles: [a, b] };
    const yes = async () => true;
    expect(await lastBaseToOpen(s, yes)).toBe(a);
    expect(await lastBaseToOpen(s, async () => false)).toBeNull();
    expect(await lastBaseToOpen({ ...s, openLast: false }, yes)).toBeNull();
    expect(await lastBaseToOpen({ ...s, recentFiles: [] }, yes)).toBeNull();
    expect(await lastBaseToOpen(s, async (p) => p === b)).toBeNull();   // only the most recent: an older one is never taken instead
    // settings.json is edited by hand: the same rule as any other open (absolute, .basecraft), and never touched on disk otherwise
    const asked: string[] = [];
    const spy = async (p: string) => (asked.push(p), true);
    expect(await lastBaseToOpen({ ...s, recentFiles: ['a.basecraft'] }, spy)).toBeNull();
    expect(await lastBaseToOpen({ ...s, recentFiles: [join(abs, 'notes.txt')] }, spy)).toBeNull();
    expect(asked).toEqual([]);
    expect(await lastBaseToOpen(s, async () => { throw new Error('EACCES'); })).toBeNull();
  });
  it('dialogs start in the default folder, else Documents', async () => {
    expect(await dialogDir({ ...DEFAULT_SETTINGS, defaultFolder: '/bases' }, '/docs', async () => true)).toBe('/bases');
    expect(await dialogDir({ ...DEFAULT_SETTINGS, defaultFolder: '/gone' }, '/docs', async () => false)).toBe('/docs');
    expect(await dialogDir(DEFAULT_SETTINGS, '/docs', async () => true)).toBe('/docs');   // '' : never tested as a folder
    const asked: string[] = [];
    await dialogDir({ ...DEFAULT_SETTINGS, defaultFolder: '/bases' }, '/docs', async (p) => (asked.push(p), true));
    expect(asked).toEqual(['/bases']);
    expect(await dialogDir({ ...DEFAULT_SETTINGS, defaultFolder: '/bases' }, '/docs', async () => { throw new Error('EIO'); })).toBe('/docs');
  });

  it('shared-data settings read key by key', () => {
    expect(readSettings({ openMode: 'x', refreshInterval: 0, updateRetries: 11, updateRetryMs: 300.5, recordLocking: 'edited' }))
      .toMatchObject({ openMode: 'shared', refreshInterval: 60, updateRetries: 2, updateRetryMs: 250, recordLocking: 'none' });
    expect(readSettings({ openMode: 'exclusive', refreshInterval: 32766, updateRetries: 0, updateRetryMs: 1000 }))
      .toMatchObject({ openMode: 'exclusive', refreshInterval: 32766, updateRetries: 0, updateRetryMs: 1000 });
  });
});
