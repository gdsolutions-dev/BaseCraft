// The Convert Macros to Python command of the form and report designers (B6).
import type { DesignDoc } from '../../shared/design/model'
import { codeBehindModule } from '../../shared/python/code-behind'
import { sameName } from '../../shared/field-types'
import { api } from '../bridge'
import { askConvertOptions } from '../macro/ConvertMacrosDialog'
import { listFunctions } from '../python/function-index'
import type { ModalApi } from '../shell/Modal'
import { saveModuleSource } from './code-module'
import { convertEventMacros } from './convert-events'

export async function convertObjectMacros(a: { kind: 'form' | 'report'; name: string; doc: DesignDoc; readOnly: boolean; modal: ModalApi; edit(apply: (d: DesignDoc) => DesignDoc): void }): Promise<void> {
  const { kind, name, modal } = a
  const message = (messageKey: string, params?: Record<string, unknown>) => modal.confirm({ titleKey: 'macro.convert.title', messageKey, params, buttons: ['ok'] })
  if (a.readOnly) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'dialog.op.readOnly', buttons: ['ok'] }); return }
  const module = codeBehindModule(kind, name)
  const found = (await api.objects.list('module')).find((m) => sameName(m.name, module))
  const existing = found ? ((await api.objects.get('module', found.name)).definition as { source?: string } | null)?.source ?? '' : `# Code of the ${kind} ${name}\n`
  const probe = convertEventMacros(a.doc, kind, existing, { errorHandling: false, comments: false }, { moduleOf: () => null })
  if (!probe) { await message('macro.convertEvents.none'); return }
  const options = await askConvertOptions(modal)
  if (!options) return
  const fns = await listFunctions()
  const out = convertEventMacros(a.doc, kind, existing, options, { moduleOf: (f) => { const x = fns.find((y) => sameName(y.fn, f)); return x ? { module: x.module, fn: x.fn } : null } })!
  if (out.converted) {
    await saveModuleSource(found?.name ?? module, out.source)
    a.edit(out.edit)
  }
  await message('macro.convertEvents.done', { object: name, count: out.converted, module: found?.name ?? module })
  if (out.notes.length) await message('macro.convert.todo', { count: out.notes.length })
}
