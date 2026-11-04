// What Python's `basecraft.ui` asks of the window (msgbox, inputbox): the bridge methods the host answers with modal dialogs.
import { showMessageBox, type MessageBoxType, type MsgBoxButtons } from '../macro/MessageBoxDialog'
import type { ModalApi } from '../shell/Modal'
import type { BridgeHandler } from './python-host'

export function uiHandlers(modal: ModalApi): Record<string, BridgeHandler> {
  return {
    'ui.msgbox': async ([prompt, buttons, title, icon]) =>
      showMessageBox(modal, { message: String(prompt), title: String(title), type: (icon ?? 'none') as MessageBoxType, buttons: buttons as MsgBoxButtons }),
    'ui.inputbox': async ([prompt, title, initial]) => // null on Cancel -> None
      modal.prompt({ titleKey: 'python.inputbox.title', params: { title: String(title) }, labelKey: 'python.inputbox.prompt', labelParams: { prompt: String(prompt) }, initial: String(initial ?? '') }),
  }
}
