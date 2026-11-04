import { afterEach, describe, expect, it, vi } from 'vitest'
import { num, str } from '../../shared/expr/library'
import type { SectionEvent } from '../../shared/report/types'
import { registerForm, type FormInstance } from '../form/form-instances'
import type { EventContext } from '../macro/engine'
import { tempVars } from '../macro/temp-vars'
import type { DocTab } from '../state/app-state'
import { pushEvent, topEvent } from './event-stack'
import { i18n } from '../i18n'
import { objectHandlers } from './object-handlers'

vi.mock('../bridge', () => ({ api: {} }))
vi.mock('../i18n', () => ({ i18n: { t: (k: string) => k, exists: () => false } }))

const offs: (() => void)[] = []
afterEach(() => { offs.splice(0).forEach((f) => f()); tempVars.clear() })

function fake(name: string, over: Partial<FormInstance> = {}): FormInstance {
  const f: FormInstance = {
    name, tabId: `t-${name}`,
    value: () => str('Dupont'), setValue: vi.fn(async () => {}), setProperty: vi.fn(), property: () => num(3), activeControl: () => 'Nom',
    goToRecord: vi.fn(async () => {}), goToControl: vi.fn(), applyFilter: vi.fn(async () => {}), showAllRecords: vi.fn(async () => {}),
    find: vi.fn(async () => true), requery: vi.fn(async () => {}), saveRecord: vi.fn(async () => {}), undoRecord: vi.fn(),
    deleteRecord: vi.fn(async () => {}), refreshRecord: vi.fn(async () => {}), ...over,
  }
  offs.push(registerForm(f))
  return f
}
const ctx = (o: Partial<EventContext> = {}): EventContext =>
  ({ object: { kind: 'form', name: 'Clients' }, event: 'OnClick', control: 'Bouton', field: () => null, cancellable: false, cancelled: false, ...o })
const h = (tab: DocTab | null = null) => objectHandlers({ projectName: () => 'Base', activeTab: () => tab })

describe('forms', () => {
  it('reads and writes values and properties, calls methods', async () => {
    const f = fake('Clients')
    const o = h()
    expect(await o['form.get']!(['Clients', 'Nom', 'value'])).toBe('Dupont')
    expect(await o['form.get']!(['Clients', 'Nom', 'width'])).toBe(3)
    await o['form.set']!(['Clients', 'Nom', 'value', { $date: '2026-01-02 03:04:05' }])
    expect(vi.mocked(f.setValue).mock.calls[0]![1]).toMatchObject({ t: 'date' })
    await o['form.set']!(['Clients', 'Nom', 'foreColor', 255])
    expect(f.setProperty).toHaveBeenCalledWith('Nom', 'foreColor', num(255))
    await o['form.do']!(['Clients', 'goToRecord', ['last', 1]])
    expect(f.goToRecord).toHaveBeenCalledWith('last', 1)
    await o['form.do']!(['Clients', 'deleteRecord', []])
    expect(f.deleteRecord).toHaveBeenCalledWith(true)
    await expect(o['form.do']!(['Clients', 'nope', []])).rejects.toMatchObject({ code: 'badArgument' })
  })
  it('names and open forms; a closed form is notOpen', async () => {
    fake('Clients')
    const o = h()
    expect(await o['forms.name']!(['clients'])).toBe('Clients')
    expect(await o['forms.name']!(['x'])).toBeNull()
    expect(await o['forms.list']!([])).toEqual(['Clients'])
    await expect(o['form.get']!(['Autre', 'a', 'value'])).rejects.toMatchObject({ code: 'notOpen' })
  })
})

describe('event stack', () => {
  it('me, cancel, report band, screen', async () => {
    const o = h()
    expect(await o['event.current']!([])).toBeNull()
    const popOuter = pushEvent(ctx())
    const inner = ctx({ object: { kind: 'form', name: 'B' }, control: undefined, cancellable: true })
    const popInner = pushEvent(inner)
    expect(await o['event.current']!([])).toEqual({ kind: 'form', name: 'B', control: null, event: 'OnClick' })
    await o['event.cancel']!([])
    expect(inner.cancelled).toBe(true)
    popInner()
    expect(await o['event.current']!([])).toEqual({ kind: 'form', name: 'Clients', control: 'Bouton', event: 'OnClick' })
    await o['event.cancel']!([])
    expect(topEvent()!.cancelled).toBe(false)
    expect(await o['screen.active']!([])).toEqual({ form: 'Clients', control: 'Bouton' })
    popOuter()
    expect(topEvent()).toBeNull()
  })
  it('report.set acts on the band of the top event', async () => {
    const o = h()
    await expect(o['report.set']!(['R', '', 'height', 2])).rejects.toMatchObject({ code: 'propertyNotSupported' })
    const band = { section: 'detail', formatCount: 1, page: 1, visible: {}, values: {}, height: 1 } as unknown as SectionEvent
    const pop = pushEvent(ctx({ object: { kind: 'report', name: 'R' }, report: band }))
    await o['report.set']!(['R', '', 'height', 2])
    expect(band.height).toBe(2)
    pop()
  })
  it('screen.active under a report event falls back to the active tab', async () => {
    fake('Clients')
    const pop = pushEvent(ctx({ object: { kind: 'report', name: 'R' }, control: undefined }))
    expect(await h({ id: 't-Clients' } as DocTab)['screen.active']!([])).toEqual({ form: 'Clients', control: 'Nom' })
    pop()
  })
  it('a bad argument names what was bad', async () => {
    fake('Clients')
    const o = h()
    vi.spyOn(i18n, 'exists').mockReturnValue(true)
    vi.spyOn(i18n, 't').mockImplementation(((k: string, p?: { name?: string }) => `${k}:${p?.name}`) as never)
    await expect(o['form.do']!(['Clients', 'nope', []])).rejects.toThrow(':nope')
    await expect(o['form.get']!(['Clients', 'Nom', 'zzz'])).rejects.toThrow(':zzz')
    vi.restoreAllMocks()
  })
  it('screen.active falls back to the active tab', async () => {
    fake('Clients')
    expect(await h({ id: 't-Clients' } as DocTab)['screen.active']!([])).toEqual({ form: 'Clients', control: 'Nom' })
  })
})

describe('tempvars and app', () => {
  it('255 names at most, case-insensitive', async () => {
    const o = h()
    await o['tempvars.set']!(['X', 5])
    expect(await o['tempvars.get']!(['x'])).toBe(5)
    for (let i = 1; i < 255; i++) await o['tempvars.set']!([`v${i}`, i])
    await expect(o['tempvars.set']!(['one more', 1])).rejects.toMatchObject({ code: 'tooManyTempVars' })
    await o['tempvars.set']!(['x', 6])
    await o['tempvars.delete']!(['X'])
    expect(await o['tempvars.get']!(['x'])).toBeNull()
    await o['tempvars.clear']!([])
    expect(await o['tempvars.names']!([])).toEqual([])
    expect(await o['app.project']!([])).toEqual({ name: 'Base' })
  })
})
