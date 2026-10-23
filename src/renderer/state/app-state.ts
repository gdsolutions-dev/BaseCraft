// Onglets de documents (réducteur pur). Un objet = un onglet, comme dans Access.
import type { ObjectKind } from '../../shared/api';
import { sameName } from '../../shared/field-types';
import type { RecordSourceRef } from '../../shared/record-source';

/** A table has Design and Datasheet; a query, form or report has Design and Run (datasheet, form view, print preview); the
 *  Relations window has only its Run view. A form's Datasheet view is its `datasheet` mode (M10), its Form view `run`. */
export type DocKind =
  | 'table'
  | 'query'
  | 'form'
  | 'report'
  | 'relations'

export type DocMode = 'design' | 'datasheet' | 'run';
/** isNew: table not saved yet; `name` is then only a provisional label (Table1…), never matched against real tables. */
/** reloadToken: structure saved (everything is read again); dataToken: rows changed elsewhere (a datasheet re-reads them). */
/** description: a table's description last set from the Properties dialog; an open design adopts it (its save keeps it). */
/** dirtySources: a running form's sources with a record being edited, its own and its subforms' (action queries' lock check). */
export interface DocTab {
  id: string; kind: DocKind; name: string; mode: DocMode; dirty: boolean; reloadToken: number; dataToken?: number; isNew?: boolean; description?: string;
  dirtySources?: RecordSourceRef[];
}
export interface AppState { tabs: DocTab[]; activeId: string | null; navVisible: boolean }
export type AppAction =
  | { type: 'open'; kind: DocKind; name: string; mode: DocMode; isNew?: boolean } | { type: 'close'; id: string } | { type: 'activate'; id: string }
  | { type: 'setMode'; id: string; mode: DocMode } | { type: 'setDirty'; id: string; dirty: boolean; sources?: RecordSourceRef[] }
  | { type: 'tableRenamed'; from: string; to: string } | { type: 'tableDropped'; name: string }
  | { type: 'tableSaved'; name: string; tabId?: string } // tabId: the new-table tab that was just saved under `name`
  | { type: 'tableDataChanged'; name: string } // rows added elsewhere (import): never reloads a design
  | { type: 'tablesChanged' } // tables created elsewhere (an import, its error table): only the Relations window reloads
  | { type: 'toggleNav' } | { type: 'reset' }
  | { type: 'objectRenamed'; kind: ObjectKind; from: string; to: string } | { type: 'objectDeleted'; kind: ObjectKind; name: string }
  | { type: 'objectSaved'; kind: ObjectKind; name: string; tabId?: string } // tabId: the new-object tab just saved under `name`
  | { type: 'listsChanged' } // a description (Properties dialog): only the navigation pane's lists are read again
  | { type: 'tableDescribed'; name: string; description: string } // Properties dialog: a table's tabs take it, never dirtied
  | { type: 'queryDataChanged' }; // A3: an action query wrote rows: every query datasheet re-reads its rows

export const initialAppState: AppState = { tabs: [], activeId: null, navVisible: true };

let seq = 0;
// Tables by exact name: the main process only hands out live names, and twins ("Été", "été" of another tool) are two tables
// (A2-R15). Objects compare with sameName (bc_objects keeps one name per sameName).
export const isDoc = (t: DocTab, kind: DocKind | ObjectKind, name: string): boolean =>
  t.kind === kind && !t.isNew && (kind === 'table' ? t.name === name : sameName(t.name, name));
const isTable = (t: DocTab, name: string) => isDoc(t, 'table', name);
/** The mode an Open asks of a tab already open: a form shown in its Datasheet view stays in it (Open only activates its tab, Access). */
export const reopenMode = (t: DocTab, mode: DocMode): DocMode => (t.kind === 'form' && t.mode === 'datasheet' && mode === 'run' ? 'datasheet' : mode);
/** The Relations window shows every table: any change of structure reloads it. */
const relationsReload = (s: AppState): AppState =>
  ({ ...s, tabs: s.tabs.map((t) => (t.kind === 'relations' ? { ...t, reloadToken: t.reloadToken + 1 } : t)) });
