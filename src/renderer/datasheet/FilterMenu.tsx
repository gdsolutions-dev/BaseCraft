// Menus Filtrer par sélection / Options de filtre avancées / Filtrer (le menu de la colonne et sa liste de valeurs), sous leur
// bouton du ruban ou l'en-tête de colonne ; partagés par la feuille de données et les formulaires.
import { Check, Minus } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlValue } from '../../shared/coerce';
import { MAX_CRITERIA_CHARS } from '../../shared/api';
import { lookupOf, type FieldDef } from '../../shared/field-types';
import { isTextField, listCriteria, type SelectionFilter } from './filter-model';

/** selection: the field, stored value and text shown of the selected cell or control. field (Home › Filter, a column header's
 *  drop-down): `list` its values but blanks (null: no list, R14), `blanks` whether it has some, `ticked` the values its list
 *  criterion keeps (null: the blanks), 'all' when the field has no criterion this menu built. */
export type FilterMenuState = { kind: 'selection'; field: FieldDef; value: SqlValue; shown: string; x: number; y: number } | { kind: 'advanced'; x: number; y: number }
  | { kind: 'field'; field: FieldDef; x: number; y: number; list: { value: SqlValue; shown: string }[] | null; blanks: boolean; ticked: SqlValue[] | 'all' };
/** What a list's OK set on a field (listCriteria): its criterion, the values it keeps (`not`: those it leaves out). */
export type BuiltList = { criteria: string; values: SqlValue[]; not: boolean };

/** The labels of the sorts and typed filters: a Lookup field's are its list text's. ponytail: Yes/No takes the numbers'. */
const labelsOf = (f: FieldDef): 'text' | 'number' | 'date' => (lookupOf(f) ? 'text' : f.props.type === 'dateTime' ? 'date'
  : ['number', 'currency', 'autoNumber', 'yesNo'].includes(f.props.type) ? 'number' : 'text');
/** The Selection menu's entries (kind, label key): a blank value offers Is [Not] Blank. */
const selectionItems = (field: FieldDef, value: SqlValue): [SelectionFilter, string][] => value === null
  ? [['equals', 'isNull'], ['notEquals', 'isNotNull']]
  : [['equals', 'equals'], ['notEquals', 'notEquals'], ...(isTextField(field) ? [['contains', 'contains'], ['notContains', 'notContains']] as [SelectionFilter, string][] : [])];

/** Takes the focus when shown; a click outside closes it (onClose()), Escape too (onClose(true): the view takes the focus back).
 *  hasFilter: any filter (advanced), a criterion on the field (field). onValues: the list's OK (null: every value ticked). */
export function FilterMenu({ menu, hasFilter, onPick, onClear, onClose, onSort, onClearField, onTyped, onValues }: { menu: FilterMenuState; hasFilter: boolean;
  onPick(kind: SelectionFilter): void; onClear(): void; onClose(escaped?: boolean): void;
  onSort?(dir: 'asc' | 'desc'): void; onClearField?(): void; onTyped?(): void; onValues?(built: BuiltList | null): void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close.current(); };
    window.addEventListener('mousedown', down);
    return () => window.removeEventListener('mousedown', down);
  }, [menu]);
  const keys = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return (
    <div ref={ref} className="ctxmenu card" role="menu" aria-label={t('datasheet.filter.menu')} data-testid="filter-menu"
      style={{ left: menu.x, top: menu.y }} onKeyDown={keys}>
      {menu.kind === 'advanced' ? (
        <button role="menuitem" data-testid="filter-menu-clear" disabled={!hasFilter} onClick={onClear}>{t('datasheet.filter.clear')}</button>
      ) : menu.kind === 'field' ? (
        <FieldItems key={menu.field.name} menu={menu} filtered={hasFilter} onSort={(d) => onSort?.(d)} onClearField={() => onClearField?.()} onTyped={() => onTyped?.()}
          onValues={(b) => onValues?.(b)} onCancel={() => onClose(true)} />
      ) : (
        selectionItems(menu.field, menu.value).map(([kind, key]) => (
          <button key={kind} role="menuitem" data-testid={`filter-menu-${kind}`} onClick={() => onPick(kind)}>
            {t(`datasheet.filter.${key}`, { value: menu.shown })}
          </button>
        ))
      )}
    </div>
  );
}

