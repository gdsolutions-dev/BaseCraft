// Formulaires ouverts en mode Boîte de dialogue (R12) : chacun par-dessus toute la fenêtre (le dernier ouvert au-dessus), le
// reste inerte sous un voile, comme une fenêtre modale d'Access. Son onglet n'est pas dans la barre ; sa croix suit le chemin de
// fermeture d'un onglet (sa garde, son Sur fermeture) ; Échap ne le ferme pas (Access). Les boîtes de message restent au-dessus.
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignDoc } from '../../shared/design/model';
import { effectiveProp } from '../../shared/design/properties';
import { api } from '../bridge';
import { twipsToPx } from '../designer/units';
import { parseFormDoc } from '../form/form-def';
import type { DocTab } from '../state/app-state';
import { DocumentView } from './document-views';
import { useErrorDialog, trapFocus } from './Modal';
import { inertRef } from './modal-tab';
import type { AppDispatch } from './nav-menu';
import { modeGuard } from './ribbon-model';

/** The record selector's width beside the Detail section (SingleFormView). */
const SELECTOR_PX = 18;

export function DialogHost(p: { tabs: readonly DocTab[]; activeId: string | null; dispatch: AppDispatch; readOnly: boolean }): JSX.Element | null {
  const dialogs = p.tabs.filter((x) => x.dialog);
  // the focus the first dialog took, given back when the last one closes (as a modal window)
  const opener = useRef<Element | null>(null);
  const open = dialogs.length > 0;
  if (open && opener.current === null) opener.current = document.activeElement;   // in render: before the dialog takes the focus
  useEffect(() => {
    const el = opener.current;
    if (open || !el) return;
    opener.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
  }, [open]);
  if (!open) return null;
  // the active dialog and the dialogs under it that opened it stay active (as DocumentTabs' opener)
  const active = new Set<string>();
  for (let t = p.tabs.find((x) => x.id === p.activeId); t?.dialog; t = p.tabs.find((x) => x.id === t!.openerId)) active.add(t.id);
  return <>{dialogs.map((tab, i) => <FormDialog key={tab.id} tab={tab} active={active.has(tab.id)} top={i === dialogs.length - 1}
    dispatch={p.dispatch} readOnly={p.readOnly} />)}</>;
}

function FormDialog({ tab, active, top, dispatch, readOnly }: { tab: DocTab; active: boolean; top: boolean; dispatch: AppDispatch; readOnly: boolean }) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<DesignDoc | null>(null);
  // its title and width; a definition that cannot be read: the form view says why, the dialog keeps its name and a default width
  useEffect(() => { api.objects.get('form', tab.name).then((r) => setDoc(parseFormDoc(r.definition).doc), () => {}); }, [tab.name, tab.reloadToken]);
  useEffect(() => { if (top && !box.current?.contains(document.activeElement)) box.current?.focus(); }, [top]);

  const close = async () => {
    try {
      const guard = modeGuard(tab.id);   // as a tab's close: its pending record, its On Close
      if (guard && !(await guard('close'))) return;
      dispatch({ type: 'close', id: tab.id });
    } catch (e) { await showError(e); }
  };
  const caption = doc ? String(effectiveProp(doc.props, 'Caption', 'form') ?? '') : '';
  const selectors = !!doc?.recordSource && effectiveProp(doc.props, 'RecordSelectors', 'form') !== false;
  // the form's width; its height is its sections' (and its navigation bar's), up to the window's
  const width = doc ? twipsToPx(Number(effectiveProp(doc.props, 'Width', 'form')) || 0) + (selectors ? SELECTOR_PX : 0) : undefined;
  const titleId = `form-dialog-title-${tab.id}`;
  return (
    <div className="form-dialog-backdrop" ref={inertRef(!top)}>
      <div ref={box} className="form-dialog card" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        data-testid={`form-dialog-${tab.name}`} onKeyDown={(e: KeyboardEvent) => { if (!e.defaultPrevented) trapFocus(e, box.current); }}>
        <div className="form-dialog-bar">
          <h2 id={titleId} className="form-dialog-title" data-testid="form-dialog-title">{caption || tab.name}</h2>
          <button className="form-dialog-x" data-testid="form-dialog-close" title={t('backstage.close')} aria-label={t('backstage.close')} onClick={() => void close()}>
            <X className="ic ic-sm" aria-hidden />
          </button>
        </div>
        <div className="form-dialog-body" style={{ width }}>
          <DocumentView tab={tab} active={active} readOnly={readOnly} dispatch={dispatch} />
        </div>
      </div>
    </div>
  );
}
