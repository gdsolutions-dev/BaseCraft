// Contrat de window.basecraft. Les types de données sont définis ici (et réexportés par src/main/db) :
// le rendu n'a pas les types Node et ne doit rien importer du processus principal.
import type { CellInput, FieldErrorCode, SqlValue } from './coerce';
import type { DesignError, TableDesign } from './field-types';
import type { ExcelPreview, ExportResult, ExportSource, ExportTextSpec } from './exchange';
import type { ImportPlan, ImportProgress, ImportResult, ImportSpec, TextPreview } from './import-text';
import type { UiLanguage } from './i18n';
import type { RecordSourceRef, SourceInfo, SourcePage, SourcePageRequest } from './record-source';

export type { CellInput, TableDesign };
export type { RecordSourceRef, SortSpec, SourceField, SourceInfo, SourcePage, SourcePageRequest } from './record-source';

export interface LockInfo { user: string; host: string; pid: number; sessionId: string; heartbeatAt: string }
export type LocationRisk = 'local' | 'network' | 'synced';
export interface TableSummary { name: string; description?: string }
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
/** filter: one criterion per field, combined with And (at most MAX_FILTERS). */
export interface PageRequest { offset: number; limit: number; sort?: { field: string; dir: 'asc' | 'desc' }; filter?: FieldFilter[] }
export interface RowPage { rows: { rowid: number; values: SqlValue[] }[] }
/** One entry of a Lookup field's list: the stored (bound) value, and the texts shown for it. */
export interface LookupRow { value: SqlValue; display: string[] }
/** A Lookup field's list as the datasheet shows it: its visible columns' texts (the first one is the text shown), their widths
 *  in twips, and their heads with Column Heads. */
export interface LookupData { rows: LookupRow[]; widths: number[]; heads?: string[] }
export type RowWriteResult =
  | { ok: true; rowid: number; values: SqlValue[]; nulled?: { field: string; code: FieldErrorCode }[] /* WriteOptions.nullOnConversion (A3) */ }
  | { ok: false; errors: { field: string; code: FieldErrorCode; message?: string /* validationText */; table?: string }[] };

export interface AppSettings {
  locale: 'system' | 'fr' | 'en';
  theme: 'system' | 'light' | 'dark';
  recentFiles: string[];
}

/** Compact and Repair (A6): sizes in bytes; `repaired`: the problems PRAGMA integrity_check found that the copy no longer has.
 *  `corrupt`: the base could not be copied, the original is untouched (its backup made first). */
export type CompactResult = { ok: true; backupPath: string; sizeBefore: number; sizeAfter: number; repaired: string[] }
  | { ok: false; reason: 'corrupt'; problems: string[]; backupPath: string };

export interface SessionState {
  path: string;
  fileName: string;
  readOnly: boolean;
  readOnlyReason?: 'heldByOther' | 'lockLost' | 'fileReadOnly';
  lockHolder?: LockInfo;
  lockStale?: boolean;
  locationRisk: LocationRisk;
  reconcileReport?: ReconcileReport;
  migratedBackupPath?: string;
  needsRecovery?: boolean; // crashed base behind a stale lock: only takeOverLock (write open) can recover it
  /** Active content (spec 4.8): none, or disabled until enabled (trusted folder, approval, « Activer le contenu »). Absent: no base. */
  content?: ContentState;
}
/** Disabled: action queries, RunSQL and unsafe macro actions are refused (bc:contentDisabled). */
export type ContentState = 'none' | 'disabled' | 'enabled';
export interface SaveTableRequest { originalName: string | null; design: TableDesign; mapping: FieldMapping[]; allowDataLoss: boolean; acceptExistingViolations?: boolean }
export type SaveTableResult = AlterResult | { ok: false; reason: 'nameExists' | 'readOnly' };
export type OpResult = { ok: true } | { ok: false; reason: 'nameExists' | 'nameInvalid' | 'readOnly' | 'notFound' | 'hasRelations' }
  | { ok: false; reason: 'external'; table: string } // a table changed outside BaseCraft: it is never rebuilt
  | { ok: false; reason: 'referenced'; table: string } // `table` has a FOREIGN KEY (not a relation) to this table
  | { ok: false; reason: 'danglingKey'; table: string } // `table` has a FOREIGN KEY to a dropped table of the new name
  | { ok: false; reason: 'viewBroken'; view: string }; // SQLite refuses the rename: this view or trigger no longer parses
// `table` left out when the refusing table cannot be found from the data (never a table without related records).
export type DeleteResult = { ok: true; count: number } | { ok: false; reason: 'related'; table?: string };

