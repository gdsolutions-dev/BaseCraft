export const UI_LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'ja', 'zh', 'ko'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const isUiLanguage = (v: unknown): v is UiLanguage => (UI_LANGUAGES as readonly unknown[]).includes(v);

/** The system region's language when the interface has a catalog for it (zh = Simplified), English otherwise. */
export function resolveUiLanguage(setting: 'system' | UiLanguage, systemLocale: string): UiLanguage {
  if (setting !== 'system') return setting;
  const lang = systemLocale.toLowerCase().split(/[-_]/)[0];
  return isUiLanguage(lang) ? lang : 'en';
}

/** Formulas, keywords and generated texts exist in French and English only; every other interface language uses English. */
export const formulaLang = (ui: string): 'fr' | 'en' => (ui === 'fr' ? 'fr' : 'en');

export function flattenKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
