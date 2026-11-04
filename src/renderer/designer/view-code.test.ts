import { describe, expect, it } from 'vitest'
import type { DesignDoc } from '../../shared/design/model'
import { firstPythonCall } from './view-code'

const ctl = (name: string, props: Record<string, unknown>) => ({ kind: 'commandButton' as const, name, left: 0, top: 0, width: 1, height: 1, props })
const doc = (props: Record<string, unknown>, ...controls: ReturnType<typeof ctl>[]): DesignDoc =>
  ({ formatVersion: '1.0', recordSource: null, props, sections: [{ kind: 'detail', height: 1, props: {}, controls }] })

describe('firstPythonCall', () => {
  it('selected control first, else the form, sections, controls in order, else null', () => {
    const d = doc({}, ctl('A', { OnClick: '=un()' }), ctl('B', { OnClick: '=marquer()' }))
    expect(firstPythonCall(d, { kind: 'controls', names: ['B'] })).toBe('marquer')
    expect(firstPythonCall(d, { kind: 'doc' })).toBe('un')
    expect(firstPythonCall(doc({ OnOpen: '=fo()' }, ctl('A', { OnClick: '=un()' })), { kind: 'doc' })).toBe('fo')
    expect(firstPythonCall(doc({}, ctl('A', { OnClick: 'Macro1' })), { kind: 'doc' })).toBeNull()
  })
})
