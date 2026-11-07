// Boîte Personnaliser les couleurs : 12 emplacements, une colonne Clair et une colonne Sombre. Elle modifie une copie ; OK l'applique à l'objet.
// Un Sombre jamais modifié suit le Clair de son emplacement (customizeColors) ; « Enregistrer » est l'étape explicite du thème personnalisé.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { THEME_SLOTS, type ThemeSlot } from '../../shared/design/theme';
import { trapFocus } from '../shell/Modal';
import { customizeColors, isValidScheme, type ColorScheme } from './scheme-gallery-model';

type Edits = Partial<Record<ThemeSlot, { light?: string; dark?: string }>>;

export function CustomizeColorsDialog(p: { base: ColorScheme; readOnly?: boolean; onOk(s: ColorScheme): void; onSave(s: ColorScheme): void; onCancel(): void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {   // le focus entre dans la boîte à l'ouverture et revient à l'élément précédent à la fermeture (comme Modal)
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input')?.focus();
    return () => before?.focus?.();
  }, []);
  const [edits, setEdits] = useState<Edits>({});
  const [name, setName] = useState(p.base.name);
  const scheme = customizeColors(p.base, edits, name.trim());
  const valid = isValidScheme(scheme) && name.trim().length <= 60;
  const set = (slot: ThemeSlot, side: 'light' | 'dark', v: string) => setEdits((e) => ({ ...e, [slot]: { ...e[slot], [side]: v } }));
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation();   // les raccourcis du shell n'atteignent pas la page derrière
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
    else trapFocus(e, ref.current);
  };
  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal card cc" role="dialog" aria-modal="true" aria-labelledby="colors-dialog-title" data-testid="colors-dialog" onKeyDown={keys}>
        <h2 id="colors-dialog-title" className="modal-title">{t('colorsGallery.title')}</h2>
        <div className="cc-grid">
          <div className="cc-row"><span /><b>{t('colorsGallery.light')}</b><b>{t('colorsGallery.dark')}</b></div>
          {THEME_SLOTS.map((s) => (
            <div key={s} className="cc-row">
              <span>{t(`color.${s}`)}</span>
              <input type="color" data-testid={`colors-${s}-light`} aria-label={`${t(`color.${s}`)} ${t('colorsGallery.light')}`} value={scheme.light[s]} onChange={(e) => set(s, 'light', e.target.value)} />
              <input type="color" data-testid={`colors-${s}-dark`} aria-label={`${t(`color.${s}`)} ${t('colorsGallery.dark')}`} value={scheme.dark[s]} onChange={(e) => set(s, 'dark', e.target.value)} />
            </div>
          ))}
        </div>
        <label className="modal-field">
          <span>{t('colorsGallery.name')}</span>
          <input data-testid="colors-name" type="text" autoComplete="off" value={name} aria-invalid={!valid} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-buttons">
          <button type="button" className="btn" data-testid="colors-reset" onClick={() => { setEdits({}); setName(p.base.name); }}>{t('colorsGallery.reset')}</button>
          <button type="button" className="btn" data-testid="colors-save" disabled={!valid} onClick={() => p.onSave(scheme)}>{t('colorsGallery.save')}</button>
          <button type="button" className="btn btn-primary" data-testid="colors-ok" disabled={!valid || p.readOnly} onClick={() => p.onOk(scheme)}>{t('dialog.button.ok')}</button>
          <button type="button" className="btn" data-testid="colors-cancel" onClick={p.onCancel}>{t('dialog.button.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
