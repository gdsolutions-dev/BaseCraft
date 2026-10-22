// Contrat de window.basecraft. Les types de données sont définis ici (et réexportés par src/main/db) :
// le rendu n'a pas les types Node et ne doit rien importer du processus principal.
import type { CellInput, FieldErrorCode, SqlValue } from './coerce';
import type { DesignError, TableDesign } from './field-types';
import type { ImportPlan, ImportProgress, ImportResult, ImportSpec, TextPreview } from './import-text';
import type { UiLanguage } from './i18n';

export type { CellInput, TableDesign };

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
  updatedRelations: string[]; // follows its FOREIGN KEY, changed outside BaseCraft (a table or field renamed, the actions)
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
export interface PageRequest { offset: number; limit: number; sort?: { field: string; dir: 'asc' | 'desc' } }
export interface RowPage { rows: { rowid: number; values: SqlValue[] }[] }
export type RowWriteResult =
  | { ok: true; rowid: number; values: SqlValue[] }
  | { ok: false; errors: { field: string; code: FieldErrorCode; message?: string /* validationText */; table?: string }[] };

export interface AppSettings {
  locale: 'system' | 'fr' | 'en';
  theme: 'system' | 'light' | 'dark';
  recentFiles: string[];
}

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
}
export interface SaveTableRequest { originalName: string | null; design: TableDesign; mapping: FieldMapping[]; allowDataLoss: boolean; acceptExistingViolations?: boolean }
export type SaveTableResult = AlterResult | { ok: false; reason: 'nameExists' | 'readOnly' };
export type OpResult = { ok: true } | { ok: false; reason: 'nameExists' | 'nameInvalid' | 'readOnly' | 'hasRelations' }
  | { ok: false; reason: 'external'; table: string } // a table changed outside BaseCraft: it is never rebuilt
  | { ok: false; reason: 'referenced'; table: string } // `table` has a FOREIGN KEY (not a relation) to this table
  | { ok: false; reason: 'danglingKey'; table: string } // `table` has a FOREIGN KEY to a dropped table of the new name
  | { ok: false; reason: 'viewBroken'; view: string }; // SQLite refuses the rename: this view or trigger no longer parses
export type DeleteResult = { ok: true; count: number } | { ok: false; reason: 'related'; table: string };

/** joinType as in Access: 1 = matching rows only, 2 = every parent row, 3 = every child row. */
export interface Relation {
  name: string; parentTable: string; parentFields: string[]; childTable: string; childFields: string[];
  enforce: boolean; cascadeUpdate: boolean; cascadeDelete: boolean; joinType: 1 | 2 | 3;
}
export type RelationResult = { ok: true; relation: Relation }
  | { ok: false; reason: 'fieldsMismatch' | 'typesMismatch' | 'parentNotUnique' | 'readOnly' | 'nameExists' | 'nameInvalid' | 'sameTable' }
  | { ok: false; reason: 'external'; table: string }
  | { ok: false; reason: 'violations'; rows: number };
export interface RelationsLayout { tables: Record<string, { x: number; y: number }> }

// Errors cross IPC as rejections whose message contains `bc:<code>`:
// bc:exists, bc:notBasecraft, bc:newerMajor, bc:needsMigration, bc:cannotOpen (base.create/open),
// bc:readOnly (rows writes, relations layout), bc:unsupportedTable (rows.*), bc:needsRecovery / bc:cannotOpen (data access without a
// readable connection), bc:noBase, bc:invalidArgument.
export const CH = {
  getSettings: 'bc:app:getSettings',
  setLocale: 'bc:app:setLocale',
  setTheme: 'bc:app:setTheme',
  closeRequested: 'bc:app:closeRequested', // main → renderer: the window is asked to close
  closeAllowed: 'bc:app:closeAllowed', // renderer → main: every document agreed, close for real
  closeAck: 'bc:app:closeAck', // renderer → main: the close request arrived (the renderer is not hung)
  baseCreate: 'bc:base:create',
  baseOpen: 'bc:base:open',
  baseClose: 'bc:base:close',
  baseState: 'bc:base:state',
  baseTakeOverLock: 'bc:base:takeOverLock',
  baseStateChanged: 'bc:base:stateChanged',
  tablesList: 'bc:tables:list',
  tablesDesign: 'bc:tables:design',
  tablesSave: 'bc:tables:save',
  tablesRename: 'bc:tables:rename',
  tablesDrop: 'bc:tables:drop',
  rowsCount: 'bc:rows:count',
  rowsPage: 'bc:rows:page',
  rowsInsert: 'bc:rows:insert',
  rowsUpdate: 'bc:rows:update',
  rowsDelete: 'bc:rows:delete',
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
  importSpecs: 'bc:importText:specs',
  importSaveSpec: 'bc:importText:saveSpec',
  importDeleteSpec: 'bc:importText:deleteSpec',
} as const;

export interface BasecraftApi {
  app: {
    getSettings(): Promise<AppSettings & { uiLanguage: UiLanguage; region: string }>;
    setLocale(l: AppSettings['locale']): Promise<void>;
    setTheme(t: AppSettings['theme']): Promise<void>;
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
    takeOverLock(): Promise<SessionState>;
    onStateChanged(cb: (s: SessionState | null) => void): () => void;
  };
  tables: {
    list(): Promise<TableSummary[]>;
    design(name: string): Promise<TableDesign>;
    save(req: SaveTableRequest): Promise<SaveTableResult>;
    rename(oldName: string, newName: string): Promise<OpResult>;
    drop(name: string): Promise<OpResult>;
  };
  rows: {
    count(table: string): Promise<number>;
    page(table: string, req: PageRequest): Promise<RowPage>;
    insert(table: string, values: Record<string, CellInput>): Promise<RowWriteResult>;
    update(table: string, rowid: number, changes: Record<string, CellInput>): Promise<RowWriteResult>;
    delete(table: string, rowids: number[]): Promise<DeleteResult>;
  };
  /** Relations (bc_relations); saves and deletes refused in read-only with reason readOnly, saveLayout with bc:readOnly. */
  relations: {
    list(): Promise<Relation[]>;
    save(rel: Relation, originalName: string | null): Promise<RelationResult>;
    delete(name: string): Promise<OpResult>;
    layout(): Promise<RelationsLayout>;
    saveLayout(l: RelationsLayout): Promise<void>;
    /** Tables whose real FOREIGN KEY to `table` has ON DELETE CASCADE: a delete of its rows deletes theirs too. */
    cascadeChildren(table: string): Promise<string[]>;
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
}
