import { CH } from '../shared/api';

/** What writes a base's design or structure: objects, tables, relations, imports (they create tables), startup options, the
 *  base-level files (create, Save As, Compact and Repair, Split Database), and the link dialog, the Linked Table Manager and Convert to Local
 *  Table (C1 R15: Refresh Link stays, the Runtime refreshes its links). BaseCraft Runtime never registers them (registerIpc's handle), so a
 *  call from the page rejects. Data entry is not design: rows, action queries, source saves, exports, printing, Enable Content,
 *  open and close, and every read stay. */
export const DESIGN_CHANNELS: ReadonlySet<string> = new Set([
  CH.baseCreate, CH.baseSaveAs, CH.baseCompact, CH.baseSplitPick, CH.baseSplit, CH.baseSaveStartup,
  CH.tablesSave, CH.tablesRename, CH.tablesDrop, CH.tablesCopy, CH.tablesAppend, CH.tablesSaveColumnWidths,
  CH.relationsSave, CH.relationsDelete, CH.relationsSaveLayout,
  CH.importPick, CH.importPreview, CH.importRun, CH.importExcelPick, CH.importExcelPreview, CH.importExcelRun, CH.importSaveSpec, CH.importDeleteSpec,
  CH.objectsSave, CH.objectsRename, CH.objectsDelete, CH.objectsCopy, CH.objectsSetDescription,
  CH.autoCorrectDependents, // O4 R10: asked before a rename only
  CH.autoCorrectApplyProperties, // O4 R12: writes forms and reports
  CH.linksPick, CH.linksInspect, CH.linksCreate, CH.linksList, CH.linksRelink, CH.linksConvert,
  CH.linksInspectServer, CH.linksCreateServer, CH.linksRelinkServer, CH.linksCanRemember, // C4: the server link dialog
  CH.migrateRun, CH.migrateImport, // C7 R1, R17
]);

export const isDesignChannel = (ch: string): boolean => DESIGN_CHANNELS.has(ch);
