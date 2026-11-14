// Access import (E1): the import report model and its plain-text form, shared by the main process and the renderer.
import type { ExportFailure } from './access-export';

export type ReportLevel = 'carried' | 'approximated' | 'ignored';
export type ReportCode =
  | 'tableImported'        // carried      object: table, n: rows
  | 'structureExact'      // carried      object: table — keys, indexes and field properties read from the export
  | 'relationCreated'      // carried      object: relation name
  | 'keyApproximated'     // approximated object: table, part: the Access key's fields — kept as a unique index, the AutoNumber stays the key
  | 'propertyDropped'     // ignored      object: table, part: field (absent: the table's own rule), reason: 'defaultValue' | 'validationRule' | 'inputMask' | 'lookup' | a DesignErrorCode
  | 'indexDropped'        // ignored      object: table, part: index name — over a skipped column, or refused by BaseCraft
  | 'keyAssumed'           // approximated object: table, part: the AutoNumber field taken as primary key
  | 'keyNotRead'           // approximated object: table (no AutoNumber: imported without a primary key)
  | 'relationNotEnforced'  // approximated object: relation name, reason: 'parentNotUnique' | 'violations'
  | 'structureNotRead'     // approximated without object: one line per import (indexes, rules, defaults, captions, lookups not read); with object: that table's structure was refused by its rows
  | 'fieldSkipped'         // ignored      object: table, part: column
  | 'valuesLost'           // ignored      object: table, part: field, n: values that did not fit and became empty
  | 'tableUnsupported'     // ignored      object: table, reason: a DesignErrorCode
  | 'tableLinked'          // ignored      object: a linked table of the Access file
  | 'relationIgnored'      // ignored      object: Access's relationship name, reason: 'tableNotImported' | a RelationResult reason
  | 'queryImported'       // carried      object: query's name here, part: its name in Access when it changed
  | 'queryKeptAsText'     // approximated object: query, reason: 'unknownFunction' (part: the function) | 'dataDefinition' | 'notRead' | 'notBound' — saved as SQL text
  | 'querySourceMissing'  // approximated object: query, part: the table or query it reads that was not imported
  | 'queryPassThrough'    // approximated object: query, part: the connection's kind — saved as SQL text, its source to be chosen again
  | 'querySkipped'        // ignored      object: query's name in Access, reason: 'nameInvalid' | 'duplicate' | 'unreadable'
  | 'formImported'        // carried      object: form's name here, part: its name in Access when it changed
  | 'reportImported'      // carried      same for a report
  | 'designSkipped'       // ignored      object: form or report's name in Access, reason: 'nameInvalid' | 'duplicate' | 'unreadable' | 'notRead'
  | 'designPropertiesIgnored' // ignored  object, n: property values not carried, part: `Name (count)` joined by ', '
  | 'designControlReplaced'   // approximated object, part: control, reason: its Access type — a label stands in its place
  | 'designEventDropped'  // ignored      object, part: the event or control, reason: 'procedure' | 'expression' | 'embeddedMacro'
  | 'designExpressionKept'    // approximated object, part: control (or 'grouping') — the expression is kept as written
  | 'designSectionDropped'    // ignored  object, part: Access section type
  | 'designControlRenamed'    // approximated object, part: old name, reason: new name
  | 'designPageDefault'   // approximated object: a report whose page setup was not read
  | 'designSourceMissing' // approximated object, part: a source this import did not bring (absent: the record source was not understood)
  | 'designSubformTable'  // approximated object, part: `Table.X` or `Query.X` shown by a subform
  | 'macrosOnly'          // ignored      one line per import with forms and reports: macros and modules
  | 'designsOnly'         // ignored      one line per import with forms and reports but without queries: queries, macros and modules
  | 'formsOnly'           // ignored      one line per import with queries: forms, reports, macros and modules
  | 'tablesOnly';         // ignored      one line per import without queries: queries, forms, reports, macros and modules

