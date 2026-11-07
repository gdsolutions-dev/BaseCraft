// Surface de création : une barre de titre, un corps quadrillé et une poignée de hauteur par section ; les contrôles, la sélection
// et ses poignées. Les gestes passent par les Pointer Events (capture sur la feuille) ; pendant un geste, l'aperçu est le
// résultat du réducteur sur les actions que donnerait le relâchement (même aimantation, mêmes bornes), sans rien enregistrer.
// Règles en cm autour de la surface, comme Access : la règle horizontale part du bord gauche de la feuille, la verticale repart de 0
// à chaque section ; elles suivent le défilement (décalées par transform, sans redessin).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { flattenControls, TWIPS_PER_CM, type ControlDef, type SectionDef } from '../../shared/design/model';
import { cellControl, readLayouts, type CellRef } from '../../shared/design/layout';
import { selectionOf } from '../../shared/design/layout-edit';
import { sameName } from '../../shared/field-types';
import type { DesignerHost, ToolState } from './Designer';
import { clipboardAction, clipContext } from './designer-clipboard';
import { gestureAllowed, type DesignerRestrict } from './designer-restrict';
import { CONTAINER_KINDS, designerReducer, docWidth, documentKind, findControl, type DesignerAction, type DesignerState } from './designer-model';
import type { Handle } from './geometry';
import { emptyCells, layoutOutlines } from './layout-outline';
import type { EmptyCell } from '../../shared/design/layout';
import { gestureEnd, isTypingKey, keyAction, placeRect, typedLabel, type Gesture } from './pointer';
import { currentSettings } from '../settings-store';
import { fieldDrop } from './FieldList';
import { PopupMenu } from './RibbonPopup';
import { useModal } from '../shell/Modal';
import { formatCm, gridStep, MAX_TWIPS, pxToTwips, snap, twipsToPx } from './units';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
type Point = { x: number; y: number };
type At = Point & { section: number };
interface Drag { g: Gesture; at: At; alt: boolean; shift: boolean; toAt(p: Point): At; parent?: string; focus?: string }
interface SectionMenu { x: number; y: number; kind: SectionDef['kind']; items: NonNullable<ReturnType<NonNullable<DesignerHost['sectionMenu']>>> }

interface PageMenu { x: number; y: number; items: NonNullable<ReturnType<NonNullable<DesignerHost['pageMenu']>>> }

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

/** Copies du Détail d'un formulaire continu en mode Page : autant que d'enregistrements lus (`rows`, le courant compris, au plus
 *  `cap`), moins le Détail modifiable, et pas plus que la fenêtre n'en montre (`detailHeight`, `viewport` en px). */
export function extraRowCount(rows: number, detailHeight: number, viewport: number, cap: number): number {
  if (detailHeight <= 0) return 0;
  return Math.max(0, Math.min(cap - 1, rows - 1, Math.ceil(viewport / detailHeight)));
}

type ExtraRows = NonNullable<DesignerHost['extraDetailRows']>;
/** Les copies en lecture seule sous le Détail : ni data-ctl, ni data-section-body, ni poignée, ni pointeur ; les gestes les ignorent.
 *  Elles dessinent le même document : modifier le Détail les met à jour. */
export const DetailCopies = memo(function DetailCopies({ s, count, render, cells = [] }: { s: SectionDef; count: number; render: ExtraRows['render']; cells?: EmptyCell[] }) {
  const controls = flattenControls(s.controls);
  return <>{Array.from({ length: count }, (_, k) => (
    <div key={k} className="dz-body dz-copy" aria-hidden style={{ height: px(s.height), pointerEvents: 'none', backgroundImage: 'none' }}>
      {cells.map((c) => (   // le fond, les lignes et les marges des cellules vides
        <div key={cellControl(c).name} className="dz-ctl dz-cellfill" style={{ left: px(c.rect.left), top: px(c.rect.top), width: px(c.rect.width), height: px(c.rect.height) }}>{render(cellControl(c), s, k + 1)}</div>
      ))}
      {controls.map((c) => (
        <div key={c.name} className="dz-ctl" style={{ left: px(c.left), top: px(c.top), width: px(c.width), height: px(c.height) }}>{render(c, s, k + 1)}</div>
      ))}
    </div>
  ))}</>;
});

