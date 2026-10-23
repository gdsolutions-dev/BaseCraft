// Grille de création, comme dans Access : une colonne par champ, les lignes Champ, Table, Opération (Totaux), Tri, Afficher,
// Critères et Ou (qui s'allongent à la saisie) ; Ajouter à, Mise à jour ou Supprimer selon le type de requête. Champ, Critères,
// Ou et Mise à jour sont des ExpressionField (forme affichée, « … » vers le générateur) ; une cellule illisible bloque
// l'enregistrement. Le sélecteur au-dessus d'une colonne la sélectionne et la déplace (glisser) ; un champ glissé du volet des
// tables sur une colonne s'y insère.
import { useId, type DragEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExprErrorCode } from '../../shared/expr/ast';
import type { DisplayContext } from '../../shared/expr/localize';
import { oneLine, type QbeDesign, type QbeTotal } from '../../shared/query/qbe';
import { printSelect } from '../../shared/query/print';
import { QUERY_PARSE } from '../../shared/query/sql-parser';
import { ExpressionField } from '../expr/ExpressionField';
import { gridRows, type GridColumn, type QbeRow } from './qbe-edit';
import { FIELD_DRAG, type PaneBox } from './TablePane';

const TOTALS: QbeTotal[] = ['groupBy', 'sum', 'avg', 'min', 'max', 'count', 'stDev', 'var', 'first', 'last', 'expression', 'where'];
const COLUMN_DRAG = 'application/x-basecraft-column';
/** Grid cells parse as the SQL dialect does (qualified names, subqueries printed on one line). */
const CELL = { qualified: true, subquery: QUERY_PARSE.subquery, printSub: (q: Parameters<typeof printSelect>[0]) => oneLine(printSelect(q)) };
const FIELD = { ...CELL, aggregates: true, alias: true };
/** Empty columns shown after the last one, so that a new field can be typed (Access shows a wide grid). */
const SPARE = 2, MIN_COLUMNS = 6;

interface Props {
  design: QbeDesign; boxes: PaneBox[]; ctx: DisplayContext; readOnly: boolean; selected: number; invalid: Record<string, string>;
  /** Table Names off: no Table row. */
  tableRow: boolean;
  /** Append To's suggestions: the target table's fields. */
  targetFields: string[];
  onSelect(col: number): void;
  onCell(col: number, row: QbeRow, value: string | boolean): void;
  onField(col: number, canonical: string): void;
  onInvalid(key: string, code: ExprErrorCode | null): void;
  onDropField(col: number, alias: string, field: string): void;
  onMoveColumn(from: number, to: number): void;
}

/** Its cell key in the grid's error map. */
export const cellKey = (c: GridColumn | undefined, col: number, row: QbeRow): string => `${c?.uid ?? `new${col}`}:${row}`;

