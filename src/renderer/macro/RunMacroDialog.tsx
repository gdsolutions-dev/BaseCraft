// Outils de base de données › Exécuter une macro : le nom d'une macro ou d'une sous-macro (« M.Sous »), choisi ou tapé.
import { createElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ComboBox } from '../shell/ComboBox';
import type { ModalApi } from '../shell/Modal';

function RunMacroForm({ names, onClose }: { names: string[]; onClose(v: string | null): void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const chosen = name.trim();
  return (
    <form data-testid="run-macro-dialog" onSubmit={(e) => { e.preventDefault(); if (chosen) onClose(chosen); }}>
      <div className="modal-field">
        <label htmlFor="run-macro-name">{t('macro.run.name')}</label>
        <ComboBox id="run-macro-name" testId="run-macro-name" label={t('macro.run.name')} value={name}
          options={names.map((n, i) => ({ id: `o${i}`, label: n }))} onChange={setName} />
      </div>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="run-macro-ok" disabled={!chosen}>{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="run-macro-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}

export const askMacroToRun = (modal: ModalApi, names: string[]): Promise<string | null> =>
  modal.custom<string>((close) => createElement(RunMacroForm, { names, onClose: close }), { titleKey: 'macro.run.title' });
