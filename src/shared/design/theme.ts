// Thème de document (lot F2) : palette de 12 emplacements en clair ET en sombre, polices de titres et de corps.
// Pur : aucune dépendance vers colors.ts ni fonts.ts (ils importent ce module), les valeurs du thème par défaut sont donc
// recopiées de colors.ts (LIGHT_THEME_HEX / DARK_THEME_HEX), vérifiées par un test.
export type ThemeSlot = 'lt1' | 'dk1' | 'lt2' | 'dk2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink' | 'folHlink';
/** Ordre du sélecteur : fonds et textes, six accents, puis liens. */
export const THEME_SLOTS: readonly ThemeSlot[] = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
export type Palette = Record<ThemeSlot, string>;
export type Mode = 'light' | 'dark';
export interface Theme {
  name: string;
  colors: { name: string; light: Palette; dark: Palette };
  fonts: { name: string; major: string; minor: string };
}
export type Variant = { mode: 'tint' | 'shade'; pct: number };

const HEX = /^#[0-9a-f]{6}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// --- Références `theme:<emplacement>[@+n | @-n]` ---

const REF = /^theme:([A-Za-z0-9]+)(?:@([+-])([1-9]\d?))?$/;

export function parseSlotRef(v: unknown): { slot: ThemeSlot; mode: 'tint' | 'shade' | null; pct: number } | null {
  const m = typeof v === 'string' ? REF.exec(v) : null;
  if (!m || !(THEME_SLOTS as readonly string[]).includes(m[1]!)) return null;
  return { slot: m[1] as ThemeSlot, mode: m[2] ? (m[2] === '+' ? 'tint' : 'shade') : null, pct: m[3] ? Number(m[3]) : 0 };
}

export const formatSlotRef = (slot: ThemeSlot, variant?: Variant): string =>
  `theme:${slot}${variant ? `@${variant.mode === 'tint' ? '+' : '-'}${variant.pct}` : ''}`;

