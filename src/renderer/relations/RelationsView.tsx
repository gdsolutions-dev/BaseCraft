// Fenêtre Relations, comme dans Access : les tables en boîtes déplaçables, les relations en lignes (« 1 » et « ∞ » avec
// l'intégrité), une relation créée en glissant un champ sur le champ d'une autre table. La disposition est enregistrée dans
// la base à la fin de chaque déplacement ; en lecture seule elle reste déplaçable, sans être enregistrée.
import { KeyRound, Pencil, Table, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Relation, RelationsLayout } from '../../shared/api';
import type { TableDesign } from '../../shared/field-types';
import { api } from '../bridge';
import type { DocViewProps } from '../shell/DocumentTabs';
import { useErrorDialog, useModal } from '../shell/Modal';
import { registerCommands } from '../shell/ribbon-model';
import { AddTablesDialog, RelationDialog, draftOf, type RelationDraft } from './RelationDialog';
import { BOX_W, autoLayout, boxHeight, deleteRefusal, isUniqueField, linePath, linkSides, type Box, type Point } from './relations-layout';
import './relations.css';

/** C1 R11: the window shows this base's relations, never a linked file's. */
const localRelations = () => api.relations.list({ localOnly: true }); // never opens (nor locks) a linked file
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
type Selection = { table: string } | { relation: string } | null;

/** The tables of the relations (of `table` only, when given). */
const related = (rels: Relation[], table?: string) =>
  rels.filter((r) => table === undefined || r.parentTable === table || r.childTable === table).flatMap((r) => [r.parentTable, r.childTable]);
const newDraft = (p: Partial<RelationDraft>): RelationDraft =>
  ({ name: '', parentTable: '', childTable: '', pairs: [], enforce: false, cascadeUpdate: false, cascadeDelete: false, joinType: 1, ...p });
const clamp = (p: Point): Point => ({ x: Math.max(0, Math.round(p.x)), y: Math.max(0, Math.round(p.y)) });

async function withDesigns(names: string[], known: Map<string, TableDesign>): Promise<Map<string, TableDesign>> {
  const m = new Map(known);
  const got = await Promise.all(names.filter((n) => !m.has(n)).map(async (n) => [n, await api.tables.design(n)] as const));
  for (const [n, d] of got) m.set(n, d);
  return m;
}

