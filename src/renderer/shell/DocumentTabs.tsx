// Onglets de documents et point de bascule type + mode → vue.
import { Table, X } from 'lucide-react';
import type { Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppAction, AppState, DocTab } from '../state/app-state';
import { DatasheetView } from '../datasheet/DatasheetView';
import { TableDesignView } from '../table-design/TableDesignView';

export interface DocViewProps { tab: DocTab; active: boolean; readOnly: boolean; dispatch: Dispatch<AppAction> }

/** The one switch point: document kind + mode → view. */
function DocumentView(p: DocViewProps) {
  switch (p.tab.kind) {
    case 'table': return p.tab.mode === 'design' ? <TableDesignView {...p} /> : <DatasheetView {...p} />;
  }
}

interface Props { state: AppState; readOnly: boolean; dispatch: Dispatch<AppAction>; onClose(tab: DocTab): void }

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
          return (
            <div key={x.id} className={`dtab${active ? ' is-active' : ''}`}
              onAuxClick={(e) => { if (e.button === 1) onClose(x); }}>
              <button role="tab" aria-selected={active} aria-controls={`doc-${x.id}`} data-testid={`doc-tab-${x.name}`} className="dtab-btn"
                onClick={() => dispatch({ type: 'activate', id: x.id })}>
                <Table className="ic" aria-hidden />{x.name}
                {x.dirty && <><span className="dtab-dirty" aria-hidden>•</span><span className="sr-only">{t('tabs.unsaved')}</span></>}
              </button>
              <button className="x" data-testid={`doc-tab-close-${x.name}`} aria-label={t('tabs.close', { name: x.name })}
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
          <DocumentView tab={x} active={x.id === state.activeId} readOnly={readOnly} dispatch={dispatch} />
        </section>
      ))}
    </main>
  );
}