export function DesignCanvas(p: { state: DesignerState; dispatch(a: DesignerAction): void; host: DesignerHost; readOnly: boolean; tool: ToolState; onTool(t: ToolState): void;
  restrict?: DesignerRestrict }) {
  const { state, dispatch, host, readOnly, tool, restrict } = p;
  const placing = !readOnly && !!tool.kind && gestureAllowed(restrict, 'place');   // Mode Page d'un état : pas de placement d'outil (restrict.toolbox)
  const sizable = gestureAllowed(restrict, 'sectionHeight');   // Mode Page : la hauteur des sections ne se tire pas
  const { t } = useTranslation();
  const modal = useModal();
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const blocks = useRef<(HTMLDivElement | null)[]>([]);
  const bodies = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<SectionMenu | null>(null);
  const [pageMenu, setPageMenu] = useState<PageMenu | null>(null);
  const [typing, setTyping] = useState<{ cell: CellRef; text: string } | null>(null);   // la légende en cours de saisie dans une cellule vide ; rien n'est créé avant la validation
  const typingRef = useRef(typing);
  typingRef.current = typing;
  const typingInput = useRef<HTMLInputElement>(null);
  const pointing = useRef(false);   // un clic donne le focus : il ne doit pas réduire une multi-sélection

  // Aperçu du geste en cours : le relâchement, appliqué sans être enregistré.
  const shown = useMemo(() => (drag ? gestureEnd(drag.g, drag.at, { ...drag, enclosed: currentSettings().selectionBehavior === 'full' }) : []).reduce(designerReducer, state), [drag, state]);
  const doc = shown.doc;
  // contours des dispositions, recalculés seulement quand le document affiché change
  const outlines = useMemo(() => doc.sections.map((_, i) => layoutOutlines(doc, i)), [doc]);
  const empties = useMemo(() => doc.sections.map((_, i) => emptyCells(doc, i)), [doc]);
  const cellsSel = shown.selection.kind === 'controls' ? shown.selection.cells ?? [] : [];
  const selectLayout = (id: string) => {
    const first = readLayouts(state.doc).find((l) => l.id === id)?.cells.find((c) => c.control !== null)?.control;
    if (first) dispatch({ type: 'select', selection: { kind: 'controls', names: selectionOf(state.doc, first, 'layout') } });
  };
  const kind = documentKind(state);
  const width = docWidth(doc, kind);
  const step = twipsToPx(gridStep(doc));
  const extra = host.extraDetailRows;
  const detailAt = doc.sections.findIndex((s) => s.kind === 'detail');
  // ponytail: la hauteur de la fenêtre borne la hauteur de la surface ; quelques copies de trop au pire (au plus count)
  const copies = extra && detailAt >= 0 ? extraRowCount(extra.count + 1, twipsToPx(doc.sections[detailAt].height), window.innerHeight, Infinity) : 0;
  useLayoutEffect(() => {   // le curseur à la fin, tout de suite : les touches suivantes y arrivent
    const i = typingInput.current;
    if (i && document.activeElement !== i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }, [typing?.cell.layout, typing?.cell.row, typing?.cell.col]);
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
    if (el.closest('[data-layout-handle], [data-layout-cell]')) return;   // la poignée d'une disposition et une cellule vide sélectionnent au clic : ni glisser ni rectangle
    const at = pt(e);
    measure();
    const handle = el.closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined;
    const bar = el.closest<HTMLElement>('[data-section-resize]')?.dataset.sectionResize;
    const ctl = el.closest<HTMLElement>('[data-ctl]')?.dataset.ctl;
    const body = el.closest<HTMLElement>('[data-section-body]')?.dataset.sectionBody;
    if (!readOnly && handle) {
      start(e, { g: { kind: 'resize', handle, origin: at }, toAt: (q) => ({ ...q, section: 0 }) }, at);
    } else if (!readOnly && sizable && bar !== undefined) {
      const index = Number(bar);
      start(e, { g: { kind: 'sectionHeight', index, origin: { y: at.y }, start: doc.sections[index].height }, toAt: (q) => ({ ...q, section: index }) }, at);
    } else if (placing && tool.kind && body !== undefined) {
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
      // le centre du rectangle posé : sur une disposition, le contrôle en devient membre
      if (controls.length) dispatch({ type: 'insert', section, controls, at: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, ...(d.parent ? { parent: d.parent } : {}) });
      if (!tool.locked) p.onTool({ kind: null, locked: false });
    } else {
      const actions = gestureEnd(d.g, at, { alt: e.altKey, shift: d.shift, enclosed: currentSettings().selectionBehavior === 'full' });
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
  }, [heights, copies]);   // les copies du Détail décalent les sections suivantes
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

  const endTyping = (commit: boolean) => {   // Entrée ou perte du focus valide ; Échap ou un texte vide ne crée rien (aucune entrée d'historique)
    const ty = typingRef.current;
    if (!ty) return;
    typingRef.current = null;
    setTyping(null);
    const cell = empties.flat().find((c) => c.layout === ty.cell.layout && c.row === ty.cell.row && c.col === ty.cell.col);
    if (!commit || readOnly || !cell || !ty.text.trim()) return;
    const section = state.doc.sections.findIndex((_, i) => empties[i].includes(cell));
    dispatch({ type: 'insert', section, controls: typedLabel(host.newControls('label', cell.rect, section, state.doc), ty.text),
      at: { x: cell.rect.left + cell.rect.width / 2, y: cell.rect.top + cell.rect.height / 2 } });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('[role="menu"]')) return;
    if (!readOnly && !tool.kind && !typingRef.current && isTypingKey(e) && !names.length && cellsSel.length === 1 && (e.target === e.currentTarget || el.closest('[data-layout-cell]'))) {
      e.preventDefault();   // seule la surface elle-même (ou la cellule) : jamais la feuille de propriétés ni un éditeur
      setTyping({ cell: cellsSel[0], text: e.key });
      return;
    }
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

  /** Clic droit sur l'onglet d'une page d'un contrôle à onglets : le contrôle est choisi, le menu de l'hôte s'ouvre (même en lecture seule : il consulte). */
  const openPageMenu = (e: MouseEvent) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab-page]');
    const control = tab?.closest<HTMLElement>('[data-ctl]')?.dataset.ctl;
    if (!tab || !control) return;
    const items = host.pageMenu?.(control, Number(tab.dataset.tabPage)) ?? [];
    if (!items.length) return;
    e.preventDefault();
    dispatch({ type: 'select', selection: { kind: 'controls', names: [control] } });
    setPageMenu({ x: e.clientX, y: e.clientY, items });
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
      <div ref={sheet} className={`dz-sheet${placing ? ' is-placing' : ''}`} style={{ width: px(width) }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={cancel} onLostPointerCapture={() => drag && cancel()}
        onContextMenu={openPageMenu} onDragStart={(e) => e.preventDefault()} onDragOver={onDragOver} onDrop={onDrop}>   {/* une image d'un aperçu ne part pas en glisser-déposer natif */}
        {doc.sections.map((s: SectionDef, i) => (
          <div key={i} ref={(el) => { blocks.current[i] = el; }} className="dz-block">
            <button type="button" className={`dz-band${state.selection.kind === 'section' && state.selection.index === i ? ' is-sel' : ''}`}
              data-testid={`section-${s.kind}`} aria-pressed={state.selection.kind === 'section' && state.selection.index === i}
              onClick={() => dispatch({ type: 'select', selection: { kind: 'section', index: i } })} onContextMenu={(e) => openSectionMenu(e, i)}>
              {host.sectionLabel(s, i)}
            </button>
            <div ref={(el) => { bodies.current[i] = el; }} className="dz-body" data-section-body={i}
              style={{ height: px(s.height), backgroundSize: `${step}px ${step}px` }}>
              {outlines[i].map(({ id, rect }) => (   // avant les contrôles : dessiné dessous ; la poignée au coin haut gauche, au-dessus
                <div key={id} className="dz-layout" aria-hidden style={{ left: px(rect.left), top: px(rect.top), width: px(rect.width), height: px(rect.height) }} />
              ))}
              {outlines[i].map(({ id, rect }) => (
                <button key={id} type="button" className="dz-layout-handle" data-layout-handle={id} data-testid={`layout-handle-${id}`}
                  aria-label={t('designer.layoutHandle', { id })} title={t('designer.layoutHandle', { id })}
                  style={{ left: Math.max(0, twipsToPx(rect.left) - 14), top: Math.max(0, twipsToPx(rect.top) - 14) }} onClick={() => selectLayout(id)} />
              ))}
              {empties[i].map((c) => (   // sous les boutons des cellules : fond, lignes et marges par le code de l'aperçu
                <div key={cellControl(c).name} className="dz-ctl dz-cellfill" aria-hidden style={{ left: px(c.rect.left), top: px(c.rect.top), width: px(c.rect.width), height: px(c.rect.height) }}>
                  {host.renderControl(cellControl(c), s)}
                </div>
              ))}
              {empties[i].map(({ layout, row, col, rect }) => {   // ponytail: ni glisser ni rectangle sur une cellule vide ; la vue Disposition d'un état n'en montre pas (à ajouter si la fusion s'y fait)
                const on = cellsSel.some((c) => c.layout === layout && c.row === row && c.col === col);
                return (
                  <button key={`${layout}-${row}-${col}`} type="button" className={`dz-cell${on ? ' is-sel' : ''}`} data-layout-cell data-testid={`cell-${layout}-${row}-${col}`}
                    aria-pressed={on} aria-label={t('designer.emptyCell', { layout, row: row + 1, col: col + 1 })}
                    style={{ left: px(rect.left), top: px(rect.top), width: px(rect.width), height: px(rect.height) }}
                    onClick={(e) => dispatch({ type: 'selectCell', cell: { layout, row, col }, add: e.ctrlKey || e.metaKey })} />
                );
              })}
              {typing && empties[i].map((c) => c.layout === typing.cell.layout && c.row === typing.cell.row && c.col === typing.cell.col && (
                <input key="typing" ref={typingInput} className="dz-cell-input" data-testid="cell-input" value={typing.text} aria-label={t('designer.emptyCell', { layout: c.layout, row: c.row + 1, col: c.col + 1 })}
                  style={{ left: px(c.rect.left), top: px(c.rect.top), width: px(c.rect.width), height: px(c.rect.height) }}
                  onChange={(e) => setTyping({ cell: typing.cell, text: e.target.value })} onBlur={() => endTyping(true)}
                  onKeyDown={(e) => {
                    e.stopPropagation();   // Suppr, Retour arrière, flèches… éditent le texte, pas la sélection du concepteur
                    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); endTyping(e.key === 'Enter'); root.current?.focus(); }
                  }} />
              ))}
              {flattenControls(s.controls).map((c) => (   // un parent sous ses enfants
                <CanvasControl key={c.name} c={c} s={s} sel={isSel(c.name)} label={typeLabel(c.kind)} render={host.renderControl} onFocusCtl={onFocusCtl} />
              ))}
              {rubber && rubber.section === i && (
                <div className="dz-rubber" aria-hidden style={{ left: Math.min(rubber.o.x, rubber.at.x), top: Math.min(rubber.o.y, rubber.at.y),
                  width: Math.abs(rubber.at.x - rubber.o.x), height: Math.abs(rubber.at.y - rubber.o.y) }} />
              )}
            </div>
            {i === detailAt && copies > 0 && <DetailCopies s={s} count={copies} render={extra!.render} cells={empties[i]} />}
            {!sizable ? <div className="dz-sresize is-fixed" aria-hidden /> /* même place, sans poignée ni clavier */ : <div className="dz-sresize" data-section-resize={i} data-testid={`section-resize-${i}`} role="separator" aria-orientation="horizontal"
              aria-label={host.sectionLabel(s, i)} tabIndex={readOnly ? undefined : 0} aria-valuemin={0} aria-valuemax={MAX_TWIPS} aria-valuenow={s.height}
              aria-valuetext={formatCm(s.height, host.sheet.display.region)}
              onKeyDown={(e) => {   // Haut / Bas : la hauteur d'un pas de grille (le réducteur ne descend pas sous le contrôle le plus bas)
                if (e.key !== 'Tab') e.stopPropagation();   // les touches de la surface (Suppr, flèches…) ne visent pas la sélection d'ici
                if (readOnly || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                dispatch({ type: 'setSectionHeight', index: i, height: Math.max(0, s.height + (e.key === 'ArrowDown' ? 1 : -1) * gridStep(state.doc)) });
              }} />}
          </div>
        ))}
      </div>
      {pageMenu && (
        <PopupMenu x={pageMenu.x} y={pageMenu.y} testId="page-menu" labelKey="form.tabOrder.pageMenu" onClose={() => setPageMenu(null)}>
          {pageMenu.items.map((m) => (
            <button key={m.id} type="button" role="menuitem" data-testid={`page-menu-${m.id}`} onClick={() => { setPageMenu(null); m.run(); }}>{t(m.labelKey)}</button>
          ))}
        </PopupMenu>
      )}
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
