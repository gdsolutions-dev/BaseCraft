// The user's own themes: <userData>/themes.json, `{ themes: Theme[] }`. Per-user, not in the base (applying a theme copies it).
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_THEMES, deriveDark, isTheme, type Theme } from '../shared/design/theme';

const file = (dir: string) => join(dir, 'themes.json');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A valid theme, or null. A hand-edited entry without `colors.dark` gets it derived from the light palette. */
function readEntry(e: unknown): Theme | null {
  if (isTheme(e)) return e;
  const c = (e as { colors?: { light?: unknown; dark?: unknown } } | null)?.colors;
  if (c === null || typeof c !== 'object' || c.dark !== undefined || !isTheme({ ...(e as object), colors: { ...c, dark: c.light } })) return null;
  return { ...(e as Theme), colors: { ...(e as Theme).colors, dark: deriveDark((c as Theme['colors']).light) } };
}

/** Never throws: a missing or corrupt file is `[]`, invalid entries are dropped, the first of each name (case-insensitive) is kept. */
export function readUserThemes(dir: string): Theme[] {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file(dir), 'utf8')); } catch { return []; }
  const list = (raw as { themes?: unknown } | null)?.themes;
  if (!Array.isArray(list)) return [];
  const out: Theme[] = [];
  for (const e of list) {
    const t = readEntry(e);
    if (t && validName(t.name) && !out.some((o) => same(o.name, t.name))) out.push(t);
  }
  return out;
}

/** Atomic (temporary file, then rename). */
export function writeUserThemes(dir: string, themes: Theme[]): void {
  const tmp = `${file(dir)}.tmp`;
  writeFileSync(tmp, JSON.stringify({ themes }, null, 2), 'utf8');
  renameSync(tmp, file(dir));
}

const validName = (n: string) => n === n.trim() && n.length >= 1 && n.length <= 60 && !CONTROL.test(n);

/** Saves `t` under its trimmed name. Rejects bc:invalidName, bc:themeReserved (a built-in name), bc:themeExists (unless `replace`). */
export function saveUserTheme(dir: string, t: Theme, replace: boolean): void {
  const name = t.name.trim();
  if (!validName(name)) throw new TypeError('bc:invalidName');
  if (BUILTIN_THEMES.some((b) => same(b.name, name))) throw new TypeError('bc:themeReserved');
  const rest = readUserThemes(dir).filter((o) => !same(o.name, name));
  if (!replace && rest.length !== readUserThemes(dir).length) throw new TypeError('bc:themeExists');
  writeUserThemes(dir, [...rest, { ...t, name }]);
}

export function removeUserTheme(dir: string, name: string): void {
  writeUserThemes(dir, readUserThemes(dir).filter((o) => !same(o.name, name)));
}
