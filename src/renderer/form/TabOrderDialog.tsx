// Boîte « Ordre de tabulation » d'Access : une liste par groupe (section ou page d'onglets), sélection de plusieurs lignes (Maj+clic, Maj+flèche,
// glissé sur les sélecteurs de lignes), déplacement du bloc au pointeur, par Monter / Descendre ou Alt+Haut / Alt+Bas, Ordre automatique.
// Se ferme sur l'ordre de chaque groupe (noms), ou null ; en lecture seule, elle se consulte seulement.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignDoc, SectionDef } from '../../shared/design/model';
import { autoPageOrder, autoTabOrder, moveBlock, pageTabOrder, tabOrder } from './form-def';

export interface TabGroup { key: string; label: string; names: string[]; auto: string[] }

export const sectionGroups = (doc: DesignDoc, label: (s: SectionDef, i: number) => string): TabGroup[] =>
  doc.sections.map((s, i) => ({ key: s.kind, label: label(s, i), names: tabOrder(s), auto: tabOrder(autoTabOrder(s)) }));

export const pageGroup = (doc: DesignDoc, tabControl: string, page: number, label: string): TabGroup[] =>
  [{ key: 'page', label, names: pageTabOrder(doc, tabControl, page), auto: autoPageOrder(doc, tabControl, page) }];

interface Sel { group: number; from: number; to: number }
interface Drag { group: number; mode: 'select' | 'move'; origin: number; gap: number; row: number }

