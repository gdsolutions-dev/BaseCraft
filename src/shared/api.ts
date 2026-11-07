// Contrat de window.basecraft. Les types de données sont définis ici (et réexportés par src/main/db) :
// le rendu n'a pas les types Node et ne doit rien importer du processus principal.
import type { CellInput, FieldErrorCode, SqlValue } from './coerce';
import type { DesignError, TableDesign } from './field-types';
import type { ExcelPreview, ExportResult, ExportSource, ExportTextSpec } from './exchange';
import type { ImportPlan, ImportProgress, ImportResult, ImportSpec, TextPreview } from './import-text';
import type { MigrateRequest, MigrateResult, ServerImportResult } from './migrate';
import type { UiLanguage } from './i18n';
import type { FieldType, NumberSize } from './field-types';
import type { RecordSourceRef, SourceInfo, SourcePage, SourcePageRequest, SourceSaveRequest, SourceSaveResult } from './record-source';
import type { StartupOptions } from './startup';
import type { Theme } from './design/theme';

export type { CellInput, TableDesign };
export type { RecordSourceRef, SortSpec, SourceField, SourceInfo, SourcePage, SourcePageRequest, SourceSaveRequest, SourceSaveResult } from './record-source';

export interface LockInfo { user: string; host: string; pid: number; sessionId: string; heartbeatAt: string }
export type LocationRisk = 'local' | 'network' | 'synced';
/** A server source's kind (C4; C5 adds 'sqlserver'). Shared with the renderer; never in registry.ts: reading links must never
 *  load a connector (R1). */
export type ServerKind = 'postgresql' | 'sqlserver';
export const isServerKind = (k: string): k is ServerKind => k === 'postgresql' || k === 'sqlserver';
/** link.kind: a source kind ('basecraft', 'sqlite', 'access', or a server's: 'postgresql'); path: a file's resolved (R5), a server's label. */
export interface TableSummary { name: string; description?: string; link?: { kind: string; path: string } }
/** A linked file's state (C1): readOnly = readable, not writable (held by another session, read-only on disk, or a read-only front-end).
 *  needsPassword (C2 R7): a protected Access file whose password this session was not given (links.unlock). */
export type LinkState = 'ok' | 'readOnly' | 'missingFile' | 'missingTable' | 'needsMigration' | 'newerMajor' | 'cannotOpen' | 'unsupportedKind' | 'needsPassword'
  | 'syncedFolder' | 'unsupportedClient' // C3 R6: a data file refused shared mode, read-only
  | 'needsLogin' | 'cannotConnect' | 'certificate' | 'serverVersion' // C4 R17: a server source
  | 'passwordExpired'; // C5: a SQL Server login whose password expired or must be changed (18487, 18488)
/** A link in the Linked Table Manager (C1 R9): its source's path (resolved, R5; a server's label, C4 R17), kind and state; holder and stale for readOnly;
 *  shared: a data file written in shared mode (C3 R3). risk: a file's location (a server has none). params: a server's, as its connector reads
 *  them (C4 R6: never a password), the server link dialog's prefill when it is relinked. */
export interface LinkInfo { name: string; sourceId: string; kind: string; path: string; state: LinkState; holder?: LockInfo; stale?: boolean; risk?: LocationRisk; shared?: true;
  params?: Record<string, unknown>;
  /** Refresh Link of a server link that failed otherwise (a timeout, a refusal): the `bc:` error, its state cannotConnect. */
  error?: string }
/** A file to link (R7): its kind and its linkable tables; `taken`: the front-end already uses that name (R2). An Access table (C2 R6):
 *  `skipped`, its columns BaseCraft does not link (attachments, OLE objects, multivalued, binary, Date/Time Extended); `unsupported`, the DesignErrorCode that
 *  keeps it from being linked. */
export interface LinkFileInfo { kind: 'basecraft' | 'sqlite' | 'access'; tables: { name: string; taken: boolean; skipped?: string[]; unsupported?: string }[] }
/** A server's linkable tables (C4 Task 12) for its `key` (credentials) and `label`: `name`, the link name offered — R6's, else with 1, 2…
 *  appended (never one the front-end uses: `taken` stays false, the field is LinkForm's); `remote` and `schema`, the server's table;
 *  readOnly: no primary key; skipped: columns BaseCraft does not link; unsupported: the DesignErrorCode that keeps it from being linked. */
export interface ServerLinkInfo { key: string; label: string;
  tables: { name: string; remote: string; schema?: string; taken: boolean; readOnly: boolean; skipped?: string[]; unsupported?: string }[] }
/** nameExists (R2) and missingTables (R9) list the names; self: the file is the front-end itself; unsupportedKind (C4 relink):
 *  tables the server holds that BaseCraft cannot link. */
export type LinkResult = { ok: true } | { ok: false; reason: 'nameExists' | 'missingTables' | 'self' | 'readOnly' | 'unsupportedKind'; names: string[] };
export interface ReconcileReport {
  addedTables: string[];
  removedTables: string[];
  addedFields: { table: string; field: string }[];
  removedFields: { table: string; field: string }[];
  removedRelations: string[]; // a table or field of the relation is gone
  downgradedRelations: string[]; // its FOREIGN KEY was removed or replaced outside BaseCraft: kept without integrity
  updatedRelations: string[]; // changed outside BaseCraft (a table or field renamed, its FOREIGN KEY's actions): followed
}
export interface FieldMapping { name: string; sourceName: string | null } // null = nouveau champ
export type AlterResult =
  | { ok: true }
  | { ok: false; reason: 'design'; errors: DesignError[] }
  | { ok: false; reason: 'lossy'; lossyRows: number }
  | { ok: false; reason: 'required'; field: string; rows: number }
  | { ok: false; reason: 'duplicate'; field: string }
  | { ok: false; reason: 'external' }
  | { ok: false; reason: 'validationExisting'; field: string; rows: number }
  // `relation` '' : a FOREIGN KEY of another tool, no relation; `table`: the other table.
  | { ok: false; reason: 'relationField'; field: string; relation: string; table: string }
  | { ok: false; reason: 'viewBroken'; view: string } // a view or trigger of the base would no longer parse (or already does not)
  | { ok: false; reason: 'danglingKey'; table: string }; // `table` has a FOREIGN KEY to a dropped table of the new name
