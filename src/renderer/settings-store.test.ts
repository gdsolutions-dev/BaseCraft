import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings-defaults';
import { DEFAULT_STARTUP } from '../shared/startup';
import { autoIndexList, currentSettings, fieldDefaults, fourDigitYear, printMargins, publishSettings } from './settings-store';
import { currentBaseOptions, publishBaseOptions } from './shell/startup';

describe('settings store', () => {
  it('serves the defaults until App publishes', () => {
    expect(currentSettings()).toEqual(DEFAULT_SETTINGS);
    expect(currentBaseOptions()).toEqual(DEFAULT_STARTUP);
  });
  it('four-digit year: either level', () => {
    publishSettings({ ...DEFAULT_SETTINGS }); publishBaseOptions({ ...DEFAULT_STARTUP }); expect(fourDigitYear()).toBe(false);
    publishBaseOptions({ ...DEFAULT_STARTUP, fourDigitYear: true }); expect(fourDigitYear()).toBe(true);
    publishBaseOptions({ ...DEFAULT_STARTUP }); publishSettings({ ...DEFAULT_SETTINGS, fourDigitYearAll: true }); expect(fourDigitYear()).toBe(true);
  });
});

describe('settings store (O3)', () => {
  it('AutoIndex list: the language default until one is typed', () => {
    publishSettings({ ...DEFAULT_SETTINGS, uiLanguage: 'fr' }); expect(autoIndexList()).toBe('N°;clé;code;num');
    publishSettings({ ...DEFAULT_SETTINGS, uiLanguage: 'en' }); expect(autoIndexList()).toBe('ID;key;code;num');
    publishSettings({ ...DEFAULT_SETTINGS, uiLanguage: 'fr', autoIndex: '' }); expect(autoIndexList()).toBe('');
    publishSettings({ ...DEFAULT_SETTINGS, defaultFieldType: 'number', defaultNumberSize: 'integer', defaultTextSize: 50, printMarginLeft: 1134 });
    expect(fieldDefaults()).toEqual({ type: 'number', textSize: 50, numberSize: 'integer' });
    expect(printMargins()).toEqual({ top: 360, right: 360, bottom: 360, left: 1134 });
    publishSettings(DEFAULT_SETTINGS);
  });
});