export const REPORT_LEVEL: Readonly<Record<ReportCode, ReportLevel>> = {
  tableImported: 'carried', relationCreated: 'carried', structureExact: 'carried',
  keyApproximated: 'approximated', propertyDropped: 'ignored', indexDropped: 'ignored',
  keyAssumed: 'approximated', keyNotRead: 'approximated', relationNotEnforced: 'approximated', structureNotRead: 'approximated',
  fieldSkipped: 'ignored', valuesLost: 'ignored', tableUnsupported: 'ignored', tableLinked: 'ignored',
  relationIgnored: 'ignored', tablesOnly: 'ignored',
  queryImported: 'carried', queryKeptAsText: 'approximated', querySourceMissing: 'approximated', queryPassThrough: 'approximated',
  querySkipped: 'ignored', formsOnly: 'ignored',
  formImported: 'carried', reportImported: 'carried', designSkipped: 'ignored', designPropertiesIgnored: 'ignored', designControlReplaced: 'approximated',
  designEventDropped: 'ignored', designExpressionKept: 'approximated', designSectionDropped: 'ignored', designControlRenamed: 'approximated',
  designPageDefault: 'approximated', designSourceMissing: 'approximated', designSubformTable: 'approximated', macrosOnly: 'ignored', designsOnly: 'ignored',
};

export interface ReportLine { code: ReportCode; object?: string; part?: string; n?: number; reason?: string }
export interface ImportReport { source: string /* the file's name, no folder */; lines: ReportLine[] }

/** `name`: the local name offered (the Access name, numbered when in use); `remote`: the Access name. */
export interface AccessImportInfo {
  tables: { name: string; remote: string; taken: false; skipped?: string[]; unsupported?: string }[];
  linked: string[]; warnSize: boolean;
  canExport: boolean; // this PC can run the export (Microsoft Access on Windows)
}
/** Where the exact structure comes from: none (the file alone), Access (the session runs the export), or an export folder `pickExport` gave. */
export type AccessStructureSource = { kind: 'file' } | { kind: 'access' } | { kind: 'folder'; dir: string };
export type AccessImportResult =
  | { ok: true; tables: { name: string; remote: string; rows: number }[]; queries: { name: string; remote: string }[];
    forms: { name: string; remote: string }[]; reports: { name: string; remote: string }[]; report: ImportReport }
  | { ok: false; reason: 'missingTables'; names: string[] } | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'export'; failure: ExportFailure };

/** The text key (after `import.report.line.`) of a line: structureNotRead with an object, and propertyDropped or indexDropped without a field or index, have their own sentence. */
export const lineKey = ({ code, object, part, reason }: ReportLine): string =>
  code === 'structureNotRead' && object !== undefined ? 'structureNotReadTable' : code === 'propertyDropped' && part === undefined ? 'propertyDroppedTable' : code === 'indexDropped' && part === undefined ? 'indexDroppedTable'
    : code === 'queryImported' && part !== undefined ? 'queryImportedAs' : code === 'formImported' && part !== undefined ? 'formImportedAs' : code === 'reportImported' && part !== undefined ? 'reportImportedAs'
    : code === 'designEventDropped' ? `designEventDropped_${reason}` : code === 'designSourceMissing' && part === undefined ? 'designSourceNotRead' : code === 'queryPassThrough' && part === undefined ? 'queryPassThroughPlain' : code;

const ORDER: ReportLevel[] = ['ignored', 'approximated', 'carried'];

/** The report as plain text: a title line with `source`, then the three levels in the order ignored, approximated, carried,
 *  each with its heading and one line per ReportLine; a level without lines is left out. Lines end with '\n'. */
export function reportText(r: ImportReport, t: (key: string, params?: Record<string, unknown>) => string): string {
  let out = `${t('import.report.title', { source: r.source })}\n`;
  for (const level of ORDER) {
    const lines = r.lines.filter((l) => REPORT_LEVEL[l.code] === level);
    if (!lines.length) continue;
    out += `${t(`import.report.level.${level}`)}\n`;
    for (const l of lines) {
      const { object, part, n, reason } = l;
      const params = Object.fromEntries(Object.entries({ object, part, n, reason }).filter(([, v]) => v !== undefined));
      out += `${t(`import.report.line.${lineKey(l)}`, params).trim()}\n`;
    }
  }
  return out;
}
