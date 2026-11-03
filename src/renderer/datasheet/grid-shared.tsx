// Partagé par les deux grilles Glide : la feuille de données d'une table et celle d'un formulaire (thème, sélection, défilement,
// éditeur ouvert, touches d'Access (Entrée, flèches, F2, comportement en entrée), icônes d'en-tête, largeurs des colonnes, crayon de la ligne modifiée).
import {
  CompactSelection, GridCellKind, interpolateColors, type DataEditorRef, type GridCell, type GridColumn, type GridSelection, type Item, type Theme,
} from '@glideapps/glide-data-grid';
import {
  AlignLeft, ArrowDown, ArrowUp, Calendar, Coins, Funnel, Hash, Link, ListOrdered, Pencil, SquareCheck, Type, type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FieldType } from '../../shared/field-types';
import { currentSettings } from '../settings-store';
import { editKey, nextCell, type EditMove } from './edit-keys';
import { editCellFrom, isDrivenEntry, isNonAsciiChar, openEditorWith, openEntry } from './glide-keyboard';

export const ROW_HEIGHT = 30;
export const HEADER_HEIGHT = 34;
export const NO_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };
export const LOADING: GridCell = { kind: GridCellKind.Loading, allowOverlay: false };
export const cellSelection = (col: number, row: number): GridSelection =>
  ({ ...NO_SELECTION, current: { cell: [col, row], range: { x: col, y: row, width: 1, height: 1 }, rangeStack: [] } });
export const rowOf = (s: GridSelection): number | null => s.current?.cell[1] ?? s.rows.first() ?? null;

const TYPE_ICON: Record<FieldType, LucideIcon> = {
  autoNumber: ListOrdered, shortText: Type, longText: AlignLeft, number: Hash, currency: Coins, dateTime: Calendar, yesNo: SquareCheck, hyperlink: Link,
};
// Glide draws header icons from SVG strings: lucide icons, in the colour Glide gives for the header's state.
const sprite = (Icon: LucideIcon) => ({ bgColor }: { bgColor: string }) => renderToStaticMarkup(<Icon size={20} color={bgColor} strokeWidth={1.75} />);
export const HEADER_ICONS = Object.fromEntries([
  ...Object.entries(TYPE_ICON).map(([type, Icon]) => [`bc-${type}`, sprite(Icon)]),
  ['bc-asc', sprite(ArrowUp)], ['bc-desc', sprite(ArrowDown)], ['bc-filter', sprite(Funnel)],
]);

/** A column's header icon: the funnel when filtered (the sort arrow over it when sorted too), else the arrow, else the field
 *  type's icon (none without a field); sorted or filtered: in the accent colour. */
export function headerDecor(type: FieldType | null, dir: 'asc' | 'desc' | null, filtered: boolean, accent: string): Partial<GridColumn> {
  const icon = filtered ? 'bc-filter' : dir ? `bc-${dir}` : type ? `bc-${type}` : undefined;
  return {
    ...(icon ? { icon } : {}), ...(filtered && dir ? { overlayIcon: `bc-${dir}` } : {}),
    ...(dir || filtered ? { themeOverride: { bgIconHeader: accent } } : {}),
  };
}

