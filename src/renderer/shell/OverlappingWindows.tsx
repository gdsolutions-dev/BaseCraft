// Overlapping windows (C6, Access's « Fenêtres superposées »): the open objects are windows inside the client area, each with a title
// bar (icon, name, minimize, maximize, close), moved and resized with the pointer, brought to the front on a click. Chosen by the
// base's option and read when it opens. Every window stays mounted (pending edits survive), as the tabs do. A form opens at its own
// width and its height follows its sections until the user resizes it; Size to Fit Form gives that back.
import { Copy, Minus, Square, SquareStack, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isServerKind, type TableSummary } from '../../shared/api';
import { hosted, type AppState, type DocTab } from '../state/app-state';
import { docTabId } from './doc-tab-ids';
import { DOC_ICONS, frontTabId, modalLabel } from './DocumentTabs';
import { DocumentView } from './document-views';
import { chrome, DEFAULT_WIN } from './form-window';
import { inertRef, setModalTabSlot, useModalTab } from './modal-tab';
import type { AppDispatch } from './nav-menu';

/** w / h null: the window's own size (a form's width, the height of its content). */
interface Geo { x: number; y: number; w: number | null; h: number | null; min: boolean; max: boolean; ctr?: boolean /* centred (Auto Center) until moved */ }
const MIN_W = 220, MIN_H = 120, STEP = 28, MINIMIZED_W = 190, BAR_H = 0;

import { RibbonPopup } from '../designer/RibbonPopup';
/** The Home › Window commands reach the front windows through this (set while the overlapping windows are shown). */
export const windowOps: { sizeToFit?: () => void; switchWindows?: () => void } = {};

interface Props { state: AppState; readOnly: boolean; linkOf(tab: DocTab): TableSummary['link']; dispatch: AppDispatch; onClose(tab: DocTab): void; formIcon: string | null }

