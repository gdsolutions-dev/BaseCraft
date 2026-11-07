// Sélecteur de couleurs à l'Access (feuille de propriétés et onglet Format) : Automatique, couleurs du thème (base + nuances),
// couleurs standard, récentes, Transparent (fonds seulement), Autres couleurs… (<input type="color"> natif).
// Un seul arrêt de tabulation ; les flèches passent d'une pastille à l'autre (haut/bas : même colonne dans la grille du thème).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { colorCss, type ColorValue } from '../../shared/design/colors';
import type { Mode, Theme } from '../../shared/design/theme';
import { colorLabel, pickerModel, pushRecent, STANDARD_COLORS } from './color-picker-model';

const KEY = 'bc.recentColors';
const HEX = /^#[0-9a-f]{6}$/;
const readRecent = (): ColorValue[] => {
  try { const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is ColorValue => typeof x === 'string' && HEX.test(x)).slice(0, 10) : []; } catch { return []; }
};
const saveRecent = (r: ColorValue[]) => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* confort par utilisateur : sans stockage, pas de récentes */ } };

export interface ColorPickerProps { value: unknown; fill: boolean; theme: Theme; mode: Mode; onPick(v: ColorValue | 'transparent' | null): void; testId: string }

export function ColorPicker({ value, fill, theme, mode, onPick, testId }: ColorPickerProps) {
  const { t } = useTranslation();
  const custom = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState(readRecent);
  const hex = typeof value === 'string' && HEX.test(value) ? value : null;
  const [stop, setStop] = useState<string | null>(null);
  const ctx = { theme, mode };
  const cols = pickerModel(theme, mode);
  const pick = (c: ColorValue) => { if (HEX.test(c)) { const r = pushRecent(recent, c); setRecent(r); saveRecent(r); } onPick(c); };   // une couleur du thème n'entre jamais dans les récentes
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {   // « change », pas « input » : un seul choix quand le sélecteur se ferme
    const el = custom.current!;
    const h = () => pickRef.current(el.value.toLowerCase() as ColorValue);
    el.addEventListener('change', h);
    return () => el.removeEventListener('change', h);
  }, [hex]);   // l'élément est recréé quand la valeur change (key)

  const keys: string[] = ['auto', ...(fill ? ['transparent'] : []), ...cols.flatMap((c) => [`theme:${c.slot}`, ...c.variants.map((v) => v.value)]), ...STANDARD_COLORS, ...recent.map((c) => `r:${c}`), 'more'];
  const first = value === undefined || value === null ? 'auto' : keys.find((k) => k === value) ?? (hex ? 'more' : 'auto');
  const tab = (k: string) => (k === (stop ?? first) ? 0 : -1);
  const rove = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button, input')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: 10, ArrowUp: -10 } as Record<string, number | undefined>)[e.key];
    if (i < 0 || (step === undefined && e.key !== 'Home' && e.key !== 'End')) return;
    e.preventDefault(); e.stopPropagation();
    const n = items.length;
    const grid = (j: number) => items[j]?.dataset.grid === '1';
    let next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + Math.sign(step!) + n) % n;
    if (Math.abs(step ?? 0) === 10 && grid(i) && grid(i + step!)) next = i + step!;   // même colonne de la grille du thème
    setStop(items[next]!.dataset.key!);
    items[next]!.focus();
  };
  const swatch = (k: string, css: string, label: string, id: string, pressed: boolean, onClick: () => void, grid = false) => (
    <button key={k} type="button" className="dz-cp-sw" title={label} aria-label={label} aria-pressed={pressed} data-testid={`colorpicker-${id}`} data-key={k}
      data-grid={grid ? '1' : undefined} tabIndex={tab(k)} style={{ background: css }} onClick={onClick} />
  );
  const sw = (c: ColorValue, id: string, grid = false, k: string = c) => swatch(k, colorCss(c, 'transparent', ctx), colorLabel(c, t), id, value === c, () => pick(c), grid);
  return (
    <div className="dz-colors dz-cp" role="group" aria-label={t('sheet.colors')} data-testid={testId} onKeyDown={rove}>
      <button type="button" data-key="auto" data-testid="colorpicker-auto" tabIndex={tab('auto')} aria-pressed={value === undefined || value === null} onClick={() => onPick(null)}>
        <i className="dz-swatch" style={{ background: colorCss(undefined, 'theme:text', ctx) }} aria-hidden />{t('colorpicker.automatic')}
      </button>
      {fill && (
        <button type="button" data-key="transparent" data-testid="colorpicker-transparent" tabIndex={tab('transparent')} onClick={() => onPick('transparent')}>
          <i className="dz-swatch dz-swatch-none" aria-hidden />{t('colorpicker.transparent')}
        </button>
      )}
      <div className="dz-cp-title">{t('colorpicker.themeColors')}</div>
      <div className="dz-cp-grid" role="presentation">
        {cols.map((c) => swatch(`theme:${c.slot}`, c.base, colorLabel(`theme:${c.slot}`, t), `theme-${c.slot}`, value === `theme:${c.slot}`, () => pick(`theme:${c.slot}` as ColorValue), true))}
        {Array.from({ length: 5 }, (_, r) => cols.map((c) => { const v = c.variants[r]!; return sw(v.value, `theme-${c.slot}-${v.mode === 'tint' ? 'l' : 'd'}${v.pct}`, true); }))}
      </div>
      <div className="dz-cp-title">{t('colorpicker.standardColors')}</div>
      <div className="dz-cp-grid" role="presentation">{STANDARD_COLORS.map((c) => sw(c, `std-${c.slice(1)}`))}</div>
      {recent.length > 0 && <>
        <div className="dz-cp-title">{t('colorpicker.recent')}</div>
        <div className="dz-cp-grid" role="presentation">{recent.map((c) => sw(c, `recent-${c.slice(1)}`, false, `r:${c}`))}</div>
      </>}
      <label className="dz-color-custom" data-testid="colorpicker-more">
        <i className="dz-swatch" style={{ background: hex ?? 'transparent' }} aria-hidden />{t('colorpicker.more')}
        <input ref={custom} key={hex ?? ''} type="color" defaultValue={hex ?? '#000000'} data-key="more" data-testid={`${testId}-custom`} tabIndex={tab('more')} />
      </label>
    </div>
  );
}
