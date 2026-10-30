// Menu contextuel du volet de navigation pour les requêtes (règle C6) : le seul appel registerNavMenuItems('query') de A3,
// complété par les tâches 8 et 9. Ouvrir passe par le même chemin que le double-clic ; Supprimer prévient des objets qui
// utilisent la requête.
import { PencilRuler, Sheet, Trash2 } from 'lucide-react';
import { queryDependents } from '../../shared/query/definition';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { registerNavMenuItems, type NavMenuContext } from '../shell/nav-menu';

/** The queries, forms, reports and local tables (a lookup) that use `name` (an unreadable one is skipped). A linked table's lookup
 *  names its own file's objects, and reading its design would open and lock that file (C1). */
async function dependents(name: string) {
  const all = (await api.objects.list()).filter((o) => o.kind === 'query' || o.kind === 'form' || o.kind === 'report');
  const objects = await Promise.all(all.map((o) => api.objects.get(o.kind, o.name).then((g) => ({ kind: o.kind, name: g.name, definition: g.definition }), () => null)));
  const tables = await Promise.all((await api.tables.list()).filter((t) => !t.link).map((t) => api.tables.design(t.name).catch(() => null)));
  return queryDependents(name, objects.filter((o) => o !== null), tables.filter((d) => d !== null));
}

/** The foundation's Delete, with Access's warning when other objects use the query (Yes/No, default No). « Suppressions de documents »
 *  off (read now): no question, unless other objects use the query (they would break: that warning stays). */
async function removeQuery(c: NavMenuContext) {
  const deps = await dependents(c.name);
  if (deps.length || (await api.app.getSettings()).confirmDocumentDeletions) {
    const list = deps.map((d) => `${d.name} (${i18n.t(`tabs.kind.${d.kind}`)})`).join(', ');
    const answer = await c.modal.confirm({
      titleKey: 'nav.deleteObjectTitle', messageKey: deps.length ? 'query.delete.usedBy' : 'nav.deleteObjectMessage',
      params: { name: c.name, list }, buttons: ['yes', 'no'], defaultButton: 'no',
    });
    if (answer !== 'yes') return;
  }
  const r = await api.objects.delete('query', c.name);
  if (r.ok) {
    c.dispatch({ type: 'objectDeleted', kind: 'query', name: c.name });
    c.reselect(null);
    return;
  }
  await c.modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, params: { name: c.name, table: '', view: '' }, buttons: ['ok'] });
}

registerNavMenuItems('query', [
  // the double-click's path: parameters asked first (QueryRunView)
  { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.open', icon: Sheet, run: (c) => { void c.dispatch({ type: 'open', kind: 'query', name: c.name, mode: 'run' }); } },
  { id: 'delete', group: 'object', order: 30, labelKey: 'nav.menu.delete', icon: Trash2, visible: (c) => !c.runtime, enabled: (c) => !c.readOnly, run: removeQuery },
  // Task 8: the design grid (read-only on a read-only base, as a table's design)
  { id: 'design', group: 'open', order: 20, labelKey: 'nav.menu.design', icon: PencilRuler, visible: (c) => !c.runtime,
    run: (c) => { void c.dispatch({ type: 'open', kind: 'query', name: c.name, mode: 'design' }); } },
  // Task 9: the SQL view, registered by design/entry.ts (B5)
]);
