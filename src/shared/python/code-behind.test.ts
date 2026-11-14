import { describe, expect, it } from 'vitest'
import { codeBehindModule, isCodeBehind, procedureName } from './code-behind'
import { isModuleName } from './module-def'

describe('code-behind names', () => {
  it('module and procedure names are Python names', () => {
    expect(codeBehindModule('form', 'Nom client')).toBe('Form_Nom_client')
    expect(isModuleName(codeBehindModule('report', 'État 1'))).toBe(true)
    expect(isCodeBehind('Report_X') && !isCodeBehind('Outils')).toBe(true)
    expect(procedureName('form', 'OnClick', 'Nom')).toBe('Nom_Click')
    expect(procedureName('form', 'BeforeUpdate')).toBe('Form_BeforeUpdate')
    expect(procedureName('report', 'OnFormat', 'GroupHeader0')).toBe('GroupHeader0_Format')
  })
})
