// End of an export (F4): the summary, and for a whole table or query « Save export steps » with the name to keep them under
// (contenu de useModal().custom). Closes with the name chosen, or null.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ExportDoneDialog({ lines, canSave, defaultName, onClose }: { lines: string[]; canSave: boolean; defaultName: string; onClose(v: { name: string | null }): void }) {
  const { t } = useTranslation();
  const [save, setSave] = useState(false);
  const [name, setName] = useState(defaultName);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onClose({ name: save && name.trim() ? name.trim() : null }); }}>
      <p className="modal-message" style={{ whiteSpace: 'pre-line' }}>{lines.join('\n')}</p>
      {canSave && (
        <>
          <label className="modal-field">
            <input type="checkbox" data-testid="export-save-check" checked={save} onChange={(e) => setSave(e.target.checked)} />
            {t('exchange.saveSteps')}
          </label>
          {save && (
            <label className="modal-field">
              <span>{t('exchange.saveName')}</span>
              <input data-testid="export-save-name" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
        </>
      )}
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="modal-btn-ok">{t('dialog.button.ok')}</button>
      </div>
    </form>
  );
}
