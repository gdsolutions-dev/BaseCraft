// Boîte « Ordre de tabulation » d'Access : une liste par section, Monter / Descendre (Alt+Haut / Alt+Bas au clavier), Ordre automatique.
// Se ferme sur l'ordre de chaque section (noms), ou null ; en lecture seule, elle se consulte seulement.
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignDoc, SectionDef } from '../../shared/design/model';
import { autoTabOrder, tabOrder } from './form-def';

export function TabOrderDialog(p: { doc: DesignDoc; sectionLabel(s: SectionDef, i: number): string; readOnly: boolean; close(v: string[][] | null): void }) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState(() => p.doc.sections.map(tabOrder));
  const detail = Math.max(0, p.doc.sections.findIndex((s) => s.kind === 'detail'));
  const [sel, setSel] = useState<{ section: number; index: number }>({ section: detail, index: 0 });
  const current = orders[sel.section] ?? [];

  const move = (delta: -1 | 1) => {
    const j = sel.index + delta;
    if (p.readOnly || j < 0 || j >= current.length) return;
    const list = [...current];
    [list[sel.index], list[j]] = [list[j], list[sel.index]];
    setOrders(orders.map((o, i) => (i === sel.section ? list : o)));
    setSel({ section: sel.section, index: j });
  };
  const auto = () => setOrders(orders.map((o, i) => (i === sel.section ? tabOrder(autoTabOrder(p.doc.sections[i])) : o)));
  const keys = (section: number) => (e: KeyboardEvent) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !orders[section].length) return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? -1 : 1;
    if (e.altKey) move(delta);
    else setSel({ section, index: Math.min(Math.max(0, (sel.section === section ? sel.index : -1) + delta), orders[section].length - 1) });
  };

  return (
    <div className="taborder" data-testid="taborder">
      <div className="taborder-lists">
        {p.doc.sections.map((s, i) => {
          const label = p.sectionLabel(s, i);
          return (
            <section key={i} className="taborder-section">
              <h3 id={`taborder-h-${i}`}>{label}</h3>
              <ul role="listbox" tabIndex={0} aria-labelledby={`taborder-h-${i}`} data-testid={`taborder-list-${s.kind}`} onKeyDown={keys(i)}
                aria-activedescendant={sel.section === i && orders[i].length ? `taborder-${i}-${sel.index}` : undefined}
                onFocus={() => { if (sel.section !== i && orders[i].length) setSel({ section: i, index: 0 }); }}>
                {orders[i].map((n, j) => (
                  <li key={n} id={`taborder-${i}-${j}`} role="option" aria-selected={sel.section === i && sel.index === j} data-testid={`taborder-item-${n}`}
                    onClick={() => setSel({ section: i, index: j })}>{n}</li>
                ))}
                {!orders[i].length && <li className="muted" aria-disabled>{t('form.tabOrder.empty')}</li>}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="muted taborder-hint">{t('form.tabOrder.hint')}</p>
      <div className="taborder-actions">
        <button type="button" className="btn" data-testid="taborder-up" disabled={p.readOnly || sel.index <= 0} onClick={() => move(-1)}>{t('form.tabOrder.up')}</button>
        <button type="button" className="btn" data-testid="taborder-down" disabled={p.readOnly || sel.index >= current.length - 1} onClick={() => move(1)}>{t('form.tabOrder.down')}</button>
        <button type="button" className="btn" data-testid="taborder-auto" disabled={p.readOnly || !current.length} onClick={auto}>{t('form.tabOrder.auto')}</button>
      </div>
      <div className="modal-buttons">
        <button type="button" className="btn btn-primary" data-testid="taborder-ok" onClick={() => p.close(p.readOnly ? null : orders)}>{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="taborder-cancel" onClick={() => p.close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
