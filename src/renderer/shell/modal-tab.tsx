// Onglet modal, comme le Générateur de requête d'Access (« Formulaire1 : Générateur de requête ») : un onglet de document ajouté
// au bout de la barre, actif tant qu'il est ouvert ; le reste de la fenêtre (volet de navigation, autres onglets) est inerte,
// comme derrière une boîte de dialogue. Le ruban et la barre d'état servent l'onglet : ses commandes sont celles de `scope`, dans le
// contexte `kind` / `mode` (ribbon-model : builder). Son contenu est rendu par l'appelant (ses contextes React restent)
// et porté dans le panneau de l'onglet. Un seul à la fois.
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DocKind, DocMode } from '../state/app-state';
import type { AppDispatch } from './nav-menu';
import { trapFocus } from './Modal';

/** labelKey : la fin du libellé de l'onglet, après le nom du document actif ; onRequestClose : la croix de l'onglet ;
 *  scope : la portée des commandes du ruban (MODAL_SCOPE…), dans le contexte kind / mode. */
export interface ModalTabEntry { labelKey: string; testId: string; onRequestClose(): void; scope: string; kind: DocKind; mode: DocMode }

let entry: ModalTabEntry | null = null;
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useModalTab = (): ModalTabEntry | null => useSyncExternalStore(subscribe, () => entry);
const useSlot = (): HTMLElement | null => useSyncExternalStore(subscribe, () => slot);
/** Rend inerte (ni clic, ni focus) ce qui est derrière un onglet modal : `ref={inertRef(!!modalTab)}`. */
export const inertRef = (on: boolean) => (el: HTMLElement | null): void => { if (el) el.inert = on; };
/** Une boîte de dialogue est devant (pas le panneau d'un onglet modal, qui laisse passer les raccourcis du ruban). */
export const dialogInFront = (): boolean => [...document.querySelectorAll('[aria-modal="true"]')].some((e) => !e.classList.contains('modal-tab-panel'));
/** Le panneau de l'onglet (DocumentTabs), où le contenu est porté. */
export function setModalTabSlot(el: HTMLElement | null): void { if (slot !== el) { slot = el; changed(); } }

let dispatchRef: AppDispatch = () => {};
/** Le dispatch du shell, pour un onglet modal rendu hors d'un document (le Générateur ouvre une requête, en enregistre une). */
export function setShellDispatch(fn: AppDispatch): void { dispatchRef = fn; }
export const shellDispatch: AppDispatch = (a) => dispatchRef(a);

/** Le contenu d'un onglet modal : ouvert tant que le composant est monté. */
export function ModalTab({ labelKey, testId, onRequestClose, scope, kind, mode, children }: ModalTabEntry & { children: ReactNode }) {
  const close = useRef(onRequestClose);
  close.current = onRequestClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => { entry = null; changed(); before?.focus?.(); };
  }, []);
  useEffect(() => { entry = { labelKey, testId, scope, kind, mode, onRequestClose: () => close.current() }; changed(); }, [labelKey, testId, scope, kind, mode]);
  const target = useSlot();
  useEffect(() => { target?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus(); }, [target]);
  if (!target) return null;
  return createPortal(
    // the keys stay here: the designer behind (in the React tree) never sees them
    <div className="modal-tab" data-testid={testId} onKeyDown={(e: KeyboardEvent) => { e.stopPropagation(); trapFocus(e, target); }}>{children}</div>,
    target);
}
