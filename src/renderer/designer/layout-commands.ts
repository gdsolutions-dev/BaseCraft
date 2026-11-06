// Ruban › Disposition (Tableau) : Empilé, Tabulaire, insérer, sélectionner, déplacer -> actions du concepteur.
// Sans contrôle sélectionné rien n'est enregistré ; sans membre de disposition dans la sélection, seuls Empilé et Tabulaire le sont
// (le ruban désactive les autres).
import { cellAt, cellItemName, layoutOf, MARGIN_PRESETS, PADDING_PRESETS, readLayouts, sectionRef } from '../../shared/design/layout';
import { canMerge, createLayout, insertCells, mergeCells, splitCell, membersOf, moveRow, removeLayout, selectionIn, slotOf } from '../../shared/design/layout-edit';
import type { DesignDoc } from '../../shared/design/model';
import type { CommandHandlers } from '../shell/ribbon-model';
import { documentKind, type DesignerAction, type DesignerState, type Selection } from './designer-model';
import { read, targetsFor, writes, type Write } from './format-commands';

export type LayoutCommand = 'stacked' | 'tabular' | 'removeLayout' | 'insertAbove' | 'insertBelow' | 'insertLeft' | 'insertRight'
  | 'selectLayout' | 'selectColumn' | 'selectRow' | 'moveUp' | 'moveDown' | 'merge' | 'splitVertically' | 'splitHorizontally';

/** L'en-tête de formulaire (form-def, que le concepteur n'importe pas) : l'hôte formulaire le fournit. */
export interface FormHeader { shown(doc: DesignDoc): boolean; toggle(doc: DesignDoc): DesignDoc }

const CREATE: LayoutCommand[] = ['stacked', 'tabular'];
const MEMBER: LayoutCommand[] = ['removeLayout', 'insertAbove', 'insertBelow', 'insertLeft', 'insertRight',
  'selectLayout', 'selectColumn', 'selectRow', 'moveUp', 'moveDown'];
const SELECT: LayoutCommand[] = ['selectLayout', 'selectColumn', 'selectRow'];
const SCOPE = { selectLayout: 'layout', selectColumn: 'column', selectRow: 'row' } as const;
const WHERE = { insertAbove: 'above', insertBelow: 'below', insertLeft: 'left', insertRight: 'right' } as const;

const names = (s: DesignerState): string[] => (s.selection.kind === 'controls' ? s.selection.names : []);
const cellsOf = (s: DesignerState) => (s.selection.kind === 'controls' ? s.selection.cells ?? [] : []);
/** Le premier contrôle sélectionné qui appartient à une disposition. */
const firstMember = (s: DesignerState): string | undefined => names(s).find((n) => layoutOf(s.doc, n));

/** The selected cells of one layout: members' cells plus the selected empty cells; null when none, or when they span layouts. */
function pickedCells(s: DesignerState): { layout: string; slots: { row: number; col: number }[]; control: string | null } | null {
  const layouts = readLayouts(s.doc);
  const found = [
    ...names(s).flatMap((n) => { const l = layoutOf(s.doc, n); const c = l?.cells.find((x) => x.control === n || (x.control !== null && x.control.toLowerCase() === n.toLowerCase())); return l && c ? [{ layout: l.id, row: c.row, col: c.col }] : []; }),
    ...(s.selection.kind === 'controls' ? s.selection.cells ?? [] : []),
  ];
  if (!found.length || found.some((f) => f.layout !== found[0].layout)) return null;
  const l = layouts.find((x) => x.id === found[0].layout);
  const control = found.map((f) => l && cellAt(l, f.row, f.col)?.control).find((c) => c) ?? null;
  return { layout: found[0].layout, slots: found, control };
}
const mergeable = (s: DesignerState): boolean => { const p = pickedCells(s); return !!p && canMerge(s.doc, p.layout, p.slots); };
const splittable = (s: DesignerState): boolean => { const p = pickedCells(s); return !!p && p.slots.length === 1; };

/** Changes when the set of registered layout handlers changes: the views re-register on it. */
export const layoutKey = (s: DesignerState): string => `${firstMember(s) ? 2 : names(s).length ? `1${cellsOf(s).length ? 'c' : ''}` : cellsOf(s).length ? 3 : 0}${mergeable(s) ? 'm' : ''}${splittable(s) ? 's' : ''}`;

/** The four Arrange popups (Gridlines, Control Margins, Control Padding, Anchoring), opened by their command. */
export type LayoutPopup = 'layoutGridlines' | 'controlMargins' | 'controlPadding' | 'anchoring';
const POPUPS: LayoutPopup[] = ['layoutGridlines', 'controlMargins', 'controlPadding', 'anchoring'];

