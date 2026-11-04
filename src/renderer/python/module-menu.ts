// Navigation Pane menu for modules: Open is the editor (there is no Run view). The rest comes from the foundation (nav-menu-items.ts).
import { PencilRuler } from 'lucide-react';
import { hasDocumentView } from '../shell/document-views';
import { registerNavMenuItems } from '../shell/nav-menu';

registerNavMenuItems('module', [
  { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.open', icon: PencilRuler, visible: (c) => !c.runtime,
    enabled: () => hasDocumentView('module', 'design'), run: (c) => { void c.dispatch({ type: 'open', kind: 'module', name: c.name, mode: 'design' }); } },
  { id: 'design', group: 'open', order: 20, labelKey: 'nav.menu.design', icon: PencilRuler, visible: () => false },
]);
