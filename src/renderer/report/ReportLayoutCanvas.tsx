// Mode Page des états (L3) : à la place de la surface de création, l'état mis en page en un seul flux sur les données lues
// (renderFlowHtml), en taille réelle comme l'aperçu à 100 %, et par-dessus une surcouche : un anneau sur chaque occurrence des
// contrôles sélectionnés et, pour un seul contrôle, une poignée de largeur au bord droit de sa première occurrence. Un clic
// sélectionne le contrôle sous le pointeur (Ctrl/Maj : ajoute ou retire) ; ailleurs, la sélection revient à l'état. Pas de
// déplacement de contrôle : la Feuille de propriétés et les commandes Organiser s'en chargent.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { itemAt } from '../../shared/report/flow';
import { renderFlowHtml, reportCss } from '../../shared/report/render';
import type { CanvasProps } from '../designer/Designer';
import { findControl } from '../designer/designer-model';
import { gridStep, twipsToPx } from '../designer/units';
import { FLOW_ROWS, type FlowData } from './layout-flow';
import { deleteTargets, overlayFor, placement, resizeTo, stepDrag, type DragStep, type WidthDrag } from './layout-overlay';
import { faces } from './ReportPreviewView';
import './preview.css';

const SCALE = twipsToPx(1);   // px par twip : la taille réelle de l'aperçu (zoom 100 %)

