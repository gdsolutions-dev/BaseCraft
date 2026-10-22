// Onglets de documents (réducteur pur). Un objet = un onglet, comme dans Access.
import { sameName } from '../../shared/field-types';

export type DocMode = 'design' | 'datasheet';
/** isNew: table not saved yet; `name` is then only a provisional label (Table1…), never matched against real tables. */
/** reloadToken: structure saved (everything is read again); dataToken: rows changed elsewhere (a datasheet re-reads them). */
export interface DocTab { id: string; kind: 'table'; name: string; mode: DocMode; dirty: boolean; reloadToken: number; dataToken?: number; isNew?: boolean }
export interface AppState { tabs: DocTab[]; activeId: string | null; navVisible: boolean }
export type AppAction =
  | { type: 'open'; kind: 'table'; name: string; mode: DocMode; isNew?: boolean } | { type: 'close'; id: string } | { type: 'activate'; id: string }
  | { type: 'setMode'; id: string; mode: DocMode } | { type: 'setDirty'; id: string; dirty: boolean }
  | { type: 'tableRenamed'; from: string; to: string } | { type: 'tableDropped'; name: string }
  | { type: 'tableSaved'; name: string; tabId?: string } // tabId: the new-table tab that was just saved under `name`
  | { type: 'tableDataChanged'; name: string } // rows added elsewhere (import): never reloads a design
  | { type: 'toggleNav' } | { type: 'reset' };

export const initialAppState: AppState = { tabs: [], activeId: null, navVisible: true };

let seq = 0;
const isTable = (t: DocTab, name: string) => !t.isNew && sameName(t.name, name);
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
      const existing = a.isNew ? undefined : s.tabs.find((t) => t.kind === a.kind && isTable(t, a.name));
      if (existing) return { ...patch(s, existing.id, { mode: a.mode }), activeId: existing.id };
      const tab: DocTab = { id: `doc${++seq}`, kind: a.kind, name: a.name, mode: a.mode, dirty: false, reloadToken: 0, ...(a.isNew ? { isNew: true } : {}) };
      return { ...s, tabs: [...s.tabs, tab], activeId: tab.id };
    }
    case 'close': return remove(s, (t) => t.id === a.id);
    case 'activate': return s.tabs.some((t) => t.id === a.id) ? { ...s, activeId: a.id } : s;
    case 'setMode': return patch(s, a.id, { mode: a.mode });
    case 'setDirty': return patch(s, a.id, { dirty: a.dirty });
    case 'tableRenamed': return { ...s, tabs: s.tabs.map((t) => (isTable(t, a.from) ? { ...t, name: a.to } : t)) };
    case 'tableDropped': return remove(s, (t) => isTable(t, a.name));
    case 'tableSaved':
      return {
        ...s,
        tabs: s.tabs.map((t) =>
          t.id === a.tabId ? { ...t, name: a.name, isNew: false, reloadToken: t.reloadToken + 1 }
          : isTable(t, a.name) ? { ...t, reloadToken: t.reloadToken + 1 } : t),
      };
    case 'tableDataChanged':
      return { ...s, tabs: s.tabs.map((t) => (isTable(t, a.name) && t.mode === 'datasheet' ? { ...t, dataToken: (t.dataToken ?? 0) + 1 } : t)) };
    case 'toggleNav': return { ...s, navVisible: !s.navVisible };
    case 'reset': return { ...initialAppState, navVisible: s.navVisible };
  }
}
