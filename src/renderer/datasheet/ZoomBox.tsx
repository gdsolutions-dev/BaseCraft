// Zoom (Access's Zoom box) : le texte d'une cellule texte dans une zone plus grande, pour lire ou corriger un long texte.
// OK rend le texte saisi ; Annuler (ou Échap) ne change rien. Lecture seule : la zone ne se modifie pas.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ZoomBox({ text, readOnly, close }: { text: string; readOnly: boolean; close(v: string | null): void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(text);
  useEffect(() => { ref.current?.querySelector('textarea')?.focus(); }, []);
  return (
    <div ref={ref} className="zoom-box">
      <textarea className="zoom-box-text" data-testid="zoom-box-text" aria-label={t('ribbon.cmd.zoom')} value={value} readOnly={readOnly}
        onChange={(e) => setValue(e.target.value)} />
      <div className="modal-buttons">
        {!readOnly && <button className="btn btn-primary" data-testid="zoom-ok" onClick={() => close(value)}>{t('dialog.button.ok')}</button>}
        <button className="btn" data-testid="zoom-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
