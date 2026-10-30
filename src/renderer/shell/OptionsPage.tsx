// File › Options (O1): Access's category list on the left, the chosen category on the right. « Générales » and « Paramètres du client »
// are the workstation's settings (settings.json): each change is written at once, the settingsChanged broadcast brings the new values
// back. « Base de données active » is the designers' (B5): Backstage passes it, or null where it is not offered (Runtime, no base).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, SettingKey } from '../../shared/api';
import { UI_LANGUAGES } from '../../shared/i18n';
import { PRODUCT_TITLE_KEY } from '../../shared/product';
import { api } from '../bridge';
import { applyTheme } from '../i18n';
import type { Settings } from './Backstage';
import { useErrorDialog } from './Modal';

export type OptionsCategory = 'general' | 'currentDb' | 'client';
const MAX_RECENT = 50;   // settings.ts's range of recentCount (0..50)

/** A text field written on blur or Enter; a refused value shows the error and the stored value again. The broadcast that only
 *  echoes the value this field sent leaves the draft alone (the user may already be typing the next one), and a value still on
 *  its way is not sent twice (Enter, then blur). */
function useCommit<K extends SettingKey>(k: K, stored: AppSettings[K], parse: (v: string) => AppSettings[K] | null) {
  const showError = useErrorDialog();
  const [draft, setDraft] = useState(String(stored));
  const sent = useRef<AppSettings[K] | null>(null);
  useEffect(() => {
    if (sent.current === null) setDraft(String(stored));
    else if (sent.current === stored) sent.current = null;   // writes are serialised: our own echo comes last
  }, [stored]);
  const commit = (raw: string) => {
    const v = parse(raw);
    if (v === null) { setDraft(String(stored)); return; }
    setDraft(String(v));
    if (v === stored || v === sent.current) return;
    sent.current = v;
    api.app.setSetting(k, v).catch((e: unknown) => { sent.current = null; setDraft(String(stored)); void showError(e); });
  };
  return {
    value: draft, onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: (e: { currentTarget: { value: string } }) => commit(e.currentTarget.value),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') commit(e.currentTarget.value); },
  };
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

function Client({ s: stored }: { s: Settings }) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const [s, setS] = useState(stored);   // a box shows its new state at once; the broadcast confirms it
  useEffect(() => setS(stored), [stored]);
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

export function OptionsPage(p: { settings: Settings | null; currentDb: ReactNode | null; cat: OptionsCategory; onCat(c: OptionsCategory): void }) {
  const { t } = useTranslation();
  const cats: OptionsCategory[] = p.currentDb ? ['general', 'currentDb', 'client'] : ['general', 'client'];
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
          {cat === 'currentDb' ? p.currentDb : p.settings && (cat === 'general' ? <General s={p.settings} /> : <Client s={p.settings} />)}
        </div>
      </div>
    </section>
  );
}
