// The Python `docmd` surface (D2 R7), shared by the docmd host and the module editor's completions.
import { ACTIONS } from '../macro/catalog'

/** Never reachable from `docmd` (Python has its own way); the replacement is named in the error. */
export const REFUSED: Record<string, string> = {
  cancelevent: 'docmd.cancel_event()', clearmacroerror: 'try/except around the call', onerror: 'try/except',
  removealltempvars: 'tempvars.clear()', removetempvar: 'del tempvars[name]', runmacro: 'docmd.run_macro(name)',
  setlocalvar: 'a Python variable', settempvar: 'tempvars[name] = value', setvalue: 'the control value (forms.F.C.value = v)',
  messagebox: 'msgbox()', stopallmacros: 'return or raise', stopmacro: 'return or raise', runcode: 'a direct call of the function',
}
export const norm = (s: string): string => s.replace(/_/g, '').toLowerCase()
const snake = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase()

/** Every allowed `docmd` name: the catalog's actions in snake_case minus the refused ones, plus `close`, `cancel_event`, `run_macro`. */
export const DOCMD_NAMES: readonly string[] = [
  ...ACTIONS.filter((a) => !REFUSED[norm(a.name)]).map((a) => snake(a.name)), 'close', 'cancel_event', 'run_macro',
]
/** The `Form` methods of src/python/basecraft/objects.py. */
export const FORM_METHODS: readonly string[] = ['requery', 'go_to_record', 'go_to_control', 'save_record', 'undo_record', 'delete_record', 'refresh_record', 'apply_filter', 'show_all_records']
