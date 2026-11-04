// Handler errors reach Python as BaseCraftError (D2 R5): code = the bc code, message = the error dialog's text.
import { i18n } from '../i18n'
import { bcErrorCode, errorMessage } from '../shell/Modal'
import type { BridgeHandler } from './python-host'

export function handlerError(e: unknown): Error & { code: string } {
  if (e instanceof Error && 'ready' in e) return e as unknown as Error & { code: string } // already coded and worded
  const m = errorMessage(e)
  return Object.assign(new Error(i18n.t(m.key, m.params)), { code: bcErrorCode(e) ?? 'Error' })
}

/** Wraps a D2 handler: whatever it throws becomes a coded error with the dialog's text. */
export const handled = (h: BridgeHandler): BridgeHandler => async (args) => {
  try { return await h(args) } catch (e) { throw handlerError(e) }
}
