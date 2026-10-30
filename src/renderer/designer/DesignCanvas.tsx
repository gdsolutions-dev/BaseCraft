// Surface de création : une barre de titre, un corps quadrillé et une poignée de hauteur par section ; les contrôles, la sélection
// et ses poignées. Les gestes passent par les Pointer Events (capture sur la feuille) ; pendant un geste, l'aperçu est le
// résultat du réducteur sur les actions que donnerait le relâchement (même aimantation, mêmes bornes), sans rien enregistrer.
// Règles en cm autour de la surface, comme Access : la règle horizontale part du bord gauche de la feuille, la verticale repart de 0
// à chaque section ; elles suivent le défilement (décalées par transform, sans redessin).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { flattenControls, TWIPS_PER_CM, type ControlDef, type SectionDef } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import type { DesignerHost, ToolState } from './Designer';
import { clipboardAction, clipContext } from './designer-clipboard';
import { CONTAINER_KINDS, designerReducer, docWidth, documentKind, findControl, type DesignerAction, type DesignerState } from './designer-model';
import type { Handle } from './geometry';
import { gestureEnd, keyAction, placeRect, type Gesture } from './pointer';
import { fieldDrop } from './FieldList';
import { PopupMenu } from './RibbonPopup';
import { useModal } from '../shell/Modal';
import { formatCm, gridStep, MAX_TWIPS, pxToTwips, snap, twipsToPx } from './units';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
type Point = { x: number; y: number };
type At = Point & { section: number };
interface Drag { g: Gesture; at: At; alt: boolean; shift: boolean; toAt(p: Point): At; parent?: string; focus?: string }
interface SectionMenu { x: number; y: number; kind: SectionDef['kind']; items: NonNullable<ReturnType<NonNullable<DesignerHost['sectionMenu']>>> }

const px = (tw: number): string => `${twipsToPx(tw)}px`;
const CM_PX = twipsToPx(TWIPS_PER_CM);

/** Les nombres d'une règle, un par cm (séparateurs de la région) ; les graduations sont dessinées en CSS. */
function RulerMarks({ twips, locale, vertical }: { twips: number; locale: string; vertical?: boolean }) {
  const fmt = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  return <>{Array.from({ length: Math.floor(twips / TWIPS_PER_CM) }, (_, i) => i + 1).map((n) => (
    <span key={n} className="dz-ruler-n" style={vertical ? { top: n * CM_PX } : { left: n * CM_PX }}>{fmt.format(n)}</span>
  ))}</>;
}

interface ControlProps { c: ControlDef; s: SectionDef; sel: boolean; label: string; render: DesignerHost['renderControl']; onFocusCtl(name: string): void }
/** Pendant un glisser, seuls les contrôles touchés se redessinent : le réducteur garde l'identité des autres. La section ne compte que
 *  par son genre et ses propriétés (l'aperçu d'un contrôle ne dépend pas de la hauteur ni des autres contrôles de sa section). */
const CanvasControl = memo(function CanvasControl({ c, s, sel, label, render, onFocusCtl }: ControlProps) {
  return (
    <div data-ctl={c.name} data-testid={`ctl-${c.name}`} role="button" tabIndex={0} aria-pressed={sel} aria-label={`${c.name}, ${label}`}
      className={`dz-ctl${sel ? ' is-sel' : ''}`} style={{ left: px(c.left), top: px(c.top), width: px(c.width), height: px(c.height) }}
      onFocus={() => onFocusCtl(c.name)}>
      {render(c, s)}
      {sel && HANDLES.map((h) => <span key={h} className={`dz-handle dz-handle-${h}`} data-handle={h} data-testid={`handle-${h}`} aria-hidden />)}
    </div>
  );
}, (a, b) => a.c === b.c && a.sel === b.sel && a.label === b.label && a.render === b.render && a.onFocusCtl === b.onFocusCtl
  && a.s.kind === b.s.kind && a.s.props === b.s.props);

