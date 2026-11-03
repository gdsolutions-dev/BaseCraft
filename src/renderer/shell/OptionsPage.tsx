// File › Options (O1): Access's category list on the left, the chosen category on the right. « Générales » and « Paramètres du client »
// are the workstation's settings (settings.json): each change is written at once, the settingsChanged broadcast brings the new values
// back. « Base de données active » is the designers' (B5): Backstage passes it, or null where it is not offered (Runtime, no base).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, SettingKey } from '../../shared/api';
import { AUTO_INDEX_DEFAULT } from '../../shared/auto-index';
import { EMBEDDED_FONTS, FONT_ALIASES } from '../../shared/fonts';
import { UI_LANGUAGES } from '../../shared/i18n';
import { localeInfo } from '../../shared/locale-format';
import { PRODUCT_TITLE_KEY } from '../../shared/product';
import { api } from '../bridge';
import { FONT_SIZES, formatCm, parseCm } from '../designer/units';
import { applyTheme } from '../i18n';
import type { Settings } from './Backstage';
import { useErrorDialog } from './Modal';
import { currentBaseOptions } from './startup';

export type OptionsCategory = 'general' | 'currentDb' | 'datasheet' | 'designers' | 'client';
const MAX_RECENT = 50;   // settings.ts's range of recentCount (0..50)
const MAX_MARGIN = 5670;   // twips: settings.ts's bound of the print margins
const NEW_FIELD_TYPES = ['shortText', 'longText', 'number', 'currency', 'dateTime', 'yesNo', 'hyperlink'] as const;   // no AutoNumber (O3 R3)
const NUMBER_SIZES = ['byte', 'integer', 'longInteger', 'single', 'double', 'decimal'] as const;
const SHEET_FONT_SIZES = [8, 9, 10, 11, 12, 14] as const;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const QUERY_FONTS = ['Segoe UI', ...EMBEDDED_FONTS.map((f) => f.family), ...Object.keys(FONT_ALIASES)];

/** Unreadable or out-of-range text: ONE error dialog (the same refusal as the main process's); the caller sends nothing. */
function useRefuse() {
  const showError = useErrorDialog();
  return (): null => { void showError(new TypeError('bc:invalidArgument')); return null; };
}

/** A text field written on blur or Enter; a refused value shows the error and the stored value again. The broadcast that only
 *  echoes the value this field sent leaves the draft alone (the user may already be typing the next one), and a value still on
 *  its way is not sent twice (Enter, then blur). */
function useCommit<K extends SettingKey>(k: K, stored: AppSettings[K], parse: (v: string) => AppSettings[K] | null, show: (v: AppSettings[K]) => string = String) {
  const showError = useErrorDialog();
  const [draft, setDraft] = useState(show(stored));
  const sent = useRef<AppSettings[K] | null>(null);
  useEffect(() => {
    if (sent.current === null) setDraft(show(stored));
    else if (sent.current === stored) sent.current = null;   // writes are serialised: our own echo comes last
  }, [stored]);
  const commit = (raw: string) => {
    const v = parse(raw);
    if (v === null) { setDraft(show(sent.current ?? stored)); return; }   // a write still in flight: its value, not the stale stored one
    setDraft(show(v));
    if (v === stored || v === sent.current) return;
    sent.current = v;
    api.app.setSetting(k, v).catch((e: unknown) => { sent.current = null; setDraft(show(stored)); void showError(e); });
  };
  return {
    value: draft, onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: (e: { currentTarget: { value: string } }) => commit(e.currentTarget.value),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); } },   // preventDefault: the error dialog that takes focus must not be answered by this very Enter
  };
}

/** A box or a radio shows its new state at once; the broadcast confirms it, a refusal restores the stored one. */
function useLocal(stored: Settings) {
  const showError = useErrorDialog();
  const [s, setS] = useState(stored);
  useEffect(() => setS(stored), [stored]);
  const put = <K extends SettingKey>(k: K, v: AppSettings[K]) => {
    setS((cur) => ({ ...cur, [k]: v }));
    api.app.setSetting(k, v).catch((err: unknown) => { setS(stored); void showError(err); });
  };
  return { s, setS, put };
}

