export type UiLanguage = 'fr' | 'en';

export function resolveUiLanguage(setting: 'system' | UiLanguage, systemLocale: string): UiLanguage {
  if (setting !== 'system') return setting;
  return systemLocale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function flattenKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
