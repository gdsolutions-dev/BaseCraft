// Numéros de page (contenu de useModal().custom) : la boîte 5090 d'Access (docs/analyse-access/interface.md) — Format, Position,
// Alignement, Afficher le numéro sur la première page ; les alignements Intérieur et Extérieur sont laissés de côté.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PageNumberOptions } from './header-items';

export type PageNumberChoice = Omit<PageNumberOptions, 'lang'>;
const ALIGNS = ['left', 'center', 'right'] as const;

export function PageNumbersDialog({ onClose }: { onClose(v: PageNumberChoice | null): void }) {
  const { t } = useTranslation();
  const [o, setO] = useState<PageNumberChoice>({ format: 'pageN', position: 'top', align: 'center', firstPage: true });
  const radio = <K extends 'format' | 'position'>(key: K, value: PageNumberChoice[K]) => (
    <label key={value}>
      <input type="radio" name={key} data-testid={`page-numbers-${key}-${value}`} checked={o[key] === value} onChange={() => setO({ ...o, [key]: value })} />
      {t(`report.pageNumbers.${value}`)}
    </label>
  );
  return (
    <form onSubmit={(e) => { e.preventDefault(); onClose(o); }}>
      <fieldset className="modal-field rp-setup">
        <legend>{t('report.pageNumbers.format')}</legend>
        {radio('format', 'pageN')}{radio('format', 'pageNofM')}
      </fieldset>
      <fieldset className="modal-field rp-setup">
        <legend>{t('report.pageNumbers.position')}</legend>
        {radio('position', 'top')}{radio('position', 'bottom')}
      </fieldset>
      <label className="modal-field rd-dialog-field">
        <span>{t('report.pageNumbers.align')}</span>
        <select data-testid="page-numbers-align" value={o.align} onChange={(e) => setO({ ...o, align: e.target.value as PageNumberChoice['align'] })}>
          {ALIGNS.map((a) => <option key={a} value={a}>{t(`report.pageNumbers.${a}`)}</option>)}
        </select>
      </label>
      <div className="modal-field rp-setup">
        <label><input type="checkbox" data-testid="page-numbers-first-page" checked={o.firstPage} onChange={(e) => setO({ ...o, firstPage: e.target.checked })} />
          {t('report.pageNumbers.firstPage')}</label>
      </div>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="modal-btn-ok">{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="modal-btn-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}
