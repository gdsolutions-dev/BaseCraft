// Partagé par les deux grilles Glide : la feuille de données d'une table et celle d'un formulaire (thème, sélection, défilement,
// éditeur ouvert, frappe d'un caractère non ASCII, icônes d'en-tête, largeurs des colonnes, crayon de la ligne modifiée).
import {
  CompactSelection, GridCellKind, interpolateColors, type DataEditorRef, type GridCell, type GridColumn, type GridSelection, type Item, type Theme,
} from '@glideapps/glide-data-grid';
import {
  AlignLeft, ArrowDown, ArrowUp, Calendar, Coins, Funnel, Hash, Link, ListOrdered, Pencil, SquareCheck, Type, type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FieldType } from '../../shared/field-types';
import { isNonAsciiChar, openEditorWith } from './glide-keyboard';

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

/** An open cell editor keeps its text until it closes: a click outside closes it and keeps the text (Glide), so does this. */
export function flushCellEditor(): void {
  if (document.querySelector('#portal .gdg-clip-region')) document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

/** Brings a row into view. ponytail: Glide's scrollTo overshoots to the end for far rows (6.0.3), so its scroller (internal
 *  class name) is moved directly, vertically only. */
export function scrollGridToRow(wrap: HTMLElement | null, row: number): void {
  const sc = wrap?.querySelector<HTMLElement>('.dvn-scroller');
  if (!sc) return;
  const top = row * ROW_HEIGHT, view = sc.clientHeight - HEADER_HEIGHT;
  if (top < sc.scrollTop) sc.scrollTop = top;
  else if (top + ROW_HEIGHT > sc.scrollTop + view) sc.scrollTop = top + ROW_HEIGHT - view;
}

/** Glide opens an editor by typing only for ASCII keys: « é » and the like on an editable text cell open it through
 *  openEditorWith. `cellAt` and `selected` are read when the key comes (refs). */
export function useNonAsciiTyping(wrap: RefObject<HTMLElement>, cellAt: RefObject<(item: Item) => GridCell>, selected: () => Item | undefined): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isNonAsciiChar(e) || !e.target || !wrap.current?.contains(e.target as Node) || document.querySelector('#portal .gdg-clip-region')) return;
      const at = selected();
      const c = at && cellAt.current?.(at);
      if (c?.kind !== GridCellKind.Text || c.readonly) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openEditorWith(e.target, e.key);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
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