export function OverlappingWindows({ state, readOnly, linkOf, dispatch, onClose, formIcon }: Props) {
  const { t } = useTranslation();
  const modalTab = useModalTab();
  const tabs = state.tabs.filter(hosted);   // a dialog form is shown by DialogHost, a pop-up by PopupHost
  const front = frontTabId(state);
  const area = useRef<HTMLElement>(null);
  const [geos, setGeos] = useState<Record<string, Partial<Geo>>>({});
  const [order, setOrder] = useState<string[]>([]);   // back to front
  useEffect(() => { if (front) setOrder((o) => (o[o.length - 1] === front ? o : [...o.filter((i) => i !== front), front])); }, [front]);

  const fresh = (x: DocTab, i: number): Geo => {
    const fit = x.kind === 'form' && x.win?.autoResize !== false;   // Auto Resize: the window is the form's size, else a window size
    return { x: 16 + STEP * (i % 8), y: 12 + STEP * (i % 8), w: fit ? null : 640, h: fit ? null : 400, min: false, max: false, ctr: x.kind === 'form' && !!x.win?.autoCenter };
  };
  const geo = (x: DocTab): Geo => ({ ...fresh(x, tabs.indexOf(x)), ...geos[x.id] });
  const patch = (id: string, p: Partial<Geo>) => setGeos((g) => ({ ...g, [id]: { ...g[id], ...p } }));
  const bounds = () => ({ w: area.current?.clientWidth ?? 1000, h: Math.max(0, (area.current?.clientHeight ?? 700) - BAR_H) });
  const show = (id: string) => { patch(id, { min: false }); dispatch({ type: 'activate', id }); };

  const cascade = () => setGeos(Object.fromEntries(tabs.map((x, i) => [x.id, fresh(x, i)])));
  const tile = () => {
    const b = bounds(), cols = Math.ceil(Math.sqrt(tabs.length || 1)), rows = Math.ceil((tabs.length || 1) / cols);
    setGeos(Object.fromEntries(tabs.map((x, i) => [x.id, { ctr: false, x: (i % cols) * Math.floor(b.w / cols), y: Math.floor(i / cols) * Math.floor(b.h / rows), w: Math.floor(b.w / cols), h: Math.floor(b.h / rows), min: false, max: false }])));
  };
  // Home › Window: Size to Fit Form and Switch Windows (ribbon commands, App.tsx)
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    windowOps.sizeToFit = () => { if (front) patch(front, { w: null, h: null, max: false, min: false, ctr: false }); };
    windowOps.switchWindows = () => setMenu(true);
    return () => { windowOps.sizeToFit = windowOps.switchWindows = undefined; };
  });
  const minimized = tabs.filter((x) => geo(x).min);
  return (
    <main className="docs card owin-area" ref={area} data-testid="owin-area">
      {menu && (
        <RibbonPopup anchor="switchWindows" testId="owin-switch-menu" labelKey="owin.switch" onClose={() => setMenu(false)}>
          {tabs.map((x) => <button key={x.id} type="button" role="menuitem" data-testid={`owin-switch-${docTabId(x)}`} aria-current={x.id === front}
            onClick={() => { setMenu(false); show(x.id); }}>{x.id === front ? '✓ ' : ''}{x.kind === 'relations' ? t('relations.title') : x.name}</button>)}
          <button type="button" role="menuitem" data-testid="owin-cascade" disabled={!tabs.length} onClick={() => { setMenu(false); cascade(); }}>{t('owin.cascade')}</button>
          <button type="button" role="menuitem" data-testid="owin-tile" disabled={!tabs.length} onClick={() => { setMenu(false); tile(); }}>{t('owin.tile')}</button>
        </RibbonPopup>
      )}
      {!tabs.length && <div className="doc-empty muted">{t('nav.openHint')}</div>}
      {tabs.map((x) => {
        const link = linkOf(x);
        return (
          <Win key={x.id} tab={x} g={geo(x)} z={1 + order.indexOf(x.id)} front={x.id === front && !modalTab} inert={!!modalTab} slot={minimized.indexOf(x)} bounds={bounds}
            formIcon={formIcon} patch={(p) => patch(x.id, p)} dispatch={dispatch} onClose={() => onClose(x)}>
            <DocumentView tab={x} active={x.id === front} readOnly={readOnly || (!!link && !isServerKind(link.kind))} link={link} dispatch={dispatch} tabs={state.tabs}
              designOpen={state.tabs.some((o) => o.id !== x.id && o.kind === 'table' && o.name === x.name && o.mode === 'design')} />
          </Win>
        );
      })}
      {modalTab && (
        // a Query Builder: its own window over the others, which stand back until it closes
        <div className="owin owin-modal" style={{ zIndex: 1000 }}>
          <div className="owin-title">
            <span className="owin-name" id={`${modalTab.testId}-tab`} data-testid={`${modalTab.testId}-tab`}>{modalLabel(state, t)} : {t(modalTab.labelKey)}</span>
            <button className="owin-btn" data-testid={`${modalTab.testId}-tab-close`} title={t('backstage.close')} aria-label={t('backstage.close')} onClick={() => modalTab.onRequestClose()}><X className="ic ic-sm" aria-hidden /></button>
          </div>
          <section ref={setModalTabSlot} id={`${modalTab.testId}-panel`} role="dialog" aria-modal="true" aria-labelledby={`${modalTab.testId}-tab`} className="doc modal-tab-panel owin-body" />
        </div>
      )}
    </main>
  );
}

interface WinProps { tab: DocTab; g: Geo; z: number; front: boolean; inert: boolean; slot: number; bounds(): { w: number; h: number }; formIcon: string | null;
  patch(g: Partial<Geo>): void; dispatch: AppDispatch; onClose(): void; children: ReactNode }

