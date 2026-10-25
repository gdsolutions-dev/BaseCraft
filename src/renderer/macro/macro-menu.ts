// Menu contextuel du volet de navigation pour les macros (règle C6) : Exécuter et Mode création. Le reste du menu (Exporter,
// Renommer, Masquer, Supprimer, Propriétés) vient du socle ; Couper, Copier et Coller, de A6 (mêmes id, l'un remplace l'autre).
import { PencilRuler, Play } from 'lucide-react';
import { registerNavMenuItems } from '../shell/nav-menu';
import { hasDocumentView } from '../shell/document-views';
import { errorMessage } from '../shell/Modal';
import { runMacroByName } from './macro-shell';

registerNavMenuItems('macro', [
  { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.run', icon: Play, run: (c) => runMacroByName(c.name).then(() => {}, (e) => {   // a double-click runs it too (runNavItem: nothing catches)
    const m = errorMessage(e);
    return c.modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: m.key, params: m.params, buttons: ['ok'] }).then(() => {});
  }) },
  { id: 'design', group: 'open', order: 20, labelKey: 'nav.menu.design', icon: PencilRuler, visible: (c) => !c.runtime,
    enabled: () => hasDocumentView('macro', 'design'), run: (c) => { void c.dispatch({ type: 'open', kind: 'macro', name: c.name, mode: 'design' }); } },
]);
