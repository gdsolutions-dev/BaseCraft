// Coulisse (onglet Fichier) : Récents, Nouveau, Ouvrir, Enregistrer sous, Compacter et réparer, Récents, Fermer, Options.
import { ArrowLeft, Database, ExternalLink, FilePlus2, FolderClosed, FolderOpen, History, Info, Save, Settings2, Wrench } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppInfo, BasecraftApi, LicenseEntry } from '../../shared/api';
import type { StartupOptions } from '../../shared/startup';
import { api } from '../bridge';
import { PRODUCT_TITLE_KEY, RUNTIME } from '../../shared/product';
import { design } from '../design/entry';
import { trapFocus } from './Modal';
import { OptionsPage, type OptionsCategory } from './OptionsPage';

export type Settings = Awaited<ReturnType<BasecraftApi['app']['getSettings']>>;
export type BackstageView = 'home' | 'options' | 'about';

/** File › About: product, version, copyright, licence, and the versions of what BaseCraft is built on. */
function About() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [licenses, setLicenses] = useState<LicenseEntry[] | null>(null);
  useEffect(() => { void api.app.info().then(setInfo); }, []);
  if (!info) return null;
  const link = (testid: string, label: string, url: string) => (
    <button type="button" className="btn" data-testid={testid} onClick={() => void api.app.openExternal(url)}>
      <ExternalLink className="ic" aria-hidden />{label}
    </button>
  );
  const rows: [string, string][] = [
    ['electron', info.electron], ['chromium', info.chromium], ['node', info.node], ['sqlite', info.sqlite], ['platform', `${info.platform} ${info.arch}`],
  ];
  return (
    <section className="bs-panel bs-about" data-testid="about">
      <h1>{t(RUNTIME ? 'about.titleRuntime' : 'about.title')}</h1>
      <p className="bs-about-product"><Database className="ic" aria-hidden /><span>{t(PRODUCT_TITLE_KEY)}</span>
        <span className="bs-about-version" data-testid="about-version">{t('about.version', { version: info.version })}</span></p>
      <p className="muted">{t('about.tagline')}</p>
      <p>{info.copyright}</p>
      <p>{t('about.licence', { licence: info.licence })}</p>
      <h2>{t('about.components')}</h2>
      <dl className="bs-about-versions">
        {rows.map(([k, v]) => <div key={k}><dt>{t(`about.${k}`)}</dt><dd data-testid={`about-${k}`}>{v}</dd></div>)}
      </dl>
      <div className="bs-about-links">
        {link('about-homepage', t('about.homepage'), info.links.homepage)}
        {link('about-issues', t('about.issues'), info.links.issues)}
        {link('about-licence', t('about.viewLicence'), info.links.licence)}
      </div>
      <button type="button" className="btn" data-testid="bs-about-licenses" onClick={() => (licenses ? setLicenses(null) : void api.app.licenses().then(setLicenses))}>
        {t('about.thirdParty')}
      </button>
      {licenses && (
        <ul className="bs-about-licenses" data-testid="bs-about-licenses-list">
          {licenses.map((l) => <li key={`${l.name}@${l.version}`}>{l.name} {l.version} <span className="muted">{l.license}</span></li>)}
        </ul>
      )}
    </section>
  );
}

interface Props {
  view: BackstageView; onView(v: BackstageView): void;
  onBack: (() => void) | null; // null: no base open, the backstage cannot be left
  hasBase: boolean; settings: Settings | null;
  onNew(): void; onCloseBase(): void;
  /** shift: Shift held on the click or key that asked for it (the base's startup is bypassed, B3 R4). */
  onOpen(path?: string, shift?: boolean): void;
  readOnly: boolean; onSaveAs(): void; onCompact(): void; // A6
  /** Options › Base de données active (B3): the forms to choose from; the title and icon saved, to apply at once (R11). */
  forms: readonly string[]; onStartupApplied(o: StartupOptions): void;
  /** A base behind a stale lock that is not recovered yet: its options cannot be read, so the section waits for the take-over. */
  needsRecovery: boolean;
}

const splitPath = (p: string) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return { name: p.slice(i + 1), dir: p.slice(0, i) };
};

export function Backstage(p: Props) {
  const { t } = useTranslation();
  const first = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [cat, setCat] = useState<OptionsCategory>('general');   // kept while the Backstage stays open
  useEffect(() => { first.current?.focus(); }, []);
  const item = (testid: string, Icon: typeof FilePlus2, label: string, onClick: (e: MouseEvent) => void, extra: { disabled?: boolean; active?: boolean } = {}) => (
    <button data-testid={testid} className={`bs-item${extra.active ? ' is-active' : ''}`} disabled={extra.disabled} onClick={onClick}
      aria-current={extra.active || undefined} ref={testid === 'bs-recent' ? first : undefined}>
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
        <div className="bs-brand" data-testid="bs-brand"><Database className="ic" aria-hidden />{t(PRODUCT_TITLE_KEY)}</div>
        {item('bs-recent', History, t('backstage.recent'), () => p.onView('home'), { active: p.view === 'home' })}
        {!RUNTIME && item('bs-new', FilePlus2, t('backstage.new'), p.onNew)}
        {item('bs-open', FolderOpen, t('backstage.open'), (e) => p.onOpen(undefined, e.shiftKey))}
        {/* BaseCraft Runtime creates and rewrites no base (B5 R4) */}
        {!RUNTIME && item('bs-save-as', Save, t('backstage.saveAs'), p.onSaveAs, { disabled: !p.hasBase })}
        {!RUNTIME && item('bs-compact', Wrench, t('backstage.compact'), p.onCompact, { disabled: !p.hasBase || p.readOnly })}
        {item('bs-close', FolderClosed, t('backstage.close'), p.onCloseBase, { disabled: !p.hasBase })}
        <div className="bs-sep" />
        {item('bs-options', Settings2, t('backstage.options'), () => p.onView(p.view === 'options' ? 'home' : 'options'), { active: p.view === 'options' })}
        {item('bs-about', Info, t('backstage.about'), () => p.onView(p.view === 'about' ? 'home' : 'about'), { active: p.view === 'about' })}
      </aside>
      <main className="bs-content">
        {p.view === 'about' ? <About /> : p.view === 'home' ? (
          <section className="bs-panel">
            <h1>{t('backstage.recent')}</h1>
            {p.settings?.recentFiles.length && p.settings.recentCount ? (
              <ul className="bs-recent">
                {p.settings.recentFiles.slice(0, p.settings.recentCount).map((f, i) => {
                  const { name, dir } = splitPath(f);
                  return (
                    <li key={f}>
                      <button data-testid={`bs-recent-${i}`} className="bs-recent-item" title={f} onClick={(e) => p.onOpen(f, e.shiftKey)}>
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
          <OptionsPage settings={p.settings} cat={cat} onCat={setCat}
            currentDb={design && p.hasBase && !p.needsRecovery ? <design.CurrentDatabaseOptions readOnly={p.readOnly} forms={p.forms} onApplied={p.onStartupApplied} /> : null} />
        )}
      </main>
    </div>
  );
}
