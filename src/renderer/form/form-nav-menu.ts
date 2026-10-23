// Menu contextuel du volet de navigation pour les formulaires (règle C6) : l'unique inscription du lot A4. Ouvrir et Mode Création
// remplacent les éléments génériques de même id (même ordre, même libellé) ; dans une base en lecture seule, Mode Création ouvre le
// concepteur en lecture seule. Ouvrir ouvre le formulaire dans son affichage par défaut (tâche 10) ; déjà ouvert en mode Formulaire
// ou Feuille de données, il active seulement son onglet (reopenMode).
import { PencilRuler, Sheet } from 'lucide-react';
import { registerNavMenuItems } from '../shell/nav-menu';

registerNavMenuItems('form', [
  { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.open', icon: Sheet,
    run: (c) => { void c.dispatch({ type: 'open', kind: 'form', name: c.name, mode: 'run' }); } },
  { id: 'design', group: 'open', order: 20, labelKey: 'nav.menu.design', icon: PencilRuler, visible: (c) => !c.runtime,
    run: (c) => { void c.dispatch({ type: 'open', kind: 'form', name: c.name, mode: 'design' }); } },
]);