export function QbeGrid({ design, boxes, ctx, readOnly, selected, invalid, tableRow, targetFields, onSelect, onCell, onField, onInvalid, onDropField, onMoveColumn }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const cols = design.columns as GridColumn[];
  const count = Math.max(MIN_COLUMNS, cols.length + SPARE);
  const rows = gridRows(design).filter((r) => tableRow || r !== 'table');
  const fieldNames = [...new Set(boxes.flatMap((b) => b.fields.map((f) => f.name)))];
  const rowLabel = (r: QbeRow) => t(r === 'criteria0' ? 'query.row.criteria' : r.startsWith('criteria') ? 'query.row.or' : `query.row.${r}`);

  const dropOn = (col: number) => (e: DragEvent) => {
    const field = e.dataTransfer.getData(FIELD_DRAG), from = e.dataTransfer.getData(COLUMN_DRAG);
    if (readOnly || (!field && !from)) return;
    e.preventDefault();
    if (field) { const f = JSON.parse(field) as { alias: string; field: string }; onDropField(col, f.alias, f.field); }
    else if (Number(from) !== col && Number(from) < cols.length) onMoveColumn(Number(from), Math.min(col, cols.length - 1));
  };
  const accept = (e: DragEvent) => {
    if (!readOnly && (e.dataTransfer.types.includes(FIELD_DRAG) || e.dataTransfer.types.includes(COLUMN_DRAG))) e.preventDefault();
  };

  const cell = (c: GridColumn | undefined, i: number, r: QbeRow) => {
    const testId = `qbe-cell-${r}-${i}`;
    const label = t('query.cell', { row: rowLabel(r), n: i + 1 });
    const key = cellKey(c, i, r);
    const common = { 'data-testid': testId, 'aria-label': label, disabled: readOnly };
    const expr = (value: string | undefined, o: { criteria?: boolean; query: typeof CELL | typeof FIELD }, commit: (v: string) => void) => (
      <div className="qcell">
        <ExpressionField id={`${uid}-${key}`} testId={testId} label={label} value={value || undefined} criteria={o.criteria} ctx={ctx} fields={fieldNames}
          disabled={readOnly} error={invalid[key]} query={o.query} onCommit={(v) => commit(v ?? '')} onInvalid={(code) => onInvalid(key, code)} />
      </div>
    );
    const crit = /^criteria(\d+)$/.exec(r);
    if (crit) return expr(c?.criteria[Number(crit[1])], { criteria: true, query: CELL }, (v) => onCell(i, r, v));
    if (r === 'field') return expr(c?.field, { query: FIELD }, (v) => onField(i, v));
    if (!c?.field) return null; // an empty column shows only its Field and criteria cells (Access leaves the rest blank)
    switch (r) {
      case 'updateTo': return expr(c?.updateTo, { query: CELL }, (v) => onCell(i, r, v));
      case 'table':
        return (
          <select {...common} value={c?.table ?? ''} onChange={(e) => onCell(i, r, e.target.value)}>
            <option value="" />
            {boxes.map((b) => <option key={b.alias} value={b.alias}>{b.alias}</option>)}
          </select>
        );
      case 'total':
        return (
          <select {...common} value={c?.total ?? 'groupBy'} onChange={(e) => onCell(i, r, e.target.value)}>
            {TOTALS.map((x) => <option key={x} value={x}>{t(`query.total.${x}`)}</option>)}
          </select>
        );
      case 'sort':
        return (
          <select {...common} value={c?.sort ?? ''} onChange={(e) => onCell(i, r, e.target.value)}>
            <option value="">{t('query.sort.none')}</option>
            <option value="asc">{t('query.sort.asc')}</option>
            <option value="desc">{t('query.sort.desc')}</option>
          </select>
        );
      case 'show':
        return <input type="checkbox" {...common} checked={c.show} onChange={(e) => onCell(i, r, e.target.checked)} />;
      case 'deleteRole':
        return (
          <select {...common} value={c?.deleteRole ?? 'where'} onChange={(e) => onCell(i, r, e.target.value)}>
            <option value="from">{t('query.deleteRole.from')}</option>
            <option value="where">{t('query.deleteRole.where')}</option>
          </select>
        );
      case 'appendTo':
        return (
          <input {...common} list={`${uid}-target`} spellCheck={false} value={c?.appendTo ?? ''} onChange={(e) => onCell(i, r, e.target.value)} />
        );
    }
  };

  /** Arrows move between cells (Left/Right leave a text only from its edge; Up/Down never change a list, Alt+Down opens it);
   *  Ctrl+Shift+Left/Right move the column. Blank cells of an empty column are skipped. */
  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const el = e.target as HTMLElement;
    const m = /^qbe-cell-(\w+)-(\d+)$/.exec(el.dataset.testid ?? '');
    if (!m) return;
    const [row, col] = [m[1] as QbeRow, Number(m[2])];
    const table = e.currentTarget;
    const focus = (r: QbeRow, i: number) => {
      const next = table.querySelector<HTMLElement>(`[data-testid="qbe-cell-${r}-${i}"]`);
      next?.focus();
      if (next instanceof HTMLInputElement && next.type !== 'checkbox') next.select();
      return !!next;
    };
    const side = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (e.ctrlKey && e.shiftKey && side) {
      const to = col + side;
      if (readOnly || col >= cols.length || to < 0 || to >= cols.length) return;
      e.preventDefault();
      onMoveColumn(col, to);
      requestAnimationFrame(() => focus(row, to)); // the moved cell keeps the focus
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const text = el instanceof HTMLInputElement && el.type !== 'checkbox';
    if (side && text) {
      const i = el as HTMLInputElement;
      if (i.selectionStart !== i.selectionEnd || i.selectionStart !== (side < 0 ? 0 : i.value.length)) return;
    }
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!step && !side) return;
    e.preventDefault();
    for (let r = rows.indexOf(row) + step, i = col + side; r >= 0 && r < rows.length && i >= 0 && i < count; r += step, i += side) {
      if (focus(rows[r], i)) return;
    }
  };

  return (
    <div className="qbe-grid" data-testid="qbe-grid">
      <datalist id={`${uid}-target`}>{['*', ...targetFields].map((f) => <option key={f} value={f} />)}</datalist>
      <table className="qg" aria-label={t('query.grid')} onKeyDown={onKeyDown}
        onFocus={(e) => { const m = /^qbe-(?:cell-\w+|colsel)-(\d+)$/.exec((e.target as HTMLElement).dataset.testid ?? ''); if (m) onSelect(Number(m[1])); }}>
        <tbody>
          <tr className="colsel">
            <th />
            {Array.from({ length: count }, (_, i) => (
              <td key={cols[i]?.uid ?? `new${i}`} className={i === selected ? 'is-on' : ''} onDragOver={accept} onDrop={dropOn(i)}>
                <button tabIndex={-1} draggable={!readOnly && i < cols.length} data-testid={`qbe-colsel-${i}`} aria-label={t('query.column', { n: i + 1 })}
                  aria-pressed={i === selected} onClick={() => onSelect(i)}
                  onDragStart={(e) => { e.dataTransfer.setData(COLUMN_DRAG, String(i)); e.dataTransfer.effectAllowed = 'move'; }} />
              </td>
            ))}
          </tr>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row">{rowLabel(r)}</th>
              {Array.from({ length: count }, (_, i) => (
                <td key={cols[i]?.uid ?? `new${i}`} className={[i === selected && 'on', r === 'show' && 'c'].filter(Boolean).join(' ')}
                  onDragOver={accept} onDrop={dropOn(i)}>
                  {cell(cols[i], i, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
