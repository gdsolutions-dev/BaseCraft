// « Exécution… » with Stop while a query call lasts (running.ts), wherever it runs: a query's datasheet, an action query, a
// slow page of a datasheet. Ctrl+Break stops it too, as in Access. Not modal: the other documents stay usable.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../bridge';
import { useErrorDialog } from './Modal';
import { isSlow, subscribeSlow } from './running';

export function RunningNotice() {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const slow = useSyncExternalStore(subscribeSlow, isSlow);
  const stop = useCallback(() => { api.queries.cancel().catch((e: unknown) => void showError(e)); }, [showError]);
  useEffect(() => {
    // Ctrl+Break: key Cancel (Windows), code Pause; only while « Exécution… » shows (a quick page read is never stopped)
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'Cancel' || e.code === 'Pause')) { e.preventDefault(); if (isSlow()) stop(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stop]);
  if (!slow) return null;
  return (
    <div className="running-notice" role="status" data-testid="running-notice">
      <span>{t('query.run.running')}</span>
      <button type="button" className="btn" data-testid="query-cancel" aria-keyshortcuts="Control+Pause" onClick={stop}>{t('query.run.stop')}</button>
    </div>
  );
}
