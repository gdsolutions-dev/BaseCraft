// Bandeaux sous le ruban : lecture seule, emplacement à risque, réconciliation, sauvegarde avant migration.
import { Info, Lock, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LockInfo, ReconcileReport, SessionState } from '../../shared/api';

type Kind = 'content' | 'readonly' | 'risk' | 'reconcile' | 'relationsRemoved' | 'relationsDowngraded' | 'relationsUpdated' | 'migrated';

/** Same rule as the main process (session.ts): an unreadable lock is reported as this placeholder. */
const isPlaceholder = (i: LockInfo) => i.pid === 0 && i.sessionId === '?';

const blockedListeners = new Set<() => void>();
/** Something was refused because the content is disabled (an action query, a macro's unsafe action): its message tells the
 *  user to click the security bar's « Activer le contenu », so a dismissed bar comes back. */
export function contentBlocked(): void { for (const f of blockedListeners) f(); }
export function onContentBlocked(f: () => void): () => void {
  blockedListeners.add(f);
  return () => { blockedListeners.delete(f); };
}

/** The security bar: shown while the base's active content (macros, action queries…) is disabled; "Enable Content" approves it. */
export function contentBanner(s: SessionState): { key: 'banner.contentDisabled' } | null {
  return s.content === 'disabled' ? { key: 'banner.contentDisabled' } : null;
}

/** The read-only banner (null when writable). R23: "Reprendre" if and only if the lock is stale — main clears
 *  lockStale once a take-over was refused, which also covers unreadable locks and bases to recover. */
export function readOnlyBanner(s: SessionState): { key: string; params?: Record<string, string>; takeOver: boolean } | null {
  const takeOver = !!s.lockStale;
  if (s.needsRecovery) return { key: 'banner.needsRecovery', takeOver };
  if (!s.readOnly) return null;
  if (s.readOnlyReason === 'fileReadOnly') return { key: 'banner.fileReadOnly', takeOver };
  if (s.readOnlyReason === 'lockLost') return { key: 'banner.lockLost', takeOver };
  const h = s.lockHolder;
  if (!h) return { key: 'banner.readOnlyReleased', takeOver }; // the holder closed the base: no lock left
  if (isPlaceholder(h)) return { key: 'banner.readOnlyUnreadable', takeOver };
  return { key: 'banner.readOnlyHeld', params: { user: h.user, host: h.host }, takeOver };
}

/** What reconcile changed: a count of structure changes, then the relations it dropped or kept without integrity, by name. */
export function reconcileBanners(r: ReconcileReport | undefined): { kind: Kind; key: string; params: Record<string, string | number> }[] {
  if (!r) return [];
  const out: { kind: Kind; key: string; params: Record<string, string | number> }[] = [];
  const count = r.addedTables.length + r.removedTables.length + r.addedFields.length + r.removedFields.length
    + r.removedRelations.length + r.downgradedRelations.length + r.updatedRelations.length;
  if (count > 0) out.push({ kind: 'reconcile', key: 'banner.reconcile', params: { count } });
  if (r.removedRelations.length) out.push({ kind: 'relationsRemoved', key: 'banner.relationsRemoved', params: { names: r.removedRelations.join(', ') } });
  if (r.downgradedRelations.length) out.push({ kind: 'relationsDowngraded', key: 'banner.relationsDowngraded', params: { names: r.downgradedRelations.join(', ') } });
  if (r.updatedRelations.length) out.push({ kind: 'relationsUpdated', key: 'banner.relationsUpdated', params: { names: r.updatedRelations.join(', ') } });
  return out;
}

export function Banners({ session, onTakeOver, onEnableContent }: { session: SessionState; onTakeOver(): void; onEnableContent(): void }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState<Kind[]>([]);
  useEffect(() => setDismissed([]), [session.path]); // dismissal lasts for the session of that base
  const showContentBar = () => setDismissed((d) => d.filter((k) => k !== 'content'));
  useEffect(() => { if (session.content !== 'disabled') showContentBar(); }, [session.content]); // disabled again: the bar returns
  useEffect(() => onContentBlocked(showContentBar), []); // something blocked: the bar returns

  const banner = (kind: Kind, tone: 'warning' | 'info', text: ReactNode, opts: { takeOver?: boolean; enableContent?: boolean; dismissible?: boolean } = {}) =>
    dismissed.includes(kind) ? null : (
      <div key={kind} className={`banner banner-${tone}`} data-testid={`banner-${kind}`} role={tone === 'warning' ? 'alert' : 'status'}>
        {kind === 'readonly' ? <Lock className="ic" aria-hidden /> : tone === 'warning' ? <TriangleAlert className="ic" aria-hidden /> : <Info className="ic" aria-hidden />}
        <span className="banner-text">{text}</span>
        {opts.takeOver && <button className="btn btn-sm" data-testid="banner-takeover" onClick={onTakeOver}>{t('banner.takeOver')}</button>}
        {opts.enableContent && <button className="btn btn-sm" data-testid="banner-enable-content" onClick={onEnableContent}>{t('banner.enableContent')}</button>}
        {opts.dismissible && (
          <button className="iconbtn" data-testid={`banner-dismiss-${kind}`} aria-label={t('banner.dismiss')} title={t('banner.dismiss')}
            onClick={() => setDismissed((d) => [...d, kind])}>
            <X className="ic ic-sm" aria-hidden />
          </button>
        )}
      </div>
    );

  const out: ReactNode[] = [];
  const content = contentBanner(session);
  if (content) out.push(banner('content', 'warning', t(content.key), { enableContent: true, dismissible: true })); // the content stays disabled when dismissed, as Office
  const ro = readOnlyBanner(session);
  if (ro) {
    const text = t(ro.key, ro.params);
    out.push(banner('readonly', 'warning', ro.takeOver && !session.needsRecovery && ro.key !== 'banner.readOnlyReleased' ? t('banner.stale', { message: text }) : text, { takeOver: ro.takeOver }));
  }
  if (session.locationRisk !== 'local') {
    out.push(banner('risk', 'warning', t(session.locationRisk === 'network' ? 'banner.riskNetwork' : 'banner.riskSynced'), { dismissible: true }));
  }
  for (const b of reconcileBanners(session.reconcileReport)) out.push(banner(b.kind, 'info', t(b.key, b.params), { dismissible: true }));
  if (session.migratedBackupPath) out.push(banner('migrated', 'info', t('banner.migrated', { path: session.migratedBackupPath }), { dismissible: true }));

  const shown = out.filter(Boolean);
  return shown.length ? <div className="banners">{shown}</div> : null;
}
