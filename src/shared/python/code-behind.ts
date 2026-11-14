// Code-behind (B6): a form or report with `[Event Procedure]` in an event property runs the function `<Control>_<Event>` of its
// module `Form_<Name>` / `Report_<Name>`, as Access does with VBA. Pure module (the Runtime needs it too).
import type { EventName } from '../design/events'

export const EVENT_PROCEDURE = '[Event Procedure]'
const ident = (s: string): string => s.replace(/[^\p{L}\p{Nd}_]/gu, '_')

/** The module of a form or report: `Form_Clients`. Two names that differ only by characters Python refuses share one module. */
export const codeBehindModule = (kind: 'form' | 'report', name: string): string => `${kind === 'form' ? 'Form' : 'Report'}_${ident(name)}`
/** A module made for a form or a report: its functions are event procedures, never `=fn()` calls. */
export const isCodeBehind = (module: string): boolean => /^(Form|Report)_/.test(module)

/** Access's short event name: OnClick -> Click, BeforeUpdate stays. */
export const eventShort = (event: EventName): string => event.replace(/^On(?=[A-Z])/, '')

/** `Nom_Click` for a control, `Detail_Format` for a section (its name), `Form_Open` / `Report_Open` for the object itself. */
export const procedureName = (kind: 'form' | 'report', event: EventName, owner?: string): string =>
  `${owner ? ident(owner) : kind === 'form' ? 'Form' : 'Report'}_${eventShort(event)}`
