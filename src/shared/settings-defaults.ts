// The workstation settings' defaults: shared because the renderer reads them before App publishes (settings-store.ts).
import type { AppSettings } from './api';

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  locale: 'system', theme: 'system', recentFiles: [],
  defaultFolder: '', recentCount: 10, openLast: false,
  confirmRecordChanges: true, confirmDocumentDeletions: true, confirmActionQueries: true,
  openMode: 'shared', recordLocking: 'none', refreshInterval: 60, updateRetries: 2, updateRetryMs: 250,
  moveAfterEnter: 'nextField', enterFieldBehavior: 'selectAll', arrowKeyBehavior: 'nextField', continuousArrowKeys: 'none', cursorStopsAtEnds: false,
  findReplaceDefault: 'fast', fourDigitYearAll: false,
  gridlinesHorizontal: true, gridlinesVertical: true, columnWidth: 1417,
  datasheetFontSize: 11, datasheetFontWeight: 400, datasheetFontUnderline: false, datasheetFontItalic: false,
  propertySheetFontSize: 8, defaultFieldType: 'shortText', defaultTextSize: 255, defaultNumberSize: 'longInteger', autoIndex: null, propertyUpdateOptions: true,
  showTableNames: true, outputAllFields: false, autoJoin: true, queryFontName: 'Segoe UI', queryFontSize: 8, selectionBehavior: 'partial',
  printMarginLeft: 360, printMarginRight: 360, printMarginTop: 360, printMarginBottom: 360,
};
