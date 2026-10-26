// Zone de liste : role="listbox" à sélection simple, les colonnes visibles à leurs largeurs, sans en-têtes ; ↑/↓ (Origine, Fin)
// et le clic choisissent la ligne, dont la valeur liée va au champ.
import { useEffect, type KeyboardEvent } from 'react';
import { controlEnabled } from '../run-model';
import { LIST_MAX, listWindow } from '../row-source';
import { columns } from './ComboBoxCtl';
import { ctlAttrs, fieldOf, hasLabel, listChoose, listCurrent, NO_LIST, type CtlProps } from './run-ctx';

export function ListBoxCtl({ c, x, style }: CtlProps) {
  const list = x.lists[c.name] ?? NO_LIST;
  const { rows } = list.data;
  const b = fieldOf(c, x);
  const { disabled, readOnly } = controlEnabled(c, x.snap, b?.f ?? null);
  const { row } = listCurrent(c, x);
  const [start, end] = listWindow(rows.length, row, !!x.other);   // another row of Continuous Forms: a few rows, not thousands each
  const id = x.id(c.name);
  const optId = (i: number) => `${id}-opt-${i}`;
  const ev = x.events(c);
  const choose = (i: number) => { if (!disabled && !readOnly && i !== row) x.update(c, () => listChoose(c, x, i, rows[i].display[0] ?? '')); };
  useEffect(() => { if (row >= 0) document.getElementById(optId(row))?.scrollIntoView({ block: 'nearest' }); }, [row]);
  const onKeyDown = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowDown' ? Math.min(row + 1, rows.length - 1) : e.key === 'ArrowUp' ? Math.max(row - 1, 0)
      : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : null;
    if (to === null || e.altKey || e.ctrlKey || !rows.length) { ev.onKeyDown(e); return; }
    e.preventDefault();
    choose(to);
  };
  return (
    <div className="frun-listbox" style={style}>
      {list.data.heads && <div className="frun-list-row frun-list-heads" aria-hidden="true" data-testid={`form-list-heads-${c.name}`}>{columns(list.data.heads, list.data.widths)}</div>}
      <div {...ctlAttrs(c, x)} role="listbox" className="frun-listbox-rows" {...(hasLabel(c) ? { 'aria-labelledby': `${id}-label` } : {})} aria-activedescendant={row >= 0 ? optId(row) : undefined}
        aria-disabled={disabled || undefined} aria-readonly={readOnly || undefined} onKeyDown={onKeyDown}>
        {rows.slice(start, end).map((r, k) => { const i = start + k; return (
          <div key={i} id={optId(i)} role="option" aria-selected={i === row} aria-label={r.display.join(' ')} data-testid={`form-option-${c.name}-${i}`}
            className={`frun-list-row${i === row ? ' is-selected' : ''}`} onClick={() => choose(i)}>
            {columns(r.display, list.data.widths)}
          </div>
        ); })}
      </div>
      {list.truncated && <div className="frun-list-note" data-testid={`form-list-truncated-${c.name}`}>{x.t('form.list.truncated', { count: LIST_MAX })}</div>}
    </div>
  );
}