/** The column menu: the two sorts, the field's criterion cleared, the typed filters, then the list (R14) with its OK. */
function FieldItems({ menu, filtered, onSort, onClearField, onTyped, onValues, onCancel }: { menu: Extract<FilterMenuState, { kind: 'field' }>; filtered: boolean;
  onSort(dir: 'asc' | 'desc'): void; onClearField(): void; onTyped(): void; onValues(b: BuiltList | null): void; onCancel(): void }) {
  const { t } = useTranslation();
  const all = [...(menu.blanks ? [null] : []), ...(menu.list ?? []).map((x) => x.value)];
  const [ticked, setTicked] = useState<SqlValue[]>(() => (menu.ticked === 'all' ? all : menu.ticked));
  const [tooLong, setTooLong] = useState(false);
  const ok = () => {
    const b = listCriteria(menu.field, all, ticked);
    if (b && b.criteria.length > MAX_CRITERIA_CHARS) setTooLong(true); // neither form fits: say so, the filter stays as it was
    else onValues(b);
  };
  const toggle = (v: SqlValue) => setTicked((ts) => (ts.includes(v) ? ts.filter((x) => x !== v) : all.filter((x) => x === v || ts.includes(x))));
  const labels = labelsOf(menu.field);
  const box = (testId: string, on: boolean | 'mixed', label: string, click: () => void) => (
    <button key={testId} role="menuitemcheckbox" aria-checked={on} data-testid={testId} onClick={click}>
      <span className="filter-box" aria-hidden>{on === 'mixed' ? <Minus /> : on && <Check />}</span>{/* drawn: no input inside a button (aria-checked says it) */}
      <span title={label}>{label}</span>
    </button>
  );
  return (
    <>
      <button role="menuitem" data-testid="filter-sort-asc" onClick={() => onSort('asc')}>{t(`datasheet.filter.sortAsc.${labels}`)}</button>
      <button role="menuitem" data-testid="filter-sort-desc" onClick={() => onSort('desc')}>{t(`datasheet.filter.sortDesc.${labels}`)}</button>
      <div className="ctxmenu-sep" />
      <button role="menuitem" data-testid="filter-clear-field" disabled={!filtered} onClick={onClearField}>
        {t('datasheet.filter.clearField', { field: menu.field.props.caption || menu.field.name })}
      </button>
      <button role="menuitem" data-testid="filter-typed" onClick={onTyped}>{t(`datasheet.filter.typed.${labels}`)}</button>
      {menu.list && (
        <>
          <div className="ctxmenu-sep" />
          <div className="filter-values">
            {box('filter-all', ticked.length === all.length ? true : ticked.length ? 'mixed' : false, t('datasheet.filter.all'), () => setTicked(ticked.length === all.length ? [] : all))}
            {menu.blanks && box('filter-blanks', ticked.includes(null), t('datasheet.filter.blanks'), () => toggle(null))}
            {menu.list.map((x, i) => box(`filter-value-${i}`, ticked.includes(x.value), x.shown, () => toggle(x.value)))}
          </div>
          {tooLong && <div role="alert" data-testid="filter-too-long" className="filter-error">{t('datasheet.filter.tooLong')}</div>}
          <div className="filter-buttons">
            <button type="button" className="btn btn-sm btn-primary" data-testid="filter-ok" disabled={!ticked.length} onClick={ok}>{t('datasheet.filter.ok')}</button>
            <button type="button" className="btn btn-sm" data-testid="filter-cancel" onClick={onCancel}>{t('datasheet.filter.cancel')}</button>
          </div>
        </>
      )}
    </>
  );
}
