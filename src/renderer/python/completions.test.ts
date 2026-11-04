import { describe, expect, it } from 'vitest'
import { basecraftCompletions, type CompletionCatalog } from './completions'

const cat: CompletionCatalog = {
  forms: ['Clients', 'Orders'], reports: ['Invoice'], tables: ['T1'], queries: ['Q1'], macros: ['M1'],
  controls: (f) => (f === 'Clients' ? ['Name', 'City'] : []), fields: () => [],
}
const labels = (s: string) => basecraftCompletions(s, cat)?.options.map((o) => o.label)

describe('basecraftCompletions', () => {
  it('forms and reports names', () => {
    expect(basecraftCompletions('forms["', cat)).toMatchObject({ from: 7, options: [{ label: 'Clients' }, { label: 'Orders' }] })
    expect(basecraftCompletions('x = forms.Cl', cat)).toMatchObject({ from: 10 })
    expect(labels('forms.Cl')).toContain('Clients')
    expect(labels('reports["')).toEqual(['Invoice'])
  })
  it('controls and methods of a form', () => {
    for (const s of ['forms["Clients"].', 'forms.Clients.']) expect(labels(s)).toEqual(expect.arrayContaining(['Name', 'City', 'requery', 'go_to_record']))
    expect(basecraftCompletions('forms.Clients.Na', cat)!.from).toBe(14)
  })
  it('docmd', () => {
    const l = labels('docmd.op')!
    expect(l).toEqual(expect.arrayContaining(['open_form', 'open_query', 'open_report', 'open_table', 'run_macro', 'cancel_event']))
    expect(l).not.toContain('set_value'); expect(l).not.toContain('set_temp_var')
  })
  it('strings and members', () => {
    expect(labels('db.open_recordset("')).toEqual(['T1', 'Q1'])
    expect(labels('docmd.run_macro("')).toEqual(['M1'])
    expect(labels('tempvars.')).toEqual(['keys', 'items', 'clear'])
    expect(labels('app.')).toEqual(['current_project', 'quit'])
  })
  it('nothing elsewhere', () => {
    expect(basecraftCompletions('x = 1', cat)).toBeNull()
    expect(basecraftCompletions('print("hello', cat)).toBeNull()
  })
})