/** A group of radios on one setting; `opts` are [value, testid, label]. */
function RadioGroup<K extends SettingKey>(p: { id: string; label: string; k: K; value: AppSettings[K]; opts: [AppSettings[K], string, string][]; put(k: K, v: AppSettings[K]): void }) {
  return (
    <div className="bs-field" role="radiogroup" aria-labelledby={`${p.id}-label`}>
      <span id={`${p.id}-label`}>{p.label}</span>
      <div className="bs-indent">
        {p.opts.map(([v, testid, label]) => (
          <label key={testid} className="bs-check">
            <input type="radio" name={p.id} data-testid={testid} checked={p.value === v} onChange={() => p.put(p.k, v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function BoxRow<K extends 'propertyUpdateOptions' | 'showTableNames' | 'outputAllFields' | 'autoJoin' | 'cursorStopsAtEnds' | 'fourDigitYearAll' | 'gridlinesHorizontal' | 'gridlinesVertical' | 'datasheetFontUnderline' | 'datasheetFontItalic'>(
  p: { k: K; testid: string; label: string; s: Settings; put(k: K, v: boolean): void }) {
  return (
    <label className="bs-check">
      <input type="checkbox" data-testid={p.testid} checked={p.s[p.k]} onChange={(e) => p.put(p.k, e.target.checked)} />
      <span>{p.label}</span>
    </label>
  );
}

function General({ s }: { s: Settings }) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const folder = useCommit('defaultFolder', s.defaultFolder, (v) => v.trim());
  const browse = async () => {
    const dir = await api.app.pickFolder();
    if (dir) await api.app.setSetting('defaultFolder', dir);
  };
  return (<>
    <p className="bs-opthead">{t('options.general.header', { product: t(PRODUCT_TITLE_KEY) })}</p>
    <h2>{t('options.general.ui')}</h2>
    <div className="bs-options">
      <label>
        <span>{t('app.language.label')}</span>
        <select data-testid="opt-lang" value={s.locale} onChange={(e) => void api.app.setLocale(e.target.value as AppSettings['locale'])}>
          {(['system', ...UI_LANGUAGES] as const).map((l) => <option key={l} value={l}>{t(`app.language.${l}`)}</option>)}
        </select>
      </label>
      <label>
        <span>{t('app.theme.label')}</span>
        <select data-testid="opt-theme" value={s.theme}
          onChange={(e) => {
            const v = e.target.value as AppSettings['theme'];
            applyTheme(v); // at once, not after the round trip
            void api.app.setTheme(v);
          }}>
          {(['system', 'light', 'dark'] as const).map((l) => <option key={l} value={l}>{t(`app.theme.${l}`)}</option>)}
        </select>
      </label>
    </div>
    <h2>{t('options.general.creation')}</h2>
    <div className="bs-options">
      <div className="bs-field">
        <label htmlFor="opt-default-folder">{t('options.general.defaultFolder')}</label>
        <div className="bs-icon-row">
          <input id="opt-default-folder" type="text" data-testid="opt-default-folder" {...folder} />
          <button type="button" className="btn btn-sm" data-testid="opt-default-folder-browse" onClick={() => void browse().catch(showError)}>
            {t('options.general.browse')}
          </button>
        </div>
      </div>
    </div>
  </>);
}

function Client({ s: stored, thisDb, designers }: { s: Settings; thisDb: ThisDb | null; designers: boolean }) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const refuse = useRefuse();
  const info = localeInfo(stored.region);
  const margin = (v: string) => {
    const tw = parseCm(v, info);
    return tw === null || tw > MAX_MARGIN ? refuse() : tw;
  };
  const showMargin = (tw: number) => formatCm(tw, info, 3);   // R9: « 0,635 cm »
  const marginLeft = useCommit('printMarginLeft', stored.printMarginLeft, margin, showMargin);
  const marginRight = useCommit('printMarginRight', stored.printMarginRight, margin, showMargin);
  const marginTop = useCommit('printMarginTop', stored.printMarginTop, margin, showMargin);
  const marginBottom = useCommit('printMarginBottom', stored.printMarginBottom, margin, showMargin);
  const { s, setS, put } = useLocal(stored);   // a box shows its new state at once; the broadcast confirms it
  const recent = useCommit('recentCount', stored.recentCount, (v) => {
    const n = Math.round(Number(v));
    return v.trim() === '' || !Number.isFinite(n) ? null : Math.min(MAX_RECENT, Math.max(0, n));
  });
  const whole = (lo: number, hi: number) => (v: string) => {
    const n = Math.round(Number(v));
    return v.trim() === '' || !Number.isFinite(n) ? null : Math.min(hi, Math.max(lo, n));
  };
  const refresh = useCommit('refreshInterval', stored.refreshInterval, whole(1, 32766));
  const retries = useCommit('updateRetries', stored.updateRetries, whole(0, 10));
  const retryMs = useCommit('updateRetryMs', stored.updateRetryMs, whole(0, 1000));
  const openMode = (testid: string, v: AppSettings['openMode'], label: string) => (
    <label className="bs-check">
      <input type="radio" name="opt-open-mode" data-testid={testid} checked={s.openMode === v}
        onChange={() => {
          setS((cur) => ({ ...cur, openMode: v }));
          api.app.setSetting('openMode', v).catch((err: unknown) => { setS(stored); void showError(err); });
        }} />
      <span>{label}</span>
    </label>
  );
  const lock = (testid: string, label: string, planned = false) => (
    <label className="bs-check" title={planned ? t('ribbon.planned.later') : undefined}>
      <input type="radio" name="opt-record-locking" data-testid={testid} checked={!planned} disabled={planned} readOnly />
      <span>{label}</span>
    </label>
  );
  const check = (testid: string, k: 'openLast' | 'confirmRecordChanges' | 'confirmDocumentDeletions' | 'confirmActionQueries', label: string) => (
    <label className="bs-check">
      <input type="checkbox" data-testid={testid} checked={s[k]}
        onChange={(e) => {
          const v = e.target.checked;
          setS((cur) => ({ ...cur, [k]: v }));
          api.app.setSetting(k, v).catch((err: unknown) => { setS(stored); void showError(err); });
        }} />
      <span>{label}</span>
    </label>
  );
  return (<>
    <p className="bs-opthead">{t('options.client.header')}</p>
    <h2>{t('options.client.editing')}</h2>
    <div className="bs-options">
      <RadioGroup id="opt-enter" label={t('options.client.enter')} k="moveAfterEnter" value={s.moveAfterEnter} put={put}
        opts={[['none', 'opt-enter-none', t('options.client.enterNone')], ['nextField', 'opt-enter-nextField', t('options.client.enterNextField')], ['nextRecord', 'opt-enter-nextRecord', t('options.client.enterNextRecord')]]} />
      <RadioGroup id="opt-entry" label={t('options.client.entry')} k="enterFieldBehavior" value={s.enterFieldBehavior} put={put}
        opts={[['selectAll', 'opt-entry-selectAll', t('options.client.entrySelectAll')], ['start', 'opt-entry-start', t('options.client.entryStart')], ['end', 'opt-entry-end', t('options.client.entryEnd')]]} />
      <RadioGroup id="opt-arrows" label={t('options.client.arrows')} k="arrowKeyBehavior" value={s.arrowKeyBehavior} put={put}
        opts={[['nextField', 'opt-arrows-nextField', t('options.client.arrowsField')], ['nextCharacter', 'opt-arrows-nextCharacter', t('options.client.arrowsChar')]]} />
      <RadioGroup id="opt-cont" label={t('options.client.continuous')} k="continuousArrowKeys" value={s.continuousArrowKeys} put={put}
        opts={[['none', 'opt-cont-none', t('options.client.continuousNone')], ['upDown', 'opt-cont-upDown', t('options.client.continuousUpDown')], ['leftRight', 'opt-cont-leftRight', t('options.client.continuousLeftRight')]]} />
      <BoxRow k="cursorStopsAtEnds" testid="opt-cursor-stop" label={t('options.client.cursorStop')} s={s} put={put} />
      <RadioGroup id="opt-find" label={t('options.client.find')} k="findReplaceDefault" value={s.findReplaceDefault} put={put}
        opts={[['fast', 'opt-find-fast', t('options.client.findFast')], ['general', 'opt-find-general', t('options.client.findGeneral')], ['startOfField', 'opt-find-startOfField', t('options.client.findStart')]]} />
      <div className="bs-field" role="group" aria-labelledby="opt-confirm-label">
        <span id="opt-confirm-label">{t('options.client.confirm')}</span>
        <div className="bs-indent">
          {check('opt-confirm-records', 'confirmRecordChanges', t('options.client.confirmRecords'))}
          {check('opt-confirm-deletions', 'confirmDocumentDeletions', t('options.client.confirmDeletions'))}
          {check('opt-confirm-actions', 'confirmActionQueries', t('options.client.confirmActions'))}
        </div>
      </div>
    </div>
    <h2>{t('options.client.display')}</h2>
    <div className="bs-options">
      <label className="bs-inline">
        <span>{t('options.client.recentCount')}</span>
        <input type="number" min={0} max={MAX_RECENT} step={1} data-testid="opt-recent-count" {...recent} />
      </label>
    </div>
    {designers && (<>
      <h2>{t('options.client.printing')}</h2>
      <div className="bs-options">
        {([['left', 'Left', marginLeft], ['right', 'Right', marginRight], ['top', 'Top', marginTop], ['bottom', 'Bottom', marginBottom]] as const).map(([side, key, m]) => (
          <label key={side} className="bs-inline">
            <span>{t(`options.client.margin${key}`)}</span>
            <input type="text" data-testid={`opt-margin-${side}`} {...m} />
          </label>
        ))}
      </div>
    </>)}
    <h2>{t('options.client.general')}</h2>
    <div className="bs-options">
      <div className="bs-field" role="group" aria-labelledby="opt-year4-label">
        <span id="opt-year4-label">{t('options.client.year4')}</span>
        <div className="bs-indent">
          <label className="bs-check">
            <input type="checkbox" data-testid="opt-year4-db" checked={thisDb ? thisDb.value : currentBaseOptions().fourDigitYear} disabled={!thisDb}
              onChange={(e) => thisDb?.onChange(e.target.checked)} />
            <span>{t('options.client.year4Db')}</span>
          </label>
          <BoxRow k="fourDigitYearAll" testid="opt-year4-all" label={t('options.client.year4All')} s={s} put={put} />
        </div>
      </div>
    </div>
    <h2>{t('options.client.advanced')}</h2>
    <div className="bs-options">
      {check('opt-open-last', 'openLast', t('options.client.openLast', { product: t(PRODUCT_TITLE_KEY) }))}
      <div className="bs-field" role="radiogroup" aria-labelledby="opt-open-mode-label">
        <span id="opt-open-mode-label">{t('options.client.openMode')}</span>
        <div className="bs-indent">
          {openMode('opt-open-mode-shared', 'shared', t('options.client.openModeShared'))}
          {openMode('opt-open-mode-exclusive', 'exclusive', t('options.client.openModeExclusive'))}
        </div>
      </div>
      <div className="bs-field" role="radiogroup" aria-labelledby="opt-record-locking-label">
        <span id="opt-record-locking-label">{t('options.client.recordLocking')}</span>
        <div className="bs-indent">
          {lock('opt-record-locking-none', t('options.client.lockNone'))}
          {lock('opt-record-locking-all', t('options.client.lockAll'), true)}
          {lock('opt-record-locking-edited', t('options.client.lockEdited'), true)}
        </div>
      </div>
      <label className="bs-inline">
        <span>{t('options.client.refreshInterval')}</span>
        <input type="number" min={1} max={32766} step={1} data-testid="opt-refresh-interval" {...refresh} />
      </label>
      <label className="bs-inline">
        <span>{t('options.client.updateRetries')}</span>
        <input type="number" min={0} max={10} step={1} data-testid="opt-update-retries" {...retries} />
      </label>
      <label className="bs-inline">
        <span>{t('options.client.updateRetryMs')}</span>
        <input type="number" min={0} max={1000} step={1} data-testid="opt-update-retry-ms" {...retryMs} />
      </label>
    </div>
  </>);
}

function Datasheet({ stored }: { stored: Settings }) {
  const { t } = useTranslation();
  const { s, put } = useLocal(stored);
  const info = localeInfo(stored.region);
  const showError = useErrorDialog();
  // Unreadable or out-of-range text: the error shows here, nothing is sent and the stored value comes back (the same refusal as the main process's).
  const refuse = (): null => { void showError(new TypeError('bc:invalidArgument')); return null; };
  const width = useCommit('columnWidth', stored.columnWidth, (v) => {
    const tw = parseCm(v, info);
    return tw === null || tw < 300 ? refuse() : tw;   // 300 twips: settings.ts's lower bound
  }, (tw) => formatCm(tw, info));
  const size = useCommit('datasheetFontSize', stored.datasheetFontSize, (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 127 ? n : refuse();
  });
  return (<>
    <p className="bs-opthead">{t('options.datasheet.header', { product: t(PRODUCT_TITLE_KEY) })}</p>
    <h2>{t('options.datasheet.gridSection')}</h2>
    <div className="bs-options">
      <div className="bs-field" role="group" aria-labelledby="opt-grid-label">
        <span id="opt-grid-label">{t('options.datasheet.gridlines')}</span>
        <div className="bs-indent">
          <BoxRow k="gridlinesHorizontal" testid="opt-grid-h" label={t('options.datasheet.horizontal')} s={s} put={put} />
          <BoxRow k="gridlinesVertical" testid="opt-grid-v" label={t('options.datasheet.vertical')} s={s} put={put} />
        </div>
      </div>
      <label className="bs-inline">
        <span>{t('options.datasheet.columnWidth')}</span>
        <input type="text" data-testid="opt-col-width" {...width} />
      </label>
    </div>
    <h2>{t('options.datasheet.font')}</h2>
    <div className="bs-options">
      <label className="bs-inline">
        <span>{t('options.datasheet.fontSize')}</span>
        <input type="text" inputMode="numeric" list="opt-font-sizes" data-testid="opt-font-size" {...size} />
        <datalist id="opt-font-sizes">{FONT_SIZES.map((n) => <option key={n} value={n} />)}</datalist>
      </label>
      <label className="bs-inline">
        <span>{t('options.datasheet.fontWeight')}</span>
        <select data-testid="opt-font-weight" value={s.datasheetFontWeight} onChange={(e) => put('datasheetFontWeight', Number(e.target.value))}>
          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{t(`options.datasheet.weight.${w}`)}</option>)}
        </select>
      </label>
      <BoxRow k="datasheetFontUnderline" testid="opt-font-underline" label={t('options.datasheet.underline')} s={s} put={put} />
      <BoxRow k="datasheetFontItalic" testid="opt-font-italic" label={t('options.datasheet.italic')} s={s} put={put} />
    </div>
  </>);
}

function Designers({ stored }: { stored: Settings }) {
  const { t } = useTranslation();
  const { s, put } = useLocal(stored);
  const refuse = useRefuse();
  const textSize = useCommit('defaultTextSize', stored.defaultTextSize, (v) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 255 ? n : refuse();
  });
  const shown = (v: string | null) => v ?? AUTO_INDEX_DEFAULT[stored.uiLanguage];
  // A blur on the untouched default list stays null (the language's default), not a stored copy of it.
  const autoIndex = useCommit('autoIndex', stored.autoIndex, (v) => {
    if (v === shown(stored.autoIndex)) return stored.autoIndex;
    return v.length > 255 || CONTROL.test(v) ? refuse() : v;
  }, shown);
  const fontName = useCommit('queryFontName', stored.queryFontName, (v) => {
    const n = v.trim();   // it goes into a CSS font-family (settings.ts refuses the same characters)
    return n.length >= 1 && n.length <= 64 && !/["\\;{}<>]/.test(n) && !CONTROL.test(n) ? n : refuse();
  });
  const fontSize = useCommit('queryFontSize', stored.queryFontSize, (v) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 127 ? n : refuse();
  });
  return (<>
    <p className="bs-opthead">{t('options.designers.header')}</p>
    <h2>{t('options.designers.sheetSection')}</h2>
    <div className="bs-options">
      <label className="bs-inline">
        <span>{t('options.designers.sheetFontSize')}</span>
        <select data-testid="opt-sheet-font" value={s.propertySheetFontSize} onChange={(e) => put('propertySheetFontSize', Number(e.target.value) as AppSettings['propertySheetFontSize'])}>
          {SHEET_FONT_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
    <h2>{t('options.designers.tableSection')}</h2>
    <div className="bs-options">
      <label className="bs-inline">
        <span>{t('options.designers.fieldType')}</span>
        <select data-testid="opt-field-type" value={s.defaultFieldType} onChange={(e) => put('defaultFieldType', e.target.value as AppSettings['defaultFieldType'])}>
          {NEW_FIELD_TYPES.map((x) => <option key={x} value={x}>{t(`fieldType.${x}`)}</option>)}
        </select>
      </label>
      <label className="bs-inline">
        <span>{t('options.designers.textSize')}</span>
        <input type="number" min={1} max={255} step={1} data-testid="opt-text-size" {...textSize} />
      </label>
      <label className="bs-inline">
        <span>{t('options.designers.numberSize')}</span>
        <select data-testid="opt-number-size" value={s.defaultNumberSize} onChange={(e) => put('defaultNumberSize', e.target.value as AppSettings['defaultNumberSize'])}>
          {NUMBER_SIZES.map((x) => <option key={x} value={x}>{t(`fieldProp.numberSizes.${x}`)}</option>)}
        </select>
      </label>
      <label className="bs-inline">
        <span>{t('options.designers.autoIndex')}</span>
        <input type="text" data-testid="opt-autoindex" {...autoIndex} />
      </label>
      <BoxRow k="propertyUpdateOptions" testid="opt-property-update" label={t('options.designers.propertyUpdate')} s={s} put={put} />
    </div>
    <h2>{t('options.designers.querySection')}</h2>
    <div className="bs-options">
      <BoxRow k="showTableNames" testid="opt-table-names" label={t('options.designers.tableNames')} s={s} put={put} />
      <BoxRow k="outputAllFields" testid="opt-output-all" label={t('options.designers.outputAll')} s={s} put={put} />
      <BoxRow k="autoJoin" testid="opt-autojoin" label={t('options.designers.autoJoin')} s={s} put={put} />
      <div className="bs-field" role="group" aria-labelledby="opt-query-font-label">
        <span id="opt-query-font-label">{t('options.designers.queryFont')}</span>
        <div className="bs-indent">
          <label className="bs-inline">
            <span>{t('options.designers.fontName')}</span>
            <input type="text" list="opt-query-fonts" data-testid="opt-query-font" {...fontName} />
            <datalist id="opt-query-fonts">{QUERY_FONTS.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label className="bs-inline">
            <span>{t('options.designers.fontSize')}</span>
            <input type="text" inputMode="numeric" list="opt-query-sizes" data-testid="opt-query-size" {...fontSize} />
            <datalist id="opt-query-sizes">{FONT_SIZES.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
        </div>
      </div>
    </div>
    <h2>{t('options.designers.formSection')}</h2>
    <div className="bs-options">
      <RadioGroup id="opt-selection" label={t('options.designers.selection')} k="selectionBehavior" value={s.selectionBehavior} put={put}
        opts={[['partial', 'opt-select-partial', t('options.designers.partial')], ['full', 'opt-select-full', t('options.designers.full')]]} />
    </div>
  </>);
}

/** « Cette base de données » (four-digit year): the open base's value and its writer; null where « Base de données active » is not offered. */
export type ThisDb = { value: boolean; onChange(v: boolean): void };

export function OptionsPage(p: { settings: Settings | null; currentDb: ReactNode | null; thisDb: ThisDb | null; designers: boolean; cat: OptionsCategory; onCat(c: OptionsCategory): void }) {
  const { t } = useTranslation();
  const cats: OptionsCategory[] = ['general', ...(p.currentDb ? ['currentDb' as const] : []), 'datasheet', ...(p.designers ? ['designers' as const] : []), 'client'];
  const cat = cats.includes(p.cat) ? p.cat : 'general';   // the base closed while « Base de données active » was shown
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    const to = e.key === 'Home' ? cats[0] : e.key === 'End' ? cats[cats.length - 1] : step ? cats[(cats.indexOf(cat) + step + cats.length) % cats.length] : null;
    if (!to) return;
    e.preventDefault();
    p.onCat(to);
    document.getElementById(`opt-cat-${to}`)?.focus();
  };
  return (
    <section className="bs-panel bs-optpage">
      <h1>{t('backstage.optionsTitle')}</h1>
      <div className="bs-optbody">
        <div className="bs-optcats" role="tablist" aria-orientation="vertical" aria-label={t('backstage.optionsTitle')} onKeyDown={onKey}>
          {cats.map((c) => (
            <button key={c} type="button" role="tab" id={`opt-cat-${c}`} data-testid={`opt-cat-${c}`} aria-selected={c === cat}
              aria-controls="opt-panel" tabIndex={c === cat ? 0 : -1} className={`bs-item${c === cat ? ' is-active' : ''}`} onClick={() => p.onCat(c)}>
              {t(`options.cat.${c}`)}
            </button>
          ))}
        </div>
        <div className="bs-optpanel" role="tabpanel" id="opt-panel" data-testid="opt-panel" aria-labelledby={`opt-cat-${cat}`}>
          {cat === 'currentDb' ? p.currentDb : p.settings && (cat === 'general' ? <General s={p.settings} /> : cat === 'datasheet' ? <Datasheet stored={p.settings} /> : cat === 'designers' ? <Designers stored={p.settings} /> : <Client s={p.settings} thisDb={p.thisDb} designers={p.designers} />)}
        </div>
      </div>
    </section>
  );
}
