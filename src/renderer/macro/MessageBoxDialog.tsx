// ZoneMessage (MessageBox) d'une macro : l'icône du type, le message en texte brut (jamais du HTML), OK.
import { CircleHelp, CircleX, Info, TriangleAlert } from 'lucide-react';
import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModalApi } from '../shell/Modal';

export type MessageBoxType = 'none' | 'critical' | 'warning' | 'question' | 'information';
const ICONS = { critical: CircleX, warning: TriangleAlert, question: CircleHelp, information: Info } as const;

function MessageBox({ message, type, onClose }: { message: string; type: MessageBoxType; onClose(v: true): void }) {
  const { t } = useTranslation();
  const Icon = type === 'none' ? null : ICONS[type];
  return (
    <div data-testid="macro-msgbox">
      <div className="macro-msgbox-body">
        {Icon && <Icon className={`ic ic-lg macro-msgbox-${type}`} aria-hidden />}
        <p className="modal-message" data-testid="macro-msgbox-text">{message}</p>
      </div>
      <div className="modal-buttons">
        <button type="button" className="btn btn-primary" data-testid="macro-msgbox-ok" onClick={() => onClose(true)}>{t('dialog.button.ok')}</button>
      </div>
    </div>
  );
}

export async function showMessageBox(modal: ModalApi, a: { message: string; title: string; type: MessageBoxType }): Promise<void> {
  await modal.custom<true>((close) => createElement(MessageBox, { message: a.message, type: a.type, onClose: close }),
    { titleKey: 'macro.msgbox.title', titleParams: { title: a.title } });
}
