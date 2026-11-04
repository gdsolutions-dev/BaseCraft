import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  tables: { list: vi.fn() }, objects: { list: vi.fn() },
  sources: { describe: vi.fn(), page: vi.fn(), save: vi.fn() },
  rows: { insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  queries: { runAction: vi.fn() },
}))
vi.mock('../bridge', () => ({ api }))
vi.mock('../i18n', () => ({
  i18n: { language: 'en', exists: (k: string) => /^dialog\.error\.(notFound|badArgument|notUpdatable|runSqlSelect|saveRefused|saveRefused_record)$/.test(k),
    t: (k: string, p?: Record<string, string>) => `${k}${p ? JSON.stringify(p) : ''}` },
}))
import { dbHandlers } from './db-handlers'

const fields = [{ name: 'Id', type: 'autoNumber', props: {} }, { name: 'Montant', type: 'currency', props: {} },
  { name: 'Date', type: 'dateTime', props: {} }, { name: 'Payee', type: 'yesNo', props: {} }]
const info = (over = {}) => ({ fields, updatable: true, parameters: [], ...over })
let h: ReturnType<typeof dbHandlers>
beforeEach(() => {
  vi.clearAllMocks()
  api.tables.list.mockResolvedValue([{ name: 'Commandes' }])
  api.objects.list.mockResolvedValue([{ name: 'RCommandes' }])
  api.sources.describe.mockResolvedValue(info())
  api.sources.page.mockResolvedValue({ rows: [], rowids: [], total: 3 })
  h = dbHandlers()
})
const open = async (src: string) => (await h['db.open']!([src, null])) as { handle: number; fields: { name: string; type: string }[]; updatable: boolean; total: number }

describe('db handlers', () => {
  it('open resolves a table, a query, SQL; unknown is notFound', async () => {
    const r = await open('commandes')
    expect(api.sources.describe).toHaveBeenLastCalledWith({ kind: 'table', name: 'Commandes' }, undefined)
    expect(r).toMatchObject({ fields: [{ name: 'Id', type: 'autoNumber' }, { name: 'Montant', type: 'currency' }, { name: 'Date', type: 'dateTime' }, { name: 'Payee', type: 'yesNo' }], updatable: true, total: 3 })
    await open('RCommandes')
    expect(api.sources.describe).toHaveBeenLastCalledWith({ kind: 'query', name: 'RCommandes' }, undefined)
    await open('SELECT * FROM Commandes')
    expect(api.sources.describe).toHaveBeenLastCalledWith({ kind: 'sql', sql: 'SELECT * FROM Commandes' }, undefined)
    await expect(h['db.open']!(['Nope', null])).rejects.toThrow(/notFound/)
  })

  it('page converts dates and Yes/No by field type', async () => {
    const { handle } = await open('Commandes')
    api.sources.page.mockResolvedValue({ rows: [[1, 2, '2026-01-02 03:04:05', -1], [2, null, '2026-01-02', 0]], rowids: [1, 2], total: 2 })
    expect(await h['db.page']!([handle, 0, 1000])).toEqual({
      rows: [[1, 2, { $date: '2026-01-02 03:04:05' }, true], [2, null, { $date: '2026-01-02 00:00:00' }, false]], rowids: [1, 2], total: 2 })
    expect(api.sources.page).toHaveBeenLastCalledWith({ kind: 'table', name: 'Commandes' }, { offset: 0, limit: 1000 })
  })

  it('save: table update/insert, query via sources.save, refused write rejects with the datasheet text', async () => {
    const t = (await open('Commandes')).handle
    api.rows.update.mockResolvedValue({ ok: true, rowid: 7, values: [] })
    expect(await h['db.save']!([t, 7, { Montant: 2 }])).toEqual({ rowid: 7 })
    expect(api.rows.update).toHaveBeenCalledWith('Commandes', 7, { Montant: 2 })
    api.rows.insert.mockResolvedValue({ ok: true, rowid: 8, values: [] })
    expect(await h['db.save']!([t, null, { Montant: { $date: '2026-01-02 03:04:05' } }])).toEqual({ rowid: 8 })
    expect(api.rows.insert).toHaveBeenCalledWith('Commandes', { Montant: '2026-01-02 03:04:05' })
    const q = (await open('RCommandes')).handle
    api.sources.save.mockResolvedValue({ ok: true, rowid: 7, values: {} })
    expect(await h['db.save']!([q, 7, { Montant: 2 }])).toEqual({ rowid: 7 })
    expect(api.sources.save).toHaveBeenCalledWith({ kind: 'query', name: 'RCommandes' }, { rowid: 7, values: { Montant: 2 } })
    api.rows.insert.mockResolvedValue({ ok: false, errors: [{ field: 'Client', code: 'required' }] })
    await expect(h['db.save']!([t, null, {}])).rejects.toThrow(/saveRefused.*Client.*fieldError\.required/)
  })

  it('delete: table, query through its key table; not updatable refuses', async () => {
    const t = (await open('Commandes')).handle
    api.rows.delete.mockResolvedValue({ ok: true, count: 1 })
    await h['db.delete']!([t, 4])
    expect(api.rows.delete).toHaveBeenCalledWith('Commandes', [4])
    api.sources.describe.mockResolvedValue(info({ keyTable: 'Commandes' }))
    const q = (await open('RCommandes')).handle
    await h['db.delete']!([q, 5])
    expect(api.rows.delete).toHaveBeenLastCalledWith('Commandes', [5])
    api.sources.describe.mockResolvedValue(info({ updatable: false }))
    const ro = (await open('SELECT 1')).handle
    await expect(h['db.save']!([ro, null, {}])).rejects.toThrow(/notUpdatable/)
    await expect(h['db.delete']!([ro, 1])).rejects.toThrow(/notUpdatable/)
  })

  it('execute: SELECT refused, action query returns its count, rowErrors rejects', async () => {
    await expect(h['db.execute']!(['SELECT 1', {}])).rejects.toThrow(/runSqlSelect/)
    api.queries.runAction.mockResolvedValue({ ok: true, count: 4 })
    expect(await h['db.execute']!(['DELETE FROM T', {}])).toBe(4)
    expect(api.queries.runAction).toHaveBeenCalledWith({ kind: 'sql', sql: 'DELETE FROM T' }, {}, { skipFailures: false, replaceTable: false })
    api.queries.runAction.mockResolvedValue({ ok: false, reason: 'rowErrors', failed: 1, total: 1, errors: [{ field: 'Client', code: 'required' }], byCause: {} })
    await expect(h['db.execute']!(['UPDATE T SET a=1', {}])).rejects.toThrow(/saveRefused/)
  })

  it('a 65th open drops the oldest handle', async () => {
    const first = (await open('Commandes')).handle
    for (let i = 0; i < 64; i++) await open('Commandes')
    await expect(h['db.page']!([first, 0, 10])).rejects.toThrow(/badArgument/)
  })
})

describe('db.execute refusals', () => {
  it('rejects with the interface text and the reason as code', async () => {
    api.queries.runAction.mockResolvedValue({ ok: false, reason: 'related', table: 'Clients' })
    await expect(h['db.execute']!(['DELETE FROM Clients', {}])).rejects.toMatchObject({ code: 'related', message: 'query.action.related{"table":"Clients"}' })
    api.queries.runAction.mockResolvedValue({ ok: false, reason: 'readOnly' })
    await expect(h['db.execute']!(['DELETE FROM Clients', {}])).rejects.toMatchObject({ code: 'readOnly', message: 'dialog.op.readOnly{"table":""}' })
  })
})
