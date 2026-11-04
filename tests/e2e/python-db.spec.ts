// D2 Task 6: Python recordsets and db.execute against a real base.
import { test, expect, type Page } from '@playwright/test'
import { createTable } from '../../src/main/db/schema'
import { insertRow } from '../../src/main/db/write-layer'
import { localeInfo } from '../../src/shared/locale-format'
import { f, t } from '../../src/shared/test-fixtures'
import { launchApp, seedBase } from './helpers'

type W = { __bcPython: { immediate(line: string): Promise<string> }; basecraft: { rows: { page(t: string, r: { offset: number; limit: number }): Promise<{ rows: { values: unknown[] }[] }> } } }
const imm = (page: Page, line: string) => page.evaluate((l) => (window as unknown as W).__bcPython.immediate(l), line)
const rejection = (page: Page, line: string) =>
  page.evaluate(async (l) => { try { await (window as unknown as W).__bcPython.immediate(l); return null } catch (e) { return String((e as Error).message) } }, line)
const rowsOf = (page: Page) => page.evaluate(() => (window as unknown as W).basecraft.rows.page('Commandes', { offset: 0, limit: 100 }).then((p) => p.rows.map((r) => r.values)))

const commandes = t('Commandes', [
  f('Id', 'autoNumber'), f('Client', 'shortText', { required: true }), f('Montant', 'currency'), f('Date', 'dateTime'), f('Payee', 'yesNo'),
])

test('Python recordsets: read, add/update/delete, execute, Required refusal, to_pandas', async () => {
  test.setTimeout(240_000)
  const base = await seedBase('pydb', async (db) => {
    createTable(db, commandes)
    for (const [c, m] of [['A', 10], ['B', 20.5], ['C', 30]] as const) await insertRow(db, commandes, { Client: c, Montant: m, Date: '2026-01-02', Payee: false }, localeInfo('en-US'))
  })
  const { app, page } = await launchApp({ args: [base] })
  try {
    await expect.poll(() => page.evaluate(() => (window as unknown as { basecraft: { base: { state(): Promise<unknown> } } }).basecraft.base.state().then(Boolean))).toBe(true)
    expect(await imm(page, '?sum(r["Montant"] for r in db.open_recordset("Commandes"))')).toBe('60.5')

    await imm(page, 'import datetime; rs = db.open_recordset("Commandes")')
    await imm(page, 'rs.add({"Client": "D", "Montant": 5, "Date": datetime.datetime(2026, 3, 4, 5, 6, 7), "Payee": True})')
    expect(await imm(page, '?len(db.open_recordset("Commandes"))')).toBe('4')
    expect(await imm(page, '?[r["Date"] for r in rs if r["Client"] == "D"][0]')).toContain('2026-03-04 05:06:07')
    expect(await imm(page, '?[r["Payee"] for r in rs if r["Client"] == "D"][0]')).toBe('True')
    expect(await imm(page, '?[r["Date"] for r in rs if r["Client"] == "A"][0]')).toContain('2026-01-02 00:00:00')
    await imm(page, 'for r in rs:\n    if r["Client"] == "A": r.update({"Montant": 11})')
    await imm(page, 'for r in rs:\n    if r["Client"] == "B": r.delete()')
    const rows = await rowsOf(page)
    expect(rows.map((r) => r[1])).toEqual(['A', 'C', 'D'])
    expect(rows[0][2]).toBe(11)

    expect(await imm(page, '?db.execute("UPDATE Commandes SET Payee = True")')).toBe('3')
    expect((await rowsOf(page)).every((r) => r[4] === -1 || r[4] === 1 || r[4] === true)).toBe(true)

    expect(await rejection(page, 'rs.add({"Montant": 1})')).toMatch(/Client/)
    expect(await imm(page, '?len(db.open_recordset("Commandes"))')).toBe('3')

    await imm(page, 'import pandas')
    expect(await imm(page, '?len(db.open_recordset("Commandes").to_pandas())')).toBe('3')
  } finally { await app.close() }
})
