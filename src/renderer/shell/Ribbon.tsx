import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  commandEnabled, commandState, commandsVersion, openPopupOf, runCommand, subscribeCommands, tabAfterContextChange, visibleTabs,
  type CommandId, type RibbonCommand, type RibbonContext, type RibbonTabId,
} from './ribbon-model';

/** Clipboard buttons act on the focused element (a text field, a pane item): a click on them must not take the focus. */
const KEEP_FOCUS: ReadonlySet<string> = new Set(['cut', 'copy', 'paste']);
const STACK = 3; // small buttons per column, icon-only buttons per grid column, as in the mockup
const TIP_WIDTH = 280; // .rtip max-width
type Item = RibbonCommand | { size: 'sm' | 'xs'; cmds: RibbonCommand[] };

export function Ribbon({ ctx, onFile }: { ctx: RibbonContext; onFile: () => void }) {
  const { t } = useTranslation();
  useSyncExternalStore(subscribeCommands, commandsVersion); // re-render when the active document's commands change
  const tabs = visibleTabs(ctx);
  // C10: a new object kind or mode brings its contextual tab forward; leaving it gives back the tab selected before.
  const key = `${ctx.kind}|${ctx.mode}`;
  const [sel, setSel] = useState(() => ({ ...tabAfterContextChange(tabs, { selected: 'home', before: 'home' }), key }));
  if (sel.key !== key) setSel({ ...tabAfterContextChange(tabs, sel), key });
  const current = tabs.find((x) => x.id === sel.selected) ?? tabs[0];

  // Placeholders (C11) explain on hover and on keyboard focus which batch delivers them.
  // The tooltip is fixed (the ribbon body scrolls and would clip it) and placed under its button at each render.
  const [tip, setTip] = useState<{ id: CommandId; el: HTMLElement } | null>(null);
  const showTip = (id: CommandId) => (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => setTip({ id, el: e.currentTarget });
  const hideTip = () => setTip(null);
  // Left-aligned with its button; near the window's right edge, right-aligned with it instead (its width follows its text).
  const tipStyle = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const w = document.documentElement.clientWidth;
    return r.left + TIP_WIDTH > w - 4 ? { right: Math.max(4, w - r.right), top: r.bottom + 4 } : { left: Math.max(4, r.left), top: r.bottom + 4 };
  };
  const select = (id: RibbonTabId) => { hideTip(); setSel((s) => ({ ...s, selected: id })); };

  // Groups that do not fit scroll sideways, with an arrow at each edge that has more.
  const body = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const b = body.current;
    if (!b) return;
    const left = b.scrollLeft > 1;
    const right = b.scrollLeft + b.clientWidth < b.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  };
  // a new tab or language changes the content; not after every render (a state update per commit would never settle)
  useLayoutEffect(() => { body.current?.scrollTo({ left: 0 }); measure(); }, [current.id, t]);
  useEffect(() => {
    const b = body.current;
    if (!b) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(b);
    return () => ro.disconnect();
  }, []);
  const scroll = (dir: 1 | -1) => { const b = body.current; if (b) b.scrollBy({ left: dir * b.clientWidth * 0.8, behavior: 'smooth' }); };

  const button = (c: RibbonCommand) => {
    const label = t(c.labelKey);
    const Icon = c.icon;
    const iconOnly = c.size === 'xs';
    // ponytail: a long label (Access's « Compacter et réparer une base de données ») needs a wider large button to stay on two lines;
    // decided by length, the 900 px layout e2e catches a label too long even for that.
    const size = `rbtn-${c.size}${c.size === 'lg' && label.length >= 24 ? ' rbtn-wide' : ''}`;
    const content = <><Icon className={c.size === 'lg' ? 'ic ic-lg' : 'ic'} aria-hidden />{!iconOnly && <span>{label}</span>}</>;
    if (c.planned) {
      const tipId = `rtip-${c.id}`;
      const shown = tip?.id === c.id ? tip.el : null;
      return (
        <Fragment key={c.id}>
          {/* aria-disabled, not disabled: it stays focusable so that its tooltip can be read; it has no action. A small or
              icon-only button may show no label (narrow window), so its tooltip names it (hidden from the description: the name
              is already its aria-label). Escape dismisses it (WCAG 1.4.13). */}
          <button data-testid={`cmd-${c.id}`} data-planned={c.planned} className={`${size} is-planned`} aria-disabled="true"
            aria-label={label} aria-describedby={tipId}
            onMouseEnter={showTip(c.id)} onMouseLeave={hideTip} onFocus={showTip(c.id)} onBlur={hideTip}
            onKeyDown={(e) => { if (e.key === 'Escape') hideTip(); }}>
            {content}
          </button>
          <span role="tooltip" id={tipId} className="rtip" data-testid={`tip-${c.id}`} hidden={!shown}
            style={shown ? tipStyle(shown) : undefined}>
            {c.size !== 'lg' && <b aria-hidden>{label}</b>}{t(`ribbon.planned.${c.planned}`)}
          </span>
        </Fragment>
      );
    }
    const on = commandState(c.id)?.active ?? c.active?.(ctx);
    return (
      <button key={c.id} data-testid={`cmd-${c.id}`} className={`${size}${on ? ' is-on' : ''}`} title={label}
        aria-label={iconOnly ? label : undefined} aria-pressed={c.active ? !!on : undefined} disabled={!commandEnabled(c.id, ctx)}
        aria-haspopup={c.popup === 'dialog' ? 'dialog' : c.popup ? 'menu' : undefined} aria-expanded={c.popup ? openPopupOf() === c.id : undefined}
        onMouseDown={KEEP_FOCUS.has(c.id) ? (e) => e.preventDefault() : undefined}
        onClick={() => runCommand(c.id)}>
        {content}
      </button>
    );
  };

  return (
    <header className="ribbon" aria-label={t('ribbon.label')}>
      <nav className="rtabs" role="tablist">
        <button className="rtab rtab-file" data-testid="ribbon-tab-file" disabled={!!ctx.builder} onClick={onFile}>{t('ribbon.file')}</button>
        {tabs.map((x, i) => (
          <Fragment key={x.id}>
            {x.contextual && i > 0 && !tabs[i - 1].contextual && <span className="rtab-sep" aria-hidden />}
            <button role="tab" aria-selected={x === current} data-testid={`ribbon-tab-${x.id}`}
              className={`rtab${x.contextual ? ' rtab-ctx' : ''}${x === current ? ' is-active' : ''}`}
              onClick={() => select(x.id)}>{t(x.labelKey)}</button>
          </Fragment>
        ))}
      </nav>
      <div className="rbody-wrap">
        {/* The browser's own focus scroll stops at the body's edge, under an arrow: bring the focused command clear of the arrows
            (scroll-padding in shell.css). */}
        <div ref={body} className="rbody" role="tabpanel" onScroll={() => { setTip((x) => (x ? { ...x } : x)); measure(); }}
          onFocus={(e) => e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })}>
          {current.groups.filter((g) => !g.visible || g.visible(ctx)).map((g) => {
            // large buttons alone, consecutive small ones stacked in columns, icon-only ones in a grid of three rows
            const items: Item[] = [];
            for (const c of g.commands.filter((x) => !x.visible || x.visible(ctx))) {
              const last = items[items.length - 1];
              if (c.size === 'lg') items.push(c);
              else if (last && 'cmds' in last && last.size === c.size && (c.size === 'xs' || last.cmds.length < STACK)) last.cmds.push(c);
              else items.push({ size: c.size, cmds: [c] });
            }
            return (
              <div key={g.id} className="rgroup" role="group" aria-label={t(g.labelKey)} data-testid={`ribbon-group-${g.id}`}>
                <div className="ritems">
                  {items.map((it, i) => (!('cmds' in it) ? button(it)
                    : it.size === 'sm' ? <div key={i} className="rstack">{it.cmds.map(button)}</div>
                    : <div key={i} className="rgrid" style={{ gridTemplateColumns: `repeat(${Math.ceil(it.cmds.length / STACK)}, auto)` }}>{it.cmds.map(button)}</div>))}
                </div>
                <div className="rlabel" aria-hidden>{t(g.labelKey)}</div>
              </div>
            );
          })}
        </div>
        {edges.left && (
          <button className="rscroll rscroll-l" data-testid="ribbon-scroll-left" tabIndex={-1} aria-label={t('ribbon.scrollLeft')} title={t('ribbon.scrollLeft')}
            onClick={() => scroll(-1)}><ChevronLeft className="ic" aria-hidden /></button>
        )}
        {edges.right && (
          <button className="rscroll rscroll-r" data-testid="ribbon-scroll-right" tabIndex={-1} aria-label={t('ribbon.scrollRight')} title={t('ribbon.scrollRight')}
            onClick={() => scroll(1)}><ChevronRight className="ic" aria-hidden /></button>
        )}
      </div>
    </header>
  );
}
