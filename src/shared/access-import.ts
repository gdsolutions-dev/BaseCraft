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
  | 'tablesOnly';          // ignored      one line per import: queries, forms, reports, macros and modules

export const REPORT_LEVEL: Readonly<Record<ReportCode, ReportLevel>> = {
  tableImported: 'carried', relationCreated: 'carried', structureExact: 'carried',
  keyApproximated: 'approximated', propertyDropped: 'ignored', indexDropped: 'ignored',
  keyAssumed: 'approximated', keyNotRead: 'approximated', relationNotEnforced: 'approximated', structureNotRead: 'approximated',
  fieldSkipped: 'ignored', valuesLost: 'ignored', tableUnsupported: 'ignored', tableLinked: 'ignored',
  relationIgnored: 'ignored', tablesOnly: 'ignored',
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
  | { ok: true; tables: { name: string; remote: string; rows: number }[]; report: ImportReport }
  | { ok: false; reason: 'missingTables'; names: string[] } | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'export'; failure: ExportFailure };

/** The text key (after `import.report.line.`) of a line: structureNotRead with an object, and propertyDropped or indexDropped without a field or index, have their own sentence. */
export const lineKey = ({ code, object, part }: ReportLine): string =>
  code === 'structureNotRead' && object !== undefined ? 'structureNotReadTable' : code === 'propertyDropped' && part === undefined ? 'propertyDroppedTable' : code === 'indexDropped' && part === undefined ? 'indexDroppedTable' : code;

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
