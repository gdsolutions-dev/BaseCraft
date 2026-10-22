// Coulisse (onglet Fichier) : Nouveau, Ouvrir, Récents, Fermer, Options.
import { ArrowLeft, Database, FilePlus2, FolderClosed, FolderOpen, Settings2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, BasecraftApi } from '../../shared/api';
import { api } from '../bridge';
import { applyTheme } from '../i18n';
import { trapFocus } from './Modal';

export type Settings = Awaited<ReturnType<BasecraftApi['app']['getSettings']>>;
export type BackstageView = 'home' | 'options';

interface Props {
  view: BackstageView; onView(v: BackstageView): void;
  onBack: (() => void) | null; // null: no base open, the backstage cannot be left
  hasBase: boolean; settings: Settings | null; onSettingsChanged(): void;
  onNew(): void; onOpen(path?: string): void; onCloseBase(): void;
}

const splitPath = (p: string) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return { name: p.slice(i + 1), dir: p.slice(0, i) };
};

export function Backstage(p: Props) {
  const { t } = useTranslation();
  const first = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const item = (testid: string, Icon: typeof FilePlus2, label: string, onClick: () => void, extra: { disabled?: boolean; active?: boolean } = {}) => (
    <button data-testid={testid} className={`bs-item${extra.active ? ' is-active' : ''}`} disabled={extra.disabled} onClick={onClick}
      aria-current={extra.active || undefined} ref={testid === 'bs-new' ? first : undefined}>
      <Icon className="ic" aria-hidden /><span>{label}</span>
    </button>
  );

  return (
    <div ref={root} className="backstage" data-testid="backstage" role="dialog" aria-modal="true" aria-label={t('backstage.menu')}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && p.onBack) { e.preventDefault(); p.onBack(); } else trapFocus(e, root.current);
      }}>
      <aside className="bs-menu">
        {p.onBack
          ? <button className="bs-back iconbtn" data-testid="bs-back" aria-label={t('backstage.back')} title={t('backstage.back')} onClick={p.onBack}><ArrowLeft className="ic" aria-hidden /></button>
          : <div className="bs-back-spacer" />}
        <div className="bs-brand"><Database className="ic" aria-hidden />{t('app.title')}</div>
        {item('bs-new', FilePlus2, t('backstage.new'), p.onNew)}
        {item('bs-open', FolderOpen, t('backstage.open'), () => p.onOpen())}
        {item('bs-close', FolderClosed, t('backstage.close'), p.onCloseBase, { disabled: !p.hasBase })}
        <div className="bs-sep" />
        {item('bs-options', Settings2, t('backstage.options'), () => p.onView(p.view === 'options' ? 'home' : 'options'), { active: p.view === 'options' })}
      </aside>
      <main className="bs-content">
        {p.view === 'home' ? (
          <section className="bs-panel">
            <h1>{t('backstage.recent')}</h1>
            {p.settings?.recentFiles.length ? (
              <ul className="bs-recent">
                {p.settings.recentFiles.map((f, i) => {
                  const { name, dir } = splitPath(f);
                  return (
                    <li key={f}>
                      <button data-testid={`bs-recent-${i}`} className="bs-recent-item" title={f} onClick={() => p.onOpen(f)}>
                        <Database className="ic" aria-hidden />
                        <span className="bs-recent-text"><span className="bs-recent-name">{name}</span><span className="muted">{dir}</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="muted">{t('backstage.noRecent')}</p>}
          </section>
        ) : (
          <section className="bs-panel">
            <h1>{t('backstage.optionsTitle')}</h1>
            {p.settings && (
              <div className="bs-options">
                <label>
                  <span>{t('app.language.label')}</span>
                  <select data-testid="opt-lang" value={p.settings.locale}
                    onChange={async (e) => { await api.app.setLocale(e.target.value as AppSettings['locale']); p.onSettingsChanged(); }}>
                    {(['system', 'fr', 'en'] as const).map((l) => <option key={l} value={l}>{t(`app.language.${l}`)}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('app.theme.label')}</span>
                  <select data-testid="opt-theme" value={p.settings.theme}
                    onChange={async (e) => {
                      const v = e.target.value as AppSettings['theme'];
                      applyTheme(v); // at once, not after the round trip
                      await api.app.setTheme(v);
                      p.onSettingsChanged();
                    }}>
                    {(['system', 'light', 'dark'] as const).map((l) => <option key={l} value={l}>{t(`app.theme.${l}`)}</option>)}
                  </select>
                </label>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