function Win(p: WinProps) {
  const { t } = useTranslation();
  const { tab: x, g } = p;
  const el = useRef<HTMLDivElement | null>(null);
  const op = useRef<{ kind: 'move' | 'size'; px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);
  const win = x.win ?? DEFAULT_WIN, ch = chrome(win);   // the form's own width and window properties (read when it opened)
  const formW = x.kind === 'form' ? win.width : null;

  const start = (kind: 'move' | 'size') => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || g.max || !el.current || (e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    op.current = { kind, px: e.clientX, py: e.clientY, x: el.current.offsetLeft, y: el.current.offsetTop - BAR_H, w: el.current.offsetWidth, h: el.current.offsetHeight };
  };
  const move = (e: PointerEvent) => {
    const o = op.current;
    if (!o) return;
    const dx = e.clientX - o.px, dy = e.clientY - o.py;
    if (o.kind === 'move') p.patch({ ctr: false, x: Math.round(o.x + dx), y: Math.max(0, Math.round(o.y + dy)) });
    else p.patch({ ctr: false, x: o.x, y: o.y, w: Math.max(MIN_W, Math.round(o.w + dx)), h: Math.max(MIN_H, Math.round(o.h + dy)) });
  };
  const end = () => { op.current = null; };

  const b = p.bounds();
  const style: CSSProperties = g.min ? { left: p.slot * (MINIMIZED_W + 4), bottom: 0, width: MINIMIZED_W, zIndex: p.z }
    : g.max ? { left: 0, top: BAR_H, width: b.w, height: b.h, zIndex: p.z }
    : { ...(g.ctr ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } : { left: g.x, top: BAR_H + g.y }), width: g.w ?? (formW !== null ? formW + 2 : 480), ...(g.h !== null ? { height: g.h } : {}), maxWidth: b.w, maxHeight: b.h, zIndex: p.z };
  const Icon: LucideIcon = DOC_ICONS[x.kind];
  const label = x.kind === 'relations' ? t('relations.title') : x.name;
  const tid = docTabId(x);
  const minLabel = t(g.min ? 'owin.restore' : 'owin.minimize'), maxLabel = t(g.max ? 'owin.restore' : 'owin.maximize');
  return (
    <div ref={(n) => { el.current = n; inertRef(p.inert)(n); }} className={`owin${p.front ? ' is-front' : ''}${g.min ? ' is-min' : ''}`} style={style}
      data-testid={`owin-${tid}`} data-front={p.front} role="group" aria-label={label}
      onPointerDownCapture={() => { if (!p.front) p.dispatch({ type: 'activate', id: x.id }); }}>
      {ch.bar && <div className="owin-title" data-testid={`owin-title-${tid}`} onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onDoubleClick={() => { if (ch.max) p.patch({ max: !g.max, min: false }); }} onAuxClick={(e) => { if (e.button === 1) p.onClose(); }}>
        {p.formIcon && (x.kind === 'form' || x.kind === 'report') ? <img className="ic" src={p.formIcon} alt="" width={16} height={16} /> : <Icon className="ic" aria-hidden />}
        <span className="owin-name">{label}{x.dirty && <span className="dtab-dirty" aria-hidden> •</span>}</span>
        {ch.box && <><button className="owin-btn" data-testid={`owin-min-${tid}`} disabled={!ch.min} title={minLabel} aria-label={minLabel} onClick={() => p.patch({ min: !g.min })}>
          {g.min ? <SquareStack className="ic ic-sm" aria-hidden /> : <Minus className="ic ic-sm" aria-hidden />}</button>
        <button className="owin-btn" data-testid={`owin-max-${tid}`} disabled={!ch.max} title={maxLabel} aria-label={maxLabel} onClick={() => p.patch({ max: !g.max, min: false })}>
          {g.max ? <Copy className="ic ic-sm" aria-hidden /> : <Square className="ic ic-sm" aria-hidden />}</button>
        <button className="owin-btn" data-testid={`owin-close-${tid}`} disabled={!ch.close} title={t('backstage.close')} aria-label={t('backstage.close')} onClick={p.onClose}><X className="ic ic-sm" aria-hidden /></button></>}
      </div>}
      <section id={`doc-${x.id}`} className="doc owin-body" hidden={g.min}>{p.children}</section>
      {!g.min && !g.max && ch.resize && <div className="owin-grip" data-testid={`owin-grip-${tid}`} onPointerDown={start('size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />}
    </div>
  );
}