/** Objects stored in bc_objects (format 1.2). Tables and queries share one namespace; every other kind has its own. */
export type ObjectKind = 'query' | 'form' | 'report' | 'macro' | 'module';
export interface ObjectSummary { kind: ObjectKind; name: string; description: string | null; navGroup: string | null; created: string; modified: string }
/** A record source served by A3's query engine (src/main/query/source.ts). */
export type QueryRef = Exclude<RecordSourceRef, { kind: 'table' }>;
/** An action query's run (A3, src/main/query/action.ts). `rowErrors`: rows the write layer refused (rules, Required, noParent,
 *  duplicate…), nothing written; `errors`: the first error of at most 5 of them (field '' for a delete that related records
 *  refuse); `byCause`: every refused row counted by Access's causes (conversion, key, lock, validation). `tableExists` (Make-Table without
 *  replaceTable), `related` (a delete or a replaced table refused by a related table; '' when it cannot be named),
 *  `nameExists` (Make-Table naming a query: never replaced); `hasRelations` (the table to replace has relations). */
export type ActionResult = { ok: true; count: number }
  | { ok: false; reason: 'rowErrors'; failed: number; total: number; errors: Extract<RowWriteResult, { ok: false }>['errors'];
    byCause: { conversion: number; key: number; lock: number; validation: number } }
  | { ok: false; reason: 'tableExists' | 'related' | 'nameExists'; table: string } | { ok: false; reason: 'hasRelations' | 'readOnly' }
  | { ok: false; reason: 'badColumnName'; column: string }; // Make-Table: a column name no field can take (T.F…): give it an alias
/** skipFailures: the valid rows are written when some fail (Access's "run anyway"). replaceTable: Make-Table replaces its table. */
export interface RunActionOptions { skipFailures: boolean; replaceTable: boolean }

