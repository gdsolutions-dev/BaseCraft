// Rendu du menu contextuel du volet de navigation depuis le registre (nav-menu.ts) : groupes séparés, sous-menus, clavier
// complet (flèches, Origine/Fin, Entrée, Échap, touches d'accès soulignées), emplacements prévus atteignables avec leur info-bulle.
import { ChevronRight } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorDialog } from './Modal';
import { accessKey, foldKey, navItemEnabled, navMenuGroups, placeMenu, type NavMenuContext, type NavMenuItem } from './nav-menu';

type Anchor = () => { left: number; right: number; top: number; bottom: number };

interface Props { ctx: NavMenuContext; x: number; y: number; onClose(): void }

export function NavMenu({ ctx, x, y, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const showError = useErrorDialog();
  const [before] = useState(() => document.activeElement as HTMLElement | null); // read before the menu takes the focus
  useEffect(() => () => before?.focus?.(), [before]); // the pane's item, focused again when the menu goes
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);
  const run = (item: NavMenuItem) => {
    onClose();
    void Promise.resolve().then(() => item.run?.(ctx)).catch(showError);
  };
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      <MenuLevel testId="nav-menu" groups={navMenuGroups(ctx)} ctx={ctx} onRun={run} onExit={onClose} autoFocus
        anchor={() => ({ left: x, right: x, top: y, bottom: y })} />
    </div>
  );
}

const focusables = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not([disabled]), :scope > .ctxmenu-entry > [role="menuitem"]:not([disabled])')];

/** anchor: the point the menu opens at, or the item a submenu belongs to; the menu is placed inside the window (placeMenu). */
function MenuLevel({ testId, groups, ctx, onRun, onExit, autoFocus, sub, anchor, id }: {
  testId: string; groups: NavMenuItem[][]; ctx: NavMenuContext; onRun(i: NavMenuItem): void; onExit(): void; autoFocus?: boolean; sub?: boolean;
  anchor: Anchor; id?: string;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  useLayoutEffect(() => { // before paint: measured, then moved
    const el = ref.current!;
    const p = placeMenu(anchor(), { width: el.offsetWidth, height: el.offsetHeight }, { width: innerWidth, height: innerHeight });
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
  }, []); // placed once, when it opens
  useEffect(() => { if (autoFocus && ref.current) focusables(ref.current)[0]?.focus(); }, [autoFocus]);

  const activate = (item: NavMenuItem) => {
    if (!navItemEnabled(item, ctx)) return; // a placeholder: nothing, as in the ribbon
    if (item.submenu) setOpen(item.id);
    else onRun(item);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // a submenu's keys do not reach its parent
    const els = ref.current ? focusables(ref.current) : [];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const focus = (n: number) => els[(n + els.length) % els.length]?.focus();
    const current = groups.flat().find((x) => `${testId}-${x.id}` === (document.activeElement as HTMLElement | null)?.dataset.testid);
    if (e.key === 'ArrowDown') focus(i + 1);
    else if (e.key === 'ArrowUp') focus(i < 0 ? -1 : i - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(-1);
    else if (e.key === 'ArrowRight' && current?.submenu) activate(current);
    else if (e.key === 'Escape' || (sub && e.key === 'ArrowLeft')) onExit();
    else if (e.key === 'Tab') onExit();
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const hit = groups.flat().find((x) => navItemEnabled(x, ctx) && foldKey(accessKey(t(x.labelKey)).key) === foldKey(e.key));
      if (!hit) return;
      if (hit.submenu) ref.current?.querySelector<HTMLElement>(`[data-testid="${testId}-${hit.id}"]`)?.focus();
      activate(hit);
    } else return;
    e.preventDefault();
  };

  return (
    <div ref={ref} className="ctxmenu card" role="menu" id={id} data-testid={sub ? `${testId}-menu` : testId} onKeyDown={onKeyDown}
>
      {groups.map((g, gi) => [
        gi > 0 && <div key={`sep-${gi}`} className="ctxmenu-sep" role="separator" />,
        ...g.map((item) => {
          const label = accessKey(t(item.labelKey));
          const Icon = item.icon;
          const enabled = navItemEnabled(item, ctx);
          const tid = `${testId}-${item.id}`;
          const subId = `${uid}-${item.id}`;
          const button = (
            <button key={item.id} role="menuitem" data-testid={tid} tabIndex={-1}
              disabled={!item.planned && !enabled} aria-disabled={item.planned ? true : undefined} data-planned={item.planned}
              title={item.planned ? t(`ribbon.planned.${item.planned}`) : undefined}
              aria-haspopup={item.submenu ? 'menu' : undefined} aria-expanded={item.submenu ? open === item.id : undefined}
              aria-controls={item.submenu && open === item.id ? subId : undefined}
              onClick={() => activate(item)} onMouseEnter={() => setOpen(item.submenu && enabled ? item.id : null)}>
              {Icon ? <Icon className="ic ic-sm" aria-hidden /> : <span className="ic ic-sm" aria-hidden />}
              <span>{label.before}{label.key && <u>{label.key}</u>}{label.after}</span>
              {item.submenu && <ChevronRight className="ic ic-sm ctxmenu-chev" aria-hidden />}
            </button>
          );
          if (!item.submenu) return button;
          return (
            <div key={item.id} className="ctxmenu-entry" role="none">
              {button}
              {open === item.id && (
                <MenuLevel testId={tid} id={subId} groups={[item.submenu]} ctx={ctx} onRun={onRun} autoFocus sub
                  anchor={() => ref.current!.querySelector(`[data-testid="${tid}"]`)!.getBoundingClientRect()}
                  onExit={() => { setOpen(null); ref.current?.querySelector<HTMLElement>(`[data-testid="${tid}"]`)?.focus(); }} />
              )}
            </div>
          );
        }),
      ])}
    </div>
  );
}
