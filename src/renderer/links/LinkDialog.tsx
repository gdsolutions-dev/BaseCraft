// Données externes › Base BaseCraft ou SQLite (C1 R7) : fichier choisi, puis ses tables à lier, chacune sous son nom (R2).
// Le choix « Importer ou lier » d'Access n'est pas proposé : C1 ne fait que lier (Convertir en table locale importe).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LinkFileInfo } from '../../shared/api';
import { api } from '../bridge';
import { errorMessage, type ModalApi } from '../shell/Modal';

/** Picks a file (cancelled: nothing), reads its tables (a file that cannot be linked rejects with its reason), then asks which
 *  to link. True when links were created. `first`: the file filter shown first (C2 R10). A protected Access file asks its password
 *  inside `inspect` (bridge.ts); Cancel there rejects with the protected-file message. */
export async function linkTables(modal: ModalApi, first?: LinkFileInfo['kind']): Promise<boolean> {
  const path = await api.links.pick(first);
  if (path === null) return false;
  const info = await api.links.inspect(path);
  return (await modal.custom<true>((close) => <LinkForm path={path} info={info} onClose={close} />, { titleKey: 'link.title' })) === true;
}

function LinkForm({ path, info, onClose }: { path: string; info: LinkFileInfo; onClose(v: true | null): void }) {
  const { t } = useTranslation();
  const free = info.tables.filter((x) => !x.taken && !x.unsupported).map((x) => x.name);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (name: string, on: boolean) => { setPicked((p) => (on ? [...p, name] : p.filter((x) => x !== name))); setError(null); };
  const link = async () => {
    setBusy(true);
    try {
      const r = await api.links.create(path, info.tables.map((x) => x.name).filter((n) => picked.includes(n)));
      if (r.ok) return onClose(true);
      setError(t(`link.error.${r.reason}`, { names: r.names.join(', ') }));
    } catch (e) {
      const m = errorMessage(e);
      setError(t(m.key, m.params));
    } finally { setBusy(false); }
  };
  return (
    <form data-testid="link-dialog" className="link-dialog" onSubmit={(e) => { e.preventDefault(); void link(); }}>
      <p data-testid="link-path">{t('link.source', { path })}</p>
      <p className="muted" data-testid="link-kind">{t(`link.kind.${info.kind}`)}</p>
      {info.tables.length === 0 ? <p className="muted">{t('link.noTables')}</p> : (
        <fieldset className="modal-field">
          <legend>{t('link.tables')}</legend>
          <div className="link-list" data-testid="link-list">
          {info.tables.map((x) => (
            <div key={x.name}>
              <label title={x.taken ? t('link.taken') : undefined}>
                <input type="checkbox" data-testid={`link-table-${x.name}`} disabled={x.taken || !!x.unsupported} checked={picked.includes(x.name)}
                  onChange={(e) => toggle(x.name, e.target.checked)} />
                {x.name}{x.taken && <em className="muted"> — {t('link.taken')}</em>}
              </label>
              {x.unsupported && <p className="muted" data-testid={`link-unsupported-${x.name}`}>{t('link.unsupported', { reason: t(`designError.${x.unsupported}`) })}</p>}
              {!!x.skipped?.length && <p className="muted" data-testid={`link-skipped-${x.name}`}>{t('link.skipped', { names: x.skipped.join(', ') })}</p>}
            </div>
          ))}
          </div>
        </fieldset>
      )}
      {error && <p className="modal-error" role="alert" data-testid="link-error">{error}</p>}
      <div className="modal-buttons">
        <button type="button" className="btn" data-testid="link-select-all" disabled={busy || free.length === 0} onClick={() => { setPicked(free); setError(null); }}>{t('link.selectAll')}</button>
        <button type="submit" className="btn btn-primary" data-testid="link-ok" disabled={busy || picked.length === 0}>{t('link.ok')}</button>
        <button type="button" className="btn" data-testid="link-cancel" disabled={busy} onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}
