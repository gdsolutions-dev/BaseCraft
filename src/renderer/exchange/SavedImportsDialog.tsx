// Saved Imports: the imports kept in the base, each to run or delete (contenu de useModal().custom). Closes with the name to run,
// or null.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SavedImport } from '../../shared/exchange';
import { api } from '../bridge';
import { useErrorDialog } from '../shell/Modal';

const SOURCE_KEY = { text: 'fmtText', excel: 'fmtExcel', xml: 'fmtXml' } as const;

export function SavedImportsDialog({ onClose }: { onClose(v: string | null): void }) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const [list, setList] = useState<Record<string, SavedImport> | null>(null);
  const load = () => api.exchange.savedImportList().then(setList, (e: unknown) => { void showError(e); });
  useEffect(() => { void load(); }, []);
  const remove = (name: string) => api.exchange.deleteSavedImport(name).then(load, (e: unknown) => { void showError(e); });
  const names = Object.keys(list ?? {});
  return (
    <div>
      {list !== null && names.length === 0 && <p className="modal-message" data-testid="saved-import-empty">{t('exchange.savedImportEmpty')}</p>}
      <ul className="modal-list" data-testid="saved-import-list">
        {names.map((n) => (
          <li key={n} className="modal-row" data-testid={`saved-import-${n}`}>
            <span style={{ flex: 1 }}>{n} <em className="muted">({t(`exchange.${SOURCE_KEY[list![n]!.source]}`)}: {list![n]!.plan.target.table})</em></span>
            <button type="button" className="btn" data-testid={`saved-import-run-${n}`} onClick={() => onClose(n)}>{t('exchange.savedRun')}</button>
            <button type="button" className="btn" data-testid={`saved-import-delete-${n}`} onClick={() => void remove(n)}>{t('exchange.savedDelete')}</button>
          </li>
        ))}
      </ul>
      <div className="modal-buttons">
        <button type="button" className="btn btn-primary" data-testid="saved-import-close" onClick={() => onClose(null)}>{t('dialog.button.ok')}</button>
      </div>
    </div>
  );
}
