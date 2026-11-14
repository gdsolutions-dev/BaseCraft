// Forms with Pop Up (backlog C6b): each in a floating window above every other window, in tabbed and overlapping hosts alike (Access opens a
// pop-up form as a floating window even in tabbed mode). Not modal: the rest of the application stays usable (Modal makes it a dialog, DialogHost).
// Title bar, buttons and resizing follow the form's Border Style, Control Box, Min Max Buttons and Close Button; Auto Resize sizes the window to
// the form, Auto Center centres it.
import { Minus, Square, SquareStack, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { effectiveProp } from '../../shared/design/properties';
import { api } from '../bridge';
import { parseFormDoc } from '../form/form-def';
import { isPopup, type DocTab } from '../state/app-state';
import { DocumentView } from './document-views';
import { chrome, DEFAULT_WIN } from './form-window';
import { inertRef } from './modal-tab';
import type { AppDispatch } from './nav-menu';

interface Geo { x: number | null; y: number | null; w: number | null; h: number | null; min: boolean; max: boolean }

export function PopupHost(p: { tabs: readonly DocTab[]; activeId: string | null; dispatch: AppDispatch; readOnly: boolean; onClose(tab: DocTab): void; inert: boolean; formIcon: string | null }) {
  const popups = p.tabs.filter(isPopup);
  return <>{popups.map((tab, i) => <PopupWindow key={tab.id} tab={tab} index={i} active={tab.id === p.activeId} {...p} />)}</>;
}

function PopupWindow({ tab, index, active, dispatch, readOnly, onClose, inert, formIcon }:
  { tab: DocTab; index: number; active: boolean; dispatch: AppDispatch; readOnly: boolean; onClose(tab: DocTab): void; inert: boolean; formIcon: string | null }) {
  const { t } = useTranslation();
  const w = tab.win ?? DEFAULT_WIN, ch = chrome(w);
  const [g, setG] = useState<Geo>({ x: null, y: null, w: null, h: null, min: false, max: false });
  const [caption, setCaption] = useState('');
  useEffect(() => { void api.objects.get('form', tab.name).then((r) => { try { setCaption(String(effectiveProp(parseFormDoc(r.definition).doc.props, 'Caption', 'form') ?? '')); } catch { /* the name */ } }, () => {}); }, [tab.name, tab.reloadToken]);
  const el = useRef<HTMLDivElement | null>(null);
  const op = useRef<{ kind: 'move' | 'size'; px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);
  const start = (kind: 'move' | 'size') => (e: PointerEvent<HTMLElement>) => {
    const box = el.current;
    if (e.button !== 0 || g.max || !box || (e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    op.current = { kind, px: e.clientX, py: e.clientY, x: box.offsetLeft, y: box.offsetTop, w: box.offsetWidth, h: box.offsetHeight };
  };
  const move = (e: PointerEvent) => {
    const o = op.current;
    if (!o) return;
    const dx = e.clientX - o.px, dy = e.clientY - o.py;
    if (o.kind === 'move') setG((v) => ({ ...v, x: Math.round(o.x + dx), y: Math.max(0, Math.round(o.y + dy)), w: v.w ?? o.w }));
    else setG((v) => ({ ...v, x: o.x, y: o.y, w: Math.max(220, Math.round(o.w + dx)), h: Math.max(120, Math.round(o.h + dy)) }));
  };
  const end = () => { op.current = null; };
  const width = g.w ?? (w.autoResize ? w.width + 2 : 640);
  const placed = g.x !== null;
  const style = g.max ? { inset: 0, zIndex: 40 }
    : { zIndex: 40 + (active ? 1 : 0), width, maxWidth: '100vw', maxHeight: '100vh', ...(g.h !== null ? { height: g.h } : !w.autoResize ? { height: 400 } : {}),
      ...(placed ? { left: g.x!, top: g.y! } : w.autoCenter ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } : { left: 160 + 28 * (index % 8), top: 150 + 28 * (index % 8) }) };
  const label = caption || tab.name;
  return (
    <div ref={(n) => { el.current = n; inertRef(inert)(n); }} className={`owin popup-win${active ? ' is-front' : ''}${g.min ? ' is-min' : ''}`} style={{ position: 'fixed', ...style }}
      data-testid={`popup-${tab.name}`} role="group" aria-label={label} onPointerDownCapture={() => { if (!active) dispatch({ type: 'activate', id: tab.id }); }}>
      {ch.bar && (
        <div className="owin-title" data-testid={`popup-title-${tab.name}`} onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          onDoubleClick={() => { if (ch.max) setG((v) => ({ ...v, max: !v.max, min: false })); }}>
          {ch.box && formIcon && <img className="ic" src={formIcon} alt="" width={16} height={16} />}
          <span className="owin-name">{label}</span>
          {ch.box && <>
            <button className="owin-btn" data-testid={`popup-min-${tab.name}`} disabled={!ch.min} title={t(g.min ? 'owin.restore' : 'owin.minimize')} aria-label={t(g.min ? 'owin.restore' : 'owin.minimize')}
              onClick={() => setG((v) => ({ ...v, min: !v.min }))}>{g.min ? <SquareStack className="ic ic-sm" aria-hidden /> : <Minus className="ic ic-sm" aria-hidden />}</button>
            <button className="owin-btn" data-testid={`popup-max-${tab.name}`} disabled={!ch.max} title={t(g.max ? 'owin.restore' : 'owin.maximize')} aria-label={t(g.max ? 'owin.restore' : 'owin.maximize')}
              onClick={() => setG((v) => ({ ...v, max: !v.max, min: false }))}><Square className="ic ic-sm" aria-hidden /></button>
            <button className="owin-btn" data-testid={`popup-close-${tab.name}`} disabled={!ch.close} title={t('backstage.close')} aria-label={t('backstage.close')} onClick={() => onClose(tab)}>
              <X className="ic ic-sm" aria-hidden /></button>
          </>}
        </div>
      )}
      <section className="doc owin-body" hidden={g.min}><DocumentView tab={tab} active={active} readOnly={readOnly} dispatch={dispatch} /></section>
      {!g.min && !g.max && ch.resize && <div className="owin-grip" onPointerDown={start('size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />}
    </div>
  );
}