/** `notice` : la clé du bandeau choisie par la vue (layoutNoticeKey), null sans bandeau. */
export function ReportLayoutCanvas({ flow, state, dispatch, readOnly, busy, notice, host, tool, onTool }: CanvasProps & { flow: FlowData; busy?: boolean; notice: string | null }) {
  const { t } = useTranslation();
  const report = flow.report;
  const html = useMemo(() => (report ? renderFlowHtml(report) : ''), [report]);
  const css = useMemo(() => (report ? reportCss(report, 'fonts/') : ''), [report]);
  const fontList = useMemo(() => (report ? [...faces(report)].join('|') : null), [report]);
  const [fontsReady, setFontsReady] = useState(false);
  const [drag, setDrag] = useState<WidthDrag | null>(null);
  const dragRef = useRef<WidthDrag | null>(null);

  // comme l'aperçu : le flux reste caché tant que ses polices embarquées ne sont pas chargées
  useEffect(() => {
    if (fontList === null) return;
    const list = fontList ? fontList.split('|') : [];
    if (!list.every((f) => document.fonts.check(f))) setFontsReady(false);
    let gone = false;
    void Promise.all(list.map((f) => document.fonts.load(f).catch(() => [])))
      .then(() => document.fonts.ready)
      .then(() => { if (!gone) setFontsReady(true); });
    return () => { gone = true; };
  }, [fontList]);

  const names = state.selection.kind === 'controls' ? state.selection.names : [];
  const overlay = report ? overlayFor(report, names, SCALE) : { rings: [], handle: null };
  // pendant le glisser (et jusqu'à la mise en page suivante) : les anneaux du contrôle suivent la largeur visée
  const dw = (name: string) => (drag && drag.name === name ? (drag.w - drag.base) * SCALE : 0);
  const handle = overlay.handle && !readOnly ? overlay.handle : null;

  const root = useRef<HTMLDivElement>(null);
  // Suppr : retire la sélection par le réducteur (comme en mode Création, qui ignore Retour arrière) ; jamais pendant une saisie ni en lecture seule
  const onKeyDown = (e: ReactKeyEvent<HTMLDivElement>) => {
    if (e.key !== 'Delete') return;
    const el = e.target as HTMLElement;
    if (readOnly || e.ctrlKey || e.shiftKey || e.altKey || el.closest('input, textarea, select, [contenteditable]') || !deleteTargets(state.selection).length) return;
    e.preventDefault();
    dispatch({ type: 'deleteSelection' });
  };

  const placing = !!tool.kind && !readOnly && !busy;
  const select = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !report) return;
    if (tool.kind && busy) return;   // outil actif pendant le recalcul : le flux affiché est périmé, le clic est ignoré
    root.current?.focus({ preventScroll: true });   // le clavier suit le clic
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / SCALE, y = (e.clientY - r.top) / SCALE;
    if (placing) {   // un outil actif : on pose (Alt : sans accrochage) ; hors bande, rien ne change et l'outil reste
      const at = placement(report, state.doc, tool, x, y, state.snap && !e.altKey ? gridStep(state.doc) : null);
      if (!at) return;
      dispatch({ type: 'insert', section: at.section, controls: host.newControls(tool.kind!, at.rect, at.section, state.doc),
        at: { x: at.rect.left + at.rect.width / 2, y: at.rect.top + at.rect.height / 2 } });
      if (!tool.locked) onTool({ kind: null, locked: false });
      return;
    }
    const name = itemAt(report, x, y) || null;   // '' : un élément sans nom
    if (e.ctrlKey || e.shiftKey || e.metaKey) { if (name) dispatch({ type: 'toggleSelect', name }); return; }
    dispatch({ type: 'select', selection: name ? { kind: 'controls', names: [name] } : { kind: 'doc' } });
  };
  // l'état du glisser lu par la référence : deux événements entre deux rendus voient le même dernier état
  const step = (s: DragStep) => {
    const r = stepDrag(dragRef.current, s, SCALE);
    dragRef.current = r.drag;
    setDrag(r.drag);
    if (r.commit) { const { name, width } = r.commit; dispatch({ type: 'edit', apply: (d) => resizeTo(d, name, width) }); }   // une seule étape d'annulation
  };
  const grab = (e: PointerEvent<HTMLSpanElement>, name: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const base = findControl(state.doc, name)?.control.width;
    if (base === undefined) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    step({ kind: 'down', name, x: e.clientX, base });
  };
  const live = !!drag && !drag.done;
  useEffect(() => {   // Échap abandonne le glisser en cours
    if (!live) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') step({ kind: 'cancel' }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live]);   // eslint-disable-line react-hooks/exhaustive-deps -- step ne lit que la référence
  // la largeur relâchée reste montrée jusqu'à la mise en page suivante (pas de retour en arrière de 150 ms)
  useEffect(() => { if (dragRef.current?.done) { dragRef.current = null; setDrag(null); } }, [report]);

  return (
    <div ref={root} className="rl" role="region" aria-label={t('designer.canvas')} data-testid="report-layout-canvas" aria-busy={!!busy} tabIndex={0} onKeyDown={onKeyDown}>
      {notice && <div className="rl-banner" role="status" data-testid="layout-notice">{t(notice, { count: FLOW_ROWS })}</div>}
      {report && <style>{css}</style>}
      <div className="rp-viewport">
        {!report && busy && <div className="rp-message" role="status" data-testid="report-progress">{t('report.progress')}</div>}
        {report && (
          <div className="rp-spread">
            <div className={`rp-sheet rl-sheet${placing ? ' rl-placing' : ''}`} data-testid="layout-flow" style={{ width: report.width * SCALE, visibility: fontsReady ? 'visible' : 'hidden' }}
              aria-busy={!fontsReady} onPointerDown={select}>
              {/* renderFlowHtml échappe tout texte et tout attribut ; la CSP de l'interface interdit les scripts */}
              <div dangerouslySetInnerHTML={{ __html: html }} />
              {overlay.rings.map((r, i) => (
                <div key={i} className="rl-ring" data-testid={`layout-ring-${r.name}`} aria-hidden
                  style={{ left: r.left, top: r.top, width: r.width + dw(r.name), height: r.height }} />
              ))}
              {handle && (
                <span className="rl-handle" data-testid="layout-width-handle" aria-hidden style={{ left: handle.left + dw(handle.name), top: handle.top, height: handle.height }}
                  onPointerDown={(e) => grab(e, handle.name)} onPointerMove={(e) => step({ kind: 'move', x: e.clientX, buttons: e.buttons })}
                  onPointerUp={() => step({ kind: 'up' })} onPointerCancel={() => step({ kind: 'cancel' })} onLostPointerCapture={() => step({ kind: 'cancel' })} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