export function RelationsView({ tab, readOnly, dispatch }: DocViewProps) {
  const { t } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [tables, setTables] = useState<string[]>([]);
  const [designs, setDesigns] = useState(new Map<string, TableDesign>());
  const [rels, setRels] = useState<Relation[]>([]);
  const [layout, setLayout] = useState<RelationsLayout>({ tables: {} });
  const [scrolls, setScrolls] = useState(new Map<string, number>());
  const [sel, setSel] = useState<Selection>(null);
  const [editing, setEditing] = useState<{ draft: RelationDraft; original: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ table: string; x: number; y: number; from: Point; moved: boolean } | null>(null);
  const link = useRef<{ table: string; field: string } | null>(null);
  const first = useRef(true);
  const live = useRef({ designs, rels, layout, sel, readOnly });
  live.current = { designs, rels, layout, sel, readOnly };

  const size = () => ({ w: canvas.current?.clientWidth || 800, h: canvas.current?.clientHeight || 600 });
  const persist = (next: RelationsLayout) => {
    setLayout(next);
    if (!live.current.readOnly) api.relations.saveLayout(next).catch((e) => void showError(e));
  };

  // Everything is read again when the window opens and when a table changes (saved, renamed, deleted).
  useEffect(() => {
    let stale = false;
    (async () => {
      const [list, rs, saved] = await Promise.all([api.tables.list(), localRelations(), api.relations.layout()]);
      const names = list.filter((x) => !x.link).map((x) => x.name); // C1 R11: local tables only
      // only the stored layout is shown, so a reload or a reopening shows the same window (Clear Layout lasts)
      const shown = Object.keys(saved.tables).filter((n) => names.includes(n));
      const ds = await withDesigns(shown, new Map());
      if (stale) return;
      // as in Access, Add Tables opens by itself on an empty window only while no relation exists
      if (first.current && !shown.length && !rs.length && names.length) setAdding(true);
      first.current = false;
      setTables(names); setRels(rs); setDesigns(ds);
      setLayout(autoLayout(shown, saved, size()));
      setSel((s) => (s && ('table' in s ? shown.includes(s.table) : rs.some((r) => r.name === s.relation)) ? s : null));
    })().catch((e) => void showError(e));
    return () => { stale = true; };
  }, [tab.reloadToken]);

  const show = async (names: string[]) => {
    const { layout: l, designs: known } = live.current;
    const shown = Object.keys(l.tables);
    const add = [...new Set(names)].filter((n) => !shown.includes(n));
    if (!add.length) return;
    try {
      setDesigns(await withDesigns(add, known));
      persist(autoLayout([...shown, ...add], l, size()));
    } catch (e) { await showError(e); }
  };
  const hide = (name: string) => {
    const { [name]: _gone, ...rest } = live.current.layout.tables;
    persist({ tables: rest });
    setSel(null);
  };
  const clearLayout = async () => {
    const ok = await modal.confirm({ titleKey: 'relations.clearTitle', messageKey: 'relations.clearMessage', buttons: ['yes', 'no'], defaultButton: 'no' });
    if (ok !== 'yes') return;
    persist({ tables: {} });
    setSel(null);
  };
  const edit = (r: Relation) => { if (!live.current.readOnly) setEditing({ draft: draftOf(r), original: r.name }); };
  const editSelected = () => {
    const { sel: s, rels: rs } = live.current;
    const r = s && 'relation' in s ? rs.find((x) => x.name === s.relation) : undefined;
    if (r) edit(r);
    else setEditing({ draft: newDraft({ parentTable: s && 'table' in s ? s.table : '' }), original: null });
  };
  const remove = async (r: Relation) => {
    if (live.current.readOnly) return;
    const ok = await modal.confirm({ titleKey: 'relations.deleteTitle', messageKey: 'relations.deleteMessage', buttons: ['yes', 'no'], defaultButton: 'no' });
    if (ok !== 'yes') return;
    try {
      const res = await api.relations.delete(r.name);
      if (!res.ok) await modal.confirm({ titleKey: 'dialog.errorTitle', ...deleteRefusal(res, r.name), buttons: ['ok'] });
      setRels(await localRelations());
      setSel(null);
    } catch (e) { await showError(e); }
  };
  const saved = async (r: Relation) => {
    setEditing(null);
    try { setRels(await localRelations()); } catch (e) { await showError(e); }
    await show([r.parentTable, r.childTable]);
    setSel({ relation: r.name });
  };

  const selTable = sel && 'table' in sel ? sel.table : null;
  useEffect(() => registerCommands(tab.id, {
    addTables: () => setAdding(true),
    editRelationships: editSelected,
    clearLayout,
    allRelationships: () => show(related(live.current.rels)),
    closeRelationships: () => { void dispatch({ type: 'close', id: tab.id }); },
    ...(selTable !== null ? { hideTable: () => hide(selTable), directRelationships: () => show(related(live.current.rels, selTable)) } : {}),
  }), [tab.id, selTable]);

  // ---------- Mouse and keyboard on the drawing ----------
  const focusBox = (el: Element) => (el.closest('.rel-box') as HTMLElement | null)?.focus();
  const startMove = (name: string) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection
    focusBox(e.currentTarget);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { table: name, x: e.clientX, y: e.clientY, from: live.current.layout.tables[name], moved: false };
  };
  const dragged = (e: PointerEvent) => {
    const g = drag.current!;
    return clamp({ x: g.from.x + e.clientX - g.x, y: g.from.y + e.clientY - g.y });
  };
  const moving = (e: PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    g.moved = true;
    const p = dragged(e);
    setLayout((l) => ({ tables: { ...l.tables, [g.table]: p } }));
  };
  const endMove = (e: PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const p = dragged(e);
    drag.current = null;
    if (g.moved) persist({ tables: { ...live.current.layout.tables, [g.table]: p } });
  };
  const boxKeys = (name: string) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const d = ARROWS[e.key];
    if (d) {
      e.preventDefault();
      setLayout((l) => ({ tables: { ...l.tables, [name]: clamp({ x: l.tables[name].x + d[0], y: l.tables[name].y + d[1] }) } }));
    } else if (e.key === 'Delete') {
      e.preventDefault();
      hide(name);
    }
  };
  const boxKeyUp = (e: KeyboardEvent) => { if (ARROWS[e.key] && e.target === e.currentTarget) persist(live.current.layout); };

  // A field dropped on a field of another table: the relation dialog, the unique side as the parent (as Access does).
  const startLink = (table: string, field: string) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusBox(e.currentTarget);
    if (live.current.readOnly) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    link.current = { table, field };
  };
  const endLink = (e: PointerEvent) => {
    const from = link.current;
    link.current = null;
    const el = from && document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-field]');
    if (!from || !el || el.dataset.table === from.table) return;
    const to = { table: el.dataset.table!, field: el.dataset.field! };
    const [p, c] = linkSides(from, to, live.current.designs);
    setEditing({ draft: newDraft({ parentTable: p.table, childTable: c.table, pairs: [[p.field, c.field]] }), original: null });
  };

  // ---------- Drawing ----------
  const shown = Object.keys(layout.tables).filter((n) => designs.has(n));
  const boxOf = (n: string): Box => ({ ...layout.tables[n], w: BOX_W, h: boxHeight(designs.get(n)!.fields.length), scroll: scrolls.get(n) ?? 0 });
  const indexOf = (n: string, f: string) => designs.get(n)!.fields.findIndex((x) => x.name === f);
  const extent = shown.reduce((m, n) => {
    const b = boxOf(n);
    return { w: Math.max(m.w, b.x + b.w + 80), h: Math.max(m.h, b.y + b.h + 80) };
  }, { w: 0, h: 0 });
  const describe = (r: Relation) => t('relations.line', {
    context: r.enforce ? 'enforced' : undefined, parent: r.parentTable, child: r.childTable,
    parentFields: r.parentFields.join(', '), childFields: r.childFields.join(', '),
  });
  const isSel = (r: Relation) => !!sel && 'relation' in sel && sel.relation === r.name;

  const line = (r: Relation) => {
    const a = boxOf(r.parentTable), b = boxOf(r.childTable);
    const paths = r.parentFields.map((pf, i) => linePath(a, indexOf(r.parentTable, pf), b, indexOf(r.childTable, r.childFields[i])));
    const { oneEnd, manyEnd } = paths[0];
    const oneToOne = r.childFields.length === 1 && isUniqueField(designs.get(r.childTable), r.childFields[0]);
    return (
      <g key={r.name} className={`rline${isSel(r) ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-label={describe(r)}
        data-testid={`rel-line-${r.name}`} onFocus={() => setSel({ relation: r.name })} onClick={() => setSel({ relation: r.name })}
        onDoubleClick={() => edit(r)}
        onKeyDown={(e) => {
          if (e.key === 'Delete') { e.preventDefault(); void remove(r); } else if (e.key === 'Enter') { e.preventDefault(); edit(r); }
        }}>
        {paths.map((p, i) => <g key={i}><path className="rline-hit" d={p.d} /><path d={p.d} /></g>)}
        {r.enforce && (
          <>
            <text x={oneEnd.x} y={oneEnd.y} textAnchor="middle" data-testid={`rel-line-${r.name}-one`}>1</text>
            <text x={manyEnd.x} y={manyEnd.y} textAnchor="middle" data-testid={`rel-line-${r.name}-many`}>{oneToOne ? '1' : '∞'}</text>
          </>
        )}
      </g>
    );
  };

  return (
    <div className="rel-view" data-testid="relations-view">
      <div ref={canvas} className={`rel-canvas${readOnly ? ' is-readonly' : ''}`} role="region" aria-label={t('relations.canvas')}
        data-testid="relations-canvas" onPointerDown={(e) => { if (!(e.target as Element).closest('.rel-box, .rline')) setSel(null); }}>
        <div className="rel-extent" style={{ width: extent.w, height: extent.h }} />
        <svg className="rel-lines" width={extent.w} height={extent.h}>
          {rels.filter((r) => shown.includes(r.parentTable) && shown.includes(r.childTable)).map(line)}
        </svg>
        {shown.map((n) => {
          const d = designs.get(n)!;
          const b = boxOf(n);
          return (
            <div key={n} className={`rel-box card${selTable === n ? ' is-selected' : ''}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
              role="group" tabIndex={0} aria-label={t('relations.table', { name: n })} data-testid={`rel-table-${n}`}
              onFocus={(e) => { if (e.target === e.currentTarget) setSel({ table: n }); }} onKeyDown={boxKeys(n)} onKeyUp={boxKeyUp}>
              <div className="rel-box-head" onPointerDown={startMove(n)} onPointerMove={moving} onPointerUp={endMove} onPointerCancel={endMove}>
                <Table className="ic" aria-hidden /><span>{n}</span>
              </div>
              <div className="rel-box-fields" onScroll={(e) => { const top = e.currentTarget.scrollTop; setScrolls((m) => new Map(m).set(n, top)); }}>
                {d.fields.map((f) => (
                  <div key={f.name} className="rel-field" data-table={n} data-field={f.name} data-testid={`rel-field-${n}-${f.name}`}
                    onPointerDown={startLink(n, f.name)} onPointerUp={endLink} onPointerCancel={() => { link.current = null; }}>
                    {f.props.primaryKey
                      ? <><KeyRound className="ic ic-sm rel-key" aria-hidden /><span className="sr-only">{t('relations.key')}</span></>
                      : <span className="rel-key-gap" />}
                    <span className="rel-field-name">{f.name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <section className="rel-list" aria-labelledby={`${tab.id}-list`}>
        <h3 id={`${tab.id}-list`}>{t('relations.list')}</h3>
        {rels.length ? (
          <ul data-testid="relations-list">
            {rels.map((r) => (
              <li key={r.name} className={isSel(r) ? 'is-selected' : ''} data-testid={`relations-item-${r.name}`}>
                <span>{describe(r)}</span>
                <button className="iconbtn" data-testid={`relations-edit-${r.name}`} disabled={readOnly} aria-label={t('relations.editOne', { name: r.name })}
                  title={t('relations.editOne', { name: r.name })} onClick={() => edit(r)}>
                  <Pencil className="ic ic-sm" aria-hidden />
                </button>
                <button className="iconbtn" data-testid={`relations-delete-${r.name}`} disabled={readOnly} aria-label={t('relations.deleteOne', { name: r.name })}
                  title={t('relations.deleteOne', { name: r.name })} onClick={() => void remove(r)}>
                  <Trash2 className="ic ic-sm" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="muted" data-testid="relations-list">{t('relations.none')}</p>}
      </section>
      {adding && (
        <AddTablesDialog tables={tables.filter((n) => !Object.hasOwn(layout.tables, n))} onClose={() => setAdding(false)}
          onAdd={(names) => { setAdding(false); void show(names); }} />
      )}
      {editing && (
        <RelationDialog tables={tables} draft={editing.draft} original={editing.original} onCancel={() => setEditing(null)}
          onSaved={(r) => void saved(r)} />
      )}
    </div>
  );
}
