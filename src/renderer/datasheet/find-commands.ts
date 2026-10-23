// Home › Find: Find opens the grid's search bar (Ctrl+F); Go To and Select are menus under their buttons.
import type { CommandHandlers } from '../shell/ribbon-model';

export type GoTo = 'first' | 'previous' | 'next' | 'last' | 'new';
export type SelectWhat = 'record' | 'all';

/** The row Go To lands on (`current`: the selected row, null without one; `count`: saved records), or 'new' for the new record. */
export function goToRow(where: GoTo, current: number | null, count: number): number | 'new' | null {
  if (where === 'new') return 'new';
  if (count === 0) return null;
  const at = current ?? 0;
  return where === 'first' ? 0 : where === 'last' ? count - 1 : where === 'next' ? Math.min(count - 1, at + 1) : Math.max(0, at - 1);
}

export function findCommands(env: { openSearch(): void; openMenu(menu: 'goTo' | 'select'): void }): CommandHandlers {
  return { find: () => env.openSearch(), goTo: () => env.openMenu('goTo'), selectMenu: () => env.openMenu('select') };
}