// Same declaration as lot A2 (datasheet filters): on merge, keep a single copy.
export interface FieldFilter { field: string; criteria: string /* canonique, mode critère */ }
export const MAX_FILTERS = 20;
/** One criterion's length (ipc-validate refuses a longer one): the Where Condition's. */
export const MAX_CRITERIA_CHARS = 65_536;
/** filter: one criterion per field, combined with And (at most MAX_FILTERS). */
export interface PageRequest { offset: number; limit: number; sort?: { field: string; dir: 'asc' | 'desc' }; filter?: FieldFilter[] }
/** A row's reference (C4 R4): a local rowid, or an opaque token of a server connector (never read outside it). NaN: none. */
export type RowRef = number | string;
export interface RowPage { rows: { rowid: RowRef; values: SqlValue[] }[] }
/** One entry of a Lookup field's list: the stored (bound) value, and the texts shown for it. */
export interface LookupRow { value: SqlValue; display: string[] }
/** A Lookup field's list as the datasheet shows it: its visible columns' texts (the first one is the text shown), their widths
 *  in twips, and their heads with Column Heads. */
export interface LookupData { rows: LookupRow[]; widths: number[]; heads?: string[] }
export type RowWriteResult =
  | { ok: true; rowid: RowRef; values: SqlValue[]; nulled?: { field: string; code: FieldErrorCode }[] /* WriteOptions.nullOnConversion (A3) */ }
  | { ok: false; errors: { field: string; code: FieldErrorCode; message?: string /* validationText */; table?: string }[] }
  | WriteConflict<SqlValue[]>;
/** An update whose record changed since editing began (C3 R8): `current` as `values` would be; deleted: the row is gone. */
export type WriteConflict<V> = { ok: false; conflict: 'changed'; current: V; rowid?: RowRef /* the current row's reference (R8) */ } | { ok: false; conflict: 'deleted' };