// --- Teinte et ombre : luminance HSL, teinte et saturation conservées ---

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function fromHsl(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const ch = (t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
  };
  return '#' + [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
/** Plus clair : L + (1 - L)·t. */
export const tint = (hex: string, t: number): string => { const [h, s, l] = toHsl(hex); return fromHsl(h, s, l + (1 - l) * t); };
/** Plus sombre : L·(1 - s). */
export const shade = (hex: string, s: number): string => { const [h, sat, l] = toHsl(hex); return fromHsl(h, sat, l * (1 - s)); };

/** Les 5 lignes du sélecteur sous une couleur de palette. */
export function variantsFor(hex: string): Variant[] {
  const t = (...p: number[]): Variant[] => p.map((pct) => ({ mode: 'tint', pct }));
  const s = (...p: number[]): Variant[] => p.map((pct) => ({ mode: 'shade', pct }));
  if (hex === '#ffffff') return s(5, 15, 25, 35, 50);
  if (hex === '#000000') return t(50, 35, 25, 15, 5);
  const l = toHsl(hex)[2];
  if (l < 0.2) return t(90, 75, 50, 25, 10);
  if (l > 0.8) return s(10, 25, 50, 75, 90);
  return [...t(80, 60, 40), ...s(25, 50)];
}

// --- Thèmes intégrés ---

/** Sombre déduit du clair : les emplacements gardent leur rôle (lt1 = arrière-plan, dk1 = texte), accents éclaircis. */
export function deriveDark(l: Palette): Palette {
  return {
    lt1: l.dk1, dk1: l.lt1, lt2: tint(l.dk1, 0.08), dk2: shade(l.lt2, 0.1),
    accent1: tint(l.accent1, 0.25), accent2: tint(l.accent2, 0.25), accent3: tint(l.accent3, 0.25),
    accent4: tint(l.accent4, 0.25), accent5: tint(l.accent5, 0.25), accent6: tint(l.accent6, 0.25),
    hlink: tint(l.hlink, 0.25), folHlink: tint(l.folHlink, 0.25),
  };
}

const pal = (v: string): Palette => {
  const a = v.split(' ');
  return Object.fromEntries(THEME_SLOTS.map((s, i) => [s, a[i]!])) as Palette;
};
// Ordre : lt1 dk1 lt2 dk2 accent1..6 hlink folHlink
const mk = (name: string, light: string, major: string, minor: string, dark?: string): Theme => {
  const l = pal(light);
  return { name, colors: { name, light: l, dark: dark ? pal(dark) : deriveDark(l) }, fonts: { name, major, minor } };
};

export const BUILTIN_THEMES: readonly Theme[] = [
  // BaseCraft = l'aspect actuel (theme.css) : clair et sombre explicites.
  mk('BaseCraft', '#ffffff #1b1f27 #f2f3f5 #5f6775 #3e63dd #e5842c #2f9e6e #8e5bd1 #c8261a #c9a227 #3e63dd #7b4fbf', 'Inter', 'Inter',
    '#1a1d23 #e6e8ec #22262d #9aa1ad #7b93f7 #f0a43a #4fc08f #b08af0 #f87171 #e3c04a #7b93f7 #b08af0'),
  mk('Ardoise', '#ffffff #1f2933 #eef1f4 #52606d #2f6f9f #e07a3f #4c9a6a #8a63c7 #c24d6b #d1a62b #1d6fb8 #7a4fa3', 'Inter', 'Inter'),
  mk('Forêt', '#ffffff #1d2a22 #eef3ee #50635a #2f7d4f #b86b2d #3b8a9a #8a9a2f #a14a5a #6b5aa8 #2a7a5a #7a5a8a', 'Caladea', 'Carlito'),
  mk('Sable', '#fffdf8 #2b2418 #f4eee1 #6a5d45 #b5762f #4f7f9a #8a9a4f #b04a3a #7a5c8f #c9a227 #9a5a1f #7a4f6a', 'Liberation Serif', 'Liberation Sans'),
  mk('Océan', '#ffffff #0f2a3a #e9f2f6 #3f6073 #0f7fa8 #1f9e8f #3a5bb5 #e0703a #7a4fa8 #d1a82b #0b6fa0 #6a4f9a', 'Carlito', 'Liberation Sans'),
  mk('Prune', '#ffffff #2a1a2e #f4edf5 #6a4f70 #8e3b8f #d1495b #2f8f83 #e1a030 #4a5fb0 #5f8a3a #8e3b8f #5a3a7a', 'Liberation Serif', 'Inter'),
];
export const DEFAULT_THEME: Theme = BUILTIN_THEMES[0]!;

// --- Lecture ---

const isPalette = (v: unknown): v is Palette => isObj(v) && THEME_SLOTS.every((s) => typeof v[s] === 'string' && HEX.test(v[s] as string));
const str = (v: unknown, d: string): string => (typeof v === 'string' && v !== '' ? v : d);

export const isTheme = (v: unknown): v is Theme =>
  isObj(v) && typeof v.name === 'string' && isObj(v.colors) && typeof v.colors.name === 'string' && isPalette(v.colors.light) && isPalette(v.colors.dark)
  && isObj(v.fonts) && typeof v.fonts.name === 'string' && typeof v.fonts.major === 'string' && typeof v.fonts.minor === 'string';

const readPalette = (v: unknown, d: Palette): Palette =>
  Object.fromEntries(THEME_SLOTS.map((s) => [s, isObj(v) && typeof v[s] === 'string' && HEX.test(v[s] as string) ? v[s] : d[s]])) as Palette;

/** Tolérant, jamais d'exception : tout ce qui est invalide retombe sur le thème par défaut, emplacement par emplacement. */
export function readTheme(v: unknown): Theme {
  if (!isObj(v)) return DEFAULT_THEME;
  const d = DEFAULT_THEME, c = isObj(v.colors) ? v.colors : {}, f = isObj(v.fonts) ? v.fonts : {};
  const light = readPalette(c.light, d.colors.light);
  const dark = isObj(c.dark) ? readPalette(c.dark, d.colors.dark) : isObj(c.light) ? deriveDark(light) : d.colors.dark;
  return {
    name: str(v.name, d.name),
    colors: { name: str(c.name, d.colors.name), light, dark },
    fonts: { name: str(f.name, d.fonts.name), major: str(f.major, d.fonts.major), minor: str(f.minor, d.fonts.minor) },
  };
}

/** Thème d'un objet : `props.Theme` s'il est valide, sinon celui de la base. */
export const effectiveTheme = (docProps: Record<string, unknown>, base: Theme): Theme => (isTheme(docProps.Theme) ? docProps.Theme : base);
