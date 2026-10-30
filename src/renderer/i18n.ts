import i18next from 'i18next';
import { catalogs } from '../shared/i18n/catalogs';
import { UI_LANGUAGES, type UiLanguage } from '../shared/i18n';

export const i18n = i18next.createInstance();
void i18n.init({
  resources: Object.fromEntries(UI_LANGUAGES.map((l) => [l, { translation: catalogs[l] }])),
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export function applyTheme(theme: 'system' | 'light' | 'dark'): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function applyUi(theme: 'system' | 'light' | 'dark', uiLanguage: UiLanguage): Promise<unknown> {
  applyTheme(theme);
  document.documentElement.lang = uiLanguage;
  return i18n.changeLanguage(uiLanguage);
}