/** Glide's theme from the app's tokens; mixes are opaque (the canvas has nothing below to blend with). */
function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--bc-${name}`).trim();
  const [surface, surface2, text, muted, border, accent] = ['surface', 'surface-2', 'text', 'text-muted', 'border', 'accent'].map(v);
  const mix = (color: string, over: string, amount: number) => interpolateColors(over, color, amount);
  const theme: Partial<Theme> = {
    accentColor: accent, accentFg: v('accent-contrast'), accentLight: mix(accent, surface, 0.14),
    textDark: text, textMedium: muted, textLight: muted, textBubble: text, textHeader: text, textHeaderSelected: v('accent-contrast'),
    bgIconHeader: muted, fgIconHeader: surface,
    bgCell: surface, bgCellMedium: surface2, bgHeader: surface2, bgHeaderHasFocus: mix(text, surface2, 0.08), bgHeaderHovered: mix(text, surface2, 0.05),
    bgBubble: surface2, bgBubbleSelected: surface, bgSearchResult: mix(accent, surface, 0.14),
    borderColor: mix(border, surface, 0.7), horizontalBorderColor: mix(border, surface, 0.7), headerBottomBorderColor: border, drilldownBorder: border,
    linkColor: accent, fontFamily: v('font'), baseFontStyle: '13px', headerFontStyle: '600 12px', markerFontStyle: '11px', editorFontSize: '13px',
    cellHorizontalPadding: 10, headerIconSize: 16,
  };
  return { theme, pending: mix(v('warning'), surface, 0.12), error: mix(v('danger'), surface, 0.16) };
}

/** Rebuilt when the theme changes (Options, or the system's light/dark when the theme follows it). */
export function usePalette() {
  const [palette, setPalette] = useState(readPalette);
  useEffect(() => {
    const update = () => setPalette(readPalette());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  }, []);
  return palette;
}

/** A cell editor is open (Glide's overlay; one in the window at a time, in the tab shown). */
export const cellEditorOpen = (): boolean => document.querySelector('#portal .gdg-clip-region') !== null;
/** An open cell editor keeps its text until it closes: a click outside closes it and keeps the text (Glide), so does this. */
export function flushCellEditor(): void {
  if (cellEditorOpen()) document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

/** Brings a row into view. ponytail: Glide's scrollTo overshoots to the end for far rows (6.0.3), so its scroller (internal
 *  class name) is moved directly, vertically only. */
export function scrollGridToRow(wrap: HTMLElement | null, row: number, rowHeight = ROW_HEIGHT): void {
  const sc = wrap?.querySelector<HTMLElement>('.dvn-scroller');
  if (!sc) return;
  const top = row * rowHeight, view = sc.clientHeight - HEADER_HEIGHT;
  if (top < sc.scrollTop) sc.scrollTop = top;
  else if (top + rowHeight > sc.scrollTop + view) sc.scrollTop = top + rowHeight - view;
}

export interface EditKeysEnv {
  cellAt(item: Item): GridCell; selected(): GridSelection['current'];
  cols(): number; rows(): number;            // rows: the new record's row included when it can be added
  moveTo(item: Item): void;                  // the grid's own selection path (a row change saves the row first)
  pastEnd?(dir: 1 | -1): boolean;            // FormDatasheet in a subform: onTabOut
}
let owner: HTMLElement | null = null; // the grid that had the focus or a click last: its editor's keys are its own (#portal is shared)

/** Access's keys in a Glide grid (O2 R3–R9): Enter, Tab, F2, Left / Right and, with « Début / Fin du champ », typing on the
 *  selected cell; through editKey / nextCell. Glide's selected cell is navigation mode, its open editor edit mode. Not taken:
 *  keys while an IME composes, the lookup editor's but plain Enter and Tab (F2 and its list's), Up / Down (Glide's records), Space (opens the editor). Typing
 *  with « Champ entier » is Glide's; « é » and the like open the editor through openEditorWith (Glide's types ASCII only). */
export function useEditKeys(wrap: RefObject<HTMLElement>, env: RefObject<EditKeysEnv>): void {
  useEffect(() => {
    // a click too: a click on the selected cell opens its editor, the focus going straight to it
    const onFocus = (e: Event) => { if (wrap.current?.contains(e.target as Node)) owner = wrap.current; };
    const onKey = (e: KeyboardEvent) => {
      const w = wrap.current, g = env.current, target = e.target;
      // untrusted: our own synthetic keys (openEditorWith, editCellFrom, the commit fix's)
      if (!e.isTrusted || e.defaultPrevented || e.isComposing || e.keyCode === 229 || !w || !g || !(target instanceof Element)) return;
      // the grid took the focus back while its editor stays open (a late focus() after a click opened it): the key is the
      // editor's, never Glide's type-to-edit (which keeps the editor's first text and drops this key)
      const stray = owner === w && w.contains(target) && target.closest('[data-testid="data-grid-canvas"]') ? openEntry() : null;
      const t: Element = stray ?? target;
      if (stray) {
        stray.focus();
        if (!isDrivenEntry(t, e)) { typeInto(e); return; }
      }
      const editing = owner === w && isDrivenEntry(t, e);
      if (!editing && !(w.contains(t) && t.closest('[data-testid="data-grid-canvas"]'))) return;
      const sel = g.selected();
      if (!sel) return;
      const at = sel.cell;
      const cell = g.cellAt(at);
      const text = cell.kind === GridCellKind.Text && !cell.readonly ? cell.data : null;
      const entry = editing ? (t as HTMLInputElement | HTMLTextAreaElement) : null;
      const s = currentSettings();
      const m: EditMove = e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey ? { to: 'field', dir: e.shiftKey ? -1 : 1, stopAtEnds: false } // Access's Tab wraps
        : editKey({
          key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, composing: false,
          caret: entry ? { start: entry.selectionStart ?? 0, end: entry.selectionEnd ?? 0, length: entry.value.length }
            : text === null ? null : { start: 0, end: text.length, length: text.length },
          editing, grid: true, continuous: false, multiline: false,
        }, s);
      if (m.to === 'pass') {
        if (stray) typeInto(e);
        if (editing || text === null) return;
        // Alt alone is a shortcut, never typing (Glide would open the editor with the letter, whatever the mode); AltGr is Ctrl+Alt
        if (e.key.length === 1 && e.altKey && !e.ctrlKey) { e.stopImmediatePropagation(); return; }
        const typed = e.key.length === 1 && e.key !== ' ' && !e.metaKey && e.ctrlKey === e.altKey;
        if (s.enterFieldBehavior !== 'selectAll' && text !== '' && (typed || ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey
          && sel.range.width * sel.range.height === 1))) { // a range: Glide's onDelete clears it
          e.preventDefault();
          e.stopImmediatePropagation();
          editCellFrom(t, s.enterFieldBehavior, e.key);
        } else if (isNonAsciiChar(e)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openEditorWith(t, e.key);
        }
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (m.to === 'caret') { if (editing || text !== null) editCellFrom(t, m.at); return; } // a Yes/No cell: F2 does nothing
      const move = (): void => {
        if (m.to === 'field') {
          const n = nextCell([at[0], at[1]], m.dir, g.cols(), g.rows(), m.stopAtEnds);
          if (n) g.moveTo(n); else if (!m.stopAtEnds) g.pastEnd?.(m.dir);
        } else if (m.to === 'record') {
          const row = at[1] + m.dir;
          if (row >= 0 && row < g.rows()) g.moveTo([at[0], row]);
        }
      };
      // an open editor: saved first, one timeout later (after the timeouts of the keys typed just before, as the commit fix);
      // closed meanwhile (a click on another cell came first), the click has moved: not this key
      if (editing) setTimeout(() => { if (cellEditorOpen()) { flushCellEditor(); move(); } }, 0);
      else move();
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pointerdown', onFocus, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('pointerdown', onFocus, true);
      window.removeEventListener('keydown', onKey, true);
      if (owner === wrap.current) owner = null;
    };
  }, []);
}

/** A character, Backspace or Delete applied to the focused entry as typed there (execCommand, as editCellFrom); other keys left. */
function typeInto(e: KeyboardEvent): void {
  const ch = e.key.length === 1 && !e.metaKey && e.ctrlKey === e.altKey; // AltGr is Ctrl+Alt
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  if (!ch && !(plain && (e.key === 'Backspace' || e.key === 'Delete'))) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  document.execCommand(ch ? 'insertText' : e.key === 'Backspace' ? 'delete' : 'forwardDelete', false, ch ? e.key : undefined);
}

/** Column widths the user dragged, by column id (others: their default), and Glide's onColumnResize. */
export function useColumnWidths(): [Record<string, number>, (c: GridColumn, w: number) => void] {
  const [widths, setWidths] = useState<Record<string, number>>({});
  return [widths, (c, w) => { const id = c.id; if (id !== undefined) setWidths((x) => ({ ...x, [id]: w })); }];
}

/** The modified row's selector shows a pencil, drawn over the canvas where Glide draws the row number (null: none). */
export function useRowPencil(editor: RefObject<DataEditorRef>, wrap: RefObject<HTMLElement>, row: number | null) {
  const [pencil, setPencil] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const box = wrap.current?.getBoundingClientRect();
    const b = row !== null && box ? editor.current?.getBounds(-1, row) : undefined;
    const next = box && b && b.y >= box.top + HEADER_HEIGHT - 1 && b.y + b.height <= box.bottom + 1
      ? { left: b.x - box.left, top: b.y - box.top, width: b.width, height: b.height } : null;
    setPencil((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  });
  return pencil;
}

export function RowPencil({ at, background, title }: { at: { left: number; top: number; width: number; height: number }; background: string; title: string }) {
  return (
    <div className="ds-pencil" style={{ ...at, background }} title={title} data-testid="grid-pencil">
      <Pencil className="ic ic-sm" aria-hidden />
    </div>
  );
}
