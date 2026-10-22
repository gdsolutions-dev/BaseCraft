import i18next from 'i18next';
import fr from '../shared/i18n/fr.json';
import en from '../shared/i18n/en.json';
import type { UiLanguage } from '../shared/i18n';

export const i18n = i18next.createInstance();
void i18n.init({
  resources: { fr: { translation: fr }, en: { translation: en } },
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
