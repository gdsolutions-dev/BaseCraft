// The base's sort order (bc_meta options: `sortOrder` applied, `sortOrderPending` chosen and waiting for Compact and Repair, as in Access).
import type { DatabaseSync } from 'node:sqlite';
import { isSortOrder, type SortOrderId } from '../../shared/sort-orders';
import { readOptions, updateOptions } from './file-format';

export interface SortOrderState { applied: SortOrderId; pending: SortOrderId | null }

/** Untrusted file content: a missing, unknown or unreadable value is `legacy` (a base made before the option; also a plain SQLite file). */
export function readSortOrder(db: DatabaseSync): SortOrderState {
  let o: Record<string, unknown>;
  try { o = readOptions(db); } catch { return { applied: 'legacy', pending: null }; }
  const applied = isSortOrder(o.sortOrder) ? o.sortOrder : 'legacy';
  return { applied, pending: isSortOrder(o.sortOrderPending) && o.sortOrderPending !== applied ? o.sortOrderPending : null };
}

/** Chooses the order the next Compact and Repair applies (the applied one: nothing waits). */
export function setPendingSortOrder(db: DatabaseSync, id: SortOrderId): void {
  updateOptions(db, (o) => { if (id === readSortOrder(db).applied) delete o.sortOrderPending; else o.sortOrderPending = id; });
}

/** Compact and Repair: the pending order becomes the applied one. Returns the state before, to undo a failed compact. */
export function applyPendingSortOrder(db: DatabaseSync): SortOrderState {
  const before = readSortOrder(db);
  if (before.pending) updateOptions(db, (o) => { o.sortOrder = before.pending; delete o.sortOrderPending; });
  return before;
}

/** Puts back what applyPendingSortOrder changed (the compact failed). */
export function restoreSortOrder(db: DatabaseSync, s: SortOrderState): void {
  updateOptions(db, (o) => { o.sortOrder = s.applied; if (s.pending) o.sortOrderPending = s.pending; else delete o.sortOrderPending; });
}