export function DesignCanvas(p: { state: DesignerState; dispatch(a: DesignerAction): void; host: DesignerHost; readOnly: boolean; tool: ToolState; onTool(t: ToolState): void }) {
  const { state, dispatch, host, readOnly, tool } = p;
  const { t } = useTranslation();
  const modal = useModal();
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const blocks = useRef<(HTMLDivElement | null)[]>([]);
  const bodies = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<SectionMenu | null>(null);
  const pointing = useRef(false);   // un clic donne le focus : il ne doit pas réduire une multi-sélection

  // Aperçu du geste en cours : le relâchement, appliqué sans être enregistré.
  const shown = useMemo(() => (drag ? gestureEnd(drag.g, drag.at, drag) : []).reduce(designerReducer, state), [drag, state]);
  const doc = shown.doc;
  const kind = documentKind(state);
  const width = docWidth(doc, kind);
  const step = twipsToPx(gridStep(doc));
  const names = shown.selection.kind === 'controls' ? shown.selection.names : [];   // un rectangle de sélection sélectionne en direct
  const isSel = (name: string) => names.some((n) => sameName(n, name));
  const typeLabel = (k: ControlDef['kind']) => { const d = host.tools.find((x) => x.kind === k); return d ? t(d.labelKey) : k; };
  const live = useRef({ names, dispatch });
  live.current = { names, dispatch };
  // le focus au clavier sélectionne ; un clic donne aussi le focus, mais il a déjà sélectionné (et ne doit pas réduire une multi-sélection)
  // le contrôle qui avait le focus a disparu (supprimé, annulé) : le focus revient à la surface, pas au corps de la page
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const a = document.activeElement;
    if (lastFocus.current && !lastFocus.current.isConnected && (!a || a === document.body)) root.current?.focus({ preventScroll: true });
  }, [state.doc]);
  const onFocusCtl = useCallback((name: string) => {
    if (!pointing.current && !live.current.names.some((n) => sameName(n, name))) live.current.dispatch({ type: 'select', selection: { kind: 'controls', names: [name] } });
  }, []);

  const pt = (e: { clientX: number; clientY: number }): Point => {
    const el = sheet.current!, r = el.getBoundingClientRect();   // offsetTop des sections : depuis l'intérieur de la bordure
    return { x: e.clientX - r.left - el.clientLeft, y: e.clientY - r.top - el.clientTop };
  };
  // Positions des sections relevées au début du geste : l'aperçu peut agrandir une section et décaler les suivantes.
  const layout = useRef<{ blocks: number[]; bodies: Point[] }>({ blocks: [], bodies: [] });
  const measure = () => {
    layout.current = { blocks: blocks.current.map((b) => b?.offsetTop ?? 0), bodies: bodies.current.map((b) => ({ x: b?.offsetLeft ?? 0, y: b?.offsetTop ?? 0 })) };
  };
  const bodyAt = (i: number): Point => layout.current.bodies[i] ?? { x: 0, y: 0 };
  const sectionAt = (y: number): number => {
    let found = 0;
    layout.current.blocks.forEach((top, i) => { if (top <= y) found = i; });
    return Math.min(found, doc.sections.length - 1);
  };
  const local = (i: number) => (q: Point): At => { const o = bodyAt(i); return { x: q.x - o.x, y: q.y - o.y, section: i }; };

  const start = (e: PointerEvent, d: Omit<Drag, 'at' | 'alt' | 'shift'>, from: Point) => {
    sheet.current!.setPointerCapture(e.pointerId);
    setDrag({ ...d, at: d.toAt(from), alt: e.altKey, shift: e.shiftKey });
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag) return;
    const el = e.target as HTMLElement;
    const at = pt(e);
    measure();
    const handle = el.closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined;
    const bar = el.closest<HTMLElement>('[data-section-resize]')?.dataset.sectionResize;
    const ctl = el.closest<HTMLElement>('[data-ctl]')?.dataset.ctl;
    const body = el.closest<HTMLElement>('[data-section-body]')?.dataset.sectionBody;
    if (!readOnly && handle) {
      start(e, { g: { kind: 'resize', handle, origin: at }, toAt: (q) => ({ ...q, section: 0 }) }, at);
    } else if (!readOnly && bar !== undefined) {
      const index = Number(bar);
      start(e, { g: { kind: 'sectionHeight', index, origin: { y: at.y }, start: doc.sections[index].height }, toAt: (q) => ({ ...q, section: index }) }, at);
    } else if (!readOnly && tool.kind && body !== undefined) {
      const section = Number(body);
      const c = ctl ? findControl(doc, ctl)?.control : undefined;
      const toAt = local(section);
      start(e, { g: { kind: 'place', tool: tool.kind, section, origin: toAt(at) }, toAt, parent: c && CONTAINER_KINDS.includes(c.kind) ? c.name : undefined }, at);
    } else if (ctl) {
      pointing.current = true;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { dispatch({ type: 'toggleSelect', name: ctl }); return; }
      const group = isSel(ctl) ? names : [ctl];
      if (!isSel(ctl) || (readOnly && names.length > 1)) dispatch({ type: 'select', selection: { kind: 'controls', names: [ctl] } });
      if (readOnly) return;
      const found = group.flatMap((n) => { const f = findControl(doc, n); return f ? [f] : []; });
      const section = findControl(doc, ctl)!.section;
      // l'ancre : le coin haut gauche de la sélection, que le pointeur emmène, d'une section à l'autre s'il le faut
      const origin = { x: twipsToPx(Math.min(...found.map((f) => f.control.left))), y: twipsToPx(Math.min(...found.map((f) => f.control.top))) };
      const toAt = (q: Point): At => {
        const s = sectionAt(q.y);
        const x = origin.x + q.x - at.x, y = origin.y + q.y - at.y;
        return { x, y: s === section ? y : y + bodyAt(section).y - bodyAt(s).y, section: s };
      };
      start(e, { g: { kind: 'move', section, origin }, toAt, focus: ctl }, at);
    } else if (body !== undefined) {
      const section = Number(body);
      const toAt = local(section);
      root.current?.focus({ preventScroll: true });
      start(e, { g: { kind: 'band', section, origin: toAt(at) }, toAt }, at);
    }
  };
  // un aperçu par image au plus : les mouvements du pointeur entre deux images se fondent dans le dernier
  const frame = useRef(0);
  const lastMove = useRef<{ p: Point; alt: boolean }>({ p: { x: 0, y: 0 }, alt: false });
  const stopFrame = () => { cancelAnimationFrame(frame.current); frame.current = 0; };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => setMenu(null), [readOnly]);   // ses éléments changent le document
  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    lastMove.current = { p: pt(e), alt: e.altKey };
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const m = lastMove.current;
      setDrag((d) => d && { ...d, at: d.toAt(m.p), alt: m.alt });
    });
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag;
    pointing.current = false;
    stopFrame();
    if (!d) return;
    setDrag(null);
    const at = d.toAt(pt(e));
    if (d.g.kind === 'place') {
      const { section, rect } = placeRect(d.g, at);
      if (state.snap && !e.altKey) { const g = gridStep(state.doc); rect.left = snap(rect.left, g); rect.top = snap(rect.top, g); }   // comme Access : le coin s'aimante
      const controls = host.newControls(d.g.tool, rect, section, state.doc);
      if (controls.length) dispatch({ type: 'insert', section, controls, ...(d.parent ? { parent: d.parent } : {}) });
      if (!tool.locked) p.onTool({ kind: null, locked: false });
    } else {
      const actions = gestureEnd(d.g, at, { alt: e.altKey, shift: d.shift });
      for (const a of actions) dispatch(a);
      // un clic sans glisser sur un contrôle d'une multi-sélection ne garde que lui
      if (d.g.kind === 'move' && !actions.length && d.focus && names.length > 1) dispatch({ type: 'select', selection: { kind: 'controls', names: [d.focus] } });
    }
    if (d.focus) root.current?.querySelector<HTMLElement>(`[data-ctl="${CSS.escape(d.focus)}"]`)?.focus({ preventScroll: true });
  };
  const cancel = () => { pointing.current = false; stopFrame(); setDrag(null); };

  // règles : l'origine de chacune relevée quand les hauteurs des sections changent (une section qui grandit décale les suivantes),
  // posée directement sur l'élément (aucun second rendu) ; le défilement est appliqué à part
  const hRuler = useRef<HTMLDivElement>(null);
  const vRuler = useRef<HTMLDivElement>(null);
  const hScale = useRef<HTMLDivElement>(null);
  const vScales = useRef<(HTMLDivElement | null)[]>([]);
  const heights = doc.sections.map((s) => s.height).join(',');
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    if (hScale.current) hScale.current.style.left = `${el.offsetLeft + el.clientLeft}px`;
    vScales.current.forEach((v, i) => { if (v) v.style.top = `${el.offsetTop + el.clientTop + (bodies.current[i]?.offsetTop ?? 0)}px`; });
  }, [heights]);
  const followScroll = () => {
    const c = root.current;
    if (!c) return;
    if (hRuler.current) hRuler.current.style.transform = `translateX(${-c.scrollLeft}px)`;
    if (vRuler.current) vRuler.current.style.transform = `translateY(${-c.scrollTop}px)`;
  };
  const locale = host.sheet.display.region.locale;

  // un champ de la Liste des champs déposé sur une section : l'hôte le crée à ce point (coin aimanté, sauf Alt)
  const onDragOver = (e: DragEvent) => { if (!readOnly && fieldDrop()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
  const onDrop = (e: DragEvent) => {
    const add = readOnly ? null : fieldDrop();
    if (!add) return;
    e.preventDefault();
    measure();
    const q = pt(e), section = sectionAt(q.y), o = bodyAt(section);
    let left = pxToTwips(Math.max(0, q.x - o.x)), top = pxToTwips(Math.max(0, q.y - o.y));
    if (state.snap && !e.altKey) { const g = gridStep(state.doc); left = snap(left, g); top = snap(top, g); }
    add({ section, left, top });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('[role="menu"]')) return;
    if (e.key === 'Escape' && drag) { e.preventDefault(); cancel(); return; }
    const clip = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey ? ({ c: 'copy', x: 'cut', v: 'paste' } as const)[e.key.toLowerCase() as 'c'] : undefined;
    if (clip) {   // Ctrl+C, Ctrl+X, Ctrl+V : les contrôles (Accueil › Presse-papiers passe par l'hôte)
      e.preventDefault();
      const a = readOnly && clip !== 'copy' ? null : clipboardAction(clip, state, clipContext(host, t));
      if (a) dispatch(a);
      return;
    }
    const a = keyAction(e.key, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, gridStep(state.doc));
    if (!a || e.altKey) return;
    if (readOnly && a.type !== 'select' && a.type !== 'selectAll') return;
    if ((a.type === 'moveBy' || a.type === 'resize') && !names.length) return;   // rien de sélectionné : les flèches font défiler
    e.preventDefault();
    dispatch(a);
  };

  const openSectionMenu = (e: MouseEvent, index: number) => {
    dispatch({ type: 'select', selection: { kind: 'section', index } });
    if (readOnly) return;   // ses éléments changent le document
    const items = host.sectionMenu?.(index, state.doc) ?? [];
    if (!items.length) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();   // le clavier (Maj+F10) donne 0, 0
    setMenu({ x: e.clientX || r.left, y: e.clientY || r.bottom, kind: state.doc.sections[index].kind, items });
  };

  const runSectionItem = async (m: SectionMenu['items'][number]) => {
    setMenu(null);
    if (m.confirmKey && (await modal.confirm({ titleKey: m.labelKey, messageKey: m.confirmKey, buttons: ['yes', 'no'], defaultButton: 'no' })) !== 'yes') return;
    dispatch(m.action);
  };

  const rubber = drag && (drag.g.kind === 'band' || drag.g.kind === 'place') ? { section: drag.g.section, o: drag.g.origin, at: drag.at } : null;

  return (
    <div className="dz-surface" style={{ ['--cm' as string]: `${CM_PX}px` }}>
    <div className="dz-ruler-corner" aria-hidden />
    <div className="dz-ruler dz-hruler" aria-hidden data-testid="ruler-h">
      <div ref={hRuler} className="dz-ruler-track"><div ref={hScale} className="dz-ruler-scale" style={{ width: px(width) }}><RulerMarks twips={width} locale={locale} /></div></div>
    </div>
    <div className="dz-ruler dz-vruler" aria-hidden data-testid="ruler-v">
      <div ref={vRuler} className="dz-ruler-track">
        {doc.sections.map((s, i) => (
          <div key={i} ref={(el) => { vScales.current[i] = el; }} className="dz-ruler-scale" data-testid={`ruler-v-${s.kind}`} style={{ height: px(s.height) }}>
            <RulerMarks twips={s.height} locale={locale} vertical />
          </div>
        ))}
      </div>
    </div>
    <div ref={root} className="dz-canvas" role="region" aria-label={t('designer.canvas')} data-testid="design-canvas" tabIndex={-1} onKeyDown={onKeyDown}
      onScroll={followScroll} onFocus={(e) => { lastFocus.current = e.target as HTMLElement; }}>
      <div ref={sheet} className={`dz-sheet${tool.kind && !readOnly ? ' is-placing' : ''}`} style={{ width: px(width) }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={cancel} onLostPointerCapture={() => drag && cancel()}
        onDragStart={(e) => e.preventDefault()} onDragOver={onDragOver} onDrop={onDrop}>   {/* une image d'un aperçu ne part pas en glisser-déposer natif */}
        {doc.sections.map((s: SectionDef, i) => (
          <div key={i} ref={(el) => { blocks.current[i] = el; }} className="dz-block">
            <button type="button" className={`dz-band${state.selection.kind === 'section' && state.selection.index === i ? ' is-sel' : ''}`}
              data-testid={`section-${s.kind}`} aria-pressed={state.selection.kind === 'section' && state.selection.index === i}
              onClick={() => dispatch({ type: 'select', selection: { kind: 'section', index: i } })} onContextMenu={(e) => openSectionMenu(e, i)}>
              {host.sectionLabel(s, i)}
            </button>
            <div ref={(el) => { bodies.current[i] = el; }} className="dz-body" data-section-body={i}
              style={{ height: px(s.height), backgroundSize: `${step}px ${step}px` }}>
              {flattenControls(s.controls).map((c) => (   // un parent sous ses enfants
                <CanvasControl key={c.name} c={c} s={s} sel={isSel(c.name)} label={typeLabel(c.kind)} render={host.renderControl} onFocusCtl={onFocusCtl} />
              ))}
              {rubber && rubber.section === i && (
                <div className="dz-rubber" aria-hidden style={{ left: Math.min(rubber.o.x, rubber.at.x), top: Math.min(rubber.o.y, rubber.at.y),
                  width: Math.abs(rubber.at.x - rubber.o.x), height: Math.abs(rubber.at.y - rubber.o.y) }} />
              )}
            </div>
            <div className="dz-sresize" data-section-resize={i} data-testid={`section-resize-${i}`} role="separator" aria-orientation="horizontal"
              aria-label={host.sectionLabel(s, i)} tabIndex={readOnly ? undefined : 0} aria-valuemin={0} aria-valuemax={MAX_TWIPS} aria-valuenow={s.height}
              aria-valuetext={formatCm(s.height, host.sheet.display.region)}
              onKeyDown={(e) => {   // Haut / Bas : la hauteur d'un pas de grille (le réducteur ne descend pas sous le contrôle le plus bas)
                if (e.key !== 'Tab') e.stopPropagation();   // les touches de la surface (Suppr, flèches…) ne visent pas la sélection d'ici
                if (readOnly || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                dispatch({ type: 'setSectionHeight', index: i, height: Math.max(0, s.height + (e.key === 'ArrowDown' ? 1 : -1) * gridStep(state.doc)) });
              }} />
          </div>
        ))}
      </div>
      {menu && (
        <PopupMenu x={menu.x} y={menu.y} testId="section-menu" labelKey={`designer.section.${menu.kind}`} onClose={() => setMenu(null)}>
          {menu.items.map((m) => (
            <button key={m.id} type="button" role="menuitem" data-testid={`section-menu-${m.id}`}
              onClick={() => void runSectionItem(m)}>{t(m.labelKey)}</button>
          ))}
        </PopupMenu>
      )}
    </div>
    </div>
  );
}
