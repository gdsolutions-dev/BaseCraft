import { describe, expect, it } from 'vitest';
import { CH } from '../shared/api';
import { DESIGN_CHANNELS, isDesignChannel } from './design-channels';

// Every other channel: data entry, reads, the window's own and the main → renderer events. A new CH key fails the test below
// until it is listed here or in DESIGN_CHANNELS (does it write the base's design or structure?).
const DATA_CHANNELS: string[] = [
  CH.getSettings, CH.setLocale, CH.setTheme, CH.setSetting, CH.pickFolder, CH.settingsChanged, CH.appInfo, CH.appLicenses, CH.appSetIcon, CH.openExternal, CH.openHyperlink, CH.edit, CH.beep, CH.appWriteClipboard, CH.appReadClipboard, CH.spellPrepare,
  CH.closeRequested, CH.closeAllowed, CH.closeAck,
  CH.baseOpen, CH.baseClose, CH.baseState, CH.baseTakeOverLock, CH.baseStateChanged, CH.baseHostCrashed, CH.baseDataChanged, CH.baseOpenFailure,
  CH.baseEnableContent, CH.baseStartup, CH.baseTheme, CH.baseThemeChanged, CH.resourcesList, CH.resourcesGet, CH.resourcesChanged, CH.themesList, CH.themesSave, CH.themesRemove,
  CH.tablesList, CH.tablesDesign, CH.tablesTestRules,
  CH.rowsCount, CH.rowsPage, CH.rowsInsert, CH.rowsUpdate, CH.rowsDelete, CH.rowsLookup,
  CH.relationsList, CH.relationsLayout, CH.relationsCascadeChildren,
  CH.importProgress, CH.importSpecs,
  CH.objectsList, CH.objectsGet,
  CH.sourcesDescribe, CH.sourcesPage, CH.sourcesSave, CH.sourcesAutoLookup, CH.chartsData,
  CH.queriesActionCount, CH.queriesRunAction, CH.queriesCancel,
  CH.reportsExportPdf, CH.reportsPrint, CH.exchangeExportText, CH.exchangeExportExcel, CH.exchangeExportMarkup, CH.exchangeSavedList, CH.exchangeSavedSave, CH.exchangeSavedDelete,
  CH.linksRefresh, CH.linksUnlock, CH.linksLogin, CH.linksLoginInfo, // C4 R10: the Runtime logs in
];

describe('design channels', () => {
  it('every channel is design or data, never both', () => {
    for (const ch of Object.values(CH)) expect(Number(DESIGN_CHANNELS.has(ch)) + Number(DATA_CHANNELS.includes(ch)), ch).toBe(1);
    for (const ch of [...DESIGN_CHANNELS, ...DATA_CHANNELS]) expect(Object.values(CH)).toContain(ch);
    for (const ch of DATA_CHANNELS) expect(isDesignChannel(ch)).toBe(false);
  });
  it('what writes the base design is a design channel', () => {
    for (const ch of [CH.baseCreate, CH.baseSaveAs, CH.baseCompact, CH.baseSaveStartup, CH.baseSaveTheme, CH.baseApplyTheme, CH.tablesSave, CH.relationsSave, CH.importRun, CH.objectsSave, CH.objectsSetDescription])
      expect(isDesignChannel(ch)).toBe(true);
  });
  it('writing the gallery is design, reading it is data', () => {
  for (const ch of [CH.resourcesAdd, CH.resourcesReplace, CH.resourcesRemove]) expect(isDesignChannel(ch)).toBe(true);
  for (const ch of [CH.resourcesList, CH.resourcesGet, CH.resourcesChanged]) expect(isDesignChannel(ch)).toBe(false);
});
  it('charts.data only reads: a data channel (Runtime keeps it)', () => { expect(isDesignChannel(CH.chartsData)).toBe(false); });
  it('link design channels are design, refresh is not', () => { // R15
    for (const ch of [CH.linksPick, CH.linksInspect, CH.linksCreate, CH.linksList, CH.linksRelink, CH.linksConvert,
      CH.linksInspectServer, CH.linksCreateServer, CH.linksRelinkServer, CH.linksCanRemember]) expect(isDesignChannel(ch)).toBe(true);
    expect(isDesignChannel(CH.linksRefresh)).toBe(false);
    expect(isDesignChannel(CH.linksUnlock)).toBe(false); // C2 R7: Runtime users unlock too
  });
  it('the Access import is design (E1: absent from the Runtime)', () => {
    for (const ch of [CH.accessImportInspect, CH.accessImportRun, CH.accessImportSaveReport, CH.accessImportPickExport]) expect(isDesignChannel(ch)).toBe(true);
  });
  it('the server migration is a design channel (C7 R1: absent from the Runtime)', () => {
    expect(isDesignChannel(CH.migrateRun)).toBe(true);
    expect(isDesignChannel(CH.migrateImport)).toBe(true); // R17
  });
});
