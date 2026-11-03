// A synchronous copy of the workstation settings for code that is not under App (keyboard handlers read it on each key, never over IPC).
import type { AppSettings } from '../shared/api';
import { AUTO_INDEX_DEFAULT } from '../shared/auto-index';
import type { FieldDefaults } from '../shared/field-types';
import type { UiLanguage } from '../shared/i18n';
import type { PageSetup } from '../shared/report/model';
import { DEFAULT_SETTINGS } from '../shared/settings-defaults';
import { currentBaseOptions } from './shell/startup';

let current: AppSettings & { uiLanguage?: UiLanguage } = DEFAULT_SETTINGS;
/** DEFAULT_SETTINGS until App publishes. */
export function currentSettings(): AppSettings & { uiLanguage?: UiLanguage } { return current; }
/** App calls it wherever it sets its own settings state. Also sets the designer font variables (O3 R7: they apply at once). */
export function publishSettings(s: AppSettings & { uiLanguage?: UiLanguage }): void {
  current = s;
  if (typeof document === 'undefined') return;
  const st = document.documentElement.style;
  st.setProperty('--bc-sheet-font', `${(s.propertySheetFontSize * 4) / 3}px`);
  st.setProperty('--bc-qd-font', `${(s.queryFontSize * 4) / 3}px`);
  st.setProperty('--bc-qd-font-family', `"${s.queryFontName}", var(--bc-font)`);
}
/** Four-digit year (O2 R11): on for every database or for this one. */
export function fourDigitYear(): boolean { return current.fourDigitYearAll || currentBaseOptions().fourDigitYear; }
/** What a new field takes (O3 R3). */
export function fieldDefaults(): FieldDefaults { return { type: current.defaultFieldType, textSize: current.defaultTextSize, numberSize: current.defaultNumberSize }; }
/** The AutoIndex list: the typed one, else the UI language's default. */
export function autoIndexList(): string { return current.autoIndex ?? AUTO_INDEX_DEFAULT[current.uiLanguage ?? 'en']; }
/** Default margins of a new report (O3 R9). */
export function printMargins(): PageSetup['margins'] {
  return { top: current.printMarginTop, right: current.printMarginRight, bottom: current.printMarginBottom, left: current.printMarginLeft };
}
