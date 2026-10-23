// Menus Filtrer par sélection / Options de filtre avancées, sous leur bouton du ruban ; partagés par la feuille de données et les formulaires.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlValue } from '../../shared/coerce';
import type { FieldDef, FieldType } from '../../shared/field-types';
import type { SelectionFilter } from './filter-model';

/** selection: the field, stored value and text shown of the selected cell or control. */
export type FilterMenuState = { kind: 'selection'; field: FieldDef; value: SqlValue; shown: string; x: number; y: number } | { kind: 'advanced'; x: number; y: number };

/** Contains / Does Not Contain are offered on text, as in Access. */
const TEXT_TYPES: FieldType[] = ['shortText', 'longText', 'hyperlink'];
/** The Selection menu's entries (kind, label key): a blank value offers Is [Not] Blank. */
const selectionItems = (field: FieldDef, value: SqlValue): [SelectionFilter, string][] => value === null
  ? [['equals', 'isNull'], ['notEquals', 'isNotNull']]
  : [['equals', 'equals'], ['notEquals', 'notEquals'], ...(TEXT_TYPES.includes(field.props.type) ? [['contains', 'contains'], ['notContains', 'notContains']] as [SelectionFilter, string][] : [])];

/** Takes the focus when shown; a click outside closes it (onClose()), Escape too (onClose(true): the view takes the focus back). */
export function FilterMenu({ menu, hasFilter, onPick, onClear, onClose }: { menu: FilterMenuState; hasFilter: boolean; onPick(kind: SelectionFilter): void; onClear(): void; onClose(escaped?: boolean): void }) {
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
