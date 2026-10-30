// Gestionnaire de tables liées (C1 R9) : chaque lien, son fichier, son type et son état ; Actualiser, Changer la source.
// Ouvert par le ruban (Données externes) et par le menu d'une table liée (ce lien coché). Concepteur : absent de BaseCraft Runtime.
import { Link } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LinkInfo } from '../../shared/api';
import { api } from '../bridge';
import { errorMessage, type ModalApi } from '../shell/Modal';
import type { AppDispatch, NavMenuItem } from '../shell/nav-menu';

/** Lists the links once (R4: listing opens and locks every data file), then shows the manager with `ticked` selected. Links
 *  refreshed or moved meanwhile: the pane reads its lists again, their open datasheets their rows. */
export async function openLinkedTableManager(modal: ModalApi, dispatch: AppDispatch, ticked: string[] = []): Promise<void> {
  const links = await api.links.list();
  const changed = new Set<string>();
  await modal.custom<true>((close) => <Manager initial={links} ticked={ticked} changed={changed} onClose={close} />, { titleKey: 'ltm.title' });
  if (changed.size === 0) return;
  void dispatch({ type: 'listsChanged' });
  for (const name of changed) void dispatch({ type: 'tableDataChanged', name });
}

/** A link's menu item (design only: registered by design/entry). */
export const linkedTableManagerItem: NavMenuItem = {
  id: 'linkedTableManager', group: 'link', order: 10, labelKey: 'nav.menu.linkedTableManager', icon: Link,
  visible: (c) => !!c.link && !c.runtime, run: (c) => openLinkedTableManager(c.modal, c.dispatch, [c.name]),
};

function Manager({ initial, ticked, changed, onClose }: { initial: LinkInfo[]; ticked: string[]; changed: Set<string>; onClose(v: true | null): void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initial);
  const [picked, setPicked] = useState(ticked.filter((n) => initial.some((l) => l.name === n)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (name: string, on: boolean) => setPicked((p) => (on ? [...p, name] : p.filter((x) => x !== name)));
  const merge = (infos: LinkInfo[]) => {
    for (const l of infos) changed.add(l.name);
    setRows((r) => r.map((l) => infos.find((x) => x.name === l.name) ?? l));
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { const m = errorMessage(e); setError(t(m.key, m.params)); } finally { setBusy(false); }
  };
  const refresh = () => run(async () => merge(await api.links.refresh(picked)));
  const relink = () => run(async () => {
    const path = await api.links.pick();
    if (path === null) return;
    const r = await api.links.relink(picked, path);
    if (!r.ok) return setError(r.reason === 'missingTables' ? t('ltm.missingTables', { names: r.names.join(', ') }) : t(`link.error.${r.reason}`, { names: r.names.join(', ') }));
    merge(await api.links.refresh(picked)); // their new path and state, without reopening every other file
  });
  const state = (l: LinkInfo) => {
    if (l.state !== 'readOnly') return t(`ltm.state.${l.state}`);
    if (!l.holder) return t('ltm.state.readOnlyFile'); // a read-only front-end or file
    return t(l.stale ? 'ltm.state.stale' : 'ltm.state.readOnly', { user: l.holder.user, host: l.holder.host });
  };
  return (
    <div data-testid="ltm-dialog" className="ltm-dialog">
      <table className="ltm-table">
        <thead><tr><th /><th>{t('ltm.col.name')}</th><th>{t('ltm.col.kind')}</th><th>{t('ltm.col.path')}</th><th>{t('ltm.col.state')}</th></tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.name} data-testid={`ltm-row-${l.name}`}>
              <td><input type="checkbox" data-testid={`ltm-check-${l.name}`} aria-label={l.name} checked={picked.includes(l.name)}
                onChange={(e) => toggle(l.name, e.target.checked)} /></td>
              <td>{l.name}</td>
              <td>{t(`link.kind.${l.kind}`, { defaultValue: l.kind })}</td>
              <td className="ltm-path" data-testid={`ltm-path-${l.name}`}>{l.path}</td>
              <td>
                <span data-testid={`ltm-state-${l.name}`}>{state(l)}</span>
                {(l.shared || (l.risk !== 'local' && l.state !== 'syncedFolder')) && <em className="muted" data-testid={`ltm-risk-${l.name}`}> — {l.shared ? t('ltm.shared') : t(`ltm.risk.${l.risk}`)}</em>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="modal-error" role="alert" data-testid="ltm-error">{error}</p>}
      <div className="modal-buttons">
        <button type="button" className="btn" data-testid="ltm-select-all" disabled={busy || rows.length === 0} onClick={() => setPicked(rows.map((l) => l.name))}>{t('link.selectAll')}</button>
        <button type="button" className="btn" data-testid="ltm-refresh" disabled={busy || picked.length === 0} onClick={() => void refresh()}>{t('ltm.refresh')}</button>
        <button type="button" className="btn" data-testid="ltm-relink" disabled={busy || picked.length === 0} onClick={() => void relink()}>{t('ltm.relink')}</button>
        <button type="button" className="btn btn-primary" data-testid="ltm-close" disabled={busy} onClick={() => onClose(true)}>{t('ltm.close')}</button>
      </div>
    </div>
  );
}
