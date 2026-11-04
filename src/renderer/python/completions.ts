// Autocomplete on BaseCraft objects in the module editor (D3 R7). Pure: the line up to the cursor in, the options out.
import { DOCMD_NAMES, FORM_METHODS } from '../../shared/python/docmd-names'

export type CompletionCatalog = {
  forms: string[]; reports: string[]; tables: string[]; queries: string[]; macros: string[]
  controls(form: string): string[]; fields(source: string): string[]
}
export type Completion = { from: number; options: { label: string; type: string; detail?: string }[] }

const opts = (names: readonly string[], type: string) => names.map((label) => ({ label, type }))
const ME = ['requery', 'refresh_record', 'save_record', 'undo_record']   // methods common to forms and reports (reports have none of the record ones)
const ID = '[A-Za-z_][A-Za-z_0-9]*'

export function basecraftCompletions(before: string, cat: CompletionCatalog): Completion | null {
  const at = (m: RegExpMatchArray, group: number) => before.length - m[group].length
  let m: RegExpMatchArray | null
  // a name inside quotes
  if ((m = before.match(/\b(forms|reports)\[["']([^"']*)$/))) return { from: at(m, 2), options: opts(m[1] === 'forms' ? cat.forms : cat.reports, 'class') }
  if ((m = before.match(/\bdocmd\.run_macro\(\s*["']([^"']*)$/))) return { from: at(m, 1), options: opts(cat.macros, 'class') }
  if ((m = before.match(/\bdb\.open_recordset\(\s*["']([^"']*)$/))) return { from: at(m, 1), options: [...opts(cat.tables, 'class'), ...opts(cat.queries, 'class')] }
  // the controls and methods of one form
  if ((m = before.match(new RegExp(String.raw`\bforms(?:\[["']([^"']+)["']\]|\.(${ID}))\.(${ID})?$`)))) {
    const form = m[1] ?? m[2]
    return { from: before.length - (m[3] ?? '').length, options: [...opts(cat.controls(form), 'property'), ...opts(FORM_METHODS, 'method')] }
  }
  if ((m = before.match(new RegExp(String.raw`\b(forms|reports)\.(${ID})?$`)))) return { from: before.length - (m[2] ?? '').length, options: opts(m[1] === 'forms' ? cat.forms : cat.reports, 'class') }
  const members = (re: string, names: readonly string[], type = 'method') => {
    const r = before.match(new RegExp(String.raw`\b${re}\.(${ID})?$`))
    return r ? { from: before.length - (r[1] ?? '').length, options: opts(names, type) } : null
  }
  return members('docmd', DOCMD_NAMES) ?? members('db', ['open_recordset', 'execute']) ?? members('tempvars', ['keys', 'items', 'clear'])
    ?? members('app', ['current_project', 'quit'], 'property') ?? members('me', ME)
}
