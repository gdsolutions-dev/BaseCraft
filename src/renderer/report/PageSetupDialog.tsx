// Mise en page d'un état (contenu de useModal().custom), comme la boîte d'Access : onglets Options d'impression (marges, Données
// seulement), Page (orientation, taille du papier) et Colonnes (grille, taille des colonnes, format). Les valeurs sont saisies en cm,
// rendues en twips. Menus Marges et Taille du ruban (mode Création et Aperçu avant impression).
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cmToTwips, twipsToCm } from '../../shared/design/model';
import { columnWidth, MAX_COLUMNS, PAPERS, pageGeometry, type PageSetup, type PaperId } from '../../shared/report/model';
import { RibbonPopup } from '../designer/RibbonPopup';
import { MARGIN_PRESETS, marginPreset, type PageSetupChoice, type PageSetupInput } from './page-setup';

const SIDES = ['top', 'bottom', 'left', 'right'] as const;
type Side = typeof SIDES[number];
type Field = Side | 'count' | 'spacing' | 'width' | 'height' | 'rowSpacing';
const MAX_CM = 10; // readReport keeps margins of at most 5670 twips
const MAX_SPACING_CM = 10;
const MAX_SIZE_CM = 50;
const PAPER_IDS = Object.keys(PAPERS) as PaperId[];

/** A number of cm typed (a decimal comma accepted); NaN when blank or not a number. */
const cmOf = (text: string): number => { const s = text.trim().replace(',', '.'); return s === '' ? NaN : Number(s); };