const SIDES = ['Top', 'Bottom', 'Left', 'Right'] as const;
type Side = (typeof SIDES)[number];
export type GridlinePreset = 'none' | 'both' | 'horizontal' | 'vertical' | 'top' | 'bottom' | 'outline';
const PRESET_SIDES: Record<Exclude<GridlinePreset, 'outline'>, Side[]> = {
  none: [], both: [...SIDES], horizontal: ['Top', 'Bottom'], vertical: ['Left', 'Right'], top: ['Top'], bottom: ['Bottom'],
};

/** One value written to the same property of every selected control and empty cell (Margins and Anchoring never reach cells); null without a target. */
function writeAll(s: DesignerState, values: Record<string, unknown>): DesignerAction | null {
  const kind = documentKind(s);
  return writes(Object.entries(values).map(([name, value]) => ({ targets: targetsFor(s.doc, s.selection, name).map((x) => x.t), name, value })), kind);
}
export const marginsAction = (s: DesignerState, preset: keyof typeof MARGIN_PRESETS): DesignerAction | null =>
  writeAll(s, Object.fromEntries(SIDES.map((x) => [`${x}Margin`, MARGIN_PRESETS[preset]])));
export const paddingAction = (s: DesignerState, preset: keyof typeof PADDING_PRESETS): DesignerAction | null =>
  writeAll(s, Object.fromEntries(SIDES.map((x) => [`${x}Padding`, PADDING_PRESETS[preset]])));
export const anchorAction = (s: DesignerState, h: 'left' | 'right' | 'both', v: 'top' | 'bottom' | 'both'): DesignerAction | null =>
  writeAll(s, { HorizontalAnchor: h, VerticalAnchor: v });
export const gridlineColorAction = (s: DesignerState, color: string): DesignerAction | null => writeAll(s, { GridlineColor: color });

/** Width and Style only touch the sides that are not transparent. */
function visibleSides(s: DesignerState, name: 'Width' | 'Style', value: unknown): DesignerAction | null {
  const kind = documentKind(s);
  return writes(SIDES.map((x): Write => ({ name: `Gridline${name}${x}`, value,
    targets: targetsFor(s.doc, s.selection, `GridlineStyle${x}`).filter((t) => read(t, `GridlineStyle${x}`, kind) !== 'transparent').map((t) => t.t) })), kind);
}
export const gridlineWidthAction = (s: DesignerState, w: number): DesignerAction | null => visibleSides(s, 'Width', w);
export const gridlineStyleAction = (s: DesignerState, style: 'solid' | 'dashed' | 'dotted'): DesignerAction | null => visibleSides(s, 'Style', style);

/** The sides of each selected control that lie on the bounding rectangle of the selected cells of its layout. */
function outlineSides(s: DesignerState): Map<string, Set<Side>> {
  const picks = new Map<string, { row: number; col: number; rows: number; cols: number; key: string }[]>();
  const layouts = readLayouts(s.doc);
  const add = (layout: string, row: number, col: number) => {
    const c = cellAt(layouts.find((l) => l.id === layout)!, row, col);
    if (c) picks.set(layout, [...(picks.get(layout) ?? []), { row: c.row, col: c.col, rows: c.rowSpan ?? 1, cols: c.colSpan ?? 1, key: (c.control ?? cellItemName({ layout, row: c.row, col: c.col })).toLowerCase() }]);
  };
  for (const n of names(s)) { const l = layoutOf(s.doc, n); const c = l?.cells.find((x) => x.control?.toLowerCase() === n.toLowerCase()); if (l && c) add(l.id, c.row, c.col); }
  for (const c of cellsOf(s)) add(c.layout, c.row, c.col);
  const out = new Map<string, Set<Side>>();
  for (const cells of picks.values()) {
    const r0 = Math.min(...cells.map((c) => c.row)), c0 = Math.min(...cells.map((c) => c.col));
    const r1 = Math.max(...cells.map((c) => c.row + c.rows - 1)), c1 = Math.max(...cells.map((c) => c.col + c.cols - 1));
    for (const c of cells) out.set(c.key, new Set<Side>([
      ...(c.row === r0 ? ['Top' as const] : []), ...(c.row + c.rows - 1 === r1 ? ['Bottom' as const] : []),
      ...(c.col === c0 ? ['Left' as const] : []), ...(c.col + c.cols - 1 === c1 ? ['Right' as const] : [])]));
  }
  return out;
}

/** Gridlines: the chosen sides become solid (a visible style already there is kept), the others transparent. */
export function gridlinesAction(s: DesignerState, preset: GridlinePreset): DesignerAction | null {
  const kind = documentKind(s);
  const outline = preset === 'outline' ? outlineSides(s) : null;
  const list: Write[] = [];
  for (const x of SIDES) {
    const name = `GridlineStyle${x}`;
    const ts = targetsFor(s.doc, s.selection, name);
    const on = (t: (typeof ts)[number]) => (outline ? (outline.get((t.t.kind === 'control' ? t.t.name : t.t.kind === 'cell' ? cellItemName(t.t) : '').toLowerCase()) ?? new Set<Side>(SIDES)).has(x) : PRESET_SIDES[preset as keyof typeof PRESET_SIDES].includes(x));
    const hidden = (t: (typeof ts)[number]) => read(t, name, kind) === 'transparent';
    list.push({ name, value: 'solid', targets: ts.filter((t) => on(t) && hidden(t)).map((t) => t.t) },
      { name, value: 'transparent', targets: ts.filter((t) => !on(t) && !hidden(t)).map((t) => t.t) });
  }
  return writes(list, kind);
}

