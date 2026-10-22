// Mode Feuille de données : grille virtualisée (Glide), enregistrement par ligne comme Access, barre de navigation.
import {
  CompactSelection, DataEditor, GridCellKind, interpolateColors, type DataEditorRef, type EditableGridCell, type GridCell,
  type GridColumn, type GridKeyEventArgs, type GridSelection, type Item, type ProvideEditorCallback, type Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import {
  AlignLeft, ArrowDown, ArrowUp, Calendar, CircleAlert, Coins, Hash, Link, ListOrdered, Pencil, SquareCheck, Type, type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTranslation } from 'react-i18next';
import type { FieldErrorCode, SqlValue } from '../../shared/coerce';
import { toDisplay } from '../../shared/expr/localize';
import { MASK_TYPES, type FieldDef, type FieldType, type TableDesign } from '../../shared/field-types';
import { localeInfo } from '../../shared/locale-format';
import { api } from '../bridge';
import type { DocViewProps } from '../shell/DocumentTabs';
import { bcErrorCode, useErrorDialog, useModal } from '../shell/Modal';
import { registerCommands, registerModeGuard } from '../shell/ribbon-model';
import { defaultValues, fromEdit, inputCell, pasteAllowed, toCell } from './datasheet-cells';
import { installEditorCommitFix, isNonAsciiChar, openEditorWith } from './glide-keyboard';
import { maskedEditor } from './MaskedEditor';
import { NavigationBar } from './NavigationBar';
import { PageCache } from './page-cache';
import { RowBuffer } from './row-buffer';
import './datasheet.css';

installEditorCommitFix();

type Shape = { design: TableDesign; locale: string; cache: PageCache; defaults: SqlValue[] /* shown on the new record's row */ };
type Sort = { field: string; dir: 'asc' | 'desc' } | null;
type FieldError = { field: string; code: FieldErrorCode; message?: string; table?: string };

const ROW_HEIGHT = 30;
const HEADER_HEIGHT = 34;
const NO_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };
const LOADING: GridCell = { kind: GridCellKind.Loading, allowOverlay: false };
const cellSelection = (col: number, row: number): GridSelection =>
  ({ ...NO_SELECTION, current: { cell: [col, row], range: { x: col, y: row, width: 1, height: 1 }, rangeStack: [] } });
const rowOf = (s: GridSelection): number | null => s.current?.cell[1] ?? s.rows.first() ?? null;

