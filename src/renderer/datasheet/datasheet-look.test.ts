import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings-defaults';
import { datasheetLook } from './datasheet-look';

describe('datasheetLook', () => {
  it('11 pt is today\'s row; larger fonts grow the row', () => {
    expect(datasheetLook(DEFAULT_SETTINGS)).toMatchObject({ fontStyle: '400 14.67px', rowHeight: 30, columnPx: 1417 / 15, vertical: true, horizontal: true, underline: false });
    expect(datasheetLook({ ...DEFAULT_SETTINGS, datasheetFontSize: 20, datasheetFontWeight: 700, datasheetFontItalic: true })).toMatchObject({ fontStyle: 'italic 700 26.67px', rowHeight: 48 });
    expect(datasheetLook({ ...DEFAULT_SETTINGS, datasheetFontSize: 16 }).rowHeight).toBe(40);
  });
});
