// Volet des tables de la grille de création : une boîte par table ou requête (titre, « * », champs, clé marquée), déplaçable à
// la souris et au clavier ; les jointures en lignes, dans le style de la fenêtre Relations. Glisser un champ sur le champ d'une
// autre boîte crée une jointure interne ; double-cliquer un champ (ou le glisser sur la grille) l'ajoute à la grille.
import { KeyRound, Table, X } from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { sameName } from '../../shared/field-types';
import type { QbeJoin } from '../../shared/query/qbe';
import { BOX_W, boxHeight, linePath, type Box, type Point } from '../relations/relations-layout';
import '../relations/relations.css';

export interface PaneBox { alias: string; fields: { name: string; key: boolean }[] }
/** The drag data of a field (onto another box's field: a join; onto the grid: a column). */
export const FIELD_DRAG = 'application/x-basecraft-field';

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
const clamp = (p: Point): Point => ({ x: Math.max(0, Math.round(p.x)), y: Math.max(0, Math.round(p.y)) });

interface Props {
  boxes: PaneBox[]; joins: QbeJoin[]; positions: Record<string, Point>; readOnly: boolean;
  /** `done`: the end of a move (the layout is the query's: saved with it). */
  onMove(alias: string, p: Point, done: boolean): void;
  onAddField(alias: string, field: string): void;
  onJoin(j: QbeJoin): void;
  onEditJoin(index: number): void;
  onRemoveJoin(index: number): void;
  onRemoveTable(alias: string): void;
}

