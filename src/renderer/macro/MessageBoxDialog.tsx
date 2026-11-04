// ZoneMessage (MessageBox) d'une macro : l'icône du type, le message en texte brut (jamais du HTML), OK.
import { CircleHelp, CircleX, Info, TriangleAlert } from 'lucide-react';
import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModalApi } from '../shell/Modal';

export type MessageBoxType = 'none' | 'critical' | 'warning' | 'question' | 'information';
export type MsgBoxButtons = 'ok' | 'ok_cancel' | 'yes_no' | 'yes_no_cancel' | 'retry_cancel' | 'abort_retry_ignore';
export type MsgBoxAnswer = 'ok' | 'cancel' | 'yes' | 'no' | 'retry' | 'abort' | 'ignore';
const BUTTONS: Record<MsgBoxButtons, MsgBoxAnswer[]> = {
  ok: ['ok'], ok_cancel: ['ok', 'cancel'], yes_no: ['yes', 'no'], yes_no_cancel: ['yes', 'no', 'cancel'],
  retry_cancel: ['retry', 'cancel'], abort_retry_ignore: ['abort', 'retry', 'ignore'],
};
/** Closing the box (Escape, the close button): Cancel if offered, else OK, else No, else the first button (R11). */
export function closeAnswer(buttons: MsgBoxButtons): MsgBoxAnswer {
  const b = BUTTONS[buttons];
  return b.includes('cancel') ? 'cancel' : b.includes('ok') ? 'ok' : b.includes('no') ? 'no' : b[0];
}
const ICONS = { critical: CircleX, warning: TriangleAlert, question: CircleHelp, information: Info } as const;

function MessageBox({ message, type, buttons, onClose }: { message: string; type: MessageBoxType; buttons: MsgBoxButtons; onClose(v: MsgBoxAnswer): void }) {
  const { t } = useTranslation();
  const Icon = type === 'none' ? null : ICONS[type];
  return (
    <div data-testid="macro-msgbox">
      <div className="macro-msgbox-body">
        {Icon && <Icon className={`ic ic-lg macro-msgbox-${type}`} aria-hidden />}
        <p className="modal-message" data-testid="macro-msgbox-text">{message}</p>
      </div>
      <div className="modal-buttons">
        {BUTTONS[buttons].map((b, i) => (
          <button key={b} type="button" className={`btn${i === 0 ? ' btn-primary' : ''}`} data-testid={`macro-msgbox-${b}`} onClick={() => onClose(b)}>{t(`dialog.button.${b}`)}</button>
        ))}
      </div>
    </div>
  );
}

export async function showMessageBox(modal: ModalApi, a: { message: string; title: string; type: MessageBoxType; buttons?: MsgBoxButtons }): Promise<MsgBoxAnswer> {
  const buttons = a.buttons ?? 'ok';
  const r = await modal.custom<MsgBoxAnswer>((close) => createElement(MessageBox, { message: a.message, type: a.type, buttons, onClose: close }),
    { titleKey: 'macro.msgbox.title', titleParams: { title: a.title } });
  return r ?? closeAnswer(buttons);
}
