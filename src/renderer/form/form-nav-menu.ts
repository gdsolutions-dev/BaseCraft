// Menu contextuel du volet de navigation pour les formulaires (règle C6) : l'unique inscription du lot A4. Ouvrir et Mode Création
// remplacent les éléments génériques de même id (même ordre, même libellé) ; dans une base en lecture seule, Mode Création ouvre le
// concepteur en lecture seule. Ouvrir ouvre le formulaire dans son affichage par défaut (tâche 10) ; déjà ouvert en mode Formulaire
// ou Feuille de données, il active seulement son onglet (reopenMode). Mode Page (L2) remplace l'emplacement réservé du socle.
import { LayoutTemplate, PencilRuler, Sheet } from 'lucide-react';
import { api } from '../bridge';
import { registerNavMenuItems, type NavMenuContext } from '../shell/nav-menu';
import { tabCommandState } from '../shell/ribbon-model';
import { parseFormDoc } from './form-def';
import { allowsLayout } from './views';

/** Le mode Page est-il permis ? Ouvert, la vue du formulaire le dit (sa valeur en cours de modification, son état de commande) ;
 *  sinon AllowLayoutView lu dans la définition enregistrée : non (false) ne fait rien ; illisible, le concepteur dit pourquoi. */
async function layoutAllowed(c: NavMenuContext): Promise<boolean> {
  if (c.openTab) return tabCommandState(c.openTab, 'viewLayout')?.enabled !== false;
  try { return allowsLayout(parseFormDoc((await api.objects.get('form', c.name)).definition).doc); } catch { return true; }
}

registerNavMenuItems('form', [
  { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.open', icon: Sheet,
    run: (c) => { void c.dispatch({ type: 'open', kind: 'form', name: c.name, mode: 'run' }); } },
  { id: 'layout', group: 'open', order: 15, labelKey: 'nav.menu.layout', icon: LayoutTemplate, visible: (c) => !c.runtime,
    run: async (c) => { if (await layoutAllowed(c)) void c.dispatch({ type: 'open', kind: 'form', name: c.name, mode: 'layout' }); } },
  { id: 'design', group: 'open', order: 20, labelKey: 'nav.menu.design', icon: PencilRuler, visible: (c) => !c.runtime,
    run: (c) => { void c.dispatch({ type: 'open', kind: 'form', name: c.name, mode: 'design' }); } },
]);
