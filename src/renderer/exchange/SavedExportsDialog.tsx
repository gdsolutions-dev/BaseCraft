// Saved Exports (F4): the exports kept in the base, each to run or delete (contenu de useModal().custom). Closes with the name to
// run, or null.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SavedExport } from '../../shared/exchange';
import { api } from '../bridge';
import { useErrorDialog } from '../shell/Modal';

const FORMAT_KEY = { text: 'fmtText', excel: 'fmtExcel', xml: 'fmtXml', html: 'fmtHtml' } as const;

export function SavedExportsDialog({ onClose }: { onClose(v: string | null): void }) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const [list, setList] = useState<Record<string, SavedExport> | null>(null);
  const load = () => api.exchange.savedList().then(setList, (e: unknown) => { void showError(e); });
  useEffect(() => { void load(); }, []);
  const remove = (name: string) => api.exchange.deleteSaved(name).then(load, (e: unknown) => { void showError(e); });
  const names = Object.keys(list ?? {});
  return (
    <div>
      {list !== null && names.length === 0 && <p className="modal-message" data-testid="saved-empty">{t('exchange.savedEmpty')}</p>}
      <ul className="modal-list" data-testid="saved-list">
        {names.map((n) => (
          <li key={n} className="modal-row" data-testid={`saved-${n}`}>
            <span style={{ flex: 1 }}>{n} <em className="muted">({t(`exchange.${FORMAT_KEY[list![n]!.format]}`)}: {list![n]!.name})</em></span>
            <button type="button" className="btn" data-testid={`saved-run-${n}`} onClick={() => onClose(n)}>{t('exchange.savedRun')}</button>
            <button type="button" className="btn" data-testid={`saved-delete-${n}`} onClick={() => void remove(n)}>{t('exchange.savedDelete')}</button>
          </li>
        ))}
      </ul>
      <div className="modal-buttons">
        <button type="button" className="btn btn-primary" data-testid="saved-close" onClick={() => onClose(null)}>{t('dialog.button.ok')}</button>
      </div>
    </div>
  );
}
