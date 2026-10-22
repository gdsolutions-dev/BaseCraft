import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppSettings } from '../shared/api';
export type { AppSettings };

const file = (dir: string) => join(dir, 'settings.json');

export function loadSettings(dir: string): AppSettings {
  const s: AppSettings = { locale: 'system', theme: 'system', recentFiles: [] };
  try {
    const j = JSON.parse(readFileSync(file(dir), 'utf8'));
    if (['system', 'fr', 'en'].includes(j.locale)) s.locale = j.locale;
    if (['system', 'light', 'dark'].includes(j.theme)) s.theme = j.theme;
    if (Array.isArray(j.recentFiles)) s.recentFiles = j.recentFiles.filter((p: unknown) => typeof p === 'string').slice(0, 10);
  } catch { /* absent ou corrompu : valeurs par défaut */ }
  return s;
}

export function saveSettings(dir: string, s: AppSettings): void {
  writeFileSync(file(dir), JSON.stringify(s, null, 2), 'utf8');
}

export function addRecentFile(s: AppSettings, path: string, platform: NodeJS.Platform): AppSettings {
  const key = (p: string) => (platform === 'win32' ? p.toLowerCase() : p);
  const rest = s.recentFiles.filter((p) => key(p) !== key(path));
  return { ...s, recentFiles: [path, ...rest].slice(0, 10) };
}
