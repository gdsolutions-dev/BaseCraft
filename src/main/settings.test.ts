import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, addRecentFile, type AppSettings } from './settings';

const defaults: AppSettings = { locale: 'system', theme: 'system', recentFiles: [] };
const tmp = () => mkdtempSync(join(tmpdir(), 'bc-set-'));

describe('settings', () => {
  it('defaults when settings missing or corrupt', () => {
    expect(loadSettings(tmp())).toEqual(defaults);
    const dir = tmp();
    writeFileSync(join(dir, 'settings.json'), '{oops');
    expect(loadSettings(dir).locale).toBe('system');
  });
  it('round-trips and ignores invalid values', () => {
    const dir = tmp();
    saveSettings(dir, { locale: 'fr', theme: 'dark', recentFiles: ['a'] });
    expect(loadSettings(dir)).toEqual({ locale: 'fr', theme: 'dark', recentFiles: ['a'] });
    writeFileSync(join(dir, 'settings.json'), '{"locale":"xx","theme":3,"recentFiles":"z"}');
    expect(loadSettings(dir)).toEqual(defaults);
  });
  it('recent files: newest first, deduped, max 10', () => {
    let s = defaults;
    for (let i = 0; i < 12; i++) s = addRecentFile(s, `C:\\b${i}.basecraft`, 'win32');
    s = addRecentFile(s, 'c:\\B5.BASECRAFT', 'win32');
    expect(s.recentFiles).toHaveLength(10);
    expect(s.recentFiles[0]).toBe('c:\\B5.BASECRAFT');
    expect(s.recentFiles.filter((p) => p.toLowerCase() === 'c:\\b5.basecraft')).toHaveLength(1);
  });
});
