import { CH } from '../shared/api';

/** What writes a base's design or structure: objects, tables, relations, imports (they create tables), startup options, the
 *  base-level files (create, Save As, Compact and Repair, Split Database), and the link dialog, the Linked Table Manager and Convert to Local
 *  Table (C1 R15: Refresh Link stays, the Runtime refreshes its links). BaseCraft Runtime never registers them (registerIpc's handle), so a
 *  call from the page rejects. Data entry is not design: rows, action queries, source saves, exports, printing, Enable Content,
 *  open and close, and every read stay. */
export const DESIGN_CHANNELS: ReadonlySet<string> = new Set([
  CH.baseCreate, CH.baseSaveAs, CH.baseCompact, CH.baseSplitPick, CH.baseSplit, CH.baseSaveStartup,
  CH.tablesSave, CH.tablesRename, CH.tablesDrop, CH.tablesCopy, CH.tablesAppend,
  CH.relationsSave, CH.relationsDelete, CH.relationsSaveLayout,
  CH.importPick, CH.importPreview, CH.importRun, CH.importExcelPick, CH.importExcelPreview, CH.importExcelRun, CH.importSaveSpec, CH.importDeleteSpec,
  CH.objectsSave, CH.objectsRename, CH.objectsDelete, CH.objectsCopy, CH.objectsSetDescription,
  CH.linksPick, CH.linksInspect, CH.linksCreate, CH.linksList, CH.linksRelink, CH.linksConvert,
]);

export const isDesignChannel = (ch: string): boolean => DESIGN_CHANNELS.has(ch);
