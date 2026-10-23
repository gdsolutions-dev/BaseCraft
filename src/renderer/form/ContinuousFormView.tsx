// Affichage Formulaires continus : le Détail répété pour chaque enregistrement (seules les lignes visibles sont dans le DOM,
// placées en absolu ; la ligne courante y reste toujours, pour garder le focus), en-tête et pied fixes, sélecteur
// d'enregistrement sur la ligne courante, le nouvel enregistrement en dernier. Les contrôles sont ceux du formulaire unique.
// Test ids : chaque ligne répète ceux du Détail (form-ctl-<nom>…) ; un test les cherche dans sa ligne (form-row-<i>).
import { ChevronRight, Pencil } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { effectiveProp } from '../../shared/design/properties';
import { NavigationBar } from '../datasheet/NavigationBar';
import { twipsToPx } from '../designer/units';
import { type RunCtx, readOnlyNote } from './controls/run-ctx';
import { FormSection } from './FormSection';
import type { SingleFormProps } from './SingleFormView';
import { visibleRange } from './views';

export interface ContinuousFormProps extends SingleFormProps {
  rowCtx(i: number): RunCtx;   // another row's context (the current row uses x)
  onRow(i: number): void;      // another row clicked elsewhere than on a control (its selector, a label, its background)
}

/** What takes the focus on a click (its focus makes its row current, the form's goRow): the row's click leaves it alone. */
const TAKES_FOCUS = 'input, textarea, button, label[for], [role="listbox"], [role="radio"], [role="tab"], [tabindex]:not([tabindex="-1"])';

export function ContinuousFormView({ doc, x, rowCtx, root, messages, filter, onGo, onNew, onToggleFilter, onRow }: ContinuousFormProps) {
  const { t } = useTranslation();
  const width = twipsToPx(Number(effectiveProp(doc.props, 'Width', 'form')) || 0);
  const shown = (kind: string) => doc.sections.find((s) => s.kind === kind && s.props.Visible !== false);
  const [header, detail, footer] = [shown('formHeader'), shown('detail'), shown('formFooter')];
  const bound = doc.recordSource !== null;   // an unbound form: one row, no selector, no navigation bar
  const selectors = bound && effectiveProp(doc.props, 'RecordSelectors', 'form') !== false;
  const nav = bound && effectiveProp(doc.props, 'NavigationButtons', 'form') !== false;
  const { snap } = x;
  const rowH = Math.max(1, twipsToPx(detail?.height ?? 0));
  const count = !detail ? 0 : bound ? snap.total + (snap.canAdd ? 1 : 0) : 1;
  const current = bound ? snap.index : 0;
  const body = useRef<HTMLDivElement>(null);
  const [port, setPort] = useState({ top: 0, height: 0 });
  const armed = useRef<number | null>(null);   // the row a click began on while it was not current

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => setPort({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the current record kept in view (navigation, Tab past the last control, a new record)
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || snap.status !== 'ready') return;
    const top = current * rowH;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight;
  }, [current, snap.status, rowH]);

  const [start, end] = visibleRange(port.top, port.height, rowH, count);
  const rows = Array.from({ length: end - start }, (_, k) => start + k);
  if (current < count && (current < start || current >= end)) rows.push(current);
  const selectorOf = (i: number) => {
    if (i !== current) return <div className="frun-selector" style={{ height: rowH }} />;
    return (
      <div className="frun-selector is-current" data-testid="form-selector" style={{ height: rowH }}>
        {snap.dirty
          ? <span data-testid="form-dirty" title={t('form.dirty')}><Pencil className="ic ic-sm" aria-hidden /><span className="sr-only">{t('form.dirty')}</span></span>
          : <ChevronRight className="ic ic-sm" aria-hidden />}
      </div>
    );
  };
  return (
    <div className="frun" ref={root} data-testid="form-run">
      {header && <div className="frun-fixed"><FormSection section={header} x={x} width={width} /></div>}
      <div className="frun-body" ref={body} data-testid="form-rows" onScroll={(e) => setPort({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
        {detail && (
          // ponytail: one spacer as tall as every row; Chromium caps an element near 33.5 M px (about 800 000 rows of 40 px),
          // beyond that the last rows cannot be scrolled to: scale the scroll position if forms ever get that many
          // any press forgets the last one's row: a right click or a drag released elsewhere never swallows the next click
          <div className="frun-rows" style={{ height: count * rowH, width: width + (selectors ? 18 : 0) }} onMouseDownCapture={() => { armed.current = null; }}>
            {rows.map((i) => (
              <div key={i} className="frun-detail frun-row" data-testid={`form-row-${i}`} data-current={i === current} data-row-other={i === current ? undefined : ''}
                style={{ top: i * rowH }}
                onMouseDown={i === current ? undefined : (e) => {
                  if (e.button !== 0) return;
                  armed.current = i;
                  if ((e.target as Element).closest(TAKES_FOCUS)) return;
                  e.preventDefault();   // the focus stays in its control, then follows to the same control on this row
                  onRow(i);
                }}
                onClickCapture={(e) => {
                  // a click begun on another row only moves to it: never a check box ticked or an option chosen by it (the
                  // row may already be current when the click ends)
                  if (armed.current === i) { e.preventDefault(); e.stopPropagation(); }
                  armed.current = null;
                }}>
                {selectors && selectorOf(i)}
                <FormSection section={detail} x={i === current ? x : rowCtx(i)} width={width} />
              </div>
            ))}
          </div>
        )}
      </div>
      {footer && <div className="frun-fixed"><FormSection section={footer} x={x} width={width} /></div>}
      {messages.length > 0 && (
        <div className="frun-message" role="alert" aria-label={t('form.message')} data-testid="form-message">
          {messages.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
      {nav && (
        <NavigationBar current={snap.status === 'ready' ? snap.index : null} count={snap.total} canAdd={snap.canAdd}
          filter={filter} onGo={onGo} onNew={onNew} onToggleFilter={onToggleFilter} note={readOnlyNote(x)} />
      )}
    </div>
  );
}