export function TablePane({ boxes, joins, positions, readOnly, onMove, onAddField, onJoin, onEditJoin, onRemoveJoin, onRemoveTable }: Props) {
  const { t } = useTranslation();
  const [scrolls, setScrolls] = useState(new Map<string, number>());
  const [selJoin, setSelJoin] = useState<number | null>(null);
  const drag = useRef<{ alias: string; x: number; y: number; from: Point; moved: boolean } | null>(null);
  const arrow = `qbe-arrow${useId().replace(/:/g, '')}`; // one per pane: every tab stays mounted, hidden ones too

  const shown = boxes.filter((b) => positions[b.alias]);
  const boxOf = (b: PaneBox): Box => ({ ...positions[b.alias], w: BOX_W, h: boxHeight(b.fields.length + 1), scroll: scrolls.get(b.alias) ?? 0 });
  const extent = shown.reduce((m, b) => {
    const r = boxOf(b);
    return { w: Math.max(m.w, r.x + r.w + 80), h: Math.max(m.h, r.y + r.h + 80) };
  }, { w: 0, h: 0 });

  // ---------- Moving a box ----------
  const at = (e: PointerEvent) => { const g = drag.current!; return clamp({ x: g.from.x + e.clientX - g.x, y: g.from.y + e.clientY - g.y }); };
  const startMove = (alias: string) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    e.preventDefault();
    (e.currentTarget.closest('.rel-box') as HTMLElement | null)?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { alias, x: e.clientX, y: e.clientY, from: positions[alias], moved: false };
  };
  const moving = (e: PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    g.moved = true;
    onMove(g.alias, at(e), false);
  };
  const endMove = (e: PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const p = at(e);
    drag.current = null;
    if (g.moved) onMove(g.alias, p, true);
  };
  const boxKeys = (alias: string) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const d = ARROWS[e.key];
    if (d) {
      e.preventDefault();
      onMove(alias, clamp({ x: positions[alias].x + d[0], y: positions[alias].y + d[1] }), true);
    } else if (e.key === 'Delete' && !readOnly) {
      e.preventDefault();
      onRemoveTable(alias);
    }
  };

  // ---------- Fields: drag onto another box's field (a join), double-click or Enter (a column) ----------
  const dragField = (alias: string, field: string) => (e: DragEvent) => {
    e.dataTransfer.setData(FIELD_DRAG, JSON.stringify({ alias, field }));
    e.dataTransfer.effectAllowed = 'copyLink';
  };
  const dropOnField = (alias: string, field: string) => (e: DragEvent) => {
    const raw = e.dataTransfer.getData(FIELD_DRAG);
    if (!raw || readOnly) return;
    e.preventDefault();
    const from = JSON.parse(raw) as { alias: string; field: string };
    if (sameName(from.alias, alias) || from.field === '*' || field === '*') return;
    onJoin({ l: from.alias, lField: from.field, r: alias, rField: field, kind: 'inner' });
  };

  // ---------- Join lines ----------
  const indexOf = (b: PaneBox, f: string) => b.fields.findIndex((x) => sameName(x.name, f)) + 1; // '*' is row 0
  const line = (j: QbeJoin, i: number) => {
    const a = shown.find((b) => sameName(b.alias, j.l)), b = shown.find((x) => sameName(x.alias, j.r));
    if (!a || !b) return null;
    const p = linePath(boxOf(a), indexOf(a, j.lField), boxOf(b), indexOf(b, j.rField));
    const label = t('query.join', { ...j });
    return (
      <g key={i} className={`rline${selJoin === i ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-label={label} data-testid={`qbe-join-${i}`}
        data-kind={j.kind} onFocus={() => setSelJoin(i)} onClick={() => setSelJoin(i)} onDoubleClick={() => { if (!readOnly) onEditJoin(i); }}
        onKeyDown={(e) => {
          if (readOnly) return;
          if (e.key === 'Delete') { e.preventDefault(); setSelJoin(null); onRemoveJoin(i); } else if (e.key === 'Enter') { e.preventDefault(); onEditJoin(i); }
        }}>
        <path className="rline-hit" d={p.d} />
        {/* an outer join points at the side whose rows are not all kept, as in Access */}
        <path d={p.d} markerEnd={j.kind === 'left' ? `url(#${arrow})` : undefined} markerStart={j.kind === 'right' ? `url(#${arrow}s)` : undefined} />
      </g>
    );
  };

  return (
    <div className="rel-canvas qbe-pane" role="region" aria-label={t('query.tablePane')} data-testid="qbe-pane"
      onPointerDown={(e) => { if (!(e.target as Element).closest('.rline')) setSelJoin(null); }}>
      <div className="rel-extent" style={{ width: extent.w, height: extent.h }} />
      <svg className="rel-lines" width={extent.w} height={extent.h}>
        <defs>
          <marker id={arrow} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" className="qbe-arrowhead" /></marker>
          <marker id={`${arrow}s`} viewBox="0 0 10 10" refX="0" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 10 0 L 0 5 L 10 10 z" className="qbe-arrowhead" /></marker>
        </defs>
        {joins.map(line)}
      </svg>
      {shown.map((b) => {
        const r = boxOf(b);
        const row = (name: string, key: boolean, label: string) => (
          <div key={name} className="rel-field qbe-field" role="button" tabIndex={0} draggable aria-label={label}
            data-testid={`qbe-field-${b.alias}-${name}`}
            onDragStart={dragField(b.alias, name)} onDragOver={(e) => { if (e.dataTransfer.types.includes(FIELD_DRAG)) e.preventDefault(); }}
            onDrop={dropOnField(b.alias, name)}
            onDoubleClick={() => { if (!readOnly) onAddField(b.alias, name); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !readOnly) { e.preventDefault(); onAddField(b.alias, name); } }}>
            {key ? <><KeyRound className="ic ic-sm rel-key" aria-hidden /><span className="sr-only">{t('query.key')}</span></> : <span className="rel-key-gap" />}
            <span className="rel-field-name">{name}</span>
          </div>
        );
        return (
          <div key={b.alias} className="rel-box card" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} role="group" tabIndex={0}
            aria-label={t('query.box', { name: b.alias })} data-testid={`qbe-box-${b.alias}`} onKeyDown={boxKeys(b.alias)}>
            <div className="rel-box-head" onPointerDown={startMove(b.alias)} onPointerMove={moving} onPointerUp={endMove} onPointerCancel={endMove}>
              <Table className="ic" aria-hidden /><span>{b.alias}</span>
              {!readOnly && (
                <button className="iconbtn qbe-remove" data-testid={`qbe-remove-${b.alias}`} aria-label={t('query.removeTable')} title={t('query.removeTable')}
                  onClick={() => onRemoveTable(b.alias)}><X className="ic ic-sm" aria-hidden /></button>
              )}
            </div>
            <div className="rel-box-fields" onScroll={(e) => { const top = e.currentTarget.scrollTop; setScrolls((m) => new Map(m).set(b.alias, top)); }}>
              {row('*', false, t('query.allFields', { name: b.alias }))}
              {b.fields.map((f) => row(f.name, f.key, f.name))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
