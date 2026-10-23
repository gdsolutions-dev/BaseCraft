// Ruban › Organiser › Taille et classement : menus Taille/Espace et Aligner, Premier plan, Arrière-plan -> actions du concepteur.
import type { CommandHandlers } from '../shell/ribbon-model';
import type { ArrangeOp, DesignerAction, DesignerState } from './designer-model';

export type ArrangeMenu = 'sizeSpace' | 'align';

/** Dans l'ordre d'Access ; Aimanter à la grille est un élément du menu Taille/Espace. */
export const ARRANGE_MENUS: Record<ArrangeMenu, (ArrangeOp | 'toggleSnap')[]> = {
  sizeSpace: ['sizeToTallest', 'sizeToShortest', 'sizeToWidest', 'sizeToNarrowest', 'sizeToGrid', 'spaceHorizontalEqual', 'spaceHorizontalIncrease',
    'spaceHorizontalDecrease', 'spaceVerticalEqual', 'spaceVerticalIncrease', 'spaceVerticalDecrease', 'toggleSnap'],
  align: ['alignToGrid', 'alignLeft', 'alignRight', 'alignTop', 'alignBottom'],
};

/** …ToGrid dès 1 contrôle, space…Equal dès 3, les autres dès 2 ; toggleSnap toujours. */
export function arrangeItemEnabled(op: ArrangeOp | 'toggleSnap', selected: number): boolean {
  if (op === 'toggleSnap') return true;
  return selected >= (op.endsWith('ToGrid') ? 1 : op.endsWith('Equal') ? 3 : 2);
}

export const selectedCount = (s: DesignerState): number => (s.selection.kind === 'controls' ? s.selection.names.length : 0);

/** À fusionner dans l'unique `registerCommands` de la vue hôte. Sans sélection, seul Taille/Espace reste (pour Aimanter à la grille ;
 *  ses autres éléments sont désactivés par arrangeItemEnabled) : les autres ne sont pas enregistrés, le ruban les désactive. */
export function designerCommands(dispatch: (a: DesignerAction) => void, openMenu: (m: ArrangeMenu) => void, selected: number): CommandHandlers {
  const sizeSpace = () => openMenu('sizeSpace');
  if (!selected) return { sizeSpace };
  return {
    sizeSpace,
    align: () => openMenu('align'),
    bringToFront: () => dispatch({ type: 'arrange', op: 'bringToFront' }),
    sendToBack: () => dispatch({ type: 'arrange', op: 'sendToBack' }),
  };
}