export function PageSetupDialog({ input, onClose }: { input: PageSetupInput; onClose(v: PageSetupChoice | null): void }) {
  const { t, i18n } = useTranslation();
  const show = (twips: number) => twipsToCm(twips).toLocaleString(i18n.language, { maximumFractionDigits: 2, useGrouping: false });
  const [tab, setTab] = useState(input.tab);
  const [orientation, setOrientation] = useState(input.page.orientation);
  const [paper, setPaper] = useState<PaperId>(input.page.paper);
  const [margins, setMargins] = useState(() => Object.fromEntries(SIDES.map((s) => [s, show(input.page.margins[s])])) as Record<Side, string>);
  const [count, setCount] = useState(String(input.columns.count));
  const [spacing, setSpacing] = useState(() => show(input.columns.spacing));
  const [across, setAcross] = useState(input.columns.across);
  const [same, setSame] = useState(input.columns.width === undefined && input.columns.height === undefined);   // Same as Detail: the computed width, the Detail's height
  const [widthText, setWidthText] = useState(() => show(input.columns.width ?? 0));
  const [heightText, setHeightText] = useState(() => show(input.columns.height ?? 0));
  const [rowSpacing, setRowSpacing] = useState(() => show(input.columns.rowSpacing ?? 0));
  const [dataOnly, setDataOnly] = useState(input.page.dataOnly === true);
  const [bad, setBad] = useState<Field[]>([]); // the fields refused, each marked invalid and described by the message
  const errorId = useId();

  const n = Number(count.trim());
  const countOk = Number.isInteger(n) && n >= 1 && n <= MAX_COLUMNS;
  // the column width, as the layout computes it (read only): the report's width, held to the printable width
  const margin = (s: Side) => (Number.isFinite(cmOf(margins[s])) ? cmToTwips(cmOf(margins[s])) : input.page.margins[s]);
  const printable = pageGeometry({ orientation, paper, margins: { top: margin('top'), bottom: margin('bottom'), left: margin('left'), right: margin('right') } }).printableWidth;
  const spacingTwips = Number.isFinite(cmOf(spacing)) ? cmToTwips(cmOf(spacing)) : 0;
  const several = countOk && n > 1;
  const colWidth = countOk ? columnWidth(Math.min(input.width, printable), n, spacingTwips) : 0;

  const ok = () => {
    const cm = Object.fromEntries(SIDES.map((s) => [s, cmOf(margins[s])])) as Record<Side, number>;
    const wrongMargins = SIDES.filter((s) => !Number.isFinite(cm[s]) || cm[s] < 0 || cm[s] > MAX_CM);
    const sp = cmOf(spacing);
    const w = cmOf(widthText), h = cmOf(heightText), rs = cmOf(rowSpacing);
    const wrongColumns: Field[] = [...(countOk ? [] : ['count' as const]), ...(!Number.isFinite(sp) || sp < 0 || sp > MAX_SPACING_CM ? ['spacing' as const] : []),
      ...(several && !same && !(w > 0 && w <= MAX_SIZE_CM) ? ['width' as const] : []), ...(several && !same && !(h > 0 && h <= MAX_SIZE_CM) ? ['height' as const] : []),
      ...(several && !(rs >= 0 && rs <= MAX_SPACING_CM) ? ['rowSpacing' as const] : [])];
    if (wrongMargins.length || wrongColumns.length) {
      setBad([...wrongMargins, ...wrongColumns]);
      setTab(wrongMargins.length ? 'options' : 'columns');
      return;
    }
    onClose({
      page: { orientation, paper, margins: { top: cmToTwips(cm.top), bottom: cmToTwips(cm.bottom), left: cmToTwips(cm.left), right: cmToTwips(cm.right) },
        ...(dataOnly ? { dataOnly: true as const } : {}) },
      columns: { count: n, spacing: cmToTwips(sp), across, ...(several && !same ? { width: cmToTwips(w), height: cmToTwips(h) } : {}),
        ...(several && cmToTwips(rs) > 0 ? { rowSpacing: cmToTwips(rs) } : {}) },
    });
  };

  const tabs = [['options', 'report.pageSetup.tabOptions'], ['page', 'report.pageSetup.tabPage'], ['columns', 'report.pageSetup.tabColumns']] as const;
  const invalid = (f: Field) => bad.includes(f);
  const describe = (f: Field) => (invalid(f) ? errorId : undefined);

  return (
    <form onSubmit={(e) => { e.preventDefault(); ok(); }}>
      <div className="rp-tabs" role="tablist">
        {tabs.map(([id, key]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`page-setup-tab-${id}`} onClick={() => setTab(id)}>{t(key)}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'options' && (
          <>
            <fieldset className="modal-field rp-setup">
              <legend>{t('report.pageSetup.margins')}</legend>
              <div className="rp-margins">
                {SIDES.map((s) => (
                  <label key={s}>
                    <span>{t(`report.pageSetup.${s}`)}</span>
                    <input data-testid={`page-setup-margin-${s}`} inputMode="decimal" value={margins[s]} aria-invalid={invalid(s)} aria-describedby={describe(s)}
                      onChange={(e) => { setMargins((m) => ({ ...m, [s]: e.target.value })); setBad((b) => b.filter((x) => x !== s)); }} />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="modal-field rp-setup">
              <label><input type="checkbox" data-testid="page-setup-data-only" checked={dataOnly} onChange={(e) => setDataOnly(e.target.checked)} />
                {t('report.pageSetup.dataOnly')}</label>
            </fieldset>
          </>
        )}
        {tab === 'page' && (
          <>
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
              <legend>{t('report.pageSetup.paper')}</legend>
              <label>
                <span>{t('report.pageSetup.size')}</span>
                <select data-testid="page-setup-paper" value={paper} onChange={(e) => setPaper(e.target.value as PaperId)}>
                  {PAPER_IDS.map((id) => <option key={id} value={id}>{t(`report.paper.${id}`)}</option>)}
                </select>
              </label>
            </fieldset>
          </>
        )}
        {tab === 'columns' && (
          <>
            <fieldset className="modal-field rp-setup">
              <legend>{t('report.columns.grid')}</legend>
              <div className="rp-margins">
                <label>
                  <span>{t('report.columns.count')}</span>
                  <input data-testid="columns-count" inputMode="numeric" value={count} aria-invalid={invalid('count')} aria-describedby={describe('count')}
                    onChange={(e) => { setCount(e.target.value); setBad((b) => b.filter((x) => x !== 'count')); }} />
                </label>
                <label>
                  <span>{t('report.columns.spacing')}</span>
                  <input data-testid="columns-spacing" inputMode="decimal" value={spacing} disabled={!countOk || n < 2} aria-invalid={invalid('spacing')}
                    aria-describedby={describe('spacing')} onChange={(e) => { setSpacing(e.target.value); setBad((b) => b.filter((x) => x !== 'spacing')); }} />
                </label>
              </div>
            </fieldset>
            <fieldset className="modal-field rp-setup">
              <legend>{t('report.columns.columnSize')}</legend>
              <div className="rp-margins">
                <label>
                  <span>{t('report.columns.width')}</span>
                  <input data-testid="columns-width" inputMode="decimal" value={same ? (countOk ? show(colWidth) : '') : widthText} readOnly={same} disabled={!several}
                    aria-invalid={invalid('width')} aria-describedby={describe('width')} onChange={(e) => { setWidthText(e.target.value); setBad((b) => b.filter((x) => x !== 'width')); }} />
                </label>
                <label>
                  <span>{t('report.columns.height')}</span>
                  <input data-testid="columns-height" inputMode="decimal" value={same ? show(input.detailHeight) : heightText} readOnly={same} disabled={!several}
                    aria-invalid={invalid('height')} aria-describedby={describe('height')} onChange={(e) => { setHeightText(e.target.value); setBad((b) => b.filter((x) => x !== 'height')); }} />
                </label>
                <label>
                  <span>{t('report.columns.rowSpacing')}</span>
                  <input data-testid="columns-row-spacing" inputMode="decimal" value={rowSpacing} disabled={!several} aria-invalid={invalid('rowSpacing')}
                    aria-describedby={describe('rowSpacing')} onChange={(e) => { setRowSpacing(e.target.value); setBad((b) => b.filter((x) => x !== 'rowSpacing')); }} />
                </label>
              </div>
              <label>
                <input type="checkbox" data-testid="columns-same-as-detail" checked={same} disabled={!several}
                  onChange={(e) => { if (!e.target.checked) { setWidthText(show(colWidth)); setHeightText(show(input.detailHeight)); } setSame(e.target.checked); }} />
                {t('report.columns.sameAsDetail')}
              </label>
            </fieldset>
            <fieldset className="modal-field rp-setup" disabled={!countOk || n < 2}>
              <legend>{t('report.columns.layout')}</legend>
              {([false, true] as const).map((v) => (
                <label key={String(v)}>
                  <input type="radio" name="column-layout" data-testid={v ? 'columns-across' : 'columns-down'} checked={across === v} onChange={() => setAcross(v)} />
                  {t(v ? 'report.columns.across' : 'report.columns.down')}
                </label>
              ))}
            </fieldset>
          </>
        )}
      </div>
      {bad.length > 0 && <span id={errorId} className="modal-error" role="alert" data-testid="page-setup-error">{t('report.pageSetup.invalid')}</span>}
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="modal-btn-ok">{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="modal-btn-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}

/** Le menu Marges (préréglages, puis Marges personnalisées… : la boîte Mise en page) ou Taille (les papiers, sous son bouton). */
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
    return <RibbonPopup anchor="pageSize" testId="page-size-menu" labelKey="ribbon.cmd.pageSize" onClose={p.onClose}>
      {PAPER_IDS.map((id) => item(id, t(`report.paper.${id}`), p.page.paper === id, { paper: id }))}
    </RibbonPopup>;
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
