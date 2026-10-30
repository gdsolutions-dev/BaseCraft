import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { AppSettings } from '../shared/api';
import { isUiLanguage } from '../shared/i18n';
import { basePath } from './ipc-validate';
export type { AppSettings };

const file = (dir: string) => join(dir, 'settings.json');

export const MAX_RECENT = 50;
export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  locale: 'system', theme: 'system', recentFiles: [],
  defaultFolder: '', recentCount: 10, openLast: false,
  confirmRecordChanges: true, confirmDocumentDeletions: true, confirmActionQueries: true,
  openMode: 'shared', recordLocking: 'none', refreshInterval: 60, updateRetries: 2, updateRetryMs: 250,
};

const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const intIn = (lo: number, hi: number) => (v: unknown): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
/** One check per key: a value that fails it is read as the key's default. */
export const SETTING_CHECKS: { [K in keyof AppSettings]: (v: unknown) => v is AppSettings[K] } = {
  locale: (v): v is AppSettings['locale'] => v === 'system' || isUiLanguage(v),
  theme: (v): v is AppSettings['theme'] => v === 'system' || v === 'light' || v === 'dark',
  recentFiles: (v): v is string[] => Array.isArray(v) && v.every((p) => typeof p === 'string'),
  defaultFolder: (v): v is string => typeof v === 'string' && (v === '' || (v.length <= 4096 && !v.includes('\0') && isAbsolute(v))),
  recentCount: (v): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_RECENT,
  openLast: bool, confirmRecordChanges: bool, confirmDocumentDeletions: bool, confirmActionQueries: bool,
  openMode: (v): v is AppSettings['openMode'] => v === 'shared' || v === 'exclusive',
  recordLocking: (v): v is 'none' => v === 'none',
  refreshInterval: intIn(1, 32766), updateRetries: intIn(0, 10), updateRetryMs: intIn(0, 1000),
};

/** Key by key, never throws: an absent, unknown or wrong value gives the key's default (the recent list drops its non-string entries). */
export function readSettings(raw: unknown): AppSettings {
  const j = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const s: AppSettings = { ...DEFAULT_SETTINGS, recentFiles: [] };
  for (const k of Object.keys(SETTING_CHECKS) as (keyof AppSettings)[]) {
    const v = k === 'recentFiles' && Array.isArray(j[k]) ? (j[k] as unknown[]).filter((p) => typeof p === 'string').slice(0, MAX_RECENT) : j[k];
    if (SETTING_CHECKS[k](v)) Object.assign(s, { [k]: v });
  }
  return s;
}

export function loadSettings(dir: string): AppSettings {
  let raw: unknown = {};
  try { raw = JSON.parse(readFileSync(file(dir), 'utf8')); } catch { /* absent ou corrompu : valeurs par défaut */ }
  return readSettings(raw);
}

export function saveSettings(dir: string, s: AppSettings): void {
  writeFileSync(file(dir), JSON.stringify(s, null, 2), 'utf8');
}

export function addRecentFile(s: AppSettings, path: string, platform: NodeJS.Platform): AppSettings {
  const key = (p: string) => (platform === 'win32' ? p.toLowerCase() : p);
  const rest = s.recentFiles.filter((p) => key(p) !== key(path));
  return { ...s, recentFiles: [path, ...rest].slice(0, MAX_RECENT) };
}

/** The base to open when the application starts with none given (openLast): the most recent one, if it is a valid base path
 *  (absolute, .basecraft: the rule of any other open; settings.json is edited by hand) and its file is still there. `isFile` is
 *  asynchronous: the base may sit on a share that does not answer, the window must not wait on it. */
export async function lastBaseToOpen(s: AppSettings, isFile: (p: string) => Promise<boolean>): Promise<string | null> {
  const p = s.openLast ? s.recentFiles[0] : undefined;
  if (!p) return null;
  try { return (await isFile(basePath(p))) ? p : null; } catch { return null; }
}

/** Where New, Open and Save As start: the default folder if it is a folder now (settings.json is edited by hand, the folder may be gone), else Documents. */
export async function dialogDir(s: AppSettings, documents: string, isDir: (p: string) => Promise<boolean>): Promise<string> {
  if (!s.defaultFolder) return documents;
  try { return (await isDir(s.defaultFolder)) ? s.defaultFolder : documents; } catch { return documents; }
}
