// Home › Text Formatting on a datasheet: the colour choices (font colour, background) and the Datasheet Formatting dialog.
// ponytail: a fixed palette plus the native colour picker (the designers' theme-token palette is a designer module)
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const SWATCHES = ['#000000', '#ffffff', '#808080', '#d9d9d9', '#c8261a', '#f0a43a', '#fff2a8', '#2e9e5b', '#3e63dd', '#7b3fc4'];

/** Colour buttons, the automatic one (the theme's own: onPick(undefined)) and a custom one. */
export function Swatches({ value, onPick, testId }: { value: string | undefined; onPick(v: string | undefined): void; testId: string }) {
  const { t } = useTranslation();
  return (
    <div className="dz-colors" role="group" aria-label={t('sheet.colors')} data-testid={testId}>
      <button type="button" aria-pressed={value === undefined} data-testid={`${testId}-auto`} onClick={() => onPick(undefined)}>{t('datasheet.format.auto')}</button>
      <div className="sheet-swatches">
        {SWATCHES.map((c) => (
          <button key={c} type="button" className="sheet-swatch" aria-label={c} aria-pressed={value === c} data-testid={`${testId}-${c.slice(1)}`} style={{ background: c }} onClick={() => onPick(c)} />
        ))}
      </div>
      <label className="dz-color-custom">
        {t('sheet.customColor')}
        <input type="color" value={value ?? '#000000'} data-testid={`${testId}-custom`} onChange={(e) => onPick(e.target.value.toLowerCase())} />
      </label>
    </div>
  );
}

export interface SheetFormat { horizontal: boolean; vertical: boolean; underline: boolean; back?: string; grid?: string; effect?: 'raised' | 'sunken' }

/** Mise en forme de la feuille de données: gridlines shown, background and gridline colours, underline. OK gives the choices. */
export function FormatBox({ initial, close }: { initial: SheetFormat; close(f: SheetFormat | null): void }) {
  const { t } = useTranslation();
  const [f, setF] = useState(initial);
  const box = (k: 'horizontal' | 'vertical' | 'underline', label: string) => (
    <label className="size-box-row">
      <input type="checkbox" data-testid={`format-${k}`} checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
  return (
    <form className="size-box" onSubmit={(e) => { e.preventDefault(); close(f); }}>
      <fieldset><legend>{t('datasheet.format.gridlines')}</legend>
        {box('horizontal', t('options.datasheet.horizontal'))}
        {box('vertical', t('options.datasheet.vertical'))}
      </fieldset>
      {box('underline', t('options.datasheet.underline'))}
      <fieldset><legend>{t('datasheet.format.cellEffect')}</legend>
        {([undefined, 'raised', 'sunken'] as const).map((e) => (
          <label key={e ?? 'flat'} className="size-box-row">
            <input type="radio" name="cell-effect" data-testid={`format-effect-${e ?? 'flat'}`} checked={f.effect === e} onChange={() => setF({ ...f, effect: e })} />
            <span>{t(`datasheet.format.${e ?? 'flat'}`)}</span>
          </label>
        ))}
      </fieldset>
      <span>{t('ribbon.cmd.textBackColor')}</span>
      <Swatches value={f.back} onPick={(back) => setF({ ...f, back })} testId="format-back" />
      <span>{t('datasheet.format.gridColor')}</span>
      <Swatches value={f.grid} onPick={(grid) => setF({ ...f, grid })} testId="format-grid" />
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="format-ok">{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="format-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}
