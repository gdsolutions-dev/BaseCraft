import { describe, expect, it, vi } from 'vitest'
import type { ModalApi } from '../shell/Modal'
import { closeAnswer } from '../macro/MessageBoxDialog'
import { uiHandlers } from './ui-handlers'

describe('ui handlers', () => {
  it('closing a message box answers per R11', () => {
    expect(closeAnswer('ok')).toBe('ok')
    expect(closeAnswer('ok_cancel')).toBe('cancel')
    expect(closeAnswer('yes_no')).toBe('no')
    expect(closeAnswer('yes_no_cancel')).toBe('cancel')
    expect(closeAnswer('retry_cancel')).toBe('cancel')
    expect(closeAnswer('abort_retry_ignore')).toBe('abort')
  })

  it('ui.inputbox prompts with the default and resolves null on cancel', async () => {
    const prompt = vi.fn().mockResolvedValue(null)
    const h = uiHandlers({ prompt } as unknown as ModalApi)
    await expect(h['ui.inputbox']!(['Nom ?', 'Titre', 'x'])).resolves.toBeNull()
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      initial: 'x', titleKey: 'python.inputbox.title', params: { title: 'Titre' }, labelKey: 'python.inputbox.prompt', labelParams: { prompt: 'Nom ?' },
    }))
  })

  it('ui.msgbox shows the box and returns the answer', async () => {
    const custom = vi.fn().mockResolvedValue(null)
    const h = uiHandlers({ custom } as unknown as ModalApi)
    await expect(h['ui.msgbox']!(['Sûr ?', 'yes_no', 'T', null])).resolves.toBe('no') // closed: R11
    expect(custom).toHaveBeenCalledOnce()
  })
})
