import { describe, expect, it } from 'vitest';
import { ARRANGE_MENUS, arrangeItemEnabled, designerCommands, type ArrangeMenu } from './designer-commands';
import type { DesignerAction } from './designer-model';

describe('arrange commands', () => {
  it('arrange menus and their enabled items', () => {
    expect(ARRANGE_MENUS.align).toEqual(['alignToGrid', 'alignLeft', 'alignRight', 'alignTop', 'alignBottom']);
    expect(ARRANGE_MENUS.sizeSpace.at(-1)).toBe('toggleSnap');
    expect([arrangeItemEnabled('alignToGrid', 1), arrangeItemEnabled('alignLeft', 1), arrangeItemEnabled('alignLeft', 2)]).toEqual([true, false, true]);
    expect([arrangeItemEnabled('spaceVerticalEqual', 2), arrangeItemEnabled('spaceVerticalEqual', 3), arrangeItemEnabled('toggleSnap', 0)]).toEqual([false, true, true]); });
  it('arrange commands', () => { const got: DesignerAction[] = []; const menus: ArrangeMenu[] = [];
    const h = designerCommands((a) => got.push(a), (m) => menus.push(m), 2);
    h.bringToFront!(); h.sizeSpace!(); h.align!(); h.sendToBack!();
    expect(got).toEqual([{ type: 'arrange', op: 'bringToFront' }, { type: 'arrange', op: 'sendToBack' }]); expect(menus).toEqual(['sizeSpace', 'align']);
    const empty: ArrangeMenu[] = [];
    const none = designerCommands(() => {}, (m) => empty.push(m), 0);   // Aimanter à la grille reste accessible sans sélection
    expect(Object.keys(none)).toEqual(['sizeSpace']); none.sizeSpace!(); expect(empty).toEqual(['sizeSpace']); });
});
