// Identifiants de test et nom accessible d'un onglet de document (contrat 1.1, C3).
import type { DocKind } from '../state/app-state';

/** Tables keep their name (`doc-tab-<name>`); objects carry their kind, since a form may share a table's name; the Relations
 *  window is one per base: `doc-tab-window-relations` (C9: a table may be named "relations"). */
export const docTabId = (tab: { kind: DocKind; name: string }): string =>
  tab.kind === 'table' ? tab.name : tab.kind === 'relations' ? 'window-relations' : `${tab.kind}-${tab.name}`;

/** The accessible name adds the kind ("Clients (Formulaire)"), except for the Relations window, whose title already says it. */
export const showsKind = (kind: DocKind): boolean => kind !== 'relations';
