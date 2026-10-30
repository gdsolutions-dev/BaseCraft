// What run code reaches of the designers (B5): only through `design` (design/entry.ts), null in BaseCraft Runtime.
import type { ObjectSummary, TableSummary } from '../../shared/api';
import type { RecordSourceRef } from '../../shared/record-source';
import type { EditListDialog } from '../datasheet/EditListDialog';
import type { ImportTextWizard } from '../import-text/ImportTextWizard';
import type { CurrentDatabaseOptions } from '../shell/CurrentDatabaseOptions';
import type { ModalApi } from '../shell/Modal';
import type { AppDispatch } from '../shell/nav-menu';
import type { CommandId } from '../shell/ribbon-model';
import type { AppAction, AppState } from '../state/app-state';
import type { FIELD_TYPES } from '../table-design/FieldPropertiesPanel';
import type { addMoreField, editValidation, moreFieldsFor, setDataType, setFormat, tableFieldsCommands } from '../table-fields/table-fields-commands';

export interface DesignHooks {
  /** The shell's design commands, moved verbatim from App's registerCommands(SHELL_SCOPE): createTableDesign, createTable,
   *  importText, importExcel, linkBaseCraft (C1), linkAccess (C2), splitDatabase (C3), relationships, createFormDesign, createBlankForm, createForm, createQueryDesign, createSqlQuery,
   *  viewSql, createReport, createReportDesign, createBlankReport, createMacro. */
  shellCommands(env: DesignShellEnv): Partial<Record<CommandId, () => void | Promise<void>>>;
  requestFieldList(kind: 'form' | 'report', name: string): void;
  ImportWizard: typeof ImportTextWizard;
  CurrentDatabaseOptions: typeof CurrentDatabaseOptions;
  tableFieldsCommands: typeof tableFieldsCommands;
  /** The Table Fields tab's menus (More Fields, Data Type, Format, Validation), shown by the datasheet. */
  FIELD_TYPES: typeof FIELD_TYPES;
  moreFieldsFor: typeof moreFieldsFor;
  addMoreField: typeof addMoreField;
  setDataType: typeof setDataType;
  setFormat: typeof setFormat;
  editValidation: typeof editValidation;
  EditListDialog: typeof EditListDialog;
}

/** The App closures those handlers read — no more. */
export interface DesignShellEnv {
  modal: ModalApi;
  dispatch: AppDispatch;
  rawDispatch(a: AppAction): void;
  t(key: string, opts?: Record<string, unknown>): string;
  live: { readonly current: { state: AppState; tables: TableSummary[]; objects: ObjectSummary[] } };
  sourceToCreate(titleKey: string): Promise<{ ref: RecordSourceRef; name: string } | null>;
  newForm(fieldList: boolean): void;
  newQueryName(): string;
  newReportName(): string;
  newMacroName(): string;
  setImporting(v: { source?: 'excel' }): void;
  /** Every document closed, each asked about its changes (as before Compact); false: one stayed. */
  closeDocuments(): Promise<boolean>;
}
