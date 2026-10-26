// File › Options › « Base de données active » (B3): the startup options of the open base. Every change saves at once; the title and the
// icon apply at once (`onApplied`), the other options at the next opening (R11, the note says so). A read-only base shows it disabled (R13).
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { sameName } from '../../shared/field-types';
import { cleanTitle, isValidIcon, type StartupOptions } from '../../shared/startup';
import { api } from '../bridge';
import { bytesToBase64, iconPng } from './app-icon';
import { bcErrorCode, useErrorDialog, useModal } from './Modal';

/** The file the owner picks; what is stored is the 256 px PNG made from it. */
const MAX_ICON_FILE = 5 * 1024 * 1024;

export function CurrentDatabaseOptions(p: { readOnly: boolean; forms: readonly string[]; onApplied(o: StartupOptions): void }) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [o, setO] = useState<StartupOptions | null>(null);
  const [title, setTitle] = useState('');
  const last = useRef<StartupOptions | null>(null);   // the options as last read or saved: a save sends the whole object
  const queue = useRef<Promise<void>>(Promise.resolve());   // one save at a time: a quick second change builds on the first
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.base.startup().then((s) => { last.current = s; setO(s); setTitle(s.appTitle); }).catch(showError), [showError]);
  useEffect(() => { void load(); }, [load]);

  const save = (patch: Partial<StartupOptions>) => {
    setO((cur) => cur && { ...cur, ...patch });   // shown at once, undone by the reload when the save fails
    const applied = p.onApplied;   // the one of the base open now: the shell drops it if the base has changed when the save resolves
    queue.current = queue.current.then(async () => {
      const cur = last.current;
      if (!cur) return;
      const next = { ...cur, ...patch };
      try {
        await api.base.saveStartup(next);
      } catch (e) {
        await showError(e);
        return load();   // what the file holds, not what was asked
      }
      last.current = next;
      if (next.appTitle !== cur.appTitle || next.appIcon !== cur.appIcon) applied(next);
    }).catch(showError);   // a rejected item never stops the saves after it
  };

  const commitTitle = () => {
    const clean = cleanTitle(title);
    setTitle(clean);
    if (clean !== last.current?.appTitle) save({ appTitle: clean });
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > MAX_ICON_FILE) throw new Error('bc:badIcon');
      const png = bytesToBase64(await iconPng(new Uint8Array(await f.arrayBuffer()), 256));
      if (!isValidIcon(png)) throw new Error('bc:badIcon');
      save({ appIcon: png });
    } catch (e) {
      if (bcErrorCode(e) === 'badIcon') await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'options.db.iconBad', buttons: ['ok'] });
      else await showError(e);
    }
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';   // the same file can be chosen again
    void pick(f);
  };

  // the stored name stays an option when no form has it (renamed, deleted: R8)
  const stored = o?.startupForm ? (p.forms.find((f) => sameName(f, o.startupForm)) ?? o.startupForm) : '';
  const forms = [...new Set([...p.forms, ...(stored ? [stored] : [])])].sort((a, b) => a.localeCompare(b, i18n.language));
  const off = p.readOnly;

  return (
    <section className="bs-dbopts" data-testid="opt-db">
      <h2>{t('options.db.title')}</h2>
      {o && (
        <div className="bs-options">
          <label>
            <span>{t('options.db.appTitle')}</span>
            <input type="text" data-testid="opt-db-title" value={title} disabled={off} onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle} onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); }} />
          </label>
          <div className="bs-field">
            <span>{t('options.db.appIcon')}</span>
            <div className="bs-icon-row">
              {o.appIcon && <img className="bs-icon-preview" data-testid="opt-db-icon-preview" alt="" width={32} height={32} src={`data:image/png;base64,${o.appIcon}`} />}
              <input ref={file} hidden type="file" accept=".png,.ico,.jpg,.jpeg,.gif,.bmp" data-testid="opt-db-icon-input" disabled={off} onChange={onFile} />
              <button type="button" className="btn btn-sm" data-testid="opt-db-icon-browse" disabled={off} onClick={() => file.current?.click()}>{t('options.db.iconBrowse')}</button>
              <button type="button" className="btn btn-sm" data-testid="opt-db-icon-remove" disabled={off || !o.appIcon} onClick={() => save({ appIcon: '' })}>{t('options.db.iconRemove')}</button>
            </div>
          </div>
          <label>
            <span>{t('options.db.startupForm')}</span>
            <select data-testid="opt-db-form" value={stored} disabled={off} onChange={(e) => save({ startupForm: e.target.value })}>
              <option value="">{t('options.db.none')}</option>
              {forms.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="bs-check">
            <input type="checkbox" data-testid="opt-db-navpane" checked={o.showNavPane} disabled={off} onChange={(e) => save({ showNavPane: e.target.checked })} />
            <span>{t('options.db.showNavPane')}</span>
          </label>
          <label>
            <span>{t('options.db.ribbon')}</span>
            <select data-testid="opt-db-ribbon" value={o.runMode ? 'simplified' : o.ribbon} disabled={off || o.runMode}
              onChange={(e) => save({ ribbon: e.target.value === 'simplified' ? 'simplified' : 'full' })}>
              <option value="full">{t('options.db.ribbonFull')}</option>
              <option value="simplified">{t('options.db.ribbonSimplified')}</option>
            </select>
          </label>
          <div className="bs-field">
            <label className="bs-check">
              <input type="checkbox" data-testid="opt-db-runmode" checked={o.runMode} disabled={off} aria-describedby="opt-db-runmode-help"
                onChange={(e) => save({ runMode: e.target.checked })} />
              <span>{t('options.db.runMode')}</span>
            </label>
            <span id="opt-db-runmode-help" className="muted">{t('options.db.runModeHelp')}</span>
          </div>
          <p className="muted" data-testid="opt-db-next-open">{t('options.db.nextOpen')}</p>
        </div>
      )}
    </section>
  );
}
