// Python's `db` (D2 R8): recordsets and action queries through the existing data API.
import type { QueryRef, RowWriteResult } from '../../shared/api'
import type { CellInput } from '../../shared/coerce'
import type { FieldDef } from '../../shared/field-types'
import { localeInfo } from '../../shared/locale-format'
import { toSourceRef, type RecordSourceRef, type SourceInfo } from '../../shared/record-source'
import { isSelectBody } from '../../shared/query/ast'
import { parseSql } from '../../shared/query/sql-parser'
import { sqlToWire, wireToCell } from '../../shared/python/values'
import { api } from '../bridge'
import { fieldErrorParams } from '../datasheet/record-messages'
import { i18n } from '../i18n'
import { refusalMessage } from '../query/run-action'
import { handled } from './handler-error'
import type { BridgeHandler } from './python-host'

const MAX_HANDLES = 64
type Source = { ref: RecordSourceRef; info: SourceInfo; params?: Record<string, CellInput> }
type Errors = Extract<RowWriteResult, { errors: unknown }>['errors']

const bad = (what: string): never => { throw new Error(`bc:badArgument|${what}`) }
const cells = (o: unknown): Record<string, CellInput> =>
  Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).map(([k, v]) => [k, wireToCell(v)]))

/** A refused write rejects with what the datasheet shows for its first error (dialog.error.saveRefused: “field”: message). */
function refused(errors: Errors, info?: SourceInfo): never {
  const e = errors[0]
  const fd = info?.fields.find((f) => f.name === e.field)
  const p = fieldErrorParams(e, fd as FieldDef | undefined, { lang: i18n.language.startsWith('fr') ? 'fr' : 'en', region: localeInfo('en-US') }, i18n.t.bind(i18n))
  throw new Error(`bc:saveRefused|${p.context === 'record' ? 'record' : p.field}|${p.message}`)
}
const conflict = (): never => { throw new Error(`bc:saveRefused|record|${i18n.t('macro.error.saveRefused')}`) }

export function dbHandlers(): Record<string, BridgeHandler> {
  const sources = new Map<number, Source>()   // insertion order: the oldest goes first
  let next = 1
  const source = (h: unknown): Source => sources.get(h as number) ?? bad('handle')
  const writable = (s: Source): Source => (s.info.updatable ? s : (() => { throw new Error('bc:notUpdatable') })())

  const handlers: Record<string, BridgeHandler> = {
    'db.open': async ([src, params]) => {
      const [tables, queries] = await Promise.all([api.tables.list(), api.objects.list('query')])
      const ref = toSourceRef(String(src), tables.map((t) => t.name), queries.map((q) => q.name))
      if (!ref) throw new Error(`bc:notFound|unknownSource|${src}`)
      const p = params ? cells(params) : undefined
      const info = await api.sources.describe(ref, p)
      const page = await api.sources.page(ref, { offset: 0, limit: 1, ...(p && { params: p }), fresh: true })
      if (sources.size >= MAX_HANDLES) sources.delete(sources.keys().next().value!)
      const handle = next++
      sources.set(handle, { ref, info, params: p })
      return { handle, fields: info.fields.map((f) => ({ name: f.name, type: f.type })), updatable: info.updatable, total: page.total }
    },
    'db.page': async ([h, offset, limit]) => {
      const s = source(h)
      const page = await api.sources.page(s.ref, { offset: Number(offset), limit: Number(limit), ...(s.params && { params: s.params }) })
      return { rows: page.rows.map((r) => r.map((v, i) => sqlToWire(v, s.info.fields[i]?.type))), rowids: page.rowids, total: page.total }
    },
    'db.save': async ([h, rowid, values]) => {
      const s = writable(source(h)), v = cells(values)
      if (s.ref.kind === 'table') {
        const r = rowid === null ? await api.rows.insert(s.ref.name, v) : await api.rows.update(s.ref.name, rowid as number, v)
        if (r.ok) return { rowid: r.rowid }
        return 'errors' in r ? refused(r.errors, s.info) : conflict()
      }
      const r = await api.sources.save(s.ref as QueryRef, { rowid: rowid as never, values: v })
      if (r.ok) return { rowid: r.rowid }
      return 'errors' in r ? refused(r.errors, s.info) : conflict()
    },
    'db.delete': async ([h, rowid]) => {
      const s = writable(source(h))
      const table = s.ref.kind === 'table' ? s.ref.name : s.info.keyTable ?? bad('keyTable')
      const r = await api.rows.delete(table, [rowid as never])
      if (!r.ok) refused([{ field: '', code: 'related', table: r.table }], s.info)
      return null
    },
    'db.execute': async ([sql, params]) => {
      const text = String(sql)
      let q; try { q = parseSql(text) } catch { q = null }
      if (!q || isSelectBody(q)) throw new Error('bc:runSqlSelect')
      const r = await api.queries.runAction({ kind: 'sql', sql: text }, cells(params), { skipFailures: false, replaceTable: false })
      if (r.ok) return r.count
      if (r.reason === 'rowErrors') refused(r.errors)
      const m = refusalMessage(r)
      throw Object.assign(new Error(i18n.t(m.key, m.params)), { code: r.reason, ready: true }) // the text the query dialog shows
    },
  }
  return Object.fromEntries(Object.entries(handlers).map(([k, f]) => [k, handled(f)]))
}
