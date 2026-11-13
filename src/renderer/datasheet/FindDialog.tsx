// « Rechercher et remplacer » (O2 R10, G1): « Rechercher » and, where the host can replace (the datasheet), « Remplacer ».
// Modeless, as Access's: no backdrop, the sheet or form behind stays usable; its view renders it (hidden with its tab, gone with
// it). Each opening starts from « Rechercher/Remplacer par défaut »; the text searched last in the session is kept.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FindOptions } from '../form/form-instances';
import { bcErrorCode, trapFocus, useErrorDialog, useModal } from '../shell/Modal';
import { currentSettings } from '../settings-store';
import { findDefaults } from './find-commands';
import './datasheet.css';

let lastWhat = '';
export type FindTab = 'find' | 'replace';
/** Replace One: the selected match replaced if it is one, then the next found (false: none found). Replace All: every match
 *  replaced; the count (0: none). */
export interface ReplaceActions { one(o: FindOptions, replaceWith: string): Promise<boolean>; all(o: FindOptions, replaceWith: string): Promise<number> }

/** `find`: false when nothing more is found (the dialog says so and stays); a refused save rejects bc:saveRefused or
 *  bc:actionCancelled (its own message already shown): the search stops there. */
export function FindDialog(p: { close(v: null): void; find(o: FindOptions): Promise<boolean>; replace?: ReplaceActions; initialTab?: FindTab }) {
  const { t } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [d] = useState(() => findDefaults(currentSettings().findReplaceDefault));   // read when the dialog opens (R1)
  const [tab, setTab] = useState<FindTab>(p.replace ? p.initialTab ?? 'find' : 'find');
  const [what, setWhat] = useState(lastWhat);
  const [replaceWith, setReplaceWith] = useState('');
  const [onlyCurrentField, setOnlyCurrentField] = useState(d.onlyCurrentField);
  const [match, setMatch] = useState<FindOptions['match']>(d.match);
  const [search, setSearch] = useState<FindOptions['search']>('all');
  const [matchCase, setMatchCase] = useState(false);
  const [asFormatted, setAsFormatted] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const open = useRef(true);   // closed during a search: its end shows nothing
  const id = useId();   // ids of its own: a hidden tab's dialog, or a master's and its subform's, stay in the page
  useEffect(() => {
    open.current = true;
    const input = ref.current?.querySelector<HTMLInputElement>('[data-testid="find-what"]');
    input?.focus();
    input?.select();
    return () => { open.current = false; };
  }, []);

  const options = (): FindOptions => ({ what, match, matchCase, search, onlyCurrentField, findFirst: false, asFormatted });
  const notFound = () => modal.confirm({ titleKey: 'macro.msgbox.defaultTitle', messageKey: 'macro.findRecord.notFound', buttons: ['ok'] });
  const next = async () => {
    if (!what || busy.current) return;
    busy.current = true;
    lastWhat = what;
    try {
      if (!(await p.find(options())) && open.current) await notFound();
    } catch (e) {
      const code = bcErrorCode(e);
      if (code !== 'saveRefused' && code !== 'actionCancelled') await showError(e);
    } finally {
      busy.current = false;
    }
  };
  /** Replace One finds the next match after replacing the selected one; Replace All asks first (Access: it cannot be undone). */
  const replaceNext = async (all: boolean) => {
    if (!what || busy.current || !p.replace) return;
    busy.current = true;
    lastWhat = what;
    try {
      if (!all) {
        if (!(await p.replace.one(options(), replaceWith)) && open.current) await notFound();
      } else if ((await modal.confirm({ titleKey: 'find.title', messageKey: 'find.replaceAllWarning', buttons: ['yes', 'no'], defaultButton: 'no' })) === 'yes') {
        const n = await p.replace.all(options(), replaceWith);
        if (open.current) await modal.confirm({ titleKey: 'find.title', messageKey: n ? 'find.replacedCount' : 'macro.findRecord.notFound', params: { count: n }, buttons: ['ok'] });
      }
    } catch (e) {
      const code = bcErrorCode(e);
      if (code !== 'saveRefused' && code !== 'actionCancelled') await showError(e);
    } finally {
      busy.current = false;
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();   // the view behind never sees the dialog's keys
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;   // an IME composition's Enter or Escape is its own
    if (e.key === 'Escape') { e.preventDefault(); p.close(null); }
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); void next(); }
    else trapFocus(e, ref.current);
  };

  const pick = <T extends string>(testid: string, label: string, value: T, set: (v: T) => void, opts: [T, string][]) => (
    <>
      <label htmlFor={id + testid}>{label}</label>
      <select id={id + testid} data-testid={testid} value={value} onChange={(e) => set(e.target.value as T)}>
        {opts.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
      </select>
    </>
  );
  const replacing = tab === 'replace' && !!p.replace;
  return (
    <div ref={ref} className="modal card find-dialog" role="dialog" aria-labelledby={id + 'title'} data-testid="find-dialog" onKeyDown={onKeyDown}>
      <h2 id={id + 'title'} className="modal-title">{t('find.title')}</h2>
      <div className="find-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'find'} data-testid="find-tab-find" onClick={() => setTab('find')}>{t('find.tabFind')}</button>
        {p.replace ? (
          <button type="button" role="tab" aria-selected={replacing} data-testid="find-tab-replace" onClick={() => setTab('replace')}>{t('find.tabReplace')}</button>
        ) : (
          <button type="button" role="tab" aria-selected="false" disabled title={t('ribbon.planned.later')} data-testid="find-tab-replace">{t('find.tabReplace')}</button>
        )}
      </div>
      <div className="modal-row find-fields" role="tabpanel">
        <label htmlFor={id + 'find-what'}>{t('find.what')}</label>
        <input id={id + 'find-what'} data-testid="find-what" autoComplete="off" value={what} onChange={(e) => setWhat(e.target.value)} />
        {replacing && (
          <>
            <label htmlFor={id + 'replace-with'}>{t('find.replaceWith')}</label>
            <input id={id + 'replace-with'} data-testid="replace-with" autoComplete="off" value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} />
          </>
        )}
        {pick('find-look-in', t('find.lookIn'), onlyCurrentField ? 'field' : 'document', (v) => setOnlyCurrentField(v === 'field'),
          [['field', 'find.lookInField'], ['document', 'find.lookInDocument']])}
        {pick('find-match', t('find.match'), match, setMatch, [['anywhere', 'find.matchAnywhere'], ['whole', 'find.matchWhole'], ['start', 'find.matchStart']])}
        {pick('find-search', t('find.search'), search, setSearch, [['up', 'find.searchUp'], ['down', 'find.searchDown'], ['all', 'find.searchAll']])}
      </div>
      <div className="find-checks">
        <label><input type="checkbox" data-testid="find-case" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />{t('find.matchCase')}</label>
        <label><input type="checkbox" data-testid="find-formatted" checked={asFormatted} onChange={(e) => setAsFormatted(e.target.checked)} />{t('find.asFormatted')}</label>
      </div>
      <div className="modal-buttons">
        <button type="button" className="btn btn-primary" data-testid="find-next" disabled={!what} onClick={() => void next()}>{t('find.next')}</button>
        {replacing && (
          <>
            <button type="button" className="btn" data-testid="replace-one" disabled={!what} onClick={() => void replaceNext(false)}>{t('find.replace')}</button>
            <button type="button" className="btn" data-testid="replace-all" disabled={!what} onClick={() => void replaceNext(true)}>{t('find.replaceAll')}</button>
          </>
        )}
        <button type="button" className="btn" data-testid="find-cancel" onClick={() => p.close(null)}>{t('find.cancel')}</button>
      </div>
    </div>
  );
}
