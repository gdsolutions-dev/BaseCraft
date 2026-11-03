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

describe('O2 settings', () => {
  it('reads the O2 keys one by one', () => {
    expect(readSettings({ moveAfterEnter: 'next', arrowKeyBehavior: 'nextCharacter', datasheetFontSize: '11', columnWidth: '2,5cm', gridlinesVertical: false }))
      .toEqual({ ...DEFAULT_SETTINGS, arrowKeyBehavior: 'nextCharacter', gridlinesVertical: false });
    for (const n of [0, 128, 10.5]) expect(readSettings({ datasheetFontSize: n }).datasheetFontSize).toBe(11);
    for (const n of [450, 0, 1000]) expect(readSettings({ datasheetFontWeight: n }).datasheetFontWeight).toBe(400);
    for (const n of [299, 31681]) expect(readSettings({ columnWidth: n }).columnWidth).toBe(1417);
    expect(readSettings({ columnWidth: 300, datasheetFontWeight: 900 })).toMatchObject({ columnWidth: 300, datasheetFontWeight: 900 });
  });
  it('the O2 defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      moveAfterEnter: 'nextField', enterFieldBehavior: 'selectAll', arrowKeyBehavior: 'nextField', continuousArrowKeys: 'none', cursorStopsAtEnds: false,
      findReplaceDefault: 'fast', fourDigitYearAll: false, gridlinesHorizontal: true, gridlinesVertical: true, columnWidth: 1417,
      datasheetFontSize: 11, datasheetFontWeight: 400, datasheetFontUnderline: false, datasheetFontItalic: false,
    });
  });
  it('every enum and boolean key refuses a wrong value', () => {
    for (const k of ['enterFieldBehavior', 'continuousArrowKeys', 'findReplaceDefault'] as const)
      expect(readSettings({ [k]: 'bogus' })[k]).toBe(DEFAULT_SETTINGS[k]);
    for (const k of ['cursorStopsAtEnds', 'fourDigitYearAll', 'gridlinesHorizontal', 'datasheetFontUnderline', 'datasheetFontItalic'] as const)
      expect(readSettings({ [k]: 'yes' })[k]).toBe(DEFAULT_SETTINGS[k]);
    expect(readSettings({ moveAfterEnter: 'none', enterFieldBehavior: 'end', continuousArrowKeys: 'leftRight', findReplaceDefault: 'startOfField' }))
      .toMatchObject({ moveAfterEnter: 'none', enterFieldBehavior: 'end', continuousArrowKeys: 'leftRight', findReplaceDefault: 'startOfField' });
  });
  it('reads the O3 keys one by one', () => {
    expect(readSettings({ defaultFieldType: 'autoNumber', defaultTextSize: '50', defaultNumberSize: 'large', autoIndex: 42,
      queryFontName: '"; } body { display:none', propertySheetFontSize: 13, selectionBehavior: 'fully', printMarginLeft: 360.5, showTableNames: false }))
      .toEqual({ ...DEFAULT_SETTINGS, showTableNames: false });
    for (const n of [0, 256]) expect(readSettings({ defaultTextSize: n }).defaultTextSize).toBe(255);
    for (const n of [-1, 5671]) expect(readSettings({ printMarginTop: n }).printMarginTop).toBe(360);
    for (const n of [0, 128]) expect(readSettings({ queryFontSize: n }).queryFontSize).toBe(8);
    for (const v of ['x'.repeat(256), 'ID\u0007']) expect(readSettings({ autoIndex: v }).autoIndex).toBeNull();
    for (const v of ['', 'a'.repeat(65), 'A\\B', 'a;b', 'a{b', 'a<b', 'a\u0001']) expect(readSettings({ queryFontName: v }).queryFontName).toBe('Segoe UI');
    expect(readSettings({ autoIndex: '', defaultFieldType: 'number', queryFontName: 'Liberation Serif', printMarginLeft: 0 }))
      .toMatchObject({ autoIndex: '', defaultFieldType: 'number', queryFontName: 'Liberation Serif', printMarginLeft: 0 });
  });
});

describe('O4 settings', () => {
  it('reads propertyUpdateOptions', () => {
    expect(readSettings({}).propertyUpdateOptions).toBe(true);
    expect(readSettings({ propertyUpdateOptions: 'off' }).propertyUpdateOptions).toBe(true);
    expect(readSettings({ propertyUpdateOptions: false }).propertyUpdateOptions).toBe(false);
  });
});
