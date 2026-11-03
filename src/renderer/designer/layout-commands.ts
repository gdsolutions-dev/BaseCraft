// Ruban › Disposition (Tableau) : Empilé, Tabulaire, insérer, sélectionner, déplacer -> actions du concepteur.
// Sans contrôle sélectionné rien n'est enregistré ; sans membre de disposition dans la sélection, seuls Empilé et Tabulaire le sont
// (le ruban désactive les autres).
import { layoutOf, sectionRef } from '../../shared/design/layout';
import { createLayout, insertCells, membersOf, moveRow, removeLayout, selectionOf } from '../../shared/design/layout-edit';
import type { DesignDoc } from '../../shared/design/model';
import type { CommandHandlers } from '../shell/ribbon-model';
import { documentKind, type DesignerAction, type DesignerState } from './designer-model';

export type LayoutCommand = 'stacked' | 'tabular' | 'removeLayout' | 'insertAbove' | 'insertBelow' | 'insertLeft' | 'insertRight'
  | 'selectLayout' | 'selectColumn' | 'selectRow' | 'moveUp' | 'moveDown';

/** L'en-tête de formulaire (form-def, que le concepteur n'importe pas) : l'hôte formulaire le fournit. */
export interface FormHeader { shown(doc: DesignDoc): boolean; toggle(doc: DesignDoc): DesignDoc }

const CREATE: LayoutCommand[] = ['stacked', 'tabular'];
const MEMBER: LayoutCommand[] = ['removeLayout', 'insertAbove', 'insertBelow', 'insertLeft', 'insertRight',
  'selectLayout', 'selectColumn', 'selectRow', 'moveUp', 'moveDown'];
const SCOPE = { selectLayout: 'layout', selectColumn: 'column', selectRow: 'row' } as const;
const WHERE = { insertAbove: 'above', insertBelow: 'below', insertLeft: 'left', insertRight: 'right' } as const;

const names = (s: DesignerState): string[] => (s.selection.kind === 'controls' ? s.selection.names : []);
/** Le premier contrôle sélectionné qui appartient à une disposition. */
const firstMember = (s: DesignerState): string | undefined => names(s).find((n) => layoutOf(s.doc, n));

/** 0 : rien de sélectionné ; 1 : des contrôles, aucun membre ; 2 : au moins un membre. Les vues s'en servent pour réenregistrer. */
export const layoutScope = (s: DesignerState): 0 | 1 | 2 => (!names(s).length ? 0 : firstMember(s) ? 2 : 1);

/** null : la commande ne s'applique pas à la sélection. */
export function layoutAction(state: DesignerState, cmd: LayoutCommand, formHeader?: FormHeader): DesignerAction | null {
  if (cmd === 'stacked' || cmd === 'tabular') {
    const sel = names(state);
    if (!sel.length) return null;
    const form = documentKind(state) === 'form';
    return { type: 'edit', apply: (doc: DesignDoc) => {
      // l'en-tête de formulaire masqué est affiché dans la même opération (une seule annulation)
      const base = cmd === 'tabular' && form && formHeader && !formHeader.shown(doc) ? formHeader.toggle(doc) : doc;
      const header = base.sections.find((s) => s.kind === (form ? 'formHeader' : 'pageHeader'));
      const headerRef = header ? sectionRef(header) : '';
      return createLayout(base, membersOf(base, sel, cmd === 'tabular' ? headerRef : undefined), cmd, { headerSection: headerRef });
    } };
  }
  const m = firstMember(state);
  if (!m) return null;
  if (cmd in SCOPE) return { type: 'select', selection: { kind: 'controls', names: selectionOf(state.doc, m, SCOPE[cmd as keyof typeof SCOPE]) } };
  if (cmd === 'removeLayout') return { type: 'edit', apply: (doc) => { const l = layoutOf(doc, m); return l ? removeLayout(doc, l.id) : doc; } };
  if (cmd === 'moveUp' || cmd === 'moveDown') return { type: 'edit', apply: (doc) => moveRow(doc, m, cmd === 'moveUp' ? -1 : 1) };
  return { type: 'edit', apply: (doc) => insertCells(doc, m, WHERE[cmd as keyof typeof WHERE]) };
}

/** À fusionner dans l'unique `registerCommands` de la vue hôte, qui se réenregistre quand `layoutScope` change. */
export function layoutCommands(current: () => DesignerState, dispatch: (a: DesignerAction) => void, formHeader?: FormHeader): CommandHandlers {
  const scope = layoutScope(current());
  const h: CommandHandlers = {};
  if (!scope) return h;
  for (const cmd of scope === 2 ? [...CREATE, ...MEMBER] : CREATE) {
    h[cmd] = () => { const a = layoutAction(current(), cmd, formHeader); if (a) dispatch(a); };
  }
  return h;
}
