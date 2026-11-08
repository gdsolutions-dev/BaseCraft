// Macro Design › Tools › Convert Macros to Python (D4): the two options of the conversion, both ticked as in Access.
import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConvertOptions } from '../../shared/macro/to-python';
import type { ModalApi } from '../shell/Modal';

function ConvertForm({ onClose }: { onClose(v: ConvertOptions | null): void }) {
  const { t } = useTranslation();
  return (
    <form data-testid="convert-macros-dialog" onSubmit={(e) => {
      e.preventDefault();
      const f = e.currentTarget.elements;
      onClose({ errorHandling: (f.namedItem('errorHandling') as HTMLInputElement).checked, comments: (f.namedItem('comments') as HTMLInputElement).checked });
    }}>
      <div className="modal-field">
        <label><input type="checkbox" name="errorHandling" data-testid="convert-error-handling" defaultChecked /> {t('macro.convert.errorHandling')}</label>
      </div>
      <div className="modal-field">
        <label><input type="checkbox" name="comments" data-testid="convert-comments" defaultChecked /> {t('macro.convert.comments')}</label>
      </div>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="convert-macros-ok">{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="convert-macros-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}

export const askConvertOptions = (modal: ModalApi): Promise<ConvertOptions | null> =>
  modal.custom<ConvertOptions>((close) => createElement(ConvertForm, { onClose: close }), { titleKey: 'macro.convert.title' });
