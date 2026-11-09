// Éditeur de couleur d'une cellule (bouton + sélecteur de couleurs), à part de la feuille de propriétés pour que le volet du graphique ne tire pas tout le concepteur.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { colorCss } from '../../shared/design/colors';
import { useDocTheme } from '../design/theme-context';
import { ColorPicker } from './ColorPicker';
import { colorLabel } from './color-picker-model';

/** Échap ou un clic dehors referme le choix des couleurs ; le focus revient au bouton. La cellule montre « Accent 2, Plus clair 80% » (aussi en infobulle). */
export function ColorEditor({ id, testId, value, mixed, disabled, fill, commit, transparent }: { id: string; testId: string; value: unknown; mixed: boolean; disabled: boolean; fill: boolean;
  commit(v: unknown): string | null; transparent?(): void }) {
  const { t } = useTranslation();
  const ctx = useDocTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const label = mixed ? t('sheet.mixed') : colorLabel(value, t);
  return (
    <div ref={box} className="dz-pfield" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
      <button ref={button} type="button" id={id} data-testid={testId} className="dz-pcolor" disabled={disabled} aria-expanded={open} title={label} onClick={() => setOpen(!open)}>
        {!mixed && <i className="dz-swatch" style={{ background: colorCss(value, 'transparent', ctx) }} aria-hidden />}<span>{label}</span>
      </button>
      {open && !disabled && (
        <ColorPicker value={mixed ? undefined : value} fill={fill} theme={ctx.theme} mode={ctx.mode} testId={`${testId}-colors`}
          onPick={(c) => { if (c === 'transparent') transparent?.(); else commit(c ?? undefined); setOpen(false); button.current?.focus(); }} />
      )}
    </div>
  );
}
