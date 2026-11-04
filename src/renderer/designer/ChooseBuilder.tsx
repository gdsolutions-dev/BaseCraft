// R11: « Choisir le générateur » — what « … » asks on an empty event: the macro builder or the function builder.
import { useTranslation } from 'react-i18next';

export function ChooseBuilder({ close }: { close(choice: 'macro' | 'function' | null): void }) {
  const { t } = useTranslation();
  return (
    <div className="modal-buttons">
      <button className="btn btn-primary" data-testid="choose-macro" onClick={() => close('macro')}>{t('builder.choose.macro')}</button>
      <button className="btn" data-testid="choose-function" onClick={() => close('function')}>{t('builder.choose.function')}</button>
      <button className="btn" data-testid="choose-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
    </div>
  );
}