const WIDTH: Record<FieldType, number> = { autoNumber: 80, shortText: 170, longText: 240, number: 110, currency: 120, dateTime: 150, yesNo: 80, hyperlink: 200 };
const TYPE_ICON: Record<FieldType, LucideIcon> = {
  autoNumber: ListOrdered, shortText: Type, longText: AlignLeft, number: Hash, currency: Coins, dateTime: Calendar, yesNo: SquareCheck, hyperlink: Link,
};
// Glide draws header icons from SVG strings: lucide icons, in the colour Glide gives for the header's state.
const sprite = (Icon: LucideIcon) => ({ bgColor }: { bgColor: string }) => renderToStaticMarkup(<Icon size={20} color={bgColor} strokeWidth={1.75} />);
const HEADER_ICONS = Object.fromEntries([
  ...Object.entries(TYPE_ICON).map(([type, Icon]) => [`bc-${type}`, sprite(Icon)]),
  ['bc-asc', sprite(ArrowUp)], ['bc-desc', sprite(ArrowDown)],
]);

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
function usePalette() {
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
function flushCellEditor(): void {
  if (document.querySelector('#portal .gdg-clip-region')) document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

export function DatasheetView({ tab, readOnly, dispatch }: DocViewProps) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const palette = usePalette();
  const editor = useRef<DataEditorRef>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const [sort, setSort] = useState<Sort>(null);
  const [selection, setSelection] = useState<GridSelection>(NO_SELECTION);
  const [error, setError] = useState<FieldError | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [refused, setRefused] = useState(false); // a write was refused as read-only (lock lost meanwhile)
  const [busy, setBusy] = useState(false); // a row is being saved: the grid is locked
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [version, bump] = useReducer((n: number) => n + 1, 0); // rows or pending edits changed: redraw
  const [, scrolled] = useReducer((n: number) => n + 1, 0);
  const [pencil, setPencil] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // Synchronous state (read right after an await, before React renders): saved rows count, new record's row shown.
  const rows = useRef({ count: 0, adding: false });
  const busyRef = useRef(false);
  const committing = useRef<Promise<boolean> | null>(null);
  const alive = useRef(true); // a page that fails after the tab closed shows nothing
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { if (!readOnly) setRefused(false); }, [readOnly]); // writable again (lock taken over)
  const ro = readOnly || refused;
  const live = useRef({ tab, shape, sort, selection, ro });
  live.current = { tab, shape, sort, selection, ro };
  const [buffer] = useState(() => new RowBuffer((rowid, changes) => {
    const name = live.current.tab.name; // renamed meanwhile: the row goes to the table under its new name
    return rowid === null ? api.rows.insert(name, changes) : api.rows.update(name, rowid, changes);
  }));
  const setRows = (patch: Partial<typeof rows.current>) => { Object.assign(rows.current, patch); bump(); };

  const dataError = (e: unknown) => { if (bcErrorCode(e) === 'unsupportedTable') setUnsupported(true); else void showError(e); };
  const writeError = async (e: unknown) => {
    if (bcErrorCode(e) === 'readOnly') setRefused(true);
    await showError(e);
  };

  const showFailure = (rowIndex: number, errors: FieldError[]) => {
    const err = errors[0];
    setError(err);
    const col = Math.max(0, live.current.shape?.design.fields.findIndex((x) => x.name === err.field) ?? 0);
    setSelection(cellSelection(col, rowIndex)); // Glide scrolls to it
  };

  /** Saves the pending row; true when nothing is left pending. One save at a time: a second call shares the first. */
  const commitRow = (): Promise<boolean> => {
    if (committing.current) return committing.current;
    if (!buffer.pending) return Promise.resolve(true);
    busyRef.current = true;
    setBusy(true);
    const run = async (): Promise<boolean> => {
      try {
        for (let p = buffer.pending; p; p = buffer.pending) { // edits typed during a save are saved next
          const out = await buffer.commit();
          if (out.status === 'failed') { showFailure(p.rowIndex, out.errors); return false; }
          if (out.status === 'saved') {
            const cache = live.current.shape?.cache;
            cache?.set(p.rowIndex, { rowid: out.rowid, values: out.values });
            if (p.rowid === null) setRows({ count: rows.current.count + 1, adding: false });
            if (live.current.sort) cache?.invalidate(); // sorted: the row takes its place (never shown twice or lost at a page edge)
            setError(null);
          }
        }
        return true;
      } catch (e) {
        await writeError(e);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
        bump();
      }
    };
    const promise = run();
    committing.current = promise;
    void promise.finally(() => { if (committing.current === promise) committing.current = null; });
    return promise;
  };

  const discardRow = () => {
    if (busyRef.current) return;
    buffer.discard();
    setError(null);
    setRows({ adding: false });
  };

  // Structure saved (reloadToken): a pending row is saved first, then design, rows and columns are read again. A rename
  // (name only) changes nothing here: saves and page requests already use the live name, the pending row stays.
  useEffect(() => {
    let current = true;
    void (async () => {
      if (buffer.pending && !(await commitRow())) {
        buffer.discard(); // its columns may no longer exist: never written to the new structure
        setError(null);
        await modal.confirm({ titleKey: 'datasheet.discardTitle', messageKey: 'datasheet.shapeChanged', params: { name: tab.name }, buttons: ['ok'] });
      }
      try {
        const name = tab.name;
        const [design, settings, count] = await Promise.all([api.tables.design(name), api.app.getSettings(), api.rows.count(name)]);
        const defaults = await defaultValues(design, settings.region);
        if (!current) return;
        const cache = new PageCache((offset, limit) => {
          const s = live.current.sort;
          return api.rows.page(live.current.tab.name, { offset, limit, ...(s ? { sort: s } : {}) });
        });
        cache.onLoaded(() => { if (alive.current) bump(); });
        cache.onError((e) => { if (alive.current && live.current.shape?.cache === cache) dataError(e); });
        live.current.sort = null;
        setSort(null);
        setSelection(NO_SELECTION);
        setError(null);
        setUnsupported(false);
        rows.current = { count, adding: false };
        setShape({ design, locale: settings.region, cache, defaults });
      } catch (e) {
        if (current) dataError(e);
      }
    })();
    return () => { current = false; };
  }, [tab.reloadToken]);

  // Rows changed elsewhere (an import appended to this table): the rows and their count are read again; structure, sort and a
  // pending row stay.
  useEffect(() => {
    if (!tab.dataToken) return;
    void api.rows.count(tab.name).then((count) => {
      if (!alive.current) return;
      live.current.shape?.cache.invalidate();
      setRows({ count });
    }, dataError);
  }, [tab.dataToken]);

  const dirty = buffer.pending !== null;
  useEffect(() => { dispatch({ type: 'setDirty', id: tab.id, dirty }); }, [dirty, tab.id, dispatch]);
  useEffect(() => () => dispatch({ type: 'setDirty', id: tab.id, dirty: false }), [tab.id, dispatch]);

  /** Every selection change made by the user: leaving the pending row saves it (a failure brings the selection back). */
  const select = (sel: GridSelection) => {
    const { count, adding } = rows.current;
    const next = rowOf(sel);
    const p = buffer.pending;
    if (p && next !== p.rowIndex) {
      setSelection(sel);
      void commitRow();
      return;
    }
    if (!p && adding && next !== count) {
      setRows({ adding: false }); // the empty new record goes; the trailing row moves up into its place
      if (next !== null && next > count && sel.current) sel = cellSelection(sel.current.cell[0], count);
    }
    setSelection(sel);
  };

  /** Brings a row into view. ponytail: Glide's scrollTo overshoots to the end for far rows (6.0.3), so its scroller
   *  (internal class name) is moved directly, vertically only. */
  const scrollToRow = (row: number) => {
    const sc = wrap.current?.querySelector<HTMLElement>('.dvn-scroller');
    if (!sc) return;
    const top = row * ROW_HEIGHT, view = sc.clientHeight - HEADER_HEIGHT;
    if (top < sc.scrollTop) sc.scrollTop = top;
    else if (top + ROW_HEIGHT > sc.scrollTop + view) sc.scrollTop = top + ROW_HEIGHT - view;
  };

  const firstEditable = () => Math.max(0, live.current.shape?.design.fields.findIndex((x) => x.props.type !== 'autoNumber') ?? 0);

  const onCellEdited = ([col, row]: Item, cell: EditableGridCell) => {
    const { shape: s, ro: locked } = live.current;
    if (!s || locked || busyRef.current) return;
    const p = buffer.pending;
    if (p && p.rowIndex !== row) return; // cannot happen: the other rows are read-only while a row is pending
    const { count, adding } = rows.current;
    if (row >= count && !(adding && row === count)) return;
    if (row < count && !s.cache.fresh(row)) return; // cannot happen: rows shown from before a reload are read-only
    const rowid = row === count ? null : s.cache.get(row)?.rowid;
    if (rowid === undefined) return;
    const field = s.design.fields[col];
    buffer.edit(row, rowid, field.name, fromEdit(field, cell));
    bump();
  };

  const onRowAppended = async (): Promise<undefined> => {
    if (live.current.ro || !(await commitRow())) return undefined; // a row in error keeps the focus
    if (!rows.current.adding) setRows({ adding: true });
    return undefined; // Glide then selects the new row (the old trailing row's index) and opens its editor
  };

  /** Rowids of the given rows (ascending), as shown; rows never loaded are read in one request. */
  const rowids = async (indices: number[]): Promise<number[]> => {
    const { shape: s, tab: doc, sort: order } = live.current;
    const ids = indices.map((i) => s?.cache.get(i)?.rowid);
    if (ids.some((x) => x === undefined)) {
      const lo = indices[0];
      const page = await api.rows.page(doc.name, { offset: lo, limit: indices[indices.length - 1] - lo + 1, ...(order ? { sort: order } : {}) });
      indices.forEach((i, k) => { ids[k] ??= page.rows[i - lo]?.rowid; });
    }
    return ids.filter((x): x is number => x !== undefined);
  };

  const deleteRecords = async (sel: GridSelection = live.current.selection) => {
    const { shape: s, tab: doc } = live.current;
    if (!s || live.current.ro || busyRef.current) return;
    const { count, adding } = rows.current;
    const range = sel.current?.range;
    const picked = sel.rows.length ? sel.rows.toArray() : range ? Array.from({ length: range.height }, (_, k) => range.y + k) : [];
    const targets = picked.filter((i) => i < count + (adding ? 1 : 0));
    if (!targets.length) return;
    const p = buffer.pending;
    const dropsPending = p !== null && targets.includes(p.rowIndex);
    if (p && !dropsPending && !(await commitRow())) return;
    const existing = targets.filter((i) => i < rows.current.count);
    if (existing.length) {
      let cascade = false; // a real key with ON DELETE CASCADE (A2-R14): the question says the related records go too
      try { cascade = (await api.relations.cascadeChildren(doc.name)).length > 0; } catch { /* asked without */ }
      const r = await modal.confirm({ titleKey: 'datasheet.deleteTitle', messageKey: cascade ? 'datasheet.deleteCascade' : 'datasheet.delete', params: { count: existing.length }, buttons: ['yes', 'no'], defaultButton: 'no' });
      if (r !== 'yes') return;
    }
    if (dropsPending || targets.includes(rows.current.count)) discardRow();
    if (!existing.length) return;
    try {
      const r = await api.rows.delete(doc.name, await rowids(existing));
      if (!r.ok) await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'datasheet.related', params: { table: r.table }, buttons: ['ok'] });
    } catch (e) {
      await writeError(e);
    }
    try {
      const n = await api.rows.count(doc.name);
      s.cache.invalidate();
      setRows({ count: n });
      setSelection(n ? cellSelection(sel.current?.cell[0] ?? firstEditable(), Math.min(existing[0], n - 1)) : NO_SELECTION);
    } catch (e) {
      dataError(e);
    }
  };

  const onDelete = (sel: GridSelection): boolean => {
    if (live.current.ro || busyRef.current) return false;
    if (sel.rows.length) { void deleteRecords(sel); return false; } // rows picked with the row selectors: delete them
    const r = sel.current?.range; // cells of one row: cleared, as edits of that row
    const p = buffer.pending;
    return r !== undefined && r.height === 1 && (p === null || p.rowIndex === r.y);
  };

  const onPaste = (_target: Item, values: readonly (readonly string[])[]): boolean => {
    if (live.current.ro || busyRef.current) return false;
    if (pasteAllowed({ rows: values.length })) return true;
    void modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'datasheet.pasteOneRow', buttons: ['ok'] });
    return false;
  };

  const onKeyDown = (e: GridKeyEventArgs) => {
    // Escape outside a cell editor (which handles its own) cancels the pending row, as in Access.
    if (e.key === 'Escape' && buffer.pending && !busyRef.current) { e.cancel(); discardRow(); }
  };

  const sortBy = async (dir: 'asc' | 'desc' | null) => {
    const { shape: s, selection: sel } = live.current;
    const col = sel.current?.cell[0] ?? sel.columns.first();
    if (!s || (dir !== null && col === undefined)) return;
    if (!(await commitRow())) return;
    const next: Sort = dir === null ? null : { field: s.design.fields[col!].name, dir };
    live.current.sort = next; // read by the page requests that follow, before React renders
    setSort(next);
    s.cache.invalidate();
    bump();
  };

  const newRecord = async () => {
    if (live.current.ro) return;
    editor.current?.focus();
    await editor.current?.appendRow(live.current.selection.current?.cell[0] ?? firstEditable());
  };

  /** Before the view goes (mode change, tab, base or window closed): the pending row is saved, else discarding is asked. */
  const leave = async (): Promise<boolean> => {
    flushCellEditor();
    if (await commitRow()) return true;
    const r = await modal.confirm({ titleKey: 'datasheet.discardTitle', messageKey: 'datasheet.discard', params: { name: live.current.tab.name }, buttons: ['yes', 'no'], defaultButton: 'no' });
    if (r !== 'yes') return false;
    if (busyRef.current) return false; // cannot happen: the question waits for the save
    discardRow();
    return true;
  };

  const save = async () => { flushCellEditor(); await commitRow(); };

  const cmds = useRef({ newRecord, deleteRecords, sortBy, leave, save });
  cmds.current = { newRecord, deleteRecords, sortBy, leave, save };
  useEffect(() => {
    // Read-only (also a refused write before the session says so): the ribbon offers no record command.
    const offCommands = registerCommands(tab.id, {
      ...(ro ? {} : { newRecord: () => cmds.current.newRecord(), deleteRecord: () => cmds.current.deleteRecords() }),
      sortAsc: () => cmds.current.sortBy('asc'),
      sortDesc: () => cmds.current.sortBy('desc'),
      sortClear: () => cmds.current.sortBy(null),
      save: () => cmds.current.save(),
    });
    return offCommands;
  }, [tab.id, ro]);
  useEffect(() => registerModeGuard(tab.id, () => cmds.current.leave()), [tab.id]);

  const getCellContent = useCallback(([col, row]: Item): GridCell => {
    if (!shape) return LOADING;
    const field = shape.design.fields[col];
    const p = buffer.pending;
    const isNew = row >= rows.current.count;
    const saved = isNew ? undefined : shape.cache.get(row);
    if (!isNew && !saved) return LOADING;
    // Read-only: during a save, other rows while one is pending, rows from before a sort/delete until their page lands.
    const locked = ro || busyRef.current || (p !== null && p.rowIndex !== row) || (!isNew && !shape.cache.fresh(row));
    let cell: GridCell;
    if (p?.rowIndex === row && Object.hasOwn(p.changes, field.name)) cell = inputCell(field, p.changes[field.name], { readOnly: locked });
    else if (isNew && field.props.type === 'autoNumber') cell = { kind: GridCellKind.Text, data: '', displayData: t('datasheet.newRecord'), allowOverlay: false, readonly: true };
    else {
      // The new record's row shows the default values, as stored values (display and edit text).
      const value = isNew ? shape.defaults[col] ?? null : saved?.values[col] ?? null;
      cell = toCell(field, value, { locale: shape.locale, lang: i18n.language.startsWith('fr') ? 'fr' : 'en', readOnly: locked });
    }
    if (error && p?.rowIndex === row && error.field === field.name) cell = { ...cell, themeOverride: { bgCell: palette.error } };
    return cell;
  }, [shape, ro, busy, error, palette, version, t, i18n.language]); // busy, version: Glide redraws when the function changes

  const cellAt = useRef(getCellContent);
  cellAt.current = getCellContent;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isNonAsciiChar(e) || !e.target || !wrap.current?.contains(e.target as Node) || document.querySelector('#portal .gdg-clip-region')) return;
      const at = live.current.selection.current?.cell;
      const c = at && cellAt.current(at);
      if (c?.kind !== GridCellKind.Text || c.readonly) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openEditorWith(e.target, e.key);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // A field with an input mask gets the masked editor. Glide gives only the cell: the edited one is the selected one.
  const provideEditor = useCallback<ProvideEditorCallback<GridCell>>((cell) => {
    const col = live.current.selection.current?.cell[0];
    const fd = col === undefined ? undefined : live.current.shape?.design.fields[col];
    if (cell.kind !== GridCellKind.Text || cell.readonly || !fd?.props.inputMask || !MASK_TYPES.includes(fd.props.type)) return undefined;
    return maskedEditor(fd.props.inputMask) as ReturnType<ProvideEditorCallback<GridCell>>;
  }, []);

  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => (buffer.pending?.rowIndex === row ? { bgCell: palette.pending, bgCellMedium: palette.pending } : undefined),
    [palette, version],
  );

  const columns = useMemo<GridColumn[]>(() => (shape?.design.fields ?? []).map((fd) => {
    const dir = sort?.field === fd.name ? sort.dir : null;
    return {
      id: fd.name, title: fd.props.caption || fd.name, width: widths[fd.name] ?? WIDTH[fd.props.type], icon: `bc-${dir ?? fd.props.type}`,
      ...(dir ? { themeOverride: { bgIconHeader: palette.theme.accentColor } } : {}),
    };
  }), [shape, sort, widths, palette]);

  // The pending row's selector shows a pencil (drawn over the canvas, where Glide draws the row number).
  useLayoutEffect(() => {
    const p = buffer.pending;
    const box = wrap.current?.getBoundingClientRect();
    const b = p && box ? editor.current?.getBounds(-1, p.rowIndex) : undefined;
    const next = box && b && b.y >= box.top + HEADER_HEIGHT - 1 && b.y + b.height <= box.bottom + 1
      ? { left: b.x - box.left, top: b.y - box.top, width: b.width, height: b.height } : null;
    setPencil((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  });

  if (unsupported) return <div className="doc-empty muted" role="alert" data-testid="datasheet-unsupported">{t('datasheet.unsupported')}</div>;
  if (!shape) return <div className="datasheet" aria-busy />;

  const { count, adding } = rows.current;
  const errorField = error && shape.design.fields.find((x) => x.name === error.field);
  /** The rule's own message, else the code's, which quotes a broken rule in its display form. */
  const errorMessage = (e: FieldError, fd: FieldDef | null | undefined) => {
    if (e.message) return e.message;
    if (e.code !== 'validation') return t(`fieldError.${e.code}`, { table: e.table ?? '' });
    const rule = fd?.props.validationRule ?? '';
    let shown = rule;
    try { shown = toDisplay(rule, { lang: i18n.language.startsWith('fr') ? 'fr' : 'en', region: localeInfo(shape.locale) }, { criteria: true }); } catch { /* as stored */ }
    return t('fieldError.validation', { rule: shown });
  };
  return (
    <div className="datasheet">
      <div className="ds-grid" ref={wrap} role="region" aria-label={t('datasheet.grid', { name: tab.name })} aria-busy={busy} data-testid="datasheet">
        <DataEditor ref={editor} theme={palette.theme} columns={columns} rows={count + (adding ? 1 : 0)} headerIcons={HEADER_ICONS}
          getCellContent={getCellContent} provideEditor={provideEditor} getRowThemeOverride={getRowThemeOverride} getCellsForSelection
          gridSelection={selection} onGridSelectionChange={select} onCellEdited={onCellEdited}
          onRowAppended={ro ? undefined : onRowAppended} trailingRowOptions={ro ? undefined : { hint: t('datasheet.nav.new'), tint: true }}
          onDelete={onDelete} onPaste={onPaste} onKeyDown={onKeyDown} keybindings={{ search: false }}
          rowMarkers={{ kind: 'clickable-number', width: 44 }} rowHeight={ROW_HEIGHT} headerHeight={HEADER_HEIGHT} smoothScrollX smoothScrollY
          onColumnResize={(c, w) => { const id = c.id; if (id !== undefined) setWidths((x) => ({ ...x, [id]: w })); }}
          onVisibleRegionChanged={() => { if (buffer.pending) scrolled(); }}
          width="100%" height="100%" />
        {pencil && (
          <div className="ds-pencil" style={{ ...pencil, background: palette.pending }} title={t('datasheet.pending')}>
            <Pencil className="ic ic-sm" aria-hidden />
          </div>
        )}
      </div>
      {error && (
        <div className="ds-error" role="alert" data-testid="datasheet-error">
          <CircleAlert className="ic ic-sm" aria-hidden />
          {t('datasheet.fieldError', { field: errorField?.props.caption || error.field, message: errorMessage(error, errorField) })}
        </div>
      )}
      <NavigationBar current={rowOf(selection)} count={count} canAdd={!ro}
        onGo={(row) => {
          const col = selection.current?.cell[0] ?? firstEditable();
          select(cellSelection(col, row));
          // Once the selection is rendered (Glide selects the first visible cell when it gets the focus without one), and
          // the scroll too (Glide's focus scrolls by a delta from its last rendered position).
          requestAnimationFrame(() => { scrollToRow(row); requestAnimationFrame(() => editor.current?.focus()); });
        }}
        onNew={() => void newRecord()} />
    </div>
  );
}