/** joinType as in Access: 1 = matching rows only, 2 = every parent row, 3 = every child row. */
export interface Relation {
  name: string; parentTable: string; parentFields: string[]; childTable: string; childFields: string[];
  enforce: boolean; cascadeUpdate: boolean; cascadeDelete: boolean; joinType: 1 | 2 | 3;
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
// bc:exists, bc:notBasecraft, bc:newerMajor, bc:needsMigration, bc:cannotOpen (base.create/open),
// bc:readOnly (rows writes, relations layout), bc:unsupportedTable (rows.*, sources.*), bc:notFound (objects.get, sources.* on a missing table; a query's missing table or query: bc:notFound|unknownSource|<name>),
// bc:corruptObject (objects.get of a definition that is not a JSON object), bc:needsRecovery / bc:cannotOpen (data access without a
// readable connection), bc:noBase, bc:invalidArgument, bc:fontMissing / bc:writeFailed / bc:printFailed (reports.*).
// A3 (`bc:<code>|<sub-code>|<detail>`): bc:invalidQuery, bc:queryBind, bc:notSelectQuery, bc:missingParameter, bc:invalidParameter
// (sources.* of kind query or sql, objects.save of a query), bc:cancelled, bc:hostCrashed.
export const CH = {
  getSettings: 'bc:app:getSettings',
  setLocale: 'bc:app:setLocale',
  setTheme: 'bc:app:setTheme',
  appInfo: 'bc:app:info',
  appLicenses: 'bc:app:licenses',
  openExternal: 'bc:app:openExternal', // only one of AppInfo.links, never a URL made up by the renderer
  edit: 'bc:app:edit', // cut / copy / paste on the focused element of the sender
  beep: 'bc:app:beep', // the system's beep (macros: Beep, MessageBox)
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
  tablesList: 'bc:tables:list',
  tablesDesign: 'bc:tables:design',
  tablesSave: 'bc:tables:save',
  tablesRename: 'bc:tables:rename',
  tablesDrop: 'bc:tables:drop',
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
  objectsDelete: 'bc:objects:delete',
  objectsCopy: 'bc:objects:copy',
  sourcesDescribe: 'bc:sources:describe',
  sourcesPage: 'bc:sources:page',
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
  baseEnableContent: 'bc:base:enableContent',
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
  app: {
    getSettings(): Promise<AppSettings & { uiLanguage: UiLanguage; region: string }>;
    setLocale(l: AppSettings['locale']): Promise<void>;
    setTheme(t: AppSettings['theme']): Promise<void>;
    info(): Promise<AppInfo>;
    /** The third-party licence inventory shipped with the app (read by the main process, never a renderer path). */
    licenses(): Promise<LicenseEntry[]>;
    openExternal(url: string): Promise<void>;
    /** webContents.cut/copy/paste on the focused element (text fields, the datasheet's own clipboard handling). */
    edit(cmd: 'cut' | 'copy' | 'paste'): Promise<void>;
    /** The system's beep (shell.beep): the macro actions Beep and MessageBox. */
    beep(): Promise<void>;
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
    onStateChanged(cb: (s: SessionState | null) => void): () => void;
    /** The data process ended on its own: the base is closed (stateChanged null), the window says so once. */
    onHostCrashed(cb: () => void): () => void;
    /** File › Save As (A6): a checked copy of the base at the path chosen in the save dialog, which then becomes the open base
     *  (recent files). null: cancelled. Rejects bc:sameFile (the open file), bc:targetInUse (open elsewhere), bc:copyCorrupt, bc:copyFailed. Allowed read-only. */
    saveAs(): Promise<SessionState | null>;
    /** Compact and Repair (A6): the renderer has closed every document first. Rejects bc:readOnly, bc:copyFailed, bc:reopenFailed (the base is then closed). */
    compact(): Promise<CompactResult>;
    /** « Activer le contenu »: approves the base's current active content (remembered for this file and content), enables it,
     *  broadcasts the state. Allowed read-only (the approval is local). */
    enableContent(): Promise<SessionState>;
  };
  tables: {
    list(): Promise<TableSummary[]>;
    design(name: string): Promise<TableDesign>;
    save(req: SaveTableRequest): Promise<SaveTableResult>;
    rename(oldName: string, newName: string): Promise<OpResult>;
    drop(name: string): Promise<OpResult>;
    /** Structure and data, under `newName` (tables and queries share one namespace). */
    /** `mode`: 'structure' copies the design only (no rows, no relationships); default 'data' (structure and data). */
    copy(name: string, newName: string, mode?: 'structure' | 'data'): Promise<OpResult>;
    /** Access's "Append Data": fields matched by name, each row through the write layer; a refused row is skipped and counted. */
    append(from: string, to: string): Promise<{ appended: number; refused: number }>;
    /** Test Validation Rules: the fields whose rule some stored rows break (an evaluation error counts), with their count. */
    testRules(name: string): Promise<{ field: string; rows: number }[]>;
  };
  rows: {
    /** The rows `filter` keeps (all without one); a criterion that cannot be compiled rejects with bc:invalidFilter. */
    count(table: string, filter?: FieldFilter[]): Promise<number>;
    page(table: string, req: PageRequest): Promise<RowPage>;
    insert(table: string, values: Record<string, CellInput>): Promise<RowWriteResult>;
    update(table: string, rowid: number, changes: Record<string, CellInput>): Promise<RowWriteResult>;
    delete(table: string, rowids: number[]): Promise<DeleteResult>;
    /** The list of a Lookup field: at most 5000 rows of a table source, sorted on the first visible column; of a SQL or saved
     *  query Row Source (A3), in the query's order; a value list in its order. No rows when the field has no lookup, its source
     *  is gone, or its query does not run (missing table, parameters…). */
    lookup(table: string, field: string): Promise<LookupData>;
  };
  /** Relations (bc_relations); saves and deletes refused in read-only with reason readOnly, saveLayout with bc:readOnly. */
  relations: {
    list(): Promise<Relation[]>;
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
    rename(kind: ObjectKind, oldName: string, newName: string): Promise<OpResult>;
    delete(kind: ObjectKind, name: string): Promise<OpResult>;
    copy(kind: ObjectKind, name: string, newName: string): Promise<OpResult>;
    /** Properties dialog, for every Navigation Pane object: a table keeps it in its metadata (TableSummary.description), an
     *  object in bc_objects (its modified date moves). At most 255 characters (else bc:invalidArgument); '' or null removes it. */
    setDescription(kind: ObjectKind | 'table', name: string, description: string | null): Promise<OpResult>;
  };
  /** Record sources of query datasheets, forms and reports. Writes go through rows.* on keyTable when updatable.
   *  page: at most 10 000 rows and 8 sort keys; `filter` as rows.page applies it, `total` counts the filtered rows. A criterion
   *  that cannot be compiled rejects bc:invalidArgument; a missing table, sort field or filter field bc:notFound. */
  sources: { describe(ref: RecordSourceRef): Promise<SourceInfo>; page(ref: RecordSourceRef, req: SourcePageRequest): Promise<SourcePage> };
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
}
