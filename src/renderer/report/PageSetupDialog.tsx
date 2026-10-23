// Mise en page d'un état (contenu de useModal().custom) : orientation et quatre marges, affichées en cm, rendues en twips ;
// menus Marges et Taille du ruban (mode Création et Aperçu avant impression).
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cmToTwips, twipsToCm } from '../../shared/design/model';
import type { PageSetup } from '../../shared/report/model';
import { RibbonPopup } from '../designer/RibbonPopup';
import { MARGIN_PRESETS, marginPreset } from './page-setup';

const SIDES = ['top', 'bottom', 'left', 'right'] as const;
const MAX_CM = 10; // readReport keeps margins of at most 5670 twips

export function PageSetupDialog({ initial, onClose }: { initial: PageSetup; onClose(v: PageSetup | null): void }) {
  const { t, i18n } = useTranslation();
  const show = (twips: number) => twipsToCm(twips).toLocaleString(i18n.language, { maximumFractionDigits: 2, useGrouping: false });
  const [orientation, setOrientation] = useState(initial.orientation);
  const [margins, setMargins] = useState(() => Object.fromEntries(SIDES.map((s) => [s, show(initial.margins[s])])) as Record<typeof SIDES[number], string>);
  const [bad, setBad] = useState<typeof SIDES[number][]>([]); // the margins refused, each marked invalid and described by the message
  const errorId = useId();

  const ok = () => {
    const texts = SIDES.map((s) => margins[s].trim().replace(',', '.'));
    const cm = texts.map(Number);
    const wrong = SIDES.filter((_, i) => texts[i] === '' || !Number.isFinite(cm[i]) || cm[i]! < 0 || cm[i]! > MAX_CM);
    if (wrong.length) {
      setBad(wrong);
      return;
    }
    const [top, bottom, left, right] = cm.map(cmToTwips) as [number, number, number, number];
    onClose({ orientation, margins: { top, right, bottom, left } });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); ok(); }}>
      <fieldset className="modal-field rp-setup">
        <legend>{t('report.pageSetup.orientation')}</legend>
        {(['portrait', 'landscape'] as const).map((o) => (
          <label key={o}>
            <input type="radio" name="orientation" data-testid={`page-setup-${o}`} checked={orientation === o} onChange={() => setOrientation(o)} />
            {t(`report.pageSetup.${o}`)}
          </label>
        ))}
      </fieldset>
      <fieldset className="modal-field rp-setup">
        <legend>{t('report.pageSetup.margins')}</legend>
        <div className="rp-margins">
          {SIDES.map((s) => (
            <label key={s}>
              <span>{t(`report.pageSetup.${s}`)}</span>
              <input data-testid={`page-setup-margin-${s}`} inputMode="decimal" value={margins[s]} aria-invalid={bad.includes(s)}
                aria-describedby={bad.includes(s) ? errorId : undefined}
                onChange={(e) => { setMargins((m) => ({ ...m, [s]: e.target.value })); setBad((b) => b.filter((x) => x !== s)); }} />
            </label>
          ))}
        </div>
        {bad.length > 0 && <span id={errorId} className="modal-error" role="alert" data-testid="page-setup-error">{t('report.pageSetup.invalid')}</span>}
      </fieldset>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="modal-btn-ok">{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="modal-btn-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}

/** Le menu Marges (préréglages, puis Marges personnalisées… : la boîte Mise en page) ou Taille (A4 seulement), sous son bouton. */
export function PageSetupMenu(p: { menu: 'margins' | 'pageSize'; page: PageSetup; onPick(v: Partial<PageSetup> | 'custom'): void; onClose(): void }) {
  const { t } = useTranslation();
  const pick = (v: Partial<PageSetup> | 'custom') => { p.onClose(); p.onPick(v); };
  const item = (id: string, label: string, checked: boolean, v: Partial<PageSetup> | 'custom' | null) => (
    <button key={id} type="button" role="menuitemradio" aria-checked={checked} data-testid={`${p.menu === 'margins' ? 'margins' : 'page-size'}-menu-${id}`}
      onClick={() => (v === null ? p.onClose() : pick(v))}>
      <Check size={14} aria-hidden style={{ visibility: checked ? 'visible' : 'hidden' }} />{label}
    </button>
  );
  if (p.menu === 'pageSize') {
    return <RibbonPopup anchor="pageSize" testId="page-size-menu" labelKey="ribbon.cmd.pageSize" onClose={p.onClose}>{item('a4', t('report.pageSize.a4'), true, null)}</RibbonPopup>;
  }
  const preset = marginPreset(p.page);
  return (
    <RibbonPopup anchor="margins" testId="margins-menu" labelKey="ribbon.cmd.margins" onClose={p.onClose}>
      {(Object.keys(MARGIN_PRESETS) as (keyof typeof MARGIN_PRESETS)[]).map((k) => item(k, t(`report.margins.${k}`), preset === k, { margins: MARGIN_PRESETS[k] }))}
      <div className="ctxmenu-sep" role="separator" />
      {item('custom', t('report.margins.custom'), preset === null, 'custom')}
    </RibbonPopup>
  );
}
