// Onglets de documents ; la vue de chacun vient du registre documentViews (type + mode).
import { AppWindow, FileSearch, FileText, Network, Table, X, Zap, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TableSummary } from '../../shared/api';
import type { AppAction, AppState, DocKind, DocTab } from '../state/app-state';
import { docTabId, showsKind } from './doc-tab-ids';
import { DocumentView } from './document-views';
import { inertRef, setModalTabSlot, useModalTab } from './modal-tab';
import type { AppDispatch } from './nav-menu';

/** designOpen: another tab has this table in Design view (Table Fields then refuses to edit its fields).
 *  link: a linked table's Design view, its source (C1 R8): the view is read-only. */
export interface DocViewProps { tab: DocTab; active: boolean; readOnly: boolean; dispatch: AppDispatch; designOpen?: boolean; link?: TableSummary['link'] }

export const DOC_ICONS: Record<DocKind, LucideIcon> = {
  table: Table,
  query: FileSearch,
  form: AppWindow,
  report: FileText,
  relations: Network,
  macro: Zap,
};

/** showTabs false (O1 R7): no strip of document tabs, but a Query Builder's own tab; the front document is shown alone.
 *  formIcon: the base's icon on form and report tabs (a data URL, O1 R10); null: their own. */
interface Props { state: AppState; readOnly: boolean; linkOf(tab: DocTab): TableSummary['link']; dispatch: AppDispatch; onClose(tab: DocTab): void; showTabs: boolean; formIcon: string | null }

export function DocumentTabs({ state, readOnly, linkOf, dispatch, onClose, showTabs, formIcon }: Props) {
  const { t } = useTranslation();
  const modalTab = useModalTab();   // a Query Builder: its tab is the only one that answers until it closes
  const tabs = state.tabs.filter((x) => !x.dialog);   // a dialog form is shown by DialogHost (R12), not as a tab
  const front = frontTabId(state);
  if (!tabs.length) {
    return <main className="docs card"><div className="doc-empty muted">{t('nav.openHint')}</div></main>;
  }
  return (
    <main className="docs card">
      {(showTabs || modalTab) && <div className="dtabs" role="tablist">
        {showTabs && tabs.map((x) => {
          const active = !modalTab && x.id === front;
          const Icon = DOC_ICONS[x.kind];
          const kind = t(`tabs.kind.${x.kind}`);
          const tid = docTabId(x);
          // The Relations window is one per base, titled in the interface language.
          const label = x.kind === 'relations' ? t('relations.title') : x.name;
          return (
            <div key={x.id} className={`dtab${active ? ' is-active' : ''}`} ref={inertRef(!!modalTab)}
              onAuxClick={(e) => { if (e.button === 1) onClose(x); }}>
              <button role="tab" aria-selected={active} aria-controls={`doc-${x.id}`} data-testid={`doc-tab-${tid}`} className="dtab-btn"
                onClick={() => dispatch({ type: 'activate', id: x.id })}>
                {formIcon && (x.kind === 'form' || x.kind === 'report') ? <img className="ic" src={formIcon} alt="" width={16} height={16} /> : <Icon className="ic" aria-hidden />}{label}{showsKind(x.kind) && <span className="sr-only"> ({kind})</span>}
                {x.dirty && <><span className="dtab-dirty" aria-hidden>•</span><span className="sr-only">{t('tabs.unsaved')}</span></>}
              </button>
              <button className="x" data-testid={`doc-tab-close-${tid}`} aria-label={showsKind(x.kind) ? t('tabs.close', { name: label, kind }) : t('tabs.closeWindow', { name: label })}
                title={t('backstage.close')} onClick={() => onClose(x)}>
                <X className="ic ic-sm" aria-hidden />
              </button>
            </div>
          );
        })}
        {modalTab && (
          <div className="dtab is-active">
            <button role="tab" aria-selected id={`${modalTab.testId}-tab`} aria-controls={`${modalTab.testId}-panel`} data-testid={`${modalTab.testId}-tab`} className="dtab-btn">
              <FileSearch className="ic" aria-hidden />{modalLabel(state, t)} : {t(modalTab.labelKey)}
            </button>
            <button className="x" data-testid={`${modalTab.testId}-tab-close`} title={t('backstage.close')} aria-label={t('backstage.close')}
              onClick={() => modalTab.onRequestClose()}>
              <X className="ic ic-sm" aria-hidden />
            </button>
          </div>
        )}
      </div>}
      {modalTab && (
        // aria-modal: the designers' keys stand back, as for a dialog (the shell's shortcuts serve the tab: dialogInFront)
        <section ref={setModalTabSlot} id={`${modalTab.testId}-panel`} role="dialog" aria-modal="true" aria-labelledby={`${modalTab.testId}-tab`} className="doc modal-tab-panel" />
      )}
      {tabs.map((x) => {
        const link = linkOf(x);
        // every document stays mounted (pending edits survive a tab switch); only the active one is shown. Under a dialog its
        // opener stays active: its dialog closing is no coming back to it (no reading again under a macro's SetValue that follows)
        return (
          <section key={x.id} id={`doc-${x.id}`} role={showTabs ? 'tabpanel' : undefined} className="doc" hidden={!!modalTab || x.id !== front}>
            <DocumentView tab={x} active={x.id === front} readOnly={readOnly || !!link} link={link} dispatch={dispatch}
              designOpen={state.tabs.some((o) => o.id !== x.id && o.kind === 'table' && o.name === x.name && o.mode === 'design')} />
          </section>
        );
      })}
    </main>
  );
}

/** The tab shown in front: the active one, or under a dialog form the tab that opened the first dialog (R12). */
function frontTabId(state: AppState): string | null {
  let tab = state.tabs.find((x) => x.id === state.activeId);
  while (tab?.dialog) { const opener = tab.openerId; tab = state.tabs.find((x) => x.id === opener); }
  return tab?.id ?? null;
}

/** The name of the document that opened the Query Builder (the active one), as its tab shows it. */
function modalLabel(state: AppState, t: (k: string) => string): string {
  const tab = state.tabs.find((x) => x.id === state.activeId);
  return !tab ? '' : tab.kind === 'relations' ? t('relations.title') : tab.name;
}
