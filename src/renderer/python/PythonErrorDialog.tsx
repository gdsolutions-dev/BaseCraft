// R10: a Python error from an event or RunCode: type, message, module and line, the traceback on demand; « Débogage » (full app
// only) opens the module at that line.
import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import type { ModalApi } from '../shell/Modal';
import type { PyError } from '../../shared/python/bridge';
import { PythonError } from './python-host';

export interface PythonErrorOptions { debug: boolean; open(module: string, line: number, message?: string): void }

/** « ZeroDivisionError : division by zero »; an interrupt has its own text. */
export const pythonErrorText = (i: PyError): string =>
  i.type === 'KeyboardInterrupt' ? i18n.t('python.error.interrupted') : i18n.t('python.error.text', { type: i.type, message: i.message });

/** The error's text, its place, and « Débogage » / « Fin »; used by this dialog and by Action Failed. */
export function PythonErrorBody({ e, o, onClose, ids }: { e: PythonError; o: PythonErrorOptions; onClose(): void; ids?: { text: string } }) {
  const { t } = useTranslation();
  const i = e.info, place = i.module !== null && i.line !== null ? { module: i.module, line: i.line } : null;
  return (
    <div data-testid="python-error">
      <p className="modal-message" role="alert" data-testid={ids?.text ?? 'python-error-text'}>{pythonErrorText(i)}</p>
      {place && <p data-testid="python-error-where">{t('python.error.where', place)}</p>}
      {i.traceback && <details><summary>{t('python.error.traceback')}</summary><pre data-testid="python-error-traceback">{i.traceback}</pre></details>}
      <div className="modal-buttons">
        {o.debug && place && <button type="button" className="btn" data-testid="python-error-debug"
          onClick={() => { onClose(); o.open(place.module, place.line, pythonErrorText(i)); }}>{t('python.error.debug')}</button>}
        <button type="button" className="btn btn-primary" data-testid="python-error-end" onClick={onClose}>{t('python.error.end')}</button>
      </div>
    </div>
  );
}

export async function showPythonError(modal: ModalApi, e: PythonError, o: PythonErrorOptions): Promise<void> {
  await modal.custom<true>((close) => createElement(PythonErrorBody, { e, o, onClose: () => close(true) }), { titleKey: 'python.error.title' });
}
