// Gestionnaire de tables liées (C1 R9) : chaque lien, sa source (fichier ou serveur, C4), son type et son état ; Actualiser, Changer
// la source (des liens serveur : la boîte de connexion de leur sorte, préremplie, dans cette fenêtre). Ouvert par le ruban (Données externes) et par le
// menu d'une table liée (ce lien coché). Concepteur : absent de BaseCraft Runtime.
import { Link } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isServerKind, type LinkInfo, type ServerKind } from '../../shared/api';
import { api } from '../bridge';
import { errorMessage, useFocusFirst, type ModalApi } from '../shell/Modal';
import type { AppDispatch, NavMenuItem } from '../shell/nav-menu';
import { ServerLinkDialog, serverTitle } from './ServerLinkDialog';

/** A server link (C4) by its kind, its params readable or not: Change Source never moves it to a file. */
const isServer = (l: LinkInfo) => isServerKind(l.kind);

/** Lists the links once (R4: listing opens and locks every data file), then shows the manager with `ticked` selected. Links
 *  refreshed or moved meanwhile: the pane reads its lists again, their open datasheets their rows. */
export async function openLinkedTableManager(modal: ModalApi, dispatch: AppDispatch, ticked: string[] = []): Promise<void> {
  const links = await api.links.list();
  const changed = new Set<string>();
  await modal.custom<true>((close, retitle) => <Manager initial={links} ticked={ticked} changed={changed} onClose={close} retitle={retitle} />, { titleKey: 'ltm.title' });
  if (changed.size === 0) return;
  void dispatch({ type: 'listsChanged' });
  for (const name of changed) void dispatch({ type: 'tableDataChanged', name });
}

/** A link's menu item (design only: registered by design/entry). */
export const linkedTableManagerItem: NavMenuItem = {
  id: 'linkedTableManager', group: 'link', order: 10, labelKey: 'nav.menu.linkedTableManager', icon: Link,
  visible: (c) => !!c.link && !c.runtime, run: (c) => openLinkedTableManager(c.modal, c.dispatch, [c.name]),
};

function Manager({ initial, ticked, changed, onClose, retitle }: {
  initial: LinkInfo[]; ticked: string[]; changed: Set<string>; onClose(v: true | null): void; retitle(titleKey: string | null): void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initial);
  const [picked, setPicked] = useState(ticked.filter((n) => initial.some((l) => l.name === n)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [relinking, setRelinking] = useState<LinkInfo | null>(null); // the server link dialog shown, prefilled from this link
  const listRef = useFocusFirst<HTMLDivElement>(relinking); // back from the relink form: the focus returns to the list
  const pickedRows = rows.filter((l) => picked.includes(l.name));
  const servers = pickedRows.filter(isServer).length;
  const kinds = new Set(pickedRows.filter(isServer).map((l) => l.kind));
  const mixed = servers > 0 && (servers < pickedRows.length || kinds.size > 1); // a file and a server, or two engines: no common source to change to
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
    if (servers) { const l = pickedRows.find(isServer)!; retitle(serverTitle(l.kind as ServerKind)); return setRelinking(l); }
    const path = await api.links.pick();
    if (path === null) return;
    const r = await api.links.relink(picked, path);
    if (!r.ok) return setError(r.reason === 'missingTables' ? t('ltm.missingTables', { names: r.names.join(', ') }) : t(`link.error.${r.reason}`, { names: r.names.join(', ') }));
    merge(await api.links.refresh(picked)); // their new path and state, without reopening every other file
  });
  const errorText = (e: string) => { const m = errorMessage(e); return t(m.key, m.params); }; // a server's refusal at Refresh (C4)
  const state = (l: LinkInfo) => {
    if (l.state !== 'readOnly') return t(`ltm.state.${l.state}`);
    if (!l.holder) return t('ltm.state.readOnlyFile'); // a read-only front-end or file
    return t(l.stale ? 'ltm.state.stale' : 'ltm.state.readOnly', { user: l.holder.user, host: l.holder.host });
  };
  if (relinking) {
    const back = (ok: true | null) => {
      retitle(null);
      setRelinking(null);
      if (ok) void run(async () => merge(await api.links.refresh(picked))); // their new path and state
    };
    // Escape goes back to the list, not out of the manager (Modal's handler would close it)
    return (
      <div onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); back(null); } }}>
        <ServerLinkDialog kind={relinking.kind as ServerKind} initial={relinking.params} relink={picked} onClose={back} />
      </div>
    );
  }
  return (
    <div ref={listRef} data-testid="ltm-dialog" className="ltm-dialog">
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
                <span data-testid={`ltm-state-${l.name}`}>{l.error ? errorText(l.error) : state(l)}</span>
                {(l.shared || (l.risk && l.risk !== 'local' && l.state !== 'syncedFolder')) && <em className="muted" data-testid={`ltm-risk-${l.name}`}> — {l.shared ? t('ltm.shared') : t(`ltm.risk.${l.risk}`)}</em>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="modal-error" role="alert" data-testid="ltm-error">{error}</p>}
      <div className="modal-buttons">
        <button type="button" className="btn" data-testid="ltm-select-all" disabled={busy || rows.length === 0} onClick={() => setPicked(rows.map((l) => l.name))}>{t('link.selectAll')}</button>
        <button type="button" className="btn" data-testid="ltm-refresh" disabled={busy || picked.length === 0} onClick={() => void refresh()}>{t('ltm.refresh')}</button>
        <button type="button" className="btn" data-testid="ltm-relink" disabled={busy || picked.length === 0 || mixed} onClick={() => void relink()}>{t('ltm.relink')}</button>
        <button type="button" className="btn btn-primary" data-testid="ltm-close" disabled={busy} onClick={() => onClose(true)}>{t('ltm.close')}</button>
      </div>
    </div>
  );
}
