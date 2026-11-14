import { describe, expect, it } from 'vitest'
import type { DesignDoc } from '../../shared/design/model'
import { convertEventMacros } from './convert-events'

const macro = { embedded: { formatVersion: '1.0', items: [{ k: 'action', action: 'Beep', args: {} }] } }
const ctl = (name: string, props: Record<string, unknown>) => ({ kind: 'commandButton' as const, name, left: 0, top: 0, width: 1, height: 1, props })
const doc: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { OnLoad: macro, OnCurrent: 'Named' },
  sections: [{ kind: 'detail', height: 1, props: {}, controls: [ctl('Nom', { OnClick: macro }), ctl('Autre', { OnClick: macro })] }] }
const o = { errorHandling: false, comments: false }, env = { moduleOf: () => null }

describe('convertEventMacros', () => {
  it('turns embedded macros into procedures, leaves named macros and existing procedures', () => {
    const r = convertEventMacros(doc, 'form', '# x\n\ndef Autre_Click():\n    pass\n', o, env)!
    expect(r.converted).toBe(2)
    expect(r.skipped).toBe(1)
    expect(r.source).toMatch(/def Form_Load\(\):/)
    expect(r.source).toMatch(/def Nom_Click\(\):/)
    expect(r.source.match(/def Autre_Click/g)).toHaveLength(1)
    const d = r.edit(doc)
    expect(d.props).toMatchObject({ OnLoad: '[Event Procedure]', OnCurrent: 'Named' })
    expect(d.sections[0]!.controls.map((c) => c.props.OnClick)).toEqual(['[Event Procedure]', macro])
  })
  it('null without any embedded macro', () => {
    expect(convertEventMacros({ ...doc, props: {}, sections: [] }, 'form', '', o, env)).toBeNull()
  })
})