export interface AppSettings {
  locale: 'system' | UiLanguage;
  theme: 'system' | 'light' | 'dark';
  recentFiles: string[];
  defaultFolder: string; // '' : the Documents folder; else absolute
  recentCount: number; // how many recent files the Backstage lists, an integer 0..50
  openLast: boolean; // open the last base at startup
  confirmRecordChanges: boolean; confirmDocumentDeletions: boolean; confirmActionQueries: boolean;
  /** Default open mode of a data file (C3 R11); applies at the next opening. */
  openMode: 'shared' | 'exclusive';
  /** Default record locking: only 'none' (G2, pessimistic locking later). */
  recordLocking: 'none';
  /** Seconds between data refreshes, 1..32766. */
  refreshInterval: number;
  /** Retries of a busy update, 0..10, and the pause between them in ms, 0..1000. */
  updateRetries: number; updateRetryMs: number;
  /** O2 Editing: what Enter does, where the caret lands entering a field, what Left/Right do. */
  moveAfterEnter: 'none' | 'nextField' | 'nextRecord';
  enterFieldBehavior: 'selectAll' | 'start' | 'end';
  arrowKeyBehavior: 'nextField' | 'nextCharacter';
  /** Arrow keys that change record in continuous forms. */
  continuousArrowKeys: 'none' | 'upDown' | 'leftRight';
  cursorStopsAtEnds: boolean;
  findReplaceDefault: 'fast' | 'general' | 'startOfField';
  /** Four-digit year for every database (the database's own is in StartupOptions). */
  fourDigitYearAll: boolean;
  /** O2 Datasheet: gridlines, default column width in twips (300..31680), cell font (points 1..127, weight 100..900 by 100). */
  gridlinesHorizontal: boolean; gridlinesVertical: boolean;
  columnWidth: number;
  datasheetFontSize: number; datasheetFontWeight: number; datasheetFontUnderline: boolean; datasheetFontItalic: boolean;
  /** O3 Object Designers: property sheet font (points), new-field defaults (text size 1..255), AutoIndex list (null: the UI language's default, '' none). */
  propertySheetFontSize: 8 | 9 | 10 | 11 | 12 | 14;
  defaultFieldType: Exclude<FieldType, 'autoNumber'>; defaultTextSize: number; defaultNumberSize: NumberSize;
  autoIndex: string | null;
  /** O4 R12: offer to copy a field's changed Format or Decimal Places to the bound controls (default on). */
  propertyUpdateOptions: boolean;
  /** Query design: table names row, output all fields, AutoJoin, grid font (name, points 1..127). */
  showTableNames: boolean; outputAllFields: boolean; autoJoin: boolean;
  queryFontName: string; queryFontSize: number;
  /** Form/report marquee, and the default print margins of a new report (twips 0..5670). */
  selectionBehavior: 'partial' | 'full';
  printMarginLeft: number; printMarginRight: number; printMarginTop: number; printMarginBottom: number;
}
/** The workstation settings the renderer may write through app.setSetting (language and theme have their own channels, the recent list is the app's). */
export const SETTING_KEYS = ['defaultFolder', 'recentCount', 'openLast', 'confirmRecordChanges', 'confirmDocumentDeletions', 'confirmActionQueries', 'openMode', 'recordLocking', 'refreshInterval', 'updateRetries', 'updateRetryMs',
  'moveAfterEnter', 'enterFieldBehavior', 'arrowKeyBehavior', 'continuousArrowKeys', 'cursorStopsAtEnds', 'findReplaceDefault', 'fourDigitYearAll',
  'gridlinesHorizontal', 'gridlinesVertical', 'columnWidth', 'datasheetFontSize', 'datasheetFontWeight', 'datasheetFontUnderline', 'datasheetFontItalic',
  'propertySheetFontSize', 'defaultFieldType', 'defaultTextSize', 'defaultNumberSize', 'autoIndex', 'propertyUpdateOptions', 'showTableNames', 'outputAllFields', 'autoJoin', 'queryFontName', 'queryFontSize',
  'selectionBehavior', 'printMarginLeft', 'printMarginRight', 'printMarginTop', 'printMarginBottom'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
/** What getSettings returns and settingsChanged carries: the settings and the language and region they resolve to. */
export type SettingsView = AppSettings & { uiLanguage: UiLanguage; region: string };

/** Compact and Repair (A6): sizes in bytes; `repaired`: the problems PRAGMA integrity_check found that the copy no longer has.
 *  `corrupt`: the base could not be copied, the original is untouched (its backup made first). */
export type CompactResult = { ok: true; backupPath: string; sizeBefore: number; sizeAfter: number; repaired: string[] }
  | { ok: false; reason: 'corrupt'; problems: string[]; backupPath: string };
/** Split Database (C3 R12): the tables moved to `dataFile`, the original's backup. `noTables`: no local table to move; `self`: the
 *  data file chosen is the open base. */
export type SplitResult = { ok: true; tables: string[]; dataFile: string; backupPath: string } | { ok: false; reason: 'noTables' | 'readOnly' | 'self' };

export interface SessionState {
  path: string;
  /** basename(origin ?? path). */
  fileName: string;
  /** The Runtime opened a local copy (`path`) of this front-end on a share (C3 R14). */
  origin?: string;
  readOnly: boolean;
  /** inUse: exclusive open mode on a data file others use; syncedFolder / unsupportedClient: shared mode refused (C3 R6). */
  readOnlyReason?: 'heldByOther' | 'lockLost' | 'fileReadOnly' | 'inUse' | 'syncedFolder' | 'unsupportedClient';
  lockHolder?: LockInfo;
  lockStale?: boolean;
  locationRisk: LocationRisk;
  reconcileReport?: ReconcileReport;
  migratedBackupPath?: string;
  needsRecovery?: boolean; // crashed base behind a stale lock: only takeOverLock (write open) can recover it
  /** Active content (spec 4.8): none, or disabled until enabled (trusted folder, approval, « Activer le contenu »). Absent: no base. */
  content?: ContentState;
  /** Base paths whose lock this session holds for its links (C1 R4), and its presence entry when shared (C3 R2): the main
   *  process beats them and releases them. */
  linkedLocks?: string[];
  /** The base is a data file (C3 R1): no network banner. */
  dataFile?: true;
  /** Open in shared mode (a presence entry, no exclusive lock). */
  shared?: true;
  /** inUse: those present. */
  users?: LockInfo[];
}
/** Disabled: action queries, RunSQL and unsafe macro actions are refused (bc:contentDisabled). */
export type ContentState = 'none' | 'disabled' | 'enabled';
export interface SaveTableRequest { originalName: string | null; design: TableDesign; mapping: FieldMapping[]; allowDataLoss: boolean; acceptExistingViolations?: boolean }
/** Property update options (O4 R12): a control of a form or report that carries its own value of a changed field property. */
export interface PropertyTarget { kind: 'form' | 'report'; name: string; control: string; current: string }
export interface PropertyUpdate { table: string; field: string; prop: 'Format' | 'DecimalPlaces'; value: string; targets: PropertyTarget[] }
export type PropertyItem = { kind: 'form' | 'report'; name: string; control: string; prop: PropertyUpdate['prop']; value: string };
export type SaveTableResult = { ok: true; autoCorrect?: AutoCorrectReport; propertyUpdates?: PropertyUpdate[] } | Exclude<AlterResult, { ok: true }> | { ok: false; reason: 'nameExists' | 'readOnly' };
export type OpResult = { ok: true } | { ok: false; reason: 'nameExists' | 'nameInvalid' | 'readOnly' | 'notFound' | 'hasRelations' | 'badModuleName' }
  | { ok: false; reason: 'external'; table: string } // a table changed outside BaseCraft: it is never rebuilt
  | { ok: false; reason: 'referenced'; table: string } // `table` has a FOREIGN KEY (not a relation) to this table
  | { ok: false; reason: 'danglingKey'; table: string } // `table` has a FOREIGN KEY to a dropped table of the new name
  | { ok: false; reason: 'viewBroken'; view: string }; // SQLite refuses the rename: this view or trigger no longer parses
// `table` left out when the refusing table cannot be found from the data (never a table without related records).
export type DeleteResult = { ok: true; count: number } | { ok: false; reason: 'related'; table?: string };

/** Objects stored in bc_objects (format 1.2). Tables and queries share one namespace; every other kind has its own. */
export type ObjectKind = 'query' | 'form' | 'report' | 'macro' | 'module';
/** An object of the base, tables included (O4: Name AutoCorrect). */
export type ObjRef = { kind: ObjectKind | 'table'; name: string };
/** A rename Name AutoCorrect follows (O4): an object's, or fields of a table in one save. */
export type NameChange =
  | { k: 'object'; kind: ObjectKind | 'table'; from: string; to: string }
  | { k: 'fields'; table: string /* its name after the same save's rename */; renames: { from: string; to: string }[] };
/** What Name AutoCorrect did for a rename (O4 R2): names after the change; `stale`, with Effectuer off, the dependents left
 *  on the old name; `logTable`, the log table created or written (R9), or with `logSkipped` the name found without its fields. */
export interface AutoCorrectReport { corrected: ObjRef[]; failed: ObjRef[]; stale: ObjRef[]; logTable?: string; logSkipped?: true }
export type RenameResult = { ok: true; autoCorrect?: AutoCorrectReport } | Exclude<OpResult, { ok: true }>;
/** The log table's texts in the UI language (R9): its name, its seven fields in order, the object types, the failure text. */
export interface LogLabels { table: string; fields: [string, string, string, string, string, string, string];
  kinds: Record<Exclude<ObjectKind, 'module'> | 'table', string>; failed: Record<'unreadable' | 'meaning' | 'dependency', string> }
export interface ObjectSummary { kind: ObjectKind; name: string; description: string | null; navGroup: string | null; created: string; modified: string }
/** A record source served by A3's query engine (src/main/query/source.ts). */
export type QueryRef = Exclude<RecordSourceRef, { kind: 'table' }>;
/** An action query's run (A3, src/main/query/action.ts). `rowErrors`: rows the write layer refused (rules, Required, noParent,
 *  duplicate…), nothing written; `errors`: the first error of at most 5 of them (field '' for a delete that related records
 *  refuse); `byCause`: every refused row counted by Access's causes (conversion, key, lock, validation). `tableExists` (Make-Table without
 *  replaceTable), `related` (a delete or a replaced table refused by a related table; '' when it cannot be named),
 *  `nameExists` (Make-Table naming a query: never replaced); `hasRelations` (the table to replace has relations). */
export type ActionResult = { ok: true; count: number }
  | { ok: false; reason: 'rowErrors'; failed: number; total: number; errors: Extract<RowWriteResult, { errors: unknown }>['errors'];
    byCause: { conversion: number; key: number; lock: number; validation: number } }
  | { ok: false; reason: 'tableExists' | 'related' | 'nameExists'; table: string } | { ok: false; reason: 'hasRelations' | 'readOnly' }
  | { ok: false; reason: 'badColumnName'; column: string }; // Make-Table: a column name no field can take (T.F…): give it an alias
/** skipFailures: the valid rows are written when some fail (Access's "run anyway"). replaceTable: Make-Table replaces its table. */
export interface RunActionOptions { skipFailures: boolean; replaceTable: boolean }

/** joinType as in Access: 1 = matching rows only, 2 = every parent row, 3 = every child row. */
export interface Relation {
  name: string; parentTable: string; parentFields: string[]; childTable: string; childFields: string[];
  enforce: boolean; cascadeUpdate: boolean; cascadeDelete: boolean; joinType: 1 | 2 | 3;
  linked?: true; // C1 R11: read from a linked file, between two of its linked tables; never saved
}
export type RelationResult = { ok: true; relation: Relation }
  | { ok: false; reason: 'fieldsMismatch' | 'typesMismatch' | 'parentNotUnique' | 'readOnly' | 'nameExists' | 'nameInvalid' | 'sameTable' }
  | { ok: false; reason: 'external'; table: string }
  | { ok: false; reason: 'duplicate'; relation: string } // `relation` already joins the same fields of the same tables
  | { ok: false; reason: 'violations'; rows: number };
/** A table that a delete of parent rows changes through its real FOREIGN KEY: CASCADE deletes, SET NULL / SET DEFAULT modify. */
export interface CascadeChild { table: string; effect: 'deleted' | 'modified' }
export interface RelationsLayout { tables: Record<string, { x: number; y: number }> }

// Errors cross IPC as rejections whose message contains `bc:<code>`:
// bc:exists, bc:notBasecraft, bc:newerMajor, bc:needsMigration, bc:needsDesigner (the Runtime never migrates), bc:cannotOpen (base.create/open),
// bc:readOnly (rows writes, relations layout), bc:unsupportedTable (rows.*, sources.*), bc:notFound (objects.get, sources.* on a missing table; a query's missing table or query: bc:notFound|unknownSource|<name>),
// bc:corruptObject (objects.get of a definition that is not a JSON object), bc:needsRecovery / bc:cannotOpen (data access without a
// readable connection), bc:noBase, bc:invalidArgument, bc:badIcon (app.setWindowIcon; also thrown by the renderer's iconPng), bc:fontMissing / bc:writeFailed / bc:printFailed (reports.*).
// A3 (`bc:<code>|<sub-code>|<detail>`): bc:invalidQuery, bc:queryBind, bc:notSelectQuery, bc:missingParameter, bc:invalidParameter
// (sources.* of kind query or sql, objects.save of a query), bc:cancelled, bc:hostCrashed.
export const CH = {
  getSettings: 'bc:app:getSettings',
  setLocale: 'bc:app:setLocale',
  setTheme: 'bc:app:setTheme',
  setSetting: 'bc:app:setSetting', // one of SETTING_KEYS, validated key by key (bc:invalidArgument)
  pickFolder: 'bc:app:pickFolder', // a folder chosen in the system dialog (null: cancelled)
  settingsChanged: 'bc:app:settingsChanged', // main → renderer: every settings write, with the SettingsView
  appInfo: 'bc:app:info',
  appLicenses: 'bc:app:licenses',
  appSetIcon: 'bc:app:setIcon', // the window icon: a small PNG the renderer re-encoded, or null for BaseCraft's (bc:badIcon)
  openExternal: 'bc:app:openExternal', // only one of AppInfo.links, never a URL made up by the renderer
  edit: 'bc:app:edit', // cut / copy / paste on the focused element of the sender
  beep: 'bc:app:beep', // the system's beep (macros: Beep, MessageBox)
  appWriteClipboard: 'bc:app:writeClipboard', // C3 R9: Write Conflict › Copy to Clipboard (a string of at most 10 MB)
  closeRequested: 'bc:app:closeRequested', // main → renderer: the window is asked to close
  closeAllowed: 'bc:app:closeAllowed', // renderer → main: every document agreed, close for real
  closeAck: 'bc:app:closeAck', // renderer → main: the close request arrived (the renderer is not hung)
  baseCreate: 'bc:base:create',
  baseOpen: 'bc:base:open',
  baseClose: 'bc:base:close',
  baseState: 'bc:base:state',
  baseTakeOverLock: 'bc:base:takeOverLock',
  baseStateChanged: 'bc:base:stateChanged',
  baseHostCrashed: 'bc:base:hostCrashed', // main → renderer: the data process ended on its own (A3)
  baseDataChanged: 'bc:base:dataChanged', // main → renderer: another workstation wrote (C3 R10, the refresh interval)
  baseOpenFailure: 'bc:base:openFailure', // the window's single question at startup: did the base the system gave open?
  tablesList: 'bc:tables:list',
  tablesDesign: 'bc:tables:design',
  tablesSave: 'bc:tables:save',
  tablesRename: 'bc:tables:rename',
  tablesDrop: 'bc:tables:drop',
  tablesSaveColumnWidths: 'bc:tables:saveColumnWidths',
  tablesTestRules: 'bc:tables:testRules',
  rowsCount: 'bc:rows:count',
  rowsPage: 'bc:rows:page',
  rowsInsert: 'bc:rows:insert',
  rowsUpdate: 'bc:rows:update',
  rowsDelete: 'bc:rows:delete',
  rowsLookup: 'bc:rows:lookup',
  relationsList: 'bc:relations:list',
  relationsSave: 'bc:relations:save',
  relationsDelete: 'bc:relations:delete',
  relationsLayout: 'bc:relations:layout',
  relationsSaveLayout: 'bc:relations:saveLayout',
  relationsCascadeChildren: 'bc:relations:cascadeChildren',
  importPick: 'bc:importText:pick',
  importPreview: 'bc:importText:preview',
  importRun: 'bc:importText:run',
  importProgress: 'bc:importText:progress', // main → renderer, during run
  importExcelPick: 'bc:importExcel:pick',
  importExcelPreview: 'bc:importExcel:preview',
  importExcelRun: 'bc:importExcel:run',
  importSpecs: 'bc:importText:specs',
  importSaveSpec: 'bc:importText:saveSpec',
  importDeleteSpec: 'bc:importText:deleteSpec',
  tablesCopy: 'bc:tables:copy',
  tablesAppend: 'bc:tables:append',
  objectsList: 'bc:objects:list',
  objectsGet: 'bc:objects:get',
  objectsSave: 'bc:objects:save',
  objectsRename: 'bc:objects:rename',
  autoCorrectDependents: 'bc:autoCorrect:dependents',
  autoCorrectApplyProperties: 'bc:autoCorrect:applyProperties',
  objectsDelete: 'bc:objects:delete',
  objectsCopy: 'bc:objects:copy',
  sourcesDescribe: 'bc:sources:describe',
  sourcesPage: 'bc:sources:page',
  sourcesSave: 'bc:sources:save',
  sourcesAutoLookup: 'bc:sources:autoLookup',
  objectsSetDescription: 'bc:objects:setDescription',
  queriesActionCount: 'bc:queries:actionCount',
  queriesRunAction: 'bc:queries:runAction',
  queriesCancel: 'bc:queries:cancel',
  reportsExportPdf: 'bc:reports:exportPdf',
  reportsPrint: 'bc:reports:print',
  exchangeExportText: 'bc:exchange:exportText', // progress: importProgress
  exchangeExportExcel: 'bc:exchange:exportExcel',
  baseSaveAs: 'bc:base:saveAs',
  baseCompact: 'bc:base:compact',
  baseSplitPick: 'bc:base:splitPick',
  baseSplit: 'bc:base:split',
  baseEnableContent: 'bc:base:enableContent',
  baseStartup: 'bc:base:startup',
  baseSaveStartup: 'bc:base:saveStartup',
  baseTheme: 'bc:base:theme',
  baseSaveTheme: 'bc:base:saveTheme',
  baseApplyTheme: 'bc:base:applyTheme',
  themesList: 'bc:themes:list',
  themesSave: 'bc:themes:save',
  themesRemove: 'bc:themes:remove',
  baseThemeChanged: 'bc:base:themeChanged', // main → renderer: the base's default theme was saved (open views refetch)
  linksPick: 'bc:links:pick',
  linksInspect: 'bc:links:inspect',
  linksCreate: 'bc:links:create',
  linksList: 'bc:links:list',
  linksRefresh: 'bc:links:refresh',
  linksRelink: 'bc:links:relink',
  linksConvert: 'bc:links:convert',
  linksUnlock: 'bc:links:unlock',
  linksLogin: 'bc:links:login',
  linksLoginInfo: 'bc:links:loginInfo',
  linksInspectServer: 'bc:links:inspectServer',
  linksCreateServer: 'bc:links:createServer',
  linksRelinkServer: 'bc:links:relinkServer',
  linksCanRemember: 'bc:links:canRemember',
  migrateRun: 'bc:migrate:run', // progress: importProgress
  migrateImport: 'bc:migrate:import', // R17, the same progress
} as const;

/** A report document to print or export (renderDocumentHtml); `name` names the PDF file proposed. */
export interface PrintRequest { html: string; name: string; landscape: boolean }
/** The longest `PrintRequest.html` main accepts; the renderer checks it before sending (report.tooLarge). */
export const MAX_PRINT_HTML_CHARS = 64 * 1024 ** 2;

/** Shown in File › About. The links are the only URLs the renderer may ask the main process to open. */
export interface AppInfo {
  version: string;
  electron: string; chromium: string; node: string; sqlite: string;
  platform: string; arch: string;
  copyright: string; licence: string;
  links: { homepage: string; issues: string; licence: string };
}

/** One line of the licence inventory (scripts/licenses.mjs). */
export interface LicenseEntry { name: string; version: string; license: string }

export interface BasecraftApi {
  /** True in an e2e run (never in a packaged app): the page may expose test hooks. */
  e2e: boolean;
  app: {
    getSettings(): Promise<SettingsView>;
    setLocale(l: AppSettings['locale']): Promise<void>;
    setTheme(t: AppSettings['theme']): Promise<void>;
    setSetting<K extends SettingKey>(k: K, v: AppSettings[K]): Promise<void>;
    /** A folder chosen in the system dialog, or null when cancelled. */
    pickFolder(): Promise<string | null>;
    /** Every settings write (language, theme, options, recent files) reaches the window with the new SettingsView. */
    onSettingsChanged(cb: (s: SettingsView) => void): () => void;
    info(): Promise<AppInfo>;
    /** The third-party licence inventory shipped with the app (read by the main process, never a renderer path). */
    licenses(): Promise<LicenseEntry[]>;
    openExternal(url: string): Promise<void>;
    /** The window's icon (Windows, Linux; macOS: nothing): a PNG of at most 256 x 256 px and 1 MiB that the renderer decoded and
     *  re-encoded, or null for BaseCraft's. Rejects bc:badIcon for a PNG the main process reads as empty or too large. */
    setWindowIcon(png: Uint8Array | null): Promise<void>;
    /** webContents.cut/copy/paste on the focused element (text fields, the datasheet's own clipboard handling). */
    edit(cmd: 'cut' | 'copy' | 'paste'): Promise<void>;
    /** The system's beep (shell.beep): the macro actions Beep and MessageBox. */
    beep(): Promise<void>;
    /** The system clipboard's text (C3 R9: the edited record of a Write Conflict). Rejects bc:invalidArgument beyond 10 MB. */
    writeClipboard(text: string): Promise<void>;
    /** The window's close button (or the system) asks to close: the documents get their say, then confirmClose().
     *  Without a subscriber, the close is confirmed at once. */
    onCloseRequested(cb: () => void): () => void;
    confirmClose(): Promise<void>;
  };
  base: {
    create(): Promise<SessionState | null>;
    open(path?: string): Promise<SessionState | null>;
    close(): Promise<void>;
    state(): Promise<SessionState | null>;
    takeOverLock(): Promise<SessionState | null>;
    /** The base the system gave this process (command line, file association) could not be opened: its `bc:<code>` error, once
     *  (the window shows it as an Open's, in the error dialog); null: none was given, or it opened. Waits for that opening to end. */
    openFailure(): Promise<string | null>;
    onStateChanged(cb: (s: SessionState | null) => void): () => void;
    /** The data process ended on its own: the base is closed (stateChanged null), the window says so once. */
    onHostCrashed(cb: () => void): () => void;
    /** Another workstation (or connection) wrote to the base or its linked files since the last refresh interval (C3 R10). */
    onDataChanged(cb: () => void): () => void;
    /** File › Save As (A6): a checked copy of the base at the path chosen in the save dialog, which then becomes the open base
     *  (recent files). null: cancelled. Rejects bc:sameFile (the open file), bc:targetInUse (open elsewhere), bc:copyCorrupt, bc:copyFailed. Allowed read-only. */
    saveAs(): Promise<SessionState | null>;
    /** Compact and Repair (A6): the renderer has closed every document first. Rejects bc:readOnly, bc:copyFailed, bc:reopenFailed (the base is then closed). */
    compact(): Promise<CompactResult>;
    /** Split Database (C3 R13): the data file's path, chosen in the save dialog (the base's folder, `<name>_donnees.basecraft`
     *  proposed); null: cancelled. */
    splitPick(): Promise<string | null>;
    /** Split Database (C3 R12) to `path` (a path splitPick returned): the renderer has closed every document first. Rejects
     *  bc:targetInUse (as Save As), bc:copyCorrupt, bc:copyFailed. */
    split(path: string): Promise<SplitResult>;
    /** « Activer le contenu »: approves the base's current active content (remembered for this file and content), enables it,
     *  broadcasts the state. Allowed read-only (the approval is local). */
    enableContent(): Promise<SessionState>;
    /** The base's startup options (B3), read tolerantly: a wrong or newer value reads as the default. Allowed read-only. */
    startup(): Promise<StartupOptions>;
    /** Saves the six options (the other keys of the stored section are kept). Rejects bc:readOnly. */
    saveStartup(o: StartupOptions): Promise<void>;
  };
  /** Default theme of the base (F2). */
  theme: {
    /** Tolerant read (invalid or absent = the built-in theme). Allowed read-only. */
    get(): Promise<Theme>;
    /** Rejects bc:invalidTheme (not a theme) and bc:readOnly. */
    set(t: Theme): Promise<void>;
    /** Makes `t` the default and removes the saved override of every form or report except those in `openNames` (open documents
     *  clear theirs by an edit), in one transaction. Rejects bc:invalidTheme, bc:invalidArgument and bc:readOnly. */
    applyToAll(t: Theme, kind: 'form' | 'report', openNames: string[]): Promise<{ cleared: number }>;
    /** The default changed (set by this window): open views refetch with get(). */
    onChange(cb: () => void): () => void;
  };
  /** The user's own themes (F2b), kept per user in <userData>/themes.json (never in the base; works read-only). */
  themes: {
    list(): Promise<Theme[]>;
    /** Rejects bc:invalidTheme, bc:invalidName (trimmed, 1..60 characters, no control character), bc:themeReserved (a built-in name,
     *  case-insensitive) and bc:themeExists (same name, case-insensitive, unless `replace`). */
    save(t: Theme, replace?: boolean): Promise<void>;
    remove(name: string): Promise<void>;
  };
  tables: {
    list(): Promise<TableSummary[]>;
    design(name: string): Promise<TableDesign>;
    save(req: SaveTableRequest): Promise<SaveTableResult>;
    rename(oldName: string, newName: string): Promise<RenameResult>;
    drop(name: string): Promise<OpResult>;
    /** Structure and data, under `newName` (tables and queries share one namespace). */
    /** `mode`: 'structure' copies the design only (no rows, no relationships); default 'data' (structure and data). */
    copy(name: string, newName: string, mode?: 'structure' | 'data'): Promise<OpResult>;
    /** Access's "Append Data": fields matched by name, each row through the write layer; a refused row is skipped and counted. */
    append(from: string, to: string): Promise<{ appended: number; refused: number }>;
    /** Test Validation Rules: the fields whose rule some stored rows break (an evaluation error counts), with their count. */
    testRules(name: string): Promise<{ field: string; rows: number }[]>;
    /** Datasheet column widths (twips by field name) saved in the table's fields; bc:readOnly in read-only, bc:linkedTable for a link. */
    saveColumnWidths(name: string, widths: Record<string, number>): Promise<void>;
  };
  rows: {
    /** The rows `filter` keeps (all without one); a criterion that cannot be compiled rejects with bc:invalidFilter. */
    count(table: string, filter?: FieldFilter[]): Promise<number>;
    page(table: string, req: PageRequest): Promise<RowPage>;
    insert(table: string, values: Record<string, CellInput>): Promise<RowWriteResult>;
    /** expected: the record as read when editing began, by field name (C3 R8); a change since is a conflict, nothing written. */
    update(table: string, rowid: RowRef, changes: Record<string, CellInput>, expected?: Record<string, SqlValue>): Promise<RowWriteResult>;
    delete(table: string, rowids: RowRef[]): Promise<DeleteResult>;
    /** The list of a Lookup field: at most 5000 rows of a table source, sorted on the first visible column; of a SQL or saved
     *  query Row Source (A3), in the query's order; a value list in its order. No rows when the field has no lookup, its source
     *  is gone, or its query does not run (missing table, parameters…). */
    lookup(table: string, field: string): Promise<LookupData>;
  };
  /** Relations (bc_relations); saves and deletes refused in read-only with reason readOnly, saveLayout with bc:readOnly. */
  relations: {
    /** localOnly (C1 R11, the Relationships window): the front-end's relations only, no linked file opened or locked. */
    list(opts?: { localOnly?: boolean }): Promise<Relation[]>;
    save(rel: Relation, originalName: string | null): Promise<RelationResult>;
    delete(name: string): Promise<OpResult>;
    layout(): Promise<RelationsLayout>;
    saveLayout(l: RelationsLayout): Promise<void>;
    /** Tables whose rows a delete of `table`'s rows deletes (ON DELETE CASCADE) or modifies (SET NULL, SET DEFAULT). */
    cascadeChildren(table: string): Promise<CascadeChild[]>;
  };
  /** Import d'un fichier texte : le fichier est lu par le processus principal, jamais par le rendu. Écritures : bc:readOnly. */
  importText: {
    pickFile(): Promise<string | null>;
    /** spec null : tout est détecté. */
    preview(path: string, spec: ImportSpec | null): Promise<TextPreview>;
    run(path: string, plan: ImportPlan): Promise<ImportResult>;
    onProgress(cb: (p: ImportProgress) => void): () => void;
    specs(): Promise<Record<string, ImportSpec>>;
    saveSpec(name: string, spec: ImportSpec): Promise<void>;
    deleteSpec(name: string): Promise<void>;
  };
  /** Import d'une feuille Excel (.xlsx / .xlsm, 100 Mo au plus : bc:fileTooLarge ; autre format ou fichier abîmé : bc:excelUnsupported).
   *  `sheet` null : la première ; `hasHeader` null : détecté. Même moteur, même progression que importText. */
  importExcel: {
    pickFile(): Promise<string | null>;
    preview(path: string, sheet: string | null, hasHeader: boolean | null): Promise<ExcelPreview>;
    run(path: string, sheet: string, hasHeader: boolean, plan: ImportPlan): Promise<ImportResult>;
  };
  /** Queries, forms, reports, macros, modules. Names: sameName; a query and a table cannot share a name. Writes on a
   *  read-only base resolve { ok: false, reason: 'readOnly' }. */
  objects: {
    list(kind?: ObjectKind): Promise<ObjectSummary[]>;
    /** The stored name and definition; an unknown object rejects bc:notFound. */
    get(kind: ObjectKind, name: string): Promise<{ name: string; definition: unknown }>;
    /** `definition`: a plain JSON object of at most 8 M characters and 64 levels (else bc:invalidArgument), opaque here: by
     *  convention `{ formatVersion: "1.0", ... }`, which each object kind checks with the rest of its own definition; unknown
     *  keys are kept. originalName null: new object; otherwise rewrites (and renames, when `name`
     *  differs) that object. */
    save(kind: ObjectKind, name: string, definition: unknown, originalName: string | null): Promise<OpResult>;
    rename(kind: ObjectKind, oldName: string, newName: string): Promise<RenameResult>;
    delete(kind: ObjectKind, name: string): Promise<OpResult>;
    copy(kind: ObjectKind, name: string, newName: string): Promise<OpResult>;
    /** Properties dialog, for every Navigation Pane object: a table keeps it in its metadata (TableSummary.description), an
     *  object in bc_objects (its modified date moves). At most 255 characters (else bc:invalidArgument); '' or null removes it. */
    setDescription(kind: ObjectKind | 'table', name: string, description: string | null): Promise<OpResult>;
  };
  /** Name AutoCorrect (O4 R10): the objects a rename would correct or fail (names after it); [] with Suivi off. Reads only. */
  autoCorrect: {
    dependents(changes: NameChange[]): Promise<ObjRef[]>;
    /** Property update options (O4 R12): writes the values to the controls in one transaction; a missing object or control is skipped. */
    applyProperties(items: PropertyItem[]): Promise<{ ok: true; count: number } | { ok: false; reason: 'readOnly' }>;
  };
  /** Record sources of query datasheets, forms and reports. Writes go through rows.* on a table, sources.save on an updatable query (B4).
   *  page: at most 10 000 rows and 8 sort keys; `filter` as rows.page applies it, `total` counts the filtered rows. A criterion
   *  that cannot be compiled rejects bc:invalidArgument; a missing table, sort field or filter field bc:notFound. */
  sources: { describe(ref: RecordSourceRef, params?: Record<string, CellInput> /* a crosstab's (B4 R11) */): Promise<SourceInfo>; page(ref: RecordSourceRef, req: SourcePageRequest): Promise<SourcePage>;
    /** B4 R2, R3: one record of an updatable query or SQL source, the key table and its one tables in one transaction
     *  (src/main/query/join-write.ts). A read-only base rejects bc:readOnly. */
    save(ref: QueryRef, req: SourceSaveRequest): Promise<SourceSaveResult>;
    /** B4 R4: the looked-up tables' output columns for the link values in `values` (Null when no parent). Reads only. */
    autoLookup(ref: QueryRef, values: Record<string, CellInput>): Promise<Record<string, SqlValue>> };
  /** Action queries (A3). Same errors as sources.* of kind query or sql (bc:missingParameter||<name> first); a select query
   *  rejects bc:invalidArgument. actionCount: the rows the query would write and the table it writes (reads only). */
  queries: {
    actionCount(ref: QueryRef, params: Record<string, CellInput>): Promise<{ count: number; table: string }>;
    runAction(ref: QueryRef, params: Record<string, CellInput>, opts: RunActionOptions): Promise<ActionResult>;
    /** Stop: ends the call in progress (it rejects bc:cancelled; an interrupted write is rolled back) and reopens the base. */
    cancel(): Promise<void>;
  };
  /** Rendered in a hidden window that loads nothing but the document and the embedded fonts. exportPdf writes only to the
   *  path the user chose in the save dialog. Rejections: bc:fontMissing (an embedded face did not load: no PDF, no print),
   *  bc:writeFailed, bc:printFailed, bc:invalidArgument. Neither writes into the base: allowed on a read-only base. */
  reports: { exportPdf(r: PrintRequest): Promise<'saved' | 'canceled'>; print(r: PrintRequest): Promise<'printed' | 'canceled'> };
  /** Exchanges (A6). exportText: the source's rows (a table or select query, with its parameters, sort and filter) to a text file
   *  at a path chosen in the save dialog (`defaultName` proposed; closing the dialog resolves { ok: false, reason: 'cancelled' }).
   *  Rejections: bc:writeFailed (the file already there is kept), bc:notFound, bc:missingParameter|…, bc:invalidArgument (also
   *  while an import or export runs). Reads only: allowed on a read-only base. onProgress: the importText progress event. */
  exchange: {
    exportText(src: ExportSource, spec: ExportTextSpec, defaultName: string): Promise<ExportResult>;
    /** As exportText, to an .xlsx workbook (typed cells, text never a formula, a text above 32,767 characters cut and counted in
     *  `warnings.truncated`; the sheet is named after `defaultName`). Above 1,048,575 rows: { ok: false, reason: 'tooManyRows' },
     *  before the save dialog. */
    exportExcel(src: ExportSource, defaultName: string): Promise<ExportResult>;
    onProgress(cb: (p: ImportProgress) => void): () => void;
  };
  /** Linked tables (C1). pick: the link dialog's file (null: cancelled), the only path inspect, create and relink accept.
   *  inspect rejects bc:linkUnavailable|<state>|<path> (not SQLite, newer BaseCraft…). refresh reopens the sources (a stale lock
   *  is taken over, R4) and is the only one the Runtime has (R15). relink (R9): every name's table must be in the file. */
  links: {
    /** first (C2 R10): the file picker's filter shown first. */
    pick(first?: LinkFileInfo['kind']): Promise<string | null>;
    inspect(path: string): Promise<LinkFileInfo>;
    create(path: string, names: string[]): Promise<LinkResult>;
    list(): Promise<LinkInfo[]>;
    refresh(names: string[]): Promise<LinkInfo[]>;
    relink(names: string[], path: string): Promise<LinkResult>;
    /** Convert to Local Table (R12): rows the local table refuses reject bc:unsupportedTable, nothing changed. */
    convert(name: string): Promise<OpResult>;
    /** C2 R7: the password of a protected Access file (a source of the open front-end, or the file the link dialog picked), kept
     *  in the data process's memory for the session only; true when the file accepts it. Never written, never sent back. */
    unlock(path: string, password: string): Promise<boolean>;
    /** C4 R10: logs in to the server of `key` (bc:linkUnavailable|needsLogin|<key>); true when the server accepts it, then kept by
     *  the main process for the session and, when `remember` and a keyring exists, on this workstation (G2). Never sent back. */
    login(key: string, user: string, password: string, remember: boolean): Promise<boolean>;
    /** The login dialog's defaults: the stored user, else the source's; the server's label; whether « Mémoriser » is offered. */
    loginInfo(key: string): Promise<{ user: string; label: string; canRemember: boolean }>;
    /** C4 Task 12, the server link dialog: logs in with `params`' user and `password` (a refused login rejects
     *  bc:linkUnavailable|needsLogin|<key>, never prompts) and lists the server's tables; the login is then kept as `login`'s. */
    inspectServer(kind: ServerKind, params: unknown, password: string, remember: boolean): Promise<ServerLinkInfo>;
    /** Links `names`, ServerLinkInfo's offered names, of the server `params` (logged in by inspectServer). */
    createServer(kind: ServerKind, params: unknown, names: string[]): Promise<LinkResult>;
    /** Relink (R9) of server links: `names` move to the server `params`, which must hold each one's table (else nothing changes). */
    relinkServer(names: string[], kind: ServerKind, params: unknown): Promise<LinkResult>;
    /** G2: whether « Mémoriser le mot de passe » can store on this workstation (a keyring exists). */
    canRemember(): Promise<boolean>;
  };
  /** C7: Database Tools › Move Data › To a Server. run: every local table to the server of `req` (logged in by inspectServer);
   *  the renderer has closed every document first; Stop is queries.cancel (cancelled). onProgress: the importText progress
   *  event, `label` the table copied, `finishing` once Stop is no longer offered. Rejects as inspectServer before connecting. */
  migrate: {
    run(req: MigrateRequest): Promise<MigrateResult>;
    /** R17: External Data › Import › PostgreSQL / SQL Server: the tables `names` (inspectServer's) copied into local tables in one
     *  transaction; Stop is queries.cancel (cancelled). Same progress event. */
    importTables(kind: ServerKind, params: unknown, names: string[]): Promise<ServerImportResult>;
    onProgress(cb: (p: ImportProgress) => void): () => void;
  };
}
