// Onglets de documents ; la vue de chacun vient du registre documentViews (type + mode).
import { AppWindow, FileSearch, FileText, Network, Table, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppAction, AppState, DocKind, DocTab } from '../state/app-state';
import { docTabId, showsKind } from './doc-tab-ids';
import { DocumentView } from './document-views';
import type { AppDispatch } from './nav-menu';

/** designOpen: another tab has this table in Design view (Table Fields then refuses to edit its fields). */
export interface DocViewProps { tab: DocTab; active: boolean; readOnly: boolean; dispatch: AppDispatch; designOpen?: boolean }

export const DOC_ICONS: Record<DocKind, LucideIcon> = {
  table: Table,
  query: FileSearch,
  form: AppWindow,
  report: FileText,
  relations: Network,
};

interface Props { state: AppState; readOnly: boolean; dispatch: AppDispatch; onClose(tab: DocTab): void }

export function DocumentTabs({ state, readOnly, dispatch, onClose }: Props) {
  const { t } = useTranslation();
  if (!state.tabs.length) {
    return <main className="docs card"><div className="doc-empty muted">{t('nav.openHint')}</div></main>;
  }
  return (
    <main className="docs card">
      <div className="dtabs" role="tablist">
        {state.tabs.map((x) => {
          const active = x.id === state.activeId;
          const Icon = DOC_ICONS[x.kind];
          const kind = t(`tabs.kind.${x.kind}`);
          const tid = docTabId(x);
          // The Relations window is one per base, titled in the interface language.
          const label = x.kind === 'relations' ? t('relations.title') : x.name;
          return (
            <div key={x.id} className={`dtab${active ? ' is-active' : ''}`}
              onAuxClick={(e) => { if (e.button === 1) onClose(x); }}>
              <button role="tab" aria-selected={active} aria-controls={`doc-${x.id}`} data-testid={`doc-tab-${tid}`} className="dtab-btn"
                onClick={() => dispatch({ type: 'activate', id: x.id })}>
                <Icon className="ic" aria-hidden />{label}{showsKind(x.kind) && <span className="sr-only"> ({kind})</span>}
                {x.dirty && <><span className="dtab-dirty" aria-hidden>•</span><span className="sr-only">{t('tabs.unsaved')}</span></>}
              </button>
              <button className="x" data-testid={`doc-tab-close-${tid}`} aria-label={showsKind(x.kind) ? t('tabs.close', { name: label, kind }) : t('tabs.closeWindow', { name: label })}
                title={t('backstage.close')} onClick={() => onClose(x)}>
                <X className="ic ic-sm" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      {state.tabs.map((x) => (
        // every document stays mounted (pending edits survive a tab switch); only the active one is shown
        <section key={x.id} id={`doc-${x.id}`} role="tabpanel" className="doc" hidden={x.id !== state.activeId}>
          <DocumentView tab={x} active={x.id === state.activeId} readOnly={readOnly} dispatch={dispatch}
            designOpen={state.tabs.some((o) => o.id !== x.id && o.kind === 'table' && o.name === x.name && o.mode === 'design')} />
        </section>
      ))}
    </main>
  );
}
