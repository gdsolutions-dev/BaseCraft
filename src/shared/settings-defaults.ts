// The workstation settings' defaults: shared because the renderer reads them before App publishes (settings-store.ts).
import type { AppSettings } from './api';
import { DEFAULT_NEW_SORT_ORDER } from './sort-orders';
import { NO_RIBBON_CUSTOM } from './ribbon-custom';

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  locale: 'system', theme: 'system', recentFiles: [],
  defaultFolder: '', newSortOrder: DEFAULT_NEW_SORT_ORDER, recentCount: 10, openLast: false,
  confirmRecordChanges: true, confirmDocumentDeletions: true, confirmActionQueries: true,
  openMode: 'shared', recordLocking: 'none', refreshInterval: 60, updateRetries: 2, updateRetryMs: 250,
  moveAfterEnter: 'nextField', enterFieldBehavior: 'selectAll', arrowKeyBehavior: 'nextField', continuousArrowKeys: 'none', cursorStopsAtEnds: false,
  findReplaceDefault: 'fast', fourDigitYearAll: false,
  gridlinesHorizontal: true, gridlinesVertical: true, columnWidth: 1417,
  datasheetFontSize: 11, datasheetFontWeight: 400, datasheetFontUnderline: false, datasheetFontItalic: false, datasheetCellEffect: 'flat',
  propertySheetFontSize: 8, defaultFieldType: 'shortText', defaultTextSize: 255, defaultNumberSize: 'longInteger', autoIndex: null, propertyUpdateOptions: true,
  showTableNames: true, outputAllFields: false, autoJoin: true, queryFontName: 'Segoe UI', queryFontSize: 8, selectionBehavior: 'partial',
  printMarginLeft: 360, printMarginRight: 360, printMarginTop: 360, printMarginBottom: 360,
  screenTips: true, screenTipShortcuts: true, quickAccess: ['save', 'undo', 'redo'],
  ribbonCustom: NO_RIBBON_CUSTOM, formTemplate: 'Normal', reportTemplate: 'Normal',
  errorChecking: true, errorUnassociated: true, errorNewLabels: true, errorProperties: true, errorReport: true, errorShortcut: true, errorColor: '#2e9d3f',
  interfaceZoom: 100, previewZoom: 'fitPage',
  trustedLocations: [], trustNetwork: false,
};
