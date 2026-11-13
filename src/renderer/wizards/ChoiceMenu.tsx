// A small menu in a dialog (Create › More Forms, Navigation): one button per choice; a disabled one says why under its label.
import { useTranslation } from 'react-i18next';
import type { ModalApi } from '../shell/Modal';
import './wizard.css';

export interface Choice<T extends string> { id: T; labelKey: string; /** shown under the label (why it is disabled, or what it does not do) */ noteKey?: string; disabled?: boolean }

export const choose = <T extends string>(modal: ModalApi, titleKey: string, choices: Choice<T>[]): Promise<T | null> =>
  modal.custom<T>((close) => <ChoiceMenu choices={choices} onClose={close} />, { titleKey });

function ChoiceMenu<T extends string>({ choices, onClose }: { choices: Choice<T>[]; onClose(v: T | null): void }) {
  const { t } = useTranslation();
  return (
    <div className="wiz" data-testid="choice-menu">
      <div className="wiz-body">
        {choices.map((c) => (
          <button key={c.id} type="button" className="btn choice" data-testid={`choice-${c.id}`} disabled={c.disabled} onClick={() => onClose(c.id)}>
            <span>{t(c.labelKey)}</span>
            {c.noteKey && <small>{t(c.noteKey)}</small>}
          </button>
        ))}
      </div>
      <div className="modal-buttons"><button type="button" className="btn" data-testid="choice-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button></div>
    </div>
  );
}
