// Outils de base de données › Fractionner la base de données (C3 R12, R13), la page de l'Assistant Fractionnement d'Access : les tables
// vont dans un fichier de données, la base actuelle devient une application frontale liée. Concepteur : absent de BaseCraft Runtime.
import { useTranslation } from 'react-i18next';
import { api } from '../bridge';
import type { ModalApi } from '../shell/Modal';
import type { AppDispatch } from '../shell/nav-menu';

/** The wizard's page, then every document closed (as before Compact), the data file chosen (cancelled: nothing), the split; the
 *  result told. A rejection (bc:targetInUse, bc:copyFailed…) goes to the command's error dialog. */
export async function splitDatabase(modal: ModalApi, closeDocuments: () => Promise<boolean>, dispatch: AppDispatch): Promise<void> {
  if ((await modal.custom<true>((close) => <SplitPage onClose={close} />, { titleKey: 'split.title' })) !== true) return;
  if (!(await closeDocuments())) return;
  const path = await api.base.splitPick();
  if (path === null) return;
  const r = await api.base.split(path);
  if (r.ok) void dispatch({ type: 'listsChanged' });
  const messageKey = r.ok ? 'split.done' : r.reason === 'readOnly' ? 'dialog.op.readOnly' : `split.${r.reason}`;
  await modal.confirm({ titleKey: 'split.title', messageKey, params: r.ok ? { path: r.dataFile, backup: r.backupPath } : {}, buttons: ['ok'] });
}

function SplitPage({ onClose }: { onClose(v: true | null): void }) {
  const { t } = useTranslation();
  return (
    <form data-testid="split-dialog" onSubmit={(e) => { e.preventDefault(); onClose(true); }}>
      <p className="modal-message">{t('split.intro')}</p>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="split-ok">{t('split.ok')}</button>
        <button type="button" className="btn" data-testid="split-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}
