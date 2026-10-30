import { describe, expect, it } from 'vitest';
import { CH } from '../shared/api';
import { DESIGN_CHANNELS, isDesignChannel } from './design-channels';

// Every other channel: data entry, reads, the window's own and the main → renderer events. A new CH key fails the test below
// until it is listed here or in DESIGN_CHANNELS (does it write the base's design or structure?).
const DATA_CHANNELS: string[] = [
  CH.getSettings, CH.setLocale, CH.setTheme, CH.setSetting, CH.pickFolder, CH.settingsChanged, CH.appInfo, CH.appLicenses, CH.appSetIcon, CH.openExternal, CH.edit, CH.beep, CH.appWriteClipboard,
  CH.closeRequested, CH.closeAllowed, CH.closeAck,
  CH.baseOpen, CH.baseClose, CH.baseState, CH.baseTakeOverLock, CH.baseStateChanged, CH.baseHostCrashed, CH.baseDataChanged, CH.baseOpenFailure,
  CH.baseEnableContent, CH.baseStartup,
  CH.tablesList, CH.tablesDesign, CH.tablesTestRules,
  CH.rowsCount, CH.rowsPage, CH.rowsInsert, CH.rowsUpdate, CH.rowsDelete, CH.rowsLookup,
  CH.relationsList, CH.relationsLayout, CH.relationsCascadeChildren,
  CH.importProgress, CH.importSpecs,
  CH.objectsList, CH.objectsGet,
  CH.sourcesDescribe, CH.sourcesPage, CH.sourcesSave, CH.sourcesAutoLookup,
  CH.queriesActionCount, CH.queriesRunAction, CH.queriesCancel,
  CH.reportsExportPdf, CH.reportsPrint, CH.exchangeExportText, CH.exchangeExportExcel,
  CH.linksRefresh, CH.linksUnlock,
];

describe('design channels', () => {
  it('every channel is design or data, never both', () => {
    for (const ch of Object.values(CH)) expect(Number(DESIGN_CHANNELS.has(ch)) + Number(DATA_CHANNELS.includes(ch)), ch).toBe(1);
    for (const ch of [...DESIGN_CHANNELS, ...DATA_CHANNELS]) expect(Object.values(CH)).toContain(ch);
    for (const ch of DATA_CHANNELS) expect(isDesignChannel(ch)).toBe(false);
  });
  it('what writes the base design is a design channel', () => {
    for (const ch of [CH.baseCreate, CH.baseSaveAs, CH.baseCompact, CH.baseSaveStartup, CH.tablesSave, CH.relationsSave, CH.importRun, CH.objectsSave, CH.objectsSetDescription])
      expect(isDesignChannel(ch)).toBe(true);
  });
  it('link design channels are design, refresh is not', () => { // R15
    for (const ch of [CH.linksPick, CH.linksInspect, CH.linksCreate, CH.linksList, CH.linksRelink, CH.linksConvert]) expect(isDesignChannel(ch)).toBe(true);
    expect(isDesignChannel(CH.linksRefresh)).toBe(false);
    expect(isDesignChannel(CH.linksUnlock)).toBe(false); // C2 R7: Runtime users unlock too
  });
});
