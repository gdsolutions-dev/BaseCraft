// The default look of a table or query datasheet (O2 R12), read once when the view opens (R1). Pure.
import type { AppSettings } from '../../shared/api';

export interface DatasheetLook {
  /** Glide's baseFontStyle: '[italic ]<weight> <px>px'. */
  fontStyle: string; fontPx: number; underline: boolean;
  rowHeight: number; columnPx: number; vertical: boolean; horizontal: boolean;
}

export function datasheetLook(s: AppSettings): DatasheetLook {
  const fontPx = +(s.datasheetFontSize * 4 / 3).toFixed(2); // pt to px
  return {
    fontStyle: `${s.datasheetFontItalic ? 'italic ' : ''}${s.datasheetFontWeight} ${fontPx}px`, fontPx, underline: s.datasheetFontUnderline,
    rowHeight: Math.max(30, Math.ceil(s.datasheetFontSize * 2) + 8), // px × 1.5, exact in points: 11 pt is today's 30
    columnPx: s.columnWidth / 15, vertical: s.gridlinesVertical, horizontal: s.gridlinesHorizontal,
  };
}