/** null : la commande ne s'applique pas à la sélection. */
export function layoutAction(state: DesignerState, cmd: LayoutCommand, formHeader?: FormHeader): DesignerAction | null {
  if (cmd === 'stacked' || cmd === 'tabular') {
    const sel = names(state);
    if (!sel.length) return null;
    const form = documentKind(state) === 'form';
    return { type: 'edit', apply: (doc: DesignDoc) => {
      // l'en-tête de formulaire masqué est affiché dans la même opération (une seule annulation)
      const base = cmd === 'tabular' && form && formHeader && !formHeader.shown(doc) ? formHeader.toggle(doc) : doc;
      const header = base.sections.find((s) => s.kind === (form ? 'formHeader' : 'pageHeader'));
      const headerRef = header ? sectionRef(header) : '';
      return createLayout(base, membersOf(base, sel, cmd === 'tabular' ? headerRef : undefined), cmd, { headerSection: headerRef });
    } };
  }
  if (cmd === 'merge' || cmd === 'splitVertically' || cmd === 'splitHorizontally') {
    const p = pickedCells(state);
    if (!p || (cmd === 'merge' ? !canMerge(state.doc, p.layout, p.slots) : p.slots.length !== 1)) return null;
    const l = readLayouts(state.doc).find((x) => x.id === p.layout)!;
    const at = cmd === 'merge' ? { row: Math.min(...p.slots.map((x) => cellAt(l, x.row, x.col)!.row)), col: Math.min(...p.slots.map((x) => cellAt(l, x.row, x.col)!.col)) }
      : { row: cellAt(l, p.slots[0].row, p.slots[0].col)!.row, col: cellAt(l, p.slots[0].row, p.slots[0].col)!.col };
    const selection: Selection = { kind: 'controls', names: p.control ? [p.control] : [], ...(p.control ? {} : { cells: [{ layout: p.layout, ...at }] }) };
    return { type: 'edit', selection, apply: (doc) => (cmd === 'merge' ? mergeCells(doc, p.layout, p.slots)
      : splitCell(doc, p.layout, p.slots[0], cmd === 'splitVertically' ? 'vertical' : 'horizontal')) };
  }
  const m = firstMember(state);
  if (cmd in SCOPE) {   // from the first member's slot, else from the first selected empty cell
    const from = (m && slotOf(state.doc, m)) || cellsOf(state)[0];
    if (!from) return null;
    const r = selectionIn(state.doc, from, SCOPE[cmd as keyof typeof SCOPE]);
    return { type: 'select', selection: { kind: 'controls', names: r.names, ...(r.cells.length ? { cells: r.cells } : {}) } };
  }
  if (!m) return null;
  if (cmd === 'removeLayout') return { type: 'edit', apply: (doc) => { const l = layoutOf(doc, m); return l ? removeLayout(doc, l.id) : doc; } };
  if (cmd === 'moveUp' || cmd === 'moveDown') return { type: 'edit', apply: (doc) => moveRow(doc, m, cmd === 'moveUp' ? -1 : 1) };
  return { type: 'edit', apply: (doc) => insertCells(doc, m, WHERE[cmd as keyof typeof WHERE]) };
}

/** À fusionner dans l'unique `registerCommands` de la vue hôte, qui se réenregistre quand `layoutKey` change. */
export function layoutCommands(current: () => DesignerState, dispatch: (a: DesignerAction) => void, formHeader?: FormHeader,
  openPopup?: (id: LayoutPopup) => void): CommandHandlers {
  const s = current();
  const h: CommandHandlers = {};
  const cmds: LayoutCommand[] = [...(names(s).length ? CREATE : []), ...(firstMember(s) ? MEMBER : cellsOf(s).length ? SELECT : []),
    ...(mergeable(s) ? ['merge' as const] : []), ...(splittable(s) ? ['splitVertically' as const, 'splitHorizontally' as const] : [])];
  for (const cmd of cmds) h[cmd] = () => { const a = layoutAction(current(), cmd, formHeader); if (a) dispatch(a); };
  // popups: Gridlines and Padding with a control or an empty cell; Margins and Anchoring need a control
  if (openPopup) for (const id of POPUPS) if (names(s).length || (cellsOf(s).length && (id === 'layoutGridlines' || id === 'controlPadding'))) h[id] = () => openPopup(id);
  return h;
}
