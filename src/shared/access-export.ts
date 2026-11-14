// The folder written by resources/access-export.ps1 (batch E2), as its JSON gives it.
export interface ExportObject {
  type: 'query' | 'form' | 'report' | 'macro' | 'module'
  name: string
  file: string
  queryType?: number
  connect?: string // the connection's kind only (the part before the first ';', e.g. 'ODBC'): the rest can hold credentials
  returnsRecords?: boolean
}
export interface ExportManifest {
  format: 1
  accessVersion: string
  source: string
  objects: ExportObject[]
  errors: { type: string; name: string; message: string }[]
}
export interface ExportField {
  name: string
  type: number
  size: number
  attributes: number
  required: boolean
  allowZeroLength: boolean
  defaultValue: string
  validationRule: string
  validationText: string
  props: Record<string, string | number | boolean>
}
export interface ExportIndex {
  name: string
  primary: boolean
  unique: boolean
  foreign: boolean
  fields: { name: string; desc: boolean }[]
}
export interface ExportTable {
  name: string
  validationRule: string
  validationText: string
  description: string
  fields: ExportField[]
  indexes: ExportIndex[]
}
export interface AccessExport {
  manifest: ExportManifest
  tables: ExportTable[]
}
/** A query of an export folder, with its text. `sql` null: the file is missing, empty, over the limit or not readable. */
export interface ExportQuery { name: string; sql: string | null; queryType: number; connect: string }
/** A form or report of an export folder. `text` null: the file is missing, empty, over MAX_ACCESS_TEXT or not readable. */
export interface ExportDesign { kind: 'form' | 'report'; name: string; text: string | null }
/** A macro or a module of an export folder. `text` null: the file is missing, empty, over MAX_ACCESS_TEXT or not readable. */
export interface ExportMacro { name: string; text: string | null }
export interface ExportModule { name: string; text: string | null }
export type ExportFailure = 'noAccess' | 'cannotOpen' | 'timeout' | 'failed' | 'badFolder' | 'otherSource'
