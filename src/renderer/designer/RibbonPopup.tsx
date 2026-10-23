// Menu flottant du concepteur : sous un bouton du ruban (RibbonPopup), ou au point d'un clic droit (PopupMenu).
// Échap, Tab ou un clic dehors ferme ; un clic sur le bouton qui l'a ouvert le referme ; Haut/Bas/Début/Fin parcourent les éléments.
// Le focus va au premier élément actif (à défaut au premier champ ou bouton), puis revient où il était.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { openPopupOf, setOpenPopup, type CommandId } from '../shell/ribbon-model';

const ITEMS = '[role^="menuitem"]:not([disabled])';

/** role="dialog": content that is no menu items (a field, colour choices), named by labelKey; its own keys (no Up/Down here). */
export function PopupMenu(p: { x: number; y: number; testId: string; labelKey: string; onClose(): void; children: ReactNode; anchor?: CommandId; role?: 'menu' | 'dialog' }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { anchor } = p;
  const close = useRef(p.onClose);
  close.current = p.onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // sans élément de menu : l'arrêt de tabulation d'un groupe (la couleur actuelle), sinon le premier champ ou bouton
    const q = (sel: string) => ref.current?.querySelector<HTMLElement>(sel);
    (q(ITEMS) ?? q('[tabindex="0"]') ?? q('input, button:not([disabled])'))?.focus();
    const onAnchor = (e: Event) => !!anchor && !!document.querySelector(`[data-testid="cmd-${anchor}"]`)?.contains(e.target as Node);
    // la liste d'un ComboBox du menu est posée dans <body> : un clic dedans n'est pas un clic dehors
    const ownList = (n: Node) => { const list = n instanceof Element ? n.closest('[role="listbox"]') : null;
      return !!list?.id && !!ref.current?.querySelector(`[aria-controls="${CSS.escape(list.id)}"]`); };
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !onAnchor(e) && !ownList(e.target as Node)) close.current(); };
    // le bouton d'origine referme le menu, sans relancer sa commande (capture sur window : avant le gestionnaire de React)
    const toggle = (e: MouseEvent) => { if (onAnchor(e)) { e.stopPropagation(); e.preventDefault(); close.current(); } };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('click', toggle, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('click', toggle, true);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [anchor]);
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); p.onClose(); return; }
    if (p.role === 'dialog' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next]?.focus();
  };
  return (
    <div ref={ref} className="ctxmenu card" role={p.role ?? 'menu'} aria-label={t(p.labelKey)} data-testid={p.testId} style={{ left: p.x, top: p.y }} onKeyDown={keys}>
      {p.children}
    </div>
  );
}

/** Sous le bouton `cmd-<anchor>`, comme le menu de filtre de la feuille de données. */
export function RibbonPopup(p: { anchor: CommandId; testId: string; labelKey: string; onClose(): void; children: ReactNode; role?: 'menu' | 'dialog' }) {
  const { anchor } = p;
  useEffect(() => { setOpenPopup(anchor); return () => { if (openPopupOf() === anchor) setOpenPopup(null); }; }, [anchor]);   // aria-expanded du bouton
  const r = document.querySelector(`[data-testid="cmd-${p.anchor}"]`)?.getBoundingClientRect();
  return <PopupMenu x={r?.left ?? 0} y={r?.bottom ?? 0} testId={p.testId} labelKey={p.labelKey} onClose={p.onClose} anchor={p.anchor} role={p.role}>{p.children}</PopupMenu>;
}
