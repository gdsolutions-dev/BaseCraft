// Embedded macros (R16): a macro stored in an event property of an open form or report design, edited in the macro designer in a
// tab of its own. The session links that tab to its design: its Save writes the definition into the design (undoable, the design
// becomes dirty), never into the file. A session lives as long as its tab (the macro view drops it when it goes).
import type { DesignDoc } from '../../shared/design/model';
import type { MacroDef } from '../../shared/macro/model';
import type { DesignerAction, PropTarget } from '../designer/designer-model';
import { targetExists } from '../designer/property-sheet-model';
import type { AppDispatch } from '../shell/nav-menu';

export interface EmbeddedSession { owner: string /* design tab id */; title: string; def: MacroDef; save(def: MacroDef): boolean /* false: owner or target gone */ }

const sessions = new Map<string, EmbeddedSession>();
let seq = 0;

/** Opens the macro tab of `s`; a session already open for the same design, object and event (its title) is shown instead. */
export function openEmbedded(dispatch: AppDispatch, s: EmbeddedSession): void {
  let id = [...sessions].find(([, x]) => x.owner === s.owner && x.title === s.title)?.[0];
  if (!id) { id = `embedded${++seq}`; sessions.set(id, s); }
  void dispatch({ type: 'open', kind: 'macro', name: s.title, mode: 'design', embedded: { id, owner: s.owner } });
}

export const embeddedSession = (id: string): EmbeddedSession | undefined => sessions.get(id);
/** Its tab closed. */
export const dropEmbedded = (id: string): void => { sessions.delete(id); };

/** The session ids of the owner's open embedded tabs (asked before the owner closes or changes mode). */
export const closeEmbeddedOf = (owner: string): string[] => [...sessions].filter(([, x]) => x.owner === owner).map(([id]) => id);

/** The session of the event property `event` of `target` in a design: `doc` reads the design as it is now (null: gone), `dispatch`
 *  is its designer's. Saving into a target renamed or deleted since is refused. */
export function eventSession(o: { owner: string; title: string; def: MacroDef; target: PropTarget; event: string; doc(): DesignDoc | null;
  dispatch(a: DesignerAction): void }): EmbeddedSession {
  return { owner: o.owner, title: o.title, def: o.def, save: (def) => {
    const doc = o.doc();
    if (!doc || !targetExists(doc, o.target)) return false;
    o.dispatch({ type: 'setProp', targets: [o.target], name: o.event, value: { embedded: def } });
    return true;
  } };
}
