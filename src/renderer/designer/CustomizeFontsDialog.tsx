// Boîte Personnaliser les polices : police des titres et du corps, parmi les polices embarquées seulement. Elle modifie une copie ; OK l'applique à l'objet.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { EMBEDDED_FONTS } from '../../shared/fonts';
import { trapFocus } from '../shell/Modal';
import { isValidFontScheme, type FontScheme } from './scheme-gallery-model';

export function CustomizeFontsDialog(p: { base: FontScheme; readOnly?: boolean; onOk(s: FontScheme): void; onSave(s: FontScheme): void; onCancel(): void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {   // le focus entre dans la boîte à l'ouverture et revient à l'élément précédent à la fermeture (comme Modal)
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('select')?.focus();
    return () => before?.focus?.();
  }, []);
  const [major, setMajor] = useState(p.base.major);
  const [minor, setMinor] = useState(p.base.minor);
  const [name, setName] = useState(p.base.name);
  const scheme: FontScheme = { name: name.trim(), major, minor };
  const valid = isValidFontScheme(scheme) && scheme.name.length <= 60;
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation();   // les raccourcis du shell n'atteignent pas la page derrière
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
    else trapFocus(e, ref.current);
  };
  const pick = (id: string, label: string, value: string, set: (v: string) => void) => (
    <label className="modal-field">
      <span>{label}</span>
      <select data-testid={id} value={value} onChange={(e) => set(e.target.value)}>
        {!EMBEDDED_FONTS.some((f) => f.family === value) && <option value={value}>{value}</option>}
        {EMBEDDED_FONTS.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
      </select>
    </label>
  );
  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal card cc" role="dialog" aria-modal="true" aria-labelledby="fonts-dialog-title" data-testid="fonts-dialog" onKeyDown={keys}>
        <h2 id="fonts-dialog-title" className="modal-title">{t('fontsGallery.title')}</h2>
        {pick('fonts-major', t('fontsGallery.major'), major, setMajor)}
        {pick('fonts-minor', t('fontsGallery.minor'), minor, setMinor)}
        <label className="modal-field">
          <span>{t('fontsGallery.name')}</span>
          <input data-testid="fonts-name" type="text" autoComplete="off" value={name} aria-invalid={!valid} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-buttons">
          <button type="button" className="btn" data-testid="fonts-save" disabled={!valid} onClick={() => p.onSave(scheme)}>{t('fontsGallery.save')}</button>
          <button type="button" className="btn btn-primary" data-testid="fonts-ok" disabled={!valid || p.readOnly} onClick={() => p.onOk(scheme)}>{t('dialog.button.ok')}</button>
          <button type="button" className="btn" data-testid="fonts-cancel" onClick={p.onCancel}>{t('dialog.button.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
