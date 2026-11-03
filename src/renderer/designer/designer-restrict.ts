// Restrictions du concepteur (Mode Page des formulaires) : vrai = masqué ou désactivé. Absentes, le concepteur est entier. Module pur.
import type { PropertyDescriptor } from '../../shared/design/properties';
import type { Gesture } from './pointer';

export interface DesignerRestrict { toolbox: boolean; sectionBars: boolean; events: boolean }

/** Mode Page des états : la boîte à outils et le placement reviennent (comme pour les formulaires) ; ni barres de hauteur de section
 *  ni onglet Événement (un seul objet : le canevas compare son identité). */
export const REPORT_LAYOUT_RESTRICT: DesignerRestrict = { toolbox: false, sectionBars: true, events: true };

/** Mode Page des formulaires (L2b) : la boîte à outils et le placement restent, comme dans Access ; ni barres de section ni onglet Événement. */
export const FORM_LAYOUT_RESTRICT: DesignerRestrict = { toolbox: false, sectionBars: true, events: true };

const TABS: PropertyDescriptor['tab'][] = ['format', 'data', 'event', 'other'];

/** Les onglets de la Feuille de propriétés à montrer (Toutes en plus) : sans Événement quand les événements sont restreints. */
export function restrictedTabs(r: DesignerRestrict | undefined): PropertyDescriptor['tab'][] {
  return r?.events ? TABS.filter((t) => t !== 'event') : TABS;
}

/** Un geste du canevas est-il permis ? La hauteur d'une section suit les barres de section, le placement d'un outil la boîte à outils ;
 *  déplacer, redimensionner et sélectionner les contrôles restent permis. */
export function gestureAllowed(r: DesignerRestrict | undefined, kind: Gesture['kind']): boolean {
  if (kind === 'sectionHeight') return !r?.sectionBars;
  if (kind === 'place') return !r?.toolbox;
  return true;
}