const patch = (s: AppState, id: string, p: Partial<DocTab>): AppState =>
  s.tabs.some((t) => t.id === id) ? { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...p } : t)) } : s;

/** Removes tabs; if the active one goes, its right neighbour (else left) becomes active. */
function remove(s: AppState, gone: (t: DocTab) => boolean): AppState {
  const tabs = s.tabs.filter((t) => !gone(t));
  if (tabs.length === s.tabs.length) return s;
  let activeId = s.activeId;
  if (!tabs.some((t) => t.id === activeId)) {
    const i = s.tabs.findIndex((t) => t.id === activeId);
    const next = s.tabs.slice(i + 1).find((t) => !gone(t)) ?? s.tabs.slice(0, i).reverse().find((t) => !gone(t));
    activeId = next?.id ?? null;
  }
  return { ...s, tabs, activeId };
}

export function appReducer(s: AppState, a: AppAction): AppState {
  switch (a.type) {
    case 'open': {
      const existing = a.isNew ? undefined : s.tabs.find((t) => isDoc(t, a.kind, a.name));
      if (existing) return { ...patch(s, existing.id, { mode: reopenMode(existing, a.mode) }), activeId: existing.id };
      const tab: DocTab = { id: `doc${++seq}`, kind: a.kind, name: a.name, mode: a.mode, dirty: false, reloadToken: 0, ...(a.isNew ? { isNew: true } : {}) };
      return { ...s, tabs: [...s.tabs, tab], activeId: tab.id };
    }
    case 'close': return remove(s, (t) => t.id === a.id);
    case 'activate': return s.tabs.some((t) => t.id === a.id) ? { ...s, activeId: a.id } : s;
    case 'setMode': return patch(s, a.id, { mode: a.mode });
    case 'setDirty': return patch(s, a.id, { dirty: a.dirty, dirtySources: a.sources });   // none given: none left (a view's cleanup)
    case 'tableRenamed': return relationsReload({ ...s, tabs: s.tabs.map((t) => (isTable(t, a.from) ? { ...t, name: a.to } : t)) });
    case 'tableDropped': return relationsReload(remove(s, (t) => isTable(t, a.name)));
    case 'tableSaved':
      return relationsReload({
        ...s,
        tabs: s.tabs.map((t) =>
          t.id === a.tabId ? { ...t, name: a.name, isNew: false, reloadToken: t.reloadToken + 1 }
          : isTable(t, a.name) ? { ...t, reloadToken: t.reloadToken + 1 } : t),
      });
    case 'tableDataChanged':
      return { ...s, tabs: s.tabs.map((t) => (isTable(t, a.name) && t.mode === 'datasheet' ? { ...t, dataToken: (t.dataToken ?? 0) + 1 } : t)) };
    case 'tablesChanged': return relationsReload(s);
    case 'listsChanged': return s;
    case 'queryDataChanged':
      return { ...s, tabs: s.tabs.map((t) => (t.kind === 'query' && t.mode === 'run' ? { ...t, dataToken: (t.dataToken ?? 0) + 1 } : t)) };
    case 'tableDescribed': return { ...s, tabs: s.tabs.map((t) => (isTable(t, a.name) ? { ...t, description: a.description } : t)) };
    case 'toggleNav': return { ...s, navVisible: !s.navVisible };
    case 'reset': return { ...initialAppState, navVisible: s.navVisible };
    case 'objectRenamed': return { ...s, tabs: s.tabs.map((t) => (isDoc(t, a.kind, a.from) ? { ...t, name: a.to } : t)) };
    case 'objectDeleted': return remove(s, (t) => isDoc(t, a.kind, a.name));
    case 'objectSaved':
      return {
        ...s,
        tabs: s.tabs.map((t) =>
          t.id === a.tabId ? { ...t, name: a.name, isNew: false, reloadToken: t.reloadToken + 1 }
          : isDoc(t, a.kind, a.name) ? { ...t, reloadToken: t.reloadToken + 1 } : t),
      };
  }
}
