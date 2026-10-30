// Conflit d'écriture (C3 R9) : l'enregistrement a changé depuis le début de la saisie. Enregistrer, copier ou abandonner.
import { useTranslation } from 'react-i18next';
import type { ModalApi } from './Modal';

export type ConflictChoice = 'save' | 'copy' | 'drop';

function WriteConflict({ close }: { close: (v: ConflictChoice | null) => void }) {
  const { t } = useTranslation();
  return (
    <div data-testid="write-conflict">
      <p className="modal-message">{t('wc.message')}</p>
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="wc-save" onClick={() => close('save')}>{t('wc.save')}</button>
        <button className="btn" data-testid="wc-copy" onClick={() => close('copy')}>{t('wc.copy')}</button>
        <button className="btn" data-testid="wc-drop" onClick={() => close('drop')}>{t('wc.drop')}</button>
      </div>
    </div>
  );
}

/** The Write Conflict dialog; Escape (close(null)) is Drop Changes. */
export async function askWriteConflict(modal: ModalApi): Promise<ConflictChoice> {
  return (await modal.custom<ConflictChoice>((close) => <WriteConflict close={close} />, { titleKey: 'wc.title' })) ?? 'drop';
}

/** The edited record for the clipboard: the field names, then the values as the view shows them; tab-separated, CRLF. */
export function recordText(names: string[], texts: string[]): string {
  return `${names.join('\t')}\r\n${texts.join('\t')}`;
}

/** The record was deleted by another user: its changes cannot be saved. */
export async function showRecordDeleted(modal: ModalApi): Promise<void> {
  await modal.confirm({ titleKey: 'wc.title', messageKey: 'wc.deleted', buttons: ['ok'] });
}
