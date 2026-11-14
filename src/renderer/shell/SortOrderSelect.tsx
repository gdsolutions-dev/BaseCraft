// The sort orders of a base (C7), as File › Options lists them: General – Legacy, General, then one per language (named by the browser, in the UI language).
import { useTranslation } from 'react-i18next';
import { SORT_ORDER_LOCALES, SORT_ORDERS, type SortOrderId } from '../../shared/sort-orders';

export function useSortOrderName(): (id: SortOrderId) => string {
  const { t, i18n } = useTranslation();
  return (id) => {
    if (id === 'legacy') return t('options.general.sortOrderLegacy');
    if (id === 'general') return t('options.general.sortOrderGeneral');
    if (id === 'spanishTraditional') return t('options.general.sortOrderSpanishTraditional');
    try { return new Intl.DisplayNames(i18n.language, { type: 'language' }).of(SORT_ORDER_LOCALES[id]) ?? id; } catch { return id; }
  };
}

export function SortOrderSelect(p: { label: string; value: SortOrderId; testid: string; disabled?: boolean; onChange(id: SortOrderId): void }) {
  const name = useSortOrderName();
  return (
    <label>
      <span>{p.label}</span>
      <select data-testid={p.testid} value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value as SortOrderId)}>
        {SORT_ORDERS.map((id) => <option key={id} value={id}>{name(id)}</option>)}
      </select>
    </label>
  );
}