export function TabOrderDialog(p: { groups: TabGroup[]; readOnly: boolean; close(v: string[][] | null): void }) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState(() => p.groups.map((g) => g.names));
  const [sel, setSel] = useState<Sel>({ group: Math.max(0, p.groups.findIndex((g) => g.key === 'detail')), from: 0, to: 0 });
  const [drop, setDrop] = useState<{ group: number; gap: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const current = orders[sel.group] ?? [];
  const lo = Math.min(sel.from, sel.to), hi = Math.max(sel.from, sel.to);

  /** Déplace le bloc [a, b] du groupe devant la position `gap` (0..n de la liste d'origine) et le garde sélectionné. */
  const moveTo = (group: number, a: number, b: number, gap: number) => {
    if (p.readOnly) return;
    const r = moveBlock(orders[group], a, b, gap);
    if (r.names === orders[group]) return;
    setOrders(orders.map((o, i) => (i === group ? r.names : o)));
    setSel({ group, from: r.lo, to: r.hi });
  };
  const auto = () => {
    setOrders(orders.map((o, i) => (i === sel.group ? p.groups[i].auto : o)));
    setSel({ group: sel.group, from: 0, to: 0 });
  };
  const keys = (group: number) => (e: KeyboardEvent) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !orders[group].length) return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? -1 : 1;
    const cur = sel.group === group ? sel : { group, from: 0, to: 0 };
    const a = Math.min(cur.from, cur.to), b = Math.max(cur.from, cur.to);
    if (e.altKey) moveTo(group, a, b, delta < 0 ? a - 1 : b + 2);
    else {
      const to = Math.min(Math.max(0, cur.to + delta), orders[group].length - 1);
      setSel({ group, from: e.shiftKey ? cur.from : to, to });
    }
  };

  // Les lignes d'une liste sont repérées par leurs rectangles ; le trait d'insertion suit les milieux de lignes.
  // ponytail: suppose aucun défilement pendant le glissé ; ajouter un défilement automatique si les listes s'allongent
  const rows = (e: PointerEvent) => [...(e.currentTarget as HTMLElement).closest('ul')!.querySelectorAll('li[role="option"]')].map((li) => li.getBoundingClientRect());
  const rowAt = (r: DOMRect[], y: number) => Math.min(r.length - 1, r.filter((x) => y >= x.bottom).length);
  const gapAt = (r: DOMRect[], y: number) => r.filter((x) => y >= x.top + x.height / 2).length;

  const down = (group: number, j: number) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (e.shiftKey && sel.group === group) { setSel({ group, from: sel.from, to: j }); return; }   // Maj+clic : étend la plage
    e.currentTarget.setPointerCapture(e.pointerId);
    const inside = !p.readOnly && sel.group === group && j >= lo && j <= hi;   // en lecture seule : sélection seulement
    drag.current = { group, mode: inside ? 'move' : 'select', origin: j, gap: -1, row: j };
    if (!inside) setSel({ group, from: j, to: j });
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const r = rows(e);
    d.row = rowAt(r, e.clientY);
    if (d.mode === 'select') setSel({ group: d.group, from: d.origin, to: d.row });
    else {
      d.gap = gapAt(r, e.clientY);
      setDrop(d.gap >= lo && d.gap <= hi + 1 ? null : { group: d.group, gap: d.gap });
    }
  };
  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    setDrop(null);
    if (!d || d.mode !== 'move' || !commit) return;
    if (d.gap === -1) setSel({ group: d.group, from: d.origin, to: d.origin });   // simple clic sur le sélecteur : la ligne seule
    else moveTo(d.group, lo, hi, d.gap);
  };

  return (
    <div className="taborder" data-testid="taborder">
      <div className="taborder-lists">
        {p.groups.map((g, i) => {
          const names = orders[i];
          const mine = sel.group === i;
          return (
            <section key={g.key} className="taborder-section">
              <h3 id={`taborder-h-${i}`}>{g.label}</h3>
              <ul role="listbox" aria-multiselectable tabIndex={0} aria-labelledby={`taborder-h-${i}`} data-testid={`taborder-list-${g.key}`} onKeyDown={keys(i)}
                aria-activedescendant={mine && names.length ? `taborder-${i}-${sel.to}` : undefined}
                onFocus={() => { if (!mine && names.length) setSel({ group: i, from: 0, to: 0 }); }}>
                {names.map((n, j) => (
                  <li key={n} id={`taborder-${i}-${j}`} role="option" aria-selected={mine && j >= lo && j <= hi} data-testid={`taborder-item-${n}`}
                    className={drop?.group === i ? (drop.gap === 0 && j === 0 ? 'drop-before' : drop.gap === j + 1 ? 'drop-after' : undefined) : undefined}
                    onClick={(e) => setSel({ group: i, from: e.shiftKey && mine ? sel.from : j, to: j })}>
                    <span aria-hidden className="taborder-sel" data-testid={`taborder-sel-${n}`} title={t('form.tabOrder.rowSelector', { name: n })}
                      onPointerDown={down(i, j)} onPointerMove={move} onPointerUp={() => end(true)}
                      onPointerCancel={() => end(false)} onLostPointerCapture={() => end(false)} onClick={(e) => e.stopPropagation()} />
                    {n}
                  </li>
                ))}
                {!names.length && <li className="muted" aria-disabled>{t('form.tabOrder.empty')}</li>}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="muted taborder-hint">{t('form.tabOrder.hint')}</p>
      <div className="taborder-actions">
        <button type="button" className="btn" data-testid="taborder-up" disabled={p.readOnly || !current.length || lo <= 0} onClick={() => moveTo(sel.group, lo, hi, lo - 1)}>{t('form.tabOrder.up')}</button>
        <button type="button" className="btn" data-testid="taborder-down" disabled={p.readOnly || !current.length || hi >= current.length - 1} onClick={() => moveTo(sel.group, lo, hi, hi + 2)}>{t('form.tabOrder.down')}</button>
        <button type="button" className="btn" data-testid="taborder-auto" disabled={p.readOnly || !current.length} onClick={auto}>{t('form.tabOrder.auto')}</button>
      </div>
      <div className="modal-buttons">
        <button type="button" className="btn btn-primary" data-testid="taborder-ok" onClick={() => p.close(p.readOnly ? null : orders)}>{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="taborder-cancel" onClick={() => p.close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
