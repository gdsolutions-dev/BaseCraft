// Couleurs des formulaires et des états (contrat 1.4, 1.5) : jeton de thème, qui suit le thème clair ou sombre, ou RVB fixe.
// Les états s'impriment toujours en clair : resolveColor(v, 'light'). Libellés : color.<jeton>.
export type ThemeColor = 'background' | 'surface' | 'surface2' | 'text' | 'textMuted' | 'border' | 'accent' | 'accentContrast' | 'danger' | 'warning';
export const THEME_COLORS: ThemeColor[] = ['background', 'surface', 'surface2', 'text', 'textMuted', 'border', 'accent', 'accentContrast', 'danger', 'warning'];
export type ColorValue = `theme:${ThemeColor}` | `#${string}`;

const CSS_VAR: Record<ThemeColor, string> = {
  background: '--bc-bg', surface: '--bc-surface', surface2: '--bc-surface-2', text: '--bc-text', textMuted: '--bc-text-muted',
  border: '--bc-border', accent: '--bc-accent', accentContrast: '--bc-accent-contrast', danger: '--bc-danger', warning: '--bc-warning',
};
/** Copies of src/renderer/theme.css (`:root`, then `[data-theme="dark"]`), checked by a test. */
export const LIGHT_THEME_HEX: Record<ThemeColor, string> = {
  background: '#f2f3f5', surface: '#ffffff', surface2: '#f7f8fa', text: '#1b1f27', textMuted: '#5f6775',
  border: '#e1e4e9', accent: '#3e63dd', accentContrast: '#ffffff', danger: '#c8261a', warning: '#b45309',
};
export const DARK_THEME_HEX: Record<ThemeColor, string> = {
  background: '#121418', surface: '#1a1d23', surface2: '#22262d', text: '#e6e8ec', textMuted: '#9aa1ad',
  border: '#2e333c', accent: '#7b93f7', accentContrast: '#0b1020', danger: '#f87171', warning: '#f0a43a',
};

const token = (v: string): ThemeColor | null =>
  v.startsWith('theme:') && (THEME_COLORS as string[]).includes(v.slice(6)) ? (v.slice(6) as ThemeColor) : null;

/** `#rrggbb` in lower case, or a known `theme:` token. */
export const isColorValue = (v: unknown): v is ColorValue => typeof v === 'string' && (/^#[0-9a-f]{6}$/.test(v) || token(v) !== null);

/** A valid value, else the caller's fallback (normally the property's catalog default), else 'transparent'. */
const valid = (v: unknown, fallback: unknown): ColorValue | null => (isColorValue(v) ? v : isColorValue(fallback) ? fallback : null);

/**
 * For the screen: a token follows the live theme through its CSS variable; `#rrggbb` as is. Total: an invalid value (an
 * external edit, '#ABCDEF', 'theme:nope', any text) gives `fallback`, never raw text into CSS.
 */
export function colorCss(v: unknown, fallback: ColorValue | 'transparent' = 'transparent'): string {
  const c = valid(v, fallback);
  if (c === null) return 'transparent';
  const t = token(c);
  return t ? `var(${CSS_VAR[t]})` : c;
}

/** A fixed `#rrggbb` for a given theme (print, PDF). Total like colorCss: 'transparent' only when nothing valid is given. */
export function resolveColor(v: unknown, theme: 'light' | 'dark', fallback: ColorValue | 'transparent' = 'transparent'): string {
  const c = valid(v, fallback);
  if (c === null) return 'transparent';
  const t = token(c);
  return t ? (theme === 'light' ? LIGHT_THEME_HEX : DARK_THEME_HEX)[t] : c;
}
