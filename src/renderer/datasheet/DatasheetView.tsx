// Mode Feuille de données : grille virtualisée (Glide), enregistrement par ligne comme Access, tri, filtres, barre de navigation.
import {
  CompactSelection, DataEditor, GridCellKind, type DataEditorRef, type DrawCellCallback, type EditableGridCell, type GridCell,
  type GridColumn, type GridKeyEventArgs, type GridSelection, type Item, type ProvideEditorCallback, type ProvideEditorCallbackResult,
  type Rectangle, type TextCell, type Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldFilter, LookupData, QueryRef, RowPage, RowRef, RowWriteResult } from '../../shared/api';
import type { CellInput, FieldErrorCode, SqlValue } from '../../shared/coerce';
import { FORMATS_BY_TYPE } from '../../shared/expr/format';
import { toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { LOOKUP_TYPES, lookupOf, MASK_TYPES, sameName, serverComputed, type FieldDef, type TableDesign } from '../../shared/field-types';
import { localeInfo, parseDecimal } from '../../shared/locale-format';
import { lookupFor, writableColumn, type RecordSourceRef, type SourceInfo } from '../../shared/record-source';
import { api } from '../bridge';
import type { DocViewProps } from '../shell/DocumentTabs';
import { ExpressionBuilder } from '../expr/ExpressionBuilder';
import { bcErrorCode, useErrorDialog, useModal } from '../shell/Modal';
import { chooseMoreExport, exportSource } from '../exchange/export';
import type { ExportFormat } from '../../shared/exchange';
import { registerCommands, registerCommandStates, registerModeGuard, type CommandId } from '../shell/ribbon-model';
import { RibbonPopup } from '../designer/RibbonPopup';
import { design } from '../design/entry';
import { DATA_EVENTS } from '../../shared/macro/data-macro';
import { currentBaseOptions, currentUi } from '../shell/startup';
import type { TableFieldsEnv, ValidationItem } from '../table-fields/table-fields-commands';
import { defaultValues, editText, fromEdit, inputCell, lookupList, measureIn, pasteAllowed, texts, toCell, truncateNumber, type LookupList } from './datasheet-cells';
import { activeFilter, NO_FILTER, selectionCriteria, withCriteria, type FilterState, type SelectionFilter } from './filter-model';
import { installEditorCommitFix } from './glide-keyboard';
import { datasheetLook } from './datasheet-look';
import { columnWidthPx, layoutSavable, rowHeightPx, storedPx, toTwips, withQuerySheet, withQueryWidths } from './sheet-layout';
import { parseSheetLayout, type SheetLayout } from '../../shared/sheet-layout';
import { leaveSheetLayout } from '../form/FormRunView';
import { passThroughOf } from '../../shared/query/definition';
import { currentSettings, fourDigitYear } from '../settings-store';
import {
  cellEditorOpen, cellSelection, flushCellEditor, HEADER_HEIGHT, HEADER_ICONS, headerDecor, LOADING, NO_SELECTION, rowOf, RowPencil, scrollGridToRow,
  useColumnWidths, useEditKeys, usePalette, useRowPencil, type EditKeysEnv,
} from './grid-shared';
import { findCommands, goToRow, matchText, replaceText, type GoTo } from './find-commands';
import { FindDialog, type FindTab } from './FindDialog';
import { SpellingDialog, type SpellAnswer } from './SpellingDialog';
import { applyChange, wordsOf } from '../../shared/spelling';
import { ZoomBox } from './ZoomBox';
import { SizeBox, UnhideBox } from './SizeBox';
import { FormatBox, Swatches, type SheetFormat } from './SheetColors';
import { EMBEDDED_FONTS } from '../../shared/fonts';
import { columnOrder, mapSelection, orderedNames } from './column-order';
import { FONT_SIZES } from '../designer/units';
import { TOTAL_LABEL, totalFnsFor, totalOf, totalsLayout, type TotalFn } from './totals';
import type { FindOptions } from '../form/form-instances';
import { FilterMenu, type BuiltList, type FilterMenuState } from './FilterMenu';
import { fieldMenu } from './filter-menu-data';
import { hasLookupEditor, lookupEditor } from './LookupEditor';
import { maskedEditor } from './MaskedEditor';
import { NavigationBar } from './NavigationBar';
import { MAX_LOADED_ROWS, PageCache } from './page-cache';
import { confirmDelete, fieldErrorParams, showRelatedRefusal } from './record-messages';
import { RowBuffer, type CommitOutcome } from './row-buffer';
import { askWriteConflict, recordText, showRecordDeleted } from '../shell/WriteConflictDialog';
import { onDataRefresh } from '../shell/data-refresh';
import './datasheet.css';

installEditorCommitFix();

/** A query's datasheet: its columns (`editable`: writableColumn, B4 R2). */
type SourceShape = { info: SourceInfo; editable: boolean[] };
type Shape = { design: TableDesign; locale: string; year4: boolean; cache: PageCache; defaults: SqlValue[] /* shown on the new record's row */; src?: SourceShape;
  /** C1 R7: a linked table its file does not let us write (WITHOUT ROWID, or held by another session). */ fixed?: true };
type Sort = { field: string; dir: 'asc' | 'desc' } | null;
type FieldError = { field: string; code: FieldErrorCode; message?: string; table?: string };
/** Lookup fields' lists, by field name (a field whose list is empty or gone is shown and edited as a plain field). */
type Lookups = Map<string, { list: LookupList; editor: ProvideEditorCallbackResult<TextCell> }>;





/** The lists of the design's Lookup fields, read once per view (and again on a reload or when the tab comes back). `editList`:
 *  « Edit List Items » of a value list that allows it (null: none, BaseCraft Runtime). */
async function loadLookups(read: (fd: FieldDef) => Promise<LookupData> | null, design: TableDesign, locale: string, editList: { open(field: string): void; disabled(): boolean } | null): Promise<Lookups> {
  const fields = design.fields.filter((fd) => lookupOf(fd));
  // A list that cannot be read is no list (raw values shown): one bad source never blocks the datasheet.
  const got = await Promise.all(fields.map(async (fd) => [fd, await (read(fd) ?? Promise.resolve(null)).catch(() => null)] as const));
  const out: Lookups = new Map();
  for (const [fd, data] of got) {
    const l = lookupOf(fd)!;
    if (!data || !hasLookupEditor(l, data.rows.length)) continue;
    const list = lookupList(data);
    out.set(fd.name, {
      list,
      editor: lookupEditor(list, {
        label: fd.props.caption || fd.name, edit: (v) => editText(fd, v, locale), listRows: l.listRows, listWidth: l.listWidth,
        ...(l.kind === 'values' && l.allowValueListEdits && editList ? { editList: { open: () => editList.open(fd.name), disabled: editList.disabled } } : {}),
      }),
    });
  }
  return out;
}

/** A query's column (SourceField) as a field of the grid. */
const columnOf = (f: SourceInfo['fields'][number]): FieldDef => ({ name: f.name, props: f.props });
/** Idle time before a query's rows are counted (Access counts its recordset in the background). */
const COUNT_IDLE_MS = 1500;

/**
 * Without `source`: a table's datasheet (rows.*, tables.design). With `source` (a query, A3): its rows through sources.page
 * with `params` (kept for the tab's life); writes only through an updatable source (sources.save: its key table and, through a
 * join, its 'one' tables, B4), only in its writable columns; a source that is not updatable is read-only (no new record,
 * `query.readOnly` in the navigation bar). A row without its key record (an outer join's) is read-only (R5).
 */
export interface DatasheetProps extends DocViewProps { source?: Exclude<RecordSourceRef, { kind: 'table' }>; params?: Record<string, CellInput> }

export function DatasheetView({ tab, active, readOnly, dispatch, source, params, designOpen, tabs, link }: DatasheetProps) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const palette = usePalette();
  const settings0 = useMemo(() => currentSettings(), []); // read when the view opens (O2 R1)
  // Home › Text Formatting: this view's font (bold, italic, underline, size) over the Options' one, and the alignment picked per field.
  // Kept with the table or query (sheetLayout, with the other state below) when the « save layout? » question is answered Yes.
  const [fontOver, setFontOver] = useState<Partial<Pick<typeof settings0, 'datasheetFontSize' | 'datasheetFontWeight' | 'datasheetFontItalic' | 'datasheetFontUnderline'>>>({});
  // Font, font colour, background and gridline colours of this view (undefined: the theme's own)
  const [skin, setSkin] = useState<{ font?: string; text?: string; back?: string; grid?: string }>({});
  const [aligns, setAligns] = useState<Record<string, 'left' | 'center' | 'right'>>({});
  const look = useMemo(() => datasheetLook({ ...settings0, ...fontOver }), [settings0, fontOver]);
  const [gridlines, setGridlines] = useState({ horizontal: look.horizontal, vertical: look.vertical }); // Quadrillage (ribbon): this view's lines
  const checkTruncated = useMemo(() => currentBaseOptions().checkTruncatedNumbers, []); // read when the view opens (R13)
  const fontFamily = skin.font ? `"${skin.font}", ${EMBEDDED_FONTS.find((f) => f.family === skin.font)?.generic ?? 'sans-serif'}` : palette.theme.fontFamily;
  const measure = useMemo(() => measureIn(`${look.fontStyle} ${fontFamily}`), [look, fontFamily]);
  const theme = useMemo(() => ({
    ...palette.theme, baseFontStyle: look.fontStyle, editorFontSize: `${look.fontPx}px`, fontFamily,
    ...(skin.text ? { textDark: skin.text } : {}),
    ...(skin.back ? { bgCell: skin.back, bgCellMedium: skin.back } : {}),
    ...(skin.grid ? { borderColor: skin.grid, horizontalBorderColor: skin.grid } : {}),
    ...(gridlines.horizontal ? {} : { horizontalBorderColor: skin.back ?? palette.theme.bgCell }),
  }), [palette, look, gridlines.horizontal, skin, fontFamily]);
  // Underline (O2 R12): Glide draws the cell, then a 1 px line under the text of a Text cell. ponytail: one line, no wrapping of long text
  const drawUnderline = useCallback<DrawCellCallback>(({ ctx, cell, theme: th, rect }, draw) => {
    draw();
    if (cell.kind !== GridCellKind.Text || !cell.displayData) return;
    ctx.font = `${th.baseFontStyle} ${th.fontFamily}`;
    const w = Math.min(ctx.measureText(cell.displayData).width, rect.width - 2 * th.cellHorizontalPadding);
    const x = cell.contentAlign === 'right' ? rect.x + rect.width - th.cellHorizontalPadding - w
      : cell.contentAlign === 'center' ? rect.x + (rect.width - w) / 2 : rect.x + th.cellHorizontalPadding;
    ctx.fillStyle = th.textDark;
    ctx.fillRect(Math.round(x), Math.round(rect.y + rect.height / 2 + look.fontPx / 2), Math.round(w), 1);
  }, [look]);
  const editor = useRef<DataEditorRef>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const [lookups, setLookups] = useState<Lookups>(new Map());
  // The ribbon menu open under its button: Table Fields (More Fields, Data Type, Format, Validation) and Home › Find (Go To, Select).
  const [popup, setPopup] = useState<'moreFields' | 'dataType' | 'format' | 'validation' | 'goTo' | 'select' | 'more' | 'fontSize' | 'font' | 'fontColor' | 'backColor' | null>(null);
  // Home › Find: the Find dialog is open while > 0 (its key: each opening starts it again); closed, the key negated: every
  // opening and closing changes it, so a search under way sees it (findInSheet)
  const [finding, setFinding] = useState(0);
  const [findTab, setFindTab] = useState<FindTab>('find');
  const findOpen = useRef(0);
  findOpen.current = finding;
  // Table Fields commands waiting for the structure to be read again, and the column to select then.
  const reloading = useRef<{ select: string | null; waiters: (() => void)[] }>({ select: null, waiters: [] });
  const [listEdit, setListEdit] = useState<string | null>(null); // the field whose « Edit List Items » box is open
  // no Edit List Items without the designers (B5 R7) nor with table design off in Datasheet view (O1 R9)
  const editList = design && currentUi().datasheetDesign ? { open: setListEdit, disabled: () => live.current.ro } : null;
  const [sort, setSort] = useState<Sort>(null);
  const [filter, setFilter] = useState<FilterState>(NO_FILTER);
  const [menu, setMenu] = useState<FilterMenuState | null>(null);
  const built = useRef(new Map<string, BuiltList>()); // what each field's list last set (R14: its ticks come back while it stands)
  const [selection, setSelectionState] = useState<GridSelection>(NO_SELECTION);
  const [error, setError] = useState<FieldError | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [refused, setRefused] = useState(false); // a write was refused as read-only (lock lost meanwhile)
  const [busy, setBusy] = useState(false); // a row is being saved: the grid is locked
  const [widths, resize] = useColumnWidths();
  const [rowHeight, setRowHeight] = useState(look.rowHeight); // Hauteur de ligne (Plus)
  // Masquer / Figer (Plus) : les champs masqués (enregistrés comme une largeur 0, la convention d'Access) et figés à gauche (enregistrés avec `sheetLayout`).
  // La vue travaille en indices de champ ; `view.order` donne le champ de chaque colonne de la grille (column-order.ts).
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [frozen, setFrozen] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]); // display order of the fields: Freeze fixes it, Unfreeze leaves the formerly frozen ones first
  const view = useMemo(() => columnOrder(shape?.design.fields.map((f) => f.name) ?? [], hidden, frozen, order), [shape, hidden, frozen, order]);
  const orderRef = useRef(view.order);
  orderRef.current = view.order;
  const fieldOf = (c: number) => orderRef.current[c] ?? c, gridOf = (c: number) => orderRef.current.indexOf(c);
  // Totaux (Accueil › Enregistrements) : la ligne des totaux sous la grille, la fonction choisie par champ, et le défilement de la grille qu'elle suit.
  // ponytail: calculés par SQL sur toutes les lignes (une source serveur : sur les lignes lues, MAX_LOADED_ROWS au plus), sans l'enregistrement en cours de saisie
  const [totalsOn, setTotalsOn] = useState(false);
  const [totalFns, setTotalFns] = useState<Record<string, TotalFn>>({});
  const [totals, setTotals] = useState<Record<string, string>>({});
  const scrollAt = useRef({ x: 0, tx: 0 }); // the grid's first scrolling column shown and its offset
  const [region, setRegion] = useState(scrollAt.current);
  // Largeurs enregistrées (px par colonne : propriété des champs d'une table, `columnWidths` d'une requête) et tirées depuis (pas encore enregistrées)
  const [stored, setStored] = useState<Record<string, number>>({});
  const dragged = useRef<Record<string, number>>({});
  /** The rest of the layout as stored (JSON), once the view has read it: the question « save layout? » is asked when it differs. */
  const layoutKept = useRef<string | null>(null);
  /** Only what differs from the defaults is kept, so an old table opens unchanged and the Options still apply to the rest. */
  const sheetLayout = (): SheetLayout => {
    const d = datasheetLook(settings0);
    return {
      ...(rowHeight !== look.rowHeight ? { rowHeight } : {}),
      ...(frozen.length ? { frozen } : {}), ...(order.length ? { order } : {}),
      ...(totalsOn ? { totals: true } : {}), ...(Object.keys(totalFns).length ? { totalFns } : {}),
      ...(fontOver.datasheetFontSize !== undefined ? { fontSize: fontOver.datasheetFontSize } : {}),
      ...(fontOver.datasheetFontWeight !== undefined ? { bold: fontOver.datasheetFontWeight >= 600 } : {}),
      ...(fontOver.datasheetFontItalic !== undefined ? { italic: fontOver.datasheetFontItalic } : {}),
      ...(fontOver.datasheetFontUnderline !== undefined ? { underline: fontOver.datasheetFontUnderline } : {}),
      ...(skin.font ? { font: skin.font } : {}), ...(skin.text ? { textColor: skin.text } : {}), ...(skin.back ? { backColor: skin.back } : {}), ...(skin.grid ? { gridColor: skin.grid } : {}),
      ...(gridlines.horizontal !== d.horizontal || gridlines.vertical !== d.vertical ? { gridlines } : {}),
      ...(Object.keys(aligns).length ? { aligns } : {}),
    };
  };
  const layoutChanged = () => layoutKept.current !== null && JSON.stringify(sheetLayout()) !== layoutKept.current;
  const applyLayout = (l: SheetLayout) => {
    const font = {
      ...(l.fontSize !== undefined ? { datasheetFontSize: l.fontSize } : {}), ...(l.bold !== undefined ? { datasheetFontWeight: l.bold ? 700 : 400 } : {}),
      ...(l.italic !== undefined ? { datasheetFontItalic: l.italic } : {}), ...(l.underline !== undefined ? { datasheetFontUnderline: l.underline } : {}),
    };
    setFontOver(font);
    setRowHeight(l.rowHeight ?? datasheetLook({ ...settings0, ...font }).rowHeight);
    setSkin({ ...(l.font && EMBEDDED_FONTS.some((f) => f.family === l.font) ? { font: l.font } : {}), ...(l.textColor ? { text: l.textColor } : {}), ...(l.backColor ? { back: l.backColor } : {}), ...(l.gridColor ? { grid: l.gridColor } : {}) });
    if (l.gridlines) setGridlines(l.gridlines);
    setFrozen(l.frozen ?? []);
    setOrder(l.order ?? []);
    setTotalsOn(!!l.totals);
    setTotalFns(l.totalFns ?? {});
    setAligns(l.aligns ?? {});
  };
  // the layout read, applied and rendered: it is the one the question compares with
  useEffect(() => { if (shape && layoutKept.current === null) layoutKept.current = JSON.stringify(sheetLayout()); }, [shape]);
  const passThrough = useRef(false);
  // A drag of a column's edge ends on the column's new right edge, where its menu button now is: Glide then opens the filter menu
  // on the mouse-up. A press that resized a column opens no menu (Access's header has none to open).
  const resizing = useRef(false);
  const onColumnResize = (c: GridColumn, w: number) => { resizing.current = true; resize(c, w); if (c.id !== undefined) dragged.current[c.id] = w; };
  const [version, bump] = useReducer((n: number) => n + 1, 0); // rows or pending edits changed: redraw
  const [, scrolled] = useReducer((n: number) => n + 1, 0);
  // Synchronous state (read right after an await, before React renders): saved rows count, new record's row shown. `more`:
  // a query not counted yet (Access counts once idle): `count` is the rows read so far, a loading row follows them.
  const rows = useRef({ count: 0, adding: false, more: false });
  const busyRef = useRef(false);
  const committing = useRef<Promise<boolean> | null>(null);
  // A click on the new record's row: Glide appends a row, then opens its editor once the row is there; the click's mouse-up opens
  // one before that, which the second replaces, losing what was typed in it (a slow save of the row left). Only the second opens.
  const appendClick = useRef(false);
  const commitRowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true)); // commitRow / selectedField, defined further down
  const selectedFieldRef = useRef<() => { col: number; field: FieldDef } | undefined>(() => undefined);
  const alive = useRef(true); // a page that fails after the tab closed shows nothing
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { if (!readOnly) setRefused(false); }, [readOnly]); // writable again (lock taken over)
  const notUpdatable = (!!shape?.src && !shape.src.info.updatable) || !!shape?.fixed; // a multi-table (or grouped…) query, a read-only link
  const ro = readOnly || refused || notUpdatable;
  const live = useRef({ tab, active, shape, sort, filter, selection, ro, readOnly, lookups, source, params });
  live.current = { tab, active, shape, sort, filter, selection, ro, readOnly, lookups, source, params };
  /** The order and filter of every page request (set in `live` before React renders: read right after an await). */
  const query = () => {
    const { sort: s, filter: f } = live.current;
    const items = activeFilter(f);
    return { ...(s ? { sort: s } : {}), ...(items ? { filter: items } : {}) };
  };

  // The data, from the table (rows.*) or from the query (sources.page with the tab's parameter values; writes on its key table).
  const withParams = () => (live.current.params ? { params: live.current.params } : {});
  /** A crosstab page whose headings differ from the columns shown (B4 R14: Refresh after an order in a new month): the
   *  structure is read again (described with the tab's values), once per new set of names. */
  const [restructure, bumpRestructure] = useReducer((n: number) => n + 1, 0);
  const pendingHeadings = useRef<string | null>(null);
  const headingsChanged = (columns: string[] | undefined) => {
    const s = live.current.shape;
    if (!columns || !s) return;
    const key = JSON.stringify(columns);
    if (key === JSON.stringify(s.design.fields.map((x) => x.name)) || key === pendingHeadings.current) return;
    pendingHeadings.current = key;
    bumpRestructure();
  };
  /** `check`: a crosstab's headings compared (R14); never while the structure itself is read (its count). `exact` false: a
   *  query is not run, only compiled (its filter checked): -1 unless its count is already known. */
  const countRows = (filter?: FieldFilter[], check = false, fresh = false, exact = true): Promise<number> => {
    const src = live.current.source;
    if (!src) return api.rows.count(live.current.tab.name, filter);
    return api.sources.page(src, { offset: 0, limit: 0, ...(filter ? { filter } : {}), ...withParams(), ...(fresh ? { fresh: true } : {}), ...(exact ? {} : { count: false as const }) })
      .then((p) => { if (check) headingsChanged(p.columns); return p.total; });
  };
  const pageRows = async (offset: number, limit: number): Promise<RowPage> => {
    const src = live.current.source;
    const q = query();
    if (!src) return api.rows.page(live.current.tab.name, { offset, limit, ...q });
    const p = await api.sources.page(src, { offset, limit, ...(q.sort ? { sort: [q.sort] } : {}), ...(q.filter ? { filter: q.filter } : {}), ...withParams(), count: false });
    headingsChanged(p.columns);
    // A row with no key-table rowid (a read-only source, an outer join's row without its key record: R5) carries NaN.
    return { rows: p.rows.map((values, i) => ({ rowid: p.rowids[i] ?? NaN, values })) };
  };
  /** The table rows are written to and deleted from (a query's key table). */
  const dataTable = () => live.current.shape?.src?.info.keyTable ?? live.current.tab.name;
  const readLookup = (fd: FieldDef, src = live.current.shape?.src): Promise<LookupData> | null => {
    if (!live.current.source) return api.rows.lookup(live.current.tab.name, fd.name);
    const origin = src?.info.fields.find((f) => f.name === fd.name)?.origin; // a query's column: its field's list
    return origin ? api.rows.lookup(origin.table, origin.field) : null;
  };
  /** A query's row, saved by its output columns in one transaction (sources.save, B4 R3); the columns read back replace the
   *  row's, the others (computed) stay until its page is read again. */
  const writeSource = async (src: SourceShape, ref: QueryRef, rowid: RowRef | null, changes: Record<string, CellInput>,
    expected: Record<string, SqlValue> | undefined): Promise<RowWriteResult> => {
    const r = await api.sources.save(ref, { rowid, values: changes, ...(expected && { expected }) });
    if (!r.ok && !('current' in r)) return r; // errors already name output columns; a record deleted (C3 R8)
    const s = live.current.shape;
    const at = buffer.pending?.rowIndex;
    const before = rowid === null ? s?.defaults : at === undefined ? undefined : s?.cache.get(at)?.values;
    const got = r.ok ? r.values : r.current;
    const values = src.info.fields.map((f, k) => (Object.hasOwn(got, f.name) ? got[f.name]! : before?.[k] ?? null));
    return r.ok ? { ok: true, rowid: r.rowid, values } : { ok: false, conflict: 'changed', current: values, ...(r.rowid !== undefined && { rowid: r.rowid }) };
  };

  /** Also in `live` at once: a save that ends before React renders reads the selection the user just moved to. */
  const setSelection = (sel: GridSelection) => { live.current.selection = sel; setSelectionState(sel); };
  const [buffer] = useState(() => new RowBuffer((rowid, changes, original) => {
    const s = live.current.shape;
    // C3 R8: the row as it was when its editing began, by the view's fields (a table's, a query's output columns)
    const expected = original && s ? Object.fromEntries(s.design.fields.map((f, k) => [f.name, original[k] ?? null])) : undefined;
    const ref = live.current.source;
    if (s?.src && ref) return writeSource(s.src, ref, rowid, changes, expected);
    const name = live.current.tab.name; // renamed meanwhile: the row goes to the table under its new name
    return rowid === null ? api.rows.insert(name, changes) : api.rows.update(name, rowid, changes, expected);
  }));
  const setRows = (patch: Partial<typeof rows.current>) => { Object.assign(rows.current, patch); bump(); };

  const dataError = (e: unknown) => { if (bcErrorCode(e) === 'unsupportedTable') setUnsupported(true); else void showError(e); };
  const writeError = async (e: unknown) => {
    if (bcErrorCode(e) === 'readOnly') setRefused(true);
    await showError(e);
  };

  /** The words of a field error, in the bar under the grid and in the message box (fieldErrorParams). */
  const errorParams = (e: FieldError) => {
    const s = live.current.shape;
    const fd = s?.design.fields.find((x) => x.name === e.field);
    return fieldErrorParams(e, fd, { lang: i18n.language.startsWith('fr') ? 'fr' : 'en', region: localeInfo(s?.locale ?? 'en-US') }, t, s?.design);
  };

  /** A refused row: its first error under the grid and in a message box (Access), then the focus is on that field's cell. */
  const showFailure = async (rowIndex: number, errors: FieldError[]) => {
    const err = errors[0];
    setError(err);
    const col = Math.max(0, live.current.shape?.design.fields.findIndex((x) => x.name === err.field) ?? 0);
    setSelection(cellSelection(col, rowIndex)); // Glide scrolls to it
    // The box gives the focus back to the grid (not to the ribbon), which has it on that cell; never behind a dialog or the
    // backstage (a close or open asked from it), which keeps the focus.
    if (!document.querySelector('[aria-modal="true"]')) editor.current?.focus();
    await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'datasheet.fieldError', params: errorParams(err), buttons: ['ok'] });
    focusCell(col, rowIndex);
  };
  /** After a box: Glide moves the focus onto the newly selected cell later, and only while the grid has it; the box had it, so it
   *  came back to the cell focused before. Glide's accessible copy of the cell takes it (the row selectors are its column 0). */
  const focusCell = (col: number, row: number) => {
    if (!document.querySelector('[aria-modal="true"]')) document.getElementById(`glide-cell-${col + 1}-${row}`)?.focus({ preventScroll: true });
  };

  /** Saves the pending row; true when nothing is left pending. One save at a time: a second call shares the first. A row whose
   *  save lost its connection (it may have committed, C4 I1) is sent again only by Save Record (`resend`): leaving it shows the
   *  message again and keeps it. */
  const commitRow = (resend = false): Promise<boolean> => {
    if (committing.current) return committing.current;
    if (!buffer.pending) return Promise.resolve(true);
    busyRef.current = true;
    setBusy(true);
    const run = async (): Promise<boolean> => {
      try {
        for (let p = buffer.pending; p; p = buffer.pending) { // edits typed during a save are saved next
          if (buffer.lookups.busy) await buffer.lookups.settled(); // the parents' values first: a lookup drops what was typed for the old one (R4)
          const failed = buffer.lookups.failure;
          if (failed) throw failed.e; // the parent is unknown: nothing is written, the row stays (Escape, or a lookup that succeeds, lifts it)
          const out = await buffer.commit(resend);
          // The box is part of the attempt: a save asked while it is open shares this one (never a second box).
          if (out.status === 'failed') { await showFailure(p.rowIndex, out.errors); return false; }
          if (out.status === 'conflict') { await resolveConflict(p.rowIndex, p.rowid!, out); continue; }
          if (out.status === 'saved') {
            const cache = live.current.shape?.cache;
            cache?.set(p.rowIndex, { rowid: out.rowid, values: out.values });
            if (p.rowid === null) setRows({ count: rows.current.count + 1, adding: false });
            // Sorted: the row takes its place. Filtered (a query too: its criteria): it stays until its page is read again,
            // then goes if it no longer matches, and the count follows. Never a row shown twice or lost at a page edge.
            const filtered = activeFilter(live.current.filter);
            const recount = !!filtered || !!live.current.shape?.src;
            if (live.current.sort || recount) cache?.invalidate();
            if (cache && recount) {
              try {
                const before = rows.current.count;
                const count = await countRows(filtered);
                setRows({ count, more: false });
                // Out of the filter: the rows under it move up, and so does a selection below it (never a record skipped).
                const at = live.current.selection.current?.cell;
                if (count < before && at && at[1] > p.rowIndex) setSelection(cellSelection(at[0], at[1] - 1));
              } catch (e) {
                dataError(e); // saved all the same
              }
            }
            setError(null);
          }
        }
        return true;
      } catch (e) {
        // The row stays to be saved, selected (Access): back on it when it was left for another row (its save failed there).
        const p = buffer.pending;
        const col = live.current.selection.current?.cell[0] ?? 0;
        if (p && rowOf(live.current.selection) !== p.rowIndex) setSelection(cellSelection(col, p.rowIndex));
        await writeError(e);
        const at = live.current.selection.current?.cell;
        if (at) focusCell(at[0], at[1]);
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

  /** C3 R9: the row changed since its editing began, or was deleted. Save Record: the next save expects the row as it is now
   *  (a new conflict asks again), on the row's current reference (C4 R8); Copy to Clipboard: the row as shown goes there, then
   *  as Drop Changes: the changes go and the row shows the other user's values (and its current reference). Deleted: said, the
   *  changes go, the rows are read again. A failed copy drops nothing. */
  const resolveConflict = async (rowIndex: number, rowid: RowRef, out: Extract<CommitOutcome, { status: 'conflict' }>) => {
    if (out.conflict === 'deleted') {
      await showRecordDeleted(modal);
      buffer.discard();
      setError(null);
      reloadRows();
      return;
    }
    const choice = await askWriteConflict(modal);
    if (choice === 'save') { buffer.setOriginal(out.current, out.rowid); return; }
    const s = live.current.shape;
    if (choice === 'copy' && s) {
      const text = (col: number) => {
        const cell = cellAt.current([col, rowIndex]);
        return cell.kind === GridCellKind.Text ? cell.displayData
          : cell.kind === GridCellKind.Boolean ? texts(s.design.fields[col]!, cell.data ? -1 : 0, { locale: s.locale })[0] : '';
      };
      await api.app.writeClipboard(recordText(s.design.fields.map((f) => f.name), s.design.fields.map((_f, col) => text(col))));
    }
    buffer.discard();
    s?.cache.set(rowIndex, { rowid: out.rowid ?? rowid, values: out.current }); // C4 R8: the row's current reference
    setError(null);
  };

  const discardRow = () => {
    if (busyRef.current) return;
    buffer.discard();
    setError(null);
    setRows({ adding: false });
  };

  // Structure saved (reloadToken), or a crosstab's headings changed (restructure): a pending row is saved first, then design,
  // rows and columns are read again. A rename (name only) changes nothing here: saves and page requests already use the live
  // name, the pending row stays.
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
        let src: SourceShape | undefined;
        const [table, settings, tableInfo] = await Promise.all([source ? null : api.tables.design(name), api.app.getSettings(),
          source ? null : api.sources.describe({ kind: 'table', name }).catch(() => null)]); // only a link says it is not updatable
        if (source) {
          const info = await api.sources.describe(source, live.current.params); // a crosstab's headings need them (B4 R11)
          src = { info, editable: info.fields.map((f) => writableColumn(info, f.name)) };
        }
        const design: TableDesign = src ? { name, fields: src.info.fields.map(columnOf) } : table!;
        // Les largeurs enregistrées : celles des champs de la table, `columnWidths` de la requête enregistrée (illisible : aucune)
        let widthsKept: Record<string, number> = {};
        const hiddenKept = new Set<string>(); // largeur 0 : champ masqué
        let sheetStored: unknown = src ? undefined : design.extra?.sheetLayout; // the rest of the layout (SheetLayout), validated by parseSheetLayout
        if (!src) for (const fd of design.fields) { const px = storedPx(fd.props.columnWidth); if (px) widthsKept[fd.name] = px; else if (fd.props.columnWidth === 0) hiddenKept.add(fd.name); }
        else if (source?.kind === 'query') {
          try {
            const def = (await api.objects.get('query', source.name)).definition as Record<string, unknown>;
            passThrough.current = passThroughOf(def) !== null;
            const cw = def.columnWidths;
            sheetStored = def.sheetLayout;
            if (typeof cw === 'object' && cw !== null && !Array.isArray(cw)) for (const [k, v] of Object.entries(cw)) { const px = storedPx(v); if (px) widthsKept[k] = px; else if (v === 0) hiddenKept.add(k); }
          } catch { widthsKept = {}; }
        }
        // A sort and the criteria of fields still there are kept (a reload after a structure change); the others go.
        const has = (field: string) => design.fields.some((x) => sameName(x.name, field));
        const keptSort = live.current.sort && has(live.current.sort.field) ? live.current.sort : null;
        const items = live.current.filter.items.filter((x) => has(x.field));
        let keptFilter: FilterState = items.length ? { ...live.current.filter, items } : NO_FILTER;
        let count: number; // a query: -1, counted once idle (its pages come first)
        try {
          count = await countRows(activeFilter(keptFilter), false, false, false);
        } catch (e) {
          if (keptFilter === NO_FILTER) throw e;
          keptFilter = NO_FILTER; // a criterion the changed field no longer accepts
          count = await countRows(undefined, false, false, false);
        }
        const [defaults, lists] = await Promise.all([defaultValues(design, settings.region), loadLookups((fd) => readLookup(fd, src), design, settings.region, editList)]);
        if (!current) return;
        const cache: PageCache = new PageCache(async (offset, limit) => {
          const page = await pageRows(offset, limit);
          if (live.current.shape?.cache === cache) grew(offset + page.rows.length, page.rows.length < limit);
          return page;
        });
        cache.onLoaded(() => { if (alive.current) bump(); });
        cache.onError((e) => { if (alive.current && live.current.shape?.cache === cache) dataError(e); });
        live.current.sort = keptSort;
        setSort(keptSort);
        live.current.filter = keptFilter;
        setFilter(keptFilter);
        setMenu(null);
        const want = reloading.current.select;
        const col = want === null ? -1 : design.fields.findIndex((x) => sameName(x.name, want));
        reloading.current.select = null;
        setSelection(col < 0 ? NO_SELECTION : { columns: CompactSelection.fromSingleSelection(col), rows: CompactSelection.empty() });
        setError(null);
        setUnsupported(false);
        rows.current = { count: Math.max(count, 0), adding: false, more: count < 0 };
        pendingHeadings.current = null;
        setStored(widthsKept);
        if (layoutKept.current === null) applyLayout(parseSheetLayout(sheetStored)); // once: a later reload keeps the view's own state
        // masqués ou réaffichés depuis le dernier enregistrement de la disposition : gardés à travers une relecture de la structure
        for (const [k, px] of Object.entries(dragged.current)) { if (px === 0) hiddenKept.add(k); else hiddenKept.delete(k); }
        setHidden(design.fields.every((f) => hiddenKept.has(f.name)) ? new Set() : hiddenKept);
        setShape({ design, locale: settings.region, year4: fourDigitYear(), cache, defaults, ...(src ? { src } : {}), ...(tableInfo && !tableInfo.updatable ? { fixed: true as const } : {}) });
        setLookups(lists);
        idle();
      } catch (e) {
        if (current) dataError(e);
      } finally {
        if (current) {
          reloading.current.select = null; // also after a failed reload
          reloading.current.waiters.splice(0).forEach((done) => done()); // a replaced run leaves them to the newer one
        }
      }
    })();
    return () => { current = false; };
  }, [tab.reloadToken, restructure]);

  /** A query not counted yet: a page read grows `count` to its end; a short page ends it (the count is then known). */
  const grew = (end: number, last: boolean) => {
    if (!alive.current || !rows.current.more) return;
    if (last) setRows({ count: end, more: false });
    else if (end > rows.current.count) setRows({ count: end });
  };
  /** A query's count, once the sheet is idle (COUNT_IDLE_MS without scrolling or keys: Access counts in the background), or at
   *  once for the last record, the new record or all records. Its run holds the data process: never while scrolling. */
  const countTimer = useRef(0);
  const counting = useRef<Promise<void> | null>(null);
  const countAll = (): Promise<void> => {
    window.clearTimeout(countTimer.current);
    if (!rows.current.more) return Promise.resolve();
    const s = live.current.shape;
    return (counting.current ??= countRows(activeFilter(live.current.filter)).then((count) => {
      if (alive.current && live.current.shape === s && rows.current.more) setRows({ count, more: false });
    }, dataError).finally(() => { counting.current = null; }));
  };
  const idle = () => {
    window.clearTimeout(countTimer.current);
    if (rows.current.more) countTimer.current = window.setTimeout(() => { if (alive.current) void countAll(); }, COUNT_IDLE_MS);
  };

  // Rows changed elsewhere (an import appended to this table, or Refresh): the rows and their count are read again; structure,
  // sort, filter and a pending row stay.
  const reloadRows = (fresh = false) => {
    void countRows(activeFilter(live.current.filter), true, fresh).then((count) => {
      if (!alive.current) return;
      live.current.shape?.cache.invalidate();
      setRows({ count, more: false });
    }, dataError);
  };
  // A sheet that never loaded (its link's file missing, C1) loads in full: relinked or refreshed meanwhile.
  useEffect(() => { if (tab.dataToken) { if (live.current.shape) reloadRows(); else bumpRestructure(); } }, [tab.dataToken]);

  // Back on this tab: the lists and the rows are read again (a delete cascading from a parent table's datasheet, its key
  // changed, a list's source table edited meanwhile).
  const wasActive = useRef(active);
  useEffect(() => {
    const back = active && !wasActive.current;
    wasActive.current = active;
    const s = live.current.shape;
    if (!back || !s) return;
    reloadRows();
    loadLookups((fd) => readLookup(fd), s.design, s.locale, editList).then((m) => { if (alive.current && live.current.shape === s) setLookups(m); }, dataError);
  }, [active]);

  const dirty = buffer.pending !== null;
  const missedRefresh = useRef(false); // C3 R10: a refresh signal came while a row was being edited
  const refreshIfMissed = (editorOpen: boolean) => {
    const s = live.current.shape;
    if (!missedRefresh.current || buffer.pending !== null || editorOpen || !s) return;
    missedRefresh.current = false;
    // The rows stay editable while read again (invalidate would lock them: a key typed meanwhile was lost), then are swapped in,
    // unless an edit began meanwhile: the refresh then waits for its end, as above.
    void Promise.all([countRows(activeFilter(live.current.filter), true), s.cache.rereadPages()]).then(([count, swap]) => {
      if (!alive.current || live.current.shape !== s) return;
      if (swap === undefined) { reloadRows(); return; }
      const editing = buffer.pending !== null || (live.current.active && cellEditorOpen());
      if (swap === null || editing || !swap()) {
        missedRefresh.current = true;
        if (!editing) cmds.current.refreshIfMissed(false); // a row written meanwhile: its reply may predate it, read again
        return;
      }
      setRows({ count, more: false });
    }, dataError);
  };
  useEffect(() => { dispatch({ type: 'setDirty', id: tab.id, dirty }); }, [dirty, tab.id, dispatch]);
  useEffect(() => () => { void dispatch({ type: 'setDirty', id: tab.id, dirty: false }); }, [tab.id, dispatch]);

  /** Every selection change made by the user: leaving the pending row saves it (a failure brings the selection back). */
  const select = (sel: GridSelection) => {
    // A column picked while a Table Fields reload runs is the one it selects again (by name: the new structure may move it)
    if (reloading.current.waiters.length) {
      const c = sel.current?.cell[0] ?? sel.columns.first();
      const f = c === undefined ? undefined : live.current.shape?.design.fields[c];
      if (f) reloading.current.select = f.name;
    }
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

  const scrollToRow = (row: number) => scrollGridToRow(wrap.current, row, rowHeight);
  const goRow = (row: number) => {
    const col = live.current.selection.current?.cell[0] ?? firstEditable();
    select(cellSelection(col, row));
    // Once the selection is rendered (Glide selects the first visible cell when it gets the focus without one), and
    // the scroll too (Glide's focus scrolls by a delta from its last rendered position). Only once the row left is saved:
    // refused, the message box keeps the focus and the grid stays on the cell in error.
    void (committing.current ?? Promise.resolve(true)).then((ok) => {
      if (ok) requestAnimationFrame(() => { scrollToRow(row); requestAnimationFrame(() => { if (!cellEditorOpen()) editor.current?.focus(); }); });
    });
  };
  /** Home > Find > Go To. */
  const goTo = async (where: GoTo) => {
    if (where === 'last' || where === 'new') await countAll();
    const target = goToRow(where, rowOf(live.current.selection), rows.current.count);
    if (target === 'new') void newRecord();
    else if (target !== null) goRow(target);
  };
  /** Home > Find > Select: the current record, or all records. */
  const selectRecords = async (what: 'record' | 'all') => {
    if (what === 'all') await countAll();
    const { count, adding } = rows.current;
    const row = rowOf(live.current.selection);
    if (what === 'record' ? row === null : count === 0) return;
    select({ columns: CompactSelection.empty(), rows: CompactSelection.fromSingleSelection(what === 'all' ? [0, count + (adding ? 1 : 0)] : row!) });
  };

  /** Home › Find (O2 R10): from the selected cell, the selected column's cells (« Champ actif ») or each row's cells left to right,
   *  down, up or all around (back to the cell itself last); the text shown (as formatted: a truncated number's value, R13) or the
   *  stored value's edit text. Rows are read through the cache four pages at a time (ensure), only as far as the search goes;
   *  from MAX_LOADED_ROWS on they are not searched (told once); every 800 rows the UI runs (the dialog closed or opened again:
   *  the search stops). A match in another row saves the row being edited first (Access: only when it moves): refused, its
   *  message shows and the search stops (bc:saveRefused). A match selects its cell, scrolled into view; the focus stays in the
   *  dialog. */
  const findInSheet = async (o: FindOptions): Promise<boolean> => {
    flushCellEditor();
    const opened = findOpen.current;
    const gone = () => findOpen.current !== opened;
    const s = live.current.shape;
    const n = Math.min(rows.current.count, MAX_LOADED_ROWS);
    if (!s || n === 0) return false;
    const cur = live.current.selection.current?.cell;
    const shown = orderRef.current; // the columns shown, left to right: a hidden field is not searched
    const width = o.onlyCurrentField ? 1 : shown.length;
    const col0 = cur?.[0] ?? firstEditable();
    const total = n * width;
    // the position searched from (row × width + column); none, or the new record's row: before the first (after the last going up)
    const at = cur && cur[1] < n ? cur[1] * width + (o.onlyCurrentField ? 0 : Math.max(0, gridOf(cur[0]))) : o.search === 'up' ? total : -1;
    for (let k = 1; k <= total; k++) {
      if (k % (800 * width) === 0) {
        await new Promise((r) => setTimeout(r));
        if (gone() || live.current.shape !== s) return false;
      }
      const pos = o.search === 'all' ? (((at + k) % total) + total) % total : o.search === 'down' ? at + k : at - k;
      if (pos < 0 || pos >= total) break;
      const row = Math.floor(pos / width), col = o.onlyCurrentField ? col0 : shown[pos % width]!;
      if (!s.cache.fresh(row)) {
        await (o.search === 'up' ? s.cache.ensure(Math.max(0, row - 799), row, gone) : s.cache.ensure(row, Math.min(n - 1, row + 799), gone));
        if (gone() || live.current.shape !== s) return false;   // the structure was read again meanwhile
      }
      const saved = s.cache.get(row);
      const field = s.design.fields[col];
      if (!saved || !field) continue;
      const cell = o.asFormatted ? cellAt.current([col, row]) : null;
      const text = cell?.kind === GridCellKind.Text ? cell.copyData ?? cell.displayData : editText(field, saved.values[col] ?? null, s.locale);
      if (!matchText(text, o.what, o.match, o.matchCase, s.locale)) continue;
      const p = buffer.pending;
      if (p && p.rowIndex !== row && !(await commitRow())) throw new Error('bc:saveRefused');
      select(cellSelection(col, row));
      requestAnimationFrame(() => { scrollToRow(row); editor.current?.scrollTo(Math.max(0, gridOf(col)), row, 'horizontal'); });
      return true;
    }
    if (rows.current.count > n && !cappedTold.current) {
      cappedTold.current = true;
      await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'datasheet.findCapped', buttons: ['ok'] });
    }
    return false;
  };

  /** Replace (Find's Replace tab, O2): the text, number, currency, date and hyperlink fields the user may edit (a number or a date is replaced in
   *  its edit text, which the save converts: an invalid result is refused with the field's message, as a typed one). */
  const replaceable = (col: number): boolean => {
    const s = live.current.shape, field = s?.design.fields[col];
    return !!s && !!field && ['shortText', 'longText', 'number', 'currency', 'dateTime', 'hyperlink'].includes(field.props.type) && !field.props.lookup
      && !serverComputed(field.props) && (!s.src || s.src.editable[col]);
  };
  /** The matched text of a cell replaced as an edit of it (saved with its row, like a typed one); false when nothing changes. */
  const replaceIn = (col: number, row: number, o: FindOptions, replaceWith: string, all: boolean): boolean => {
    const cell = cellAt.current([col, row]);
    if (cell.kind !== GridCellKind.Text) return false;
    const next = replaceText(cell.data, o, replaceWith, all);
    if (next === cell.data) return false;
    select(cellSelection(col, row));
    onCellEdited([col, row], { ...cell, data: next, displayData: next } as EditableGridCell);
    return true;
  };
  /** Replace One: the selected cell replaced when it holds a match, then the next match is found (findInSheet). */
  const replaceOne = async (o: FindOptions, replaceWith: string): Promise<boolean> => {
    flushCellEditor();
    const s = live.current.shape, cur = live.current.selection.current?.cell;
    if (s && cur && !live.current.ro && cur[1] < rows.current.count && replaceable(cur[0])) {
      const cell = cellAt.current(cur);
      if (cell.kind === GridCellKind.Text && matchText(cell.data, o.what, o.match, o.matchCase, s.locale)) replaceIn(cur[0], cur[1], o, replaceWith, false);
    }
    return findInSheet(o);
  };
  /** Replace All: every match of the loaded rows, row by row; a row is saved before the next one (a refused save stops it). */
  const replaceAll = async (o: FindOptions, replaceWith: string): Promise<number> => {
    flushCellEditor();
    const opened = findOpen.current;
    const gone = () => findOpen.current !== opened;
    const s = live.current.shape;
    if (!s || live.current.ro) return 0;
    const n = Math.min(rows.current.count, MAX_LOADED_ROWS);
    const cur = live.current.selection.current?.cell;
    const cols = orderRef.current.filter((c) => replaceable(c) && (!o.onlyCurrentField || c === (cur?.[0] ?? firstEditable())));
    let count = 0;
    for (let row = 0; row < n; row++) {
      if (!s.cache.fresh(row)) {
        await s.cache.ensure(row, Math.min(n - 1, row + 799), gone);
        if (gone() || live.current.shape !== s) return count;
      }
      for (const col of cols) {
        const cell = cellAt.current([col, row]);
        if (cell.kind !== GridCellKind.Text || !matchText(cell.data, o.what, o.match, o.matchCase, s.locale)) continue;
        const p = buffer.pending;
        if (p && p.rowIndex !== row && !(await commitRow())) throw new Error('bc:saveRefused');
        if (replaceIn(col, row, o, replaceWith, true)) count++;
      }
    }
    if (!(await commitRow())) throw new Error('bc:saveRefused');
    return count;
  };

  /** Home › Spelling (C2): from the selected cell, row by row, the replaceable cells' text (Find's walk, in its column order); each
   *  misspelled word stops the walk in the Spelling dialog. A change is an edit of the cell, as Replace's; Ignore All and Change All
   *  last for this check. The record being edited is saved when the walk moves to another one. */
  const spelling = async () => {
    flushCellEditor();
    const s = live.current.shape;
    if (!s || live.current.ro) return;
    if (!(await api.app.spellPrepare())) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'datasheet.spellUnavailable', buttons: ['ok'] }); return; }
    const gone = () => live.current.shape !== s;
    const n = Math.min(rows.current.count, MAX_LOADED_ROWS);
    const cur = live.current.selection.current?.cell;
    const from = cur && cur[1] < n ? { row: cur[1], grid: Math.max(0, gridOf(cur[0])) } : { row: 0, grid: 0 };
    const ignored = new Set<string>(), always = new Map<string, string>();
    let stopped = false;
    for (let row = from.row; row < n && !stopped; row++) {
      if (!s.cache.fresh(row)) {
        await s.cache.ensure(row, Math.min(n - 1, row + 799), gone);
        if (gone()) return;
      }
      for (const col of orderRef.current.filter((c) => replaceable(c) && gridOf(c) >= (row === from.row ? from.grid : 0))) {
        const cell = cellAt.current([col, row]);
        if (cell.kind !== GridCellKind.Text) continue;
        let text = cell.data, at = 0;
        for (;;) {
          const w = wordsOf(text).find((x) => x.start >= at && !ignored.has(x.word.toLowerCase()) && api.app.isMisspelled(x.word));
          if (!w) break;
          const key = w.word.toLowerCase();
          let to = always.get(key);
          if (to === undefined) {
            select(cellSelection(col, row));
            const a = await modal.custom<SpellAnswer>((close) => <SpellingDialog text={text} word={w} suggestions={api.app.spellSuggestions(w.word)} close={close} />, { titleKey: 'ribbon.cmd.spelling' });
            if (!a) { stopped = true; break; }
            if (a.action === 'ignore') { at = w.end; continue; }
            if (a.action === 'ignoreAll') { ignored.add(key); continue; }
            to = a.text;
            if (a.action === 'changeAll') always.set(key, to);
          }
          text = applyChange(text, w, to);
          at = w.start + to.length;
        }
        if (text !== cell.data) {
          const p = buffer.pending;
          if (p && p.rowIndex !== row && !(await commitRow())) throw new Error('bc:saveRefused');
          select(cellSelection(col, row));
          onCellEdited([col, row], { ...cell, data: text, displayData: text } as EditableGridCell);
        }
        if (stopped) break;
      }
    }
    if (!(await commitRow())) throw new Error('bc:saveRefused');
    if (!stopped) await modal.confirm({ titleKey: 'ribbon.cmd.spelling', messageKey: 'datasheet.spellDone', buttons: ['ok'] });
  };

  const firstEditable = () => {
    const s = live.current.shape;
    const shown = orderRef.current; // a hidden field is never the one to go to
    return shown.find((k) => { const x = s?.design.fields[k]; return !!x && x.props.type !== 'autoNumber' && !serverComputed(x.props) && (!s?.src || s.src.editable[k]); }) ?? shown[0] ?? 0;
  };

  const onCellEdited = ([col, row]: Item, cell: EditableGridCell) => {
    const { shape: s, ro: locked } = live.current;
    if (!s || locked || busyRef.current) return;
    const p = buffer.pending;
    if (p && p.rowIndex !== row) return; // cannot happen: the other rows are read-only while a row is pending
    const { count, adding } = rows.current;
    if (row >= count && !(adding && row === count)) return;
    if (row < count && !s.cache.fresh(row)) return; // cannot happen: rows shown from before a reload are read-only
    const rowid = row === count ? null : s.cache.get(row)?.rowid;
    const field = s.design.fields[col];
    // a query's computed column, a join field, a row without its key record (R5), a column its server computes (C4 M2)
    if (rowid === undefined || Number.isNaN(rowid) || (s.src && !s.src.editable[col]) || serverComputed(field.props)) return;
    buffer.edit(row, rowid, field.name, fromEdit(field, cell), rowid === null ? null : s.cache.get(row)?.values ?? null);
    bump();
    if (s.src) lookUp(row, field.name);
  };

  /** AutoLookup (B4 R4): a link column of the pending row changed, so the parents it links (lookupFor) show the values of the
   *  parent it now points to (blank: none). Their whole link is sent (typed, else looked up, else stored): a table is looked up
   *  only when all of its link is known. Only their columns change; an edit typed meanwhile stays. Nothing is written; the
   *  latest lookup of a link wins (buffer.lookups). A failure says nothing until the row is saved, which it refuses (commitRow). */
  const lookUp = (row: number, column: string) => {
    const { shape: s, source: ref } = live.current;
    const p = buffer.pending;
    const what = s?.src && lookupFor(s.src.info, column);
    if (!s || !what || !ref || p?.rowIndex !== row) return;
    const looked = buffer.looked;
    const stored = row >= rows.current.count ? s.defaults : s.cache.get(row)?.values;
    const values: Record<string, CellInput> = Object.create(null) as Record<string, CellInput>;
    for (const name of what.links) {
      const k = s.design.fields.findIndex((f) => sameName(f.name, name));
      const f = s.design.fields[k]?.name ?? name;
      values[f] = Object.hasOwn(p.changes, f) ? p.changes[f]! : Object.hasOwn(looked, f) ? looked[f]! : stored?.[k] ?? null;
    }
    buffer.lookups.ask(what.links, api.sources.autoLookup(ref, values), (got) => {
      if (live.current.shape !== s) return;
      buffer.lookedUp(row, Object.fromEntries(Object.entries(got).filter(([k]) => what.columns.some((c) => sameName(c, k)))), p.changes);
      bump();
    });
  };

  const onRowAppended = async (): Promise<undefined> => {
    appendClick.current = true; // a keyboard append has no mouse-up: the next pointer press clears it
    const shown = rows.current.count + (rows.current.adding ? 1 : 0);
    if (live.current.ro || !(await commitRow())) return undefined; // a row in error keeps the focus
    // A row saved out of the filter: the grid has no more rows than before, and Glide, which waits for more, would never
    // select the new record. Appended again once rendered with the new count, it does.
    if (rows.current.count + 1 <= shown) {
      const col = live.current.selection.current?.cell[0] ?? firstEditable();
      requestAnimationFrame(() => requestAnimationFrame(() => void editor.current?.appendRow(Math.max(0, gridOf(col)))));
      return undefined;
    }
    if (!rows.current.adding) setRows({ adding: true });
    return undefined; // Glide then selects the new row (the old trailing row's index) and opens its editor
  };

  /** Rowids of the given rows (ascending), as shown; rows never loaded are read in one request. */
  const rowids = async (indices: number[]): Promise<RowRef[]> => {
    const s = live.current.shape;
    const ids = indices.map((i) => s?.cache.get(i)?.rowid);
    if (ids.some((x) => x === undefined)) {
      const lo = indices[0];
      const page = await pageRows(lo, indices[indices.length - 1] - lo + 1);
      indices.forEach((i, k) => { ids[k] ??= page.rows[i - lo]?.rowid; });
    }
    return ids.filter((x): x is RowRef => x !== undefined && !Number.isNaN(x)); // a row without its key record is never deleted (R5)
  };

  const deleteRecords = async (sel: GridSelection = live.current.selection) => {
    const s = live.current.shape;
    if (!s || live.current.ro || busyRef.current) return;
    const { count, adding } = rows.current;
    const range = sel.current?.range;
    const picked = sel.rows.length ? sel.rows.toArray() : range ? Array.from({ length: range.height }, (_, k) => range.y + k) : [];
    const targets = picked.filter((i) => i < count + (adding ? 1 : 0));
    if (!targets.length) return;
    const p = buffer.pending;
    const dropsPending = p !== null && targets.includes(p.rowIndex);
    if (p && !dropsPending && !(await commitRow())) return;
    // a row without its key record (R5) is never deleted, nor counted in the question
    const existing = targets.filter((i) => i < rows.current.count && !Number.isNaN(s.cache.get(i)?.rowid ?? 0));
    if (existing.length) {
      // The real keys decide (A2-R14, A2-R15): ON DELETE CASCADE deletes related records, SET NULL / SET DEFAULT modify them.
      if (!(await confirmDelete(modal, dataTable(), existing.length))) return;
    }
    if (dropsPending || targets.includes(rows.current.count)) discardRow();
    if (!existing.length) return;
    try {
      const ids = await rowids(existing); // rows never loaded: a keyless one is dropped here
      const r = ids.length ? await api.rows.delete(dataTable(), ids) : { ok: true as const };
      if (!r.ok) await showRelatedRefusal(modal, r);
    } catch (e) {
      await writeError(e);
    }
    try {
      const n = await countRows(activeFilter(live.current.filter));
      s.cache.invalidate();
      setRows({ count: n, more: false });
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
    idle();
    // Escape outside a cell editor (which handles its own) cancels the pending row, as in Access.
    if (e.key === 'Escape' && buffer.pending && !busyRef.current) { e.cancel(); discardRow(); }
  };

  /** `at`: the column (a header's drop-down), else the selected one. */
  const sortBy = async (dir: 'asc' | 'desc' | null, at?: number) => {
    const { shape: s, selection: sel } = live.current;
    const col = at ?? sel.current?.cell[0] ?? sel.columns.first();
    if (!s || (dir !== null && col === undefined)) return;
    if (!(await commitRow())) return;
    const next: Sort = dir === null ? null : { field: s.design.fields[col!].name, dir };
    live.current.sort = next; // read by the page requests that follow, before React renders
    setSort(next);
    s.cache.invalidate();
    bump();
  };

  /** A criterion a query source refuses comes back as bc:invalidArgument (contract 1.2): shown as the table's bc:invalidFilter. */
  const filterError = (e: unknown): unknown => (live.current.source && bcErrorCode(e) === 'invalidArgument' ? new Error((e as Error).message.includes('|unknownFunction|') ? (e as Error).message.replace('invalidArgument', 'invalidFilter') : 'bc:invalidFilter') : e);

  /** A new filter: the pending row is saved first; the filter applies once the base accepted it (its count). The grid goes
   *  back to the first record, as in Access. */
  const applyFilter = async (next: FilterState) => {
    const s = live.current.shape;
    if (!s || !(await commitRow())) return;
    let count: number;
    try { count = await countRows(activeFilter(next)); } catch (e) { await showError(filterError(e)); return; }
    if (live.current.shape !== s) return; // reloaded meanwhile
    live.current.filter = next;
    setFilter(next);
    s.cache.invalidate();
    setRows({ count, adding: false, more: false });
    const col = live.current.selection.current?.cell[0] ?? firstEditable();
    setSelection(count ? cellSelection(col, 0) : NO_SELECTION);
    // Back to the grid (not to the ribbon or the closed menu), once the selection is rendered; never behind a dialog, nor
    // away from an editor a click opened meanwhile.
    requestAnimationFrame(() => { if (!document.querySelector('[aria-modal="true"]') && !cellEditorOpen()) editor.current?.focus(); });
  };
  const setCriteria = async (field: string, criteria: string) => {
    let next: FilterState;
    try { next = withCriteria(live.current.filter, field, criteria); } catch (e) { await showError(e); return; }
    await applyFilter(next);
  };

  const selectedField = (): { col: number; field: FieldDef } | undefined => {
    const { shape: s, selection: sel } = live.current;
    const col = sel.current?.cell[0] ?? sel.columns.first();
    return s && col !== undefined ? { col, field: s.design.fields[col] } : undefined;
  };
  /** Under the ribbon button that opened it (the grid's corner without one). */
  const menuAt = (id: CommandId) => {
    const r = document.querySelector(`[data-testid="cmd-${id}"]`)?.getBoundingClientRect() ?? wrap.current?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: r?.bottom ?? 0 };
  };

  /** Filter By Selection: the menu for the selected cell's stored value (a Lookup field: its bound value, not its text). */
  /** Zoom (Access's Zoom box): the selected text cell's text in a larger box. OK writes it back as an edit of that cell, as typing
   *  would (the new record's cell too). A field without text (a number, a Lookup) has none: nothing opens. */
  const zoomBox = async () => {
    flushCellEditor();
    const at = selectedField();
    const s = live.current.shape;
    if (!at || !s || at.field.props.lookup || (at.field.props.type !== 'shortText' && at.field.props.type !== 'longText')) return;
    const row = rowOf(live.current.selection) ?? rows.current.count;
    const cell = cellAt.current([at.col, row]);
    if (cell.kind !== GridCellKind.Text) return;
    const readOnly = live.current.ro;
    const next = await modal.custom<string>((close) => <ZoomBox text={cell.data} readOnly={readOnly} close={close} />, { titleKey: 'ribbon.cmd.zoom' });
    if (next === null || next === cell.data || readOnly) return;
    onCellEdited([at.col, row], { ...cell, data: next, displayData: next } as EditableGridCell);
  };
  /** Home › Records › More: Row Height (points, every row of this view) and Field Width (cm, the selected column: kept as a dragged width is). */
  const moreSize = async (what: 'rowHeight' | 'columnWidth') => {
    flushCellEditor();
    const info = localeInfo(live.current.shape?.locale ?? 'en-US');
    const points = (px: number) => new Intl.NumberFormat(info.locale, { maximumFractionDigits: 2, useGrouping: false }).format(px * 0.75);
    if (what === 'rowHeight') {
      const px = await modal.custom<number>((close) => <SizeBox label={t('datasheet.more.rowHeightLabel')} standardLabel={t('datasheet.more.standardHeight')}
        text={points(rowHeight)} standard={points(look.rowHeight)} parse={(s) => { const d = parseDecimal(s, info); return rowHeightPx(d === null ? null : Number(d)); }} close={close} />, { titleKey: 'datasheet.more.rowHeight' });
      if (px !== null) setRowHeight(px);
      return;
    }
    const at = selectedField(), names = pickedFields();
    if (!at || !names.length) return;
    // Access's unit: characters of the datasheet's font (the width of its digits)
    const digit = measure('0') || 7;
    const chars = (px: number) => points(px / 0.75 / digit);
    const px = await modal.custom<number>((close) => <SizeBox label={t('datasheet.more.columnWidthLabel')} standardLabel={t('datasheet.more.standardWidth')}
      text={chars(widths[at.field.name] ?? stored[at.field.name] ?? look.columnPx)} standard={chars(look.columnPx)}
      parse={(s) => { const d = parseDecimal(s, info); return d === null ? null : columnWidthPx(Number(d) * digit * 15); }}
      fit={{ label: t('datasheet.more.bestFit'), px: () => bestFit(at.col) }} close={close} />, { titleKey: 'datasheet.more.columnWidth' });
    if (px !== null) for (const name of names) onColumnResize({ id: name } as GridColumn, px);
  };
  /** Best Fit: the widest of the heading and of the column's cells in the rows read so far. ponytail: rows not loaded yet are not measured */
  const bestFit = (col: number): number => {
    const s = live.current.shape, fd = s?.design.fields[col];
    if (!s || !fd) return look.columnPx;
    let w = measure(fd.props.caption || fd.name) + 44; // the heading's type icon and menu arrow
    const n = Math.min(rows.current.count, MAX_LOADED_ROWS);
    for (let row = 0; row < n; row++) {
      if (!s.cache.fresh(row)) continue;
      const cell = cellAt.current([col, row]);
      if (cell.kind === GridCellKind.Text) w = Math.max(w, measure(cell.displayData));
    }
    return Math.min(2112, Math.max(20, Math.ceil(w) + 18)); // the cell's padding on both sides
  };
  /** The fields a More command acts on: the selected columns, else the current cell's. */
  const pickedFields = (): string[] => {
    const { shape: s, selection: sel } = live.current;
    const cols = sel.columns.length ? sel.columns.toArray() : sel.current ? [sel.current.cell[0]] : [];
    return s ? cols.flatMap((c) => (s.design.fields[c] ? [s.design.fields[c].name] : [])) : [];
  };
  /** Hidden fields changed (Hide, Unhide): kept with the layout like a dragged width (0: hidden); the current cell leaves a
   *  hidden column for the next shown one. One field at least stays shown. */
  const setHiddenFields = (next: ReadonlySet<string>) => {
    const s = live.current.shape;
    if (!s || s.design.fields.every((f) => next.has(f.name))) return;
    flushCellEditor();
    for (const fd of s.design.fields) {
      if (next.has(fd.name) !== hidden.has(fd.name)) dragged.current[fd.name] = next.has(fd.name) ? 0 : widths[fd.name] ?? stored[fd.name] ?? look.columnPx;
    }
    const sel = live.current.selection, cur = sel.current?.cell;
    const shown = s.design.fields.map((_, i) => i).filter((i) => !next.has(s.design.fields[i]!.name));
    if (sel.columns.length || (cur && !shown.includes(cur[0]))) {
      setSelection(cur ? cellSelection(shown.includes(cur[0]) ? cur[0] : shown.find((i) => i > cur[0]) ?? shown[shown.length - 1]!, cur[1]) : NO_SELECTION);
    }
    setHidden(next);
    backToGrid();
  };
  const hideFields = () => setHiddenFields(new Set([...hidden, ...pickedFields()]));
  /** Unhide Fields: Access's box of every field, ticked when shown. */
  const unhideFields = async () => {
    const s = live.current.shape;
    if (!s) return;
    const next = await modal.custom<string[]>((close) => <UnhideBox fields={s.design.fields.map((f) => ({ name: f.name, title: f.props.caption || f.name }))} hidden={hidden} close={close} />, { titleKey: 'datasheet.more.unhideTitle' });
    if (next) setHiddenFields(new Set(next));
  };
  /** Freeze Fields: the picked fields move to the left and stay there while the others scroll. */
  const freezeFields = (on = true) => {
    flushCellEditor();
    if (on) {
      const names = pickedFields(), next = [...frozen.filter((n) => !names.includes(n)), ...names];
      setFrozen(next);
      setOrder([...next, ...orderedNames(live.current.shape?.design.fields.map((f) => f.name) ?? [], order).filter((n) => !next.includes(n))]); // Unfreeze leaves them first
    } else setFrozen([]);
    backToGrid();
  };
  /** After a More command: the keys go to the grid again, not to the ribbon button (once the new columns are rendered). */
  const backToGrid = () => requestAnimationFrame(() => { if (!document.querySelector('[aria-modal="true"]') && !cellEditorOpen()) editor.current?.focus(); });
  const filterSelection = async () => {
    flushCellEditor();
    if (!(await commitRow())) return;
    const at = selectedField();
    const row = rowOf(live.current.selection);
    const s = live.current.shape;
    const saved = row === null || !s ? undefined : s.cache.get(row);
    if (!at || !s || row === null || !saved) return; // the new record, or a row still loading
    const value = saved.values[at.col] ?? null;
    try { selectionCriteria('equals', at.field, value); } catch (e) { await showError(e); return; } // a BLOB: refused before the menu
    const cell = cellAt.current([at.col, row]);
    const shown = cell.kind === GridCellKind.Text ? cell.displayData : editText(at.field, value, s.locale);
    setMenu({ kind: 'selection', field: at.field, value, shown, ...menuAt('filterSelection') });
  };
  const pickSelection = (kind: SelectionFilter) => {
    if (menu?.kind !== 'selection') return;
    setMenu(null);
    void setCriteria(menu.field.name, selectionCriteria(kind, menu.field, menu.value));
  };

  /** The column `col` (a header's drop-down), else the selected one. */
  const fieldAt = (col?: number) => {
    const s = live.current.shape;
    return col === undefined ? selectedField() : s && s.design.fields[col] ? { col, field: s.design.fields[col] } : undefined;
  };
  /** The column menu's « Filtres de texte » (…): its criteria in the Expression Builder (display form). Empty: no criteria on
   *  this field. A criterion the base refuses keeps the builder open with the text and the reason. */
  const filterField = async (col?: number) => {
    flushCellEditor();
    if (!(await commitRow())) return;
    const at = fieldAt(col);
    const s = live.current.shape;
    if (!at || !s) return;
    const ctx: DisplayContext = { lang: i18n.language.startsWith('fr') ? 'fr' : 'en', region: localeInfo(s.locale) };
    const current = live.current.filter.items.find((x) => x.field === at.field.name)?.criteria ?? '';
    let initial = current;
    try { if (current) initial = toDisplay(current, ctx, { criteria: true }); } catch { /* as stored */ }
    const validate = async (criteria: string): Promise<string | null> => {
      try {
        await countRows(activeFilter(withCriteria(live.current.filter, at.field.name, criteria)));
        return null;
      } catch (err) {
        const e = filterError(err);
        const code = bcErrorCode(e);
        return t(code && i18n.exists(`dialog.error.${code}`) ? `dialog.error.${code}` : 'dialog.error.unknown', { detail: e instanceof Error ? e.message : String(e) });
      }
    };
    const criteria = await modal.custom<string>((close) => (
      <ExpressionBuilder ctx={{ ...ctx, fields: s.design.fields.map((x) => x.name), criteria: true }} initial={initial} close={close} validate={validate}
        label={t('datasheet.filter.fieldLabel', { field: at.field.props.caption || at.field.name })} />
    ), { titleKey: 'datasheet.filter.fieldTitle' });
    if (criteria !== null) await setCriteria(at.field.name, criteria);
  };

  /** Home › Filter, a column header's drop-down (`col`, the menu at `at`): Access's column menu, with the field's list (R14)
   *  of the values its records have under the other fields' criteria. */
  const filterMenu = async (col?: number, at?: { x: number; y: number }) => {
    flushCellEditor();
    if (!(await commitRow())) return;
    const picked = fieldAt(col);
    const s = live.current.shape;
    if (!picked || !s) return;
    const { field } = picked;
    const lookup = live.current.lookups.get(field.name)?.list;
    const ctx = { locale: s.locale, lang: i18n.language.startsWith('fr') ? 'fr' as const : 'en' as const, ...(s.year4 ? { fourDigitYear: true } : {}) };
    const shown = (v: SqlValue) => {
      const c = toCell(field, v, { ...ctx, readOnly: true, lookup });
      return c.kind === GridCellKind.Text ? c.displayData : texts({ ...field, props: { ...field.props, format: field.props.format || 'yesNo' } }, v, ctx)[0]; // a Yes/No: Oui / Non
    };
    const filter = activeFilter(withCriteria(live.current.filter, field.name, ''));
    const src = live.current.source;
    const table = live.current.tab.name;
    let total: Promise<number> | undefined;
    const read = async (offset: number, limit: number) => {
      if (src) return api.sources.page(src, { offset, limit, sort: [{ field: field.name, dir: 'asc' }], ...(filter ? { filter } : {}), ...withParams() });
      total ??= api.rows.count(table, filter);
      const rows = limit ? (await api.rows.page(table, { offset, limit, sort: { field: field.name, dir: 'asc' }, ...(filter ? { filter } : {}) })).rows.map((r) => r.values) : [];
      return { rows, total: await total };
    };
    const m = await fieldMenu(field, at ?? menuAt('filter'), { ref: src ?? { kind: 'table', name: table }, info: s.src?.info, col: picked.col, byShown: !!lookup, read, shown,
      criteria: live.current.filter.items.find((x) => x.field === field.name)?.criteria, built: built.current.get(field.name) });
    if (live.current.shape === s) setMenu(m);
  };
  /** A menu's field, as a column (undefined: gone meanwhile, the selected one then). */
  const colOf = (field: FieldDef) => { const i = live.current.shape?.design.fields.findIndex((x) => x.name === field.name) ?? -1; return i < 0 ? undefined : i; };

  const toggleFilter = () => { const f = live.current.filter; if (f.items.length) void applyFilter({ ...f, active: !f.active }); };
  const clearFilter = () => { setMenu(null); void applyFilter(NO_FILTER); };


  const newRecord = async () => {
    if (live.current.ro) return;
    if (rows.current.more) { // the new record's row comes after all the rows: counted first, then rendered
      await countAll();
      await new Promise((r) => requestAnimationFrame(r));
    }
    editor.current?.focus();
    await editor.current?.appendRow(Math.max(0, gridOf(live.current.selection.current?.cell[0] ?? firstEditable())));
  };

  /** The record bar's Go: beyond the rows read (a query not counted yet), counted first. */
  const navGo = async (row: number) => {
    if (row >= rows.current.count && rows.current.more) await countAll();
    if (rows.current.count > 0) goRow(Math.min(row, rows.current.count - 1));
  };

  /** Before the view goes (mode change, tab, base or window closed): the pending row is saved, else discarding is asked. */
  const leave = async (): Promise<boolean> => {
    flushCellEditor();
    if (!(await commitRow())) {
      const r = await modal.confirm({ titleKey: 'datasheet.discardTitle', messageKey: 'datasheet.discard', params: { name: live.current.tab.name }, buttons: ['yes', 'no'], defaultButton: 'no' });
      if (r !== 'yes') return false;
      if (busyRef.current) return false; // cannot happen: the question waits for the save
      discardRow();
    }
    // Les largeurs tirées, une fois l'enregistrement quitté : la question d'Access (Oui enregistre, Non les oublie, Annuler reste)
    const ok = await leaveSheetLayout({ widths: dragged.current, pending: layoutChanged(), readOnly: !layoutOk(), name: live.current.tab.name,
      messageKey: live.current.source ? 'datasheet.saveQueryLayout' : 'datasheet.saveTableLayout', confirm: modal.confirm, save: saveLayout });
    if (ok) { dragged.current = {}; layoutKept.current = JSON.stringify(sheetLayout()); }
    return ok;
  };

  // ponytail: un lien (fichier ou serveur) garde ses largeurs pour la session, sans question (Access les garde dans le front-end) ; à ajouter avec `bc_links.props.meta`.
  const layoutOk = () => layoutSavable({ kind: live.current.source ? 'query' : 'table', ...(live.current.source ? { source: live.current.source } : {}), link: !!link, passThrough: passThrough.current, readOnly: live.current.readOnly, runtime: !design });
  /** Enregistre les largeurs tirées et le reste de la mise en forme : les champs et les métadonnées de la table (twips), ou la définition de la requête ; un échec est montré, l'onglet reste. */
  const saveLayout = async (w: Record<string, number>): Promise<boolean> => {
    const { tab: tb, source: src } = live.current;
    const sheet = sheetLayout(), changed = layoutChanged();
    try {
      if (!src) {
        if (Object.keys(w).length) await api.tables.saveColumnWidths(tb.name, toTwips(w));
        if (changed) await api.tables.saveSheetLayout(tb.name, sheet);
      } else {
        const def = (await api.objects.get('query', tb.name)).definition as Record<string, unknown>;
        const r = await api.objects.save('query', tb.name, withQuerySheet(withQueryWidths(def, w), sheet), tb.name);
        if (!r.ok) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, buttons: ['ok'] }); return false; }
      }
      layoutKept.current = JSON.stringify(sheet);
      setStored((k) => ({ ...k, ...Object.fromEntries(Object.entries(w).filter(([, px]) => px > 0)) })); // 0 : masqué, pas une largeur
      return true;
    } catch (e) { await showError(e); return false; }
  };

  // Ctrl+S : l'enregistrement, puis les largeurs tirées sans question (comme Enregistrer d'Access) ; prises avant l'écriture,
  // pour qu'une fermeture pendant celle-ci ne repose pas la question (échec : rendues, la question reviendra)
  const save = async () => {
    flushCellEditor();
    if (!(await commitRow(true)) || !layoutOk() || (!Object.keys(dragged.current).length && !layoutChanged())) return;
    const w = dragged.current;
    dragged.current = {};
    if (!(await saveLayout(w))) dragged.current = { ...w, ...dragged.current };
  };

  /** External Data › Export › Text File or Excel: this datasheet's rows, in its current order and filter (a query's with its
   *  parameters). The record being edited is saved first, as Access does; refused, nothing is exported. */
  const exportData = async (format: ExportFormat) => {
    flushCellEditor();
    if (!(await commitRow())) return;
    const { tab: tb, source: src, params: ps } = live.current;
    const q = query();
    return exportSource(modal, { ref: src ?? { kind: 'table', name: tb.name }, ...(ps ? { params: ps } : {}), ...(q.sort ? { sort: [q.sort] } : {}), ...(q.filter ? { filter: q.filter } : {}) }, tb.name, format);
  };

  /** Table Fields (a table tab only): the commands edit the structure through the same save as Design view. Read at call time. */
  const designOpenRef = useRef(designOpen);
  designOpenRef.current = designOpen;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const fieldsEnv = useRef<TableFieldsEnv>({
    get table() { return live.current.tab.name; }, get readOnly() { return live.current.ro; }, modal,
    design: () => live.current.shape?.design ?? null,
    selectedField: () => selectedFieldRef.current()?.field.name ?? null,
    flushPending: async () => { flushCellEditor(); return commitRowRef.current(); },
    designOpen: () => !!designOpenRef.current,
    tabs: () => tabsRef.current ?? [], dispatch: (a) => dispatch(a),
    // Resolves once the new structure is shown (or after 10 s, should the reload never come): the next command builds from it.
    reload: (select) => new Promise<void>((done) => {
      reloading.current.select = select;
      reloading.current.waiters.push(done);
      setTimeout(() => { reloading.current.select = null; done(); }, 10_000); // never selects that column at a later, unrelated reload
      dispatch({ type: 'tableSaved', name: live.current.tab.name });
    }),
    displayContext: () => (live.current.shape ? { lang: i18n.language.startsWith('fr') ? 'fr' : 'en', region: localeInfo(live.current.shape.locale) } : null),
  }).current;
  const fieldHandlers = useMemo(() => (currentUi().datasheetDesign ? design?.tableFieldsCommands(fieldsEnv) : undefined), [fieldsEnv]);   // O1 R9: read at mount
  commitRowRef.current = commitRow;
  selectedFieldRef.current = selectedField;
  /** Align Left, Center, Right: the picked fields' cells, else every shown field's (the same button again: back to the type's own alignment). */
  const alignFields = (to: 'left' | 'center' | 'right') => {
    const picked = pickedFields(), fields = live.current.shape?.design.fields ?? [];
    const names = picked.length ? picked : orderRef.current.map((i) => fields[i]!.name);
    setAligns((cur) => { const next = { ...cur }, off = names.every((n) => cur[n] === to); for (const n of names) { if (off) delete next[n]; else next[n] = to; } return next; });
  };
  /** Mise en forme de la feuille de données: the view's gridlines, background and gridline colours, underline. */
  const formatBox = async () => {
    const f = await modal.custom<SheetFormat>((close) => <FormatBox initial={{ ...gridlines, underline: look.underline, back: skin.back, grid: skin.grid }} close={close} />, { titleKey: 'ribbon.cmd.datasheetFormatting' });
    if (!f) return;
    setGridlines({ horizontal: f.horizontal, vertical: f.vertical });
    setSkin((k) => ({ ...k, back: f.back, grid: f.grid }));
    setFontOver((o) => ({ ...o, datasheetFontUnderline: f.underline }));
  };
  const cmds = useRef({ newRecord, deleteRecords, sortBy, leave, save, reloadRows, refreshIfMissed, filterMenu, filterSelection, toggleFilter, menuAt, exportData, findInSheet, replaceOne, replaceAll, spelling, discardRow, zoomBox, alignFields, formatBox });
  cmds.current = { newRecord, deleteRecords, sortBy, leave, save, reloadRows, refreshIfMissed, filterMenu, filterSelection, toggleFilter, menuAt, exportData, findInSheet, replaceOne, replaceAll, spelling, discardRow, zoomBox, alignFields, formatBox };
  const hasFilter = filter.items.length > 0;
  useEffect(() => {
    // Read-only (also a refused write before the session says so): the ribbon offers no record command.
    const offCommands = registerCommands(tab.id, {
      ...(ro ? {} : { newRecord: () => cmds.current.newRecord(), deleteRecord: () => cmds.current.deleteRecords() }),
      sortAsc: () => cmds.current.sortBy('asc'),
      sortDesc: () => cmds.current.sortBy('desc'),
      sortClear: () => cmds.current.sortBy(null),
      filter: () => cmds.current.filterMenu(),
      filterSelection: () => cmds.current.filterSelection(),
      filterAdvanced: () => setMenu({ kind: 'advanced', ...cmds.current.menuAt('filterAdvanced') }),
      ...(hasFilter ? { filterToggle: () => cmds.current.toggleFilter() } : {}),
      save: () => cmds.current.save(),
      ...(ro ? {} : { undo: () => cmds.current.discardRow() }),   // Quick Access Toolbar Undo: the pending record dropped (Escape)
      ...(tab.kind === 'table' && !source && fieldHandlers ? {
        ...fieldHandlers, moreFields: () => setPopup('moreFields'), dataType: () => setPopup('dataType'), format: () => setPopup('format'), validation: () => setPopup('validation'),
      } : {}),
      ...(!ro && (tab.kind === 'table' || tab.kind === 'query') ? { spelling: () => cmds.current.spelling() } : {}),
      ...(tab.kind === 'table' || tab.kind === 'query' ? findCommands({ openFind: (tab) => { setFindTab(tab); setFinding((k) => Math.abs(k) + 1); }, openMenu: (m) => setPopup(m) }) : {}),
      refresh: () => cmds.current.reloadRows(true), // Shift+F9 (Requery): a pass-through runs again (C6 R7)
      zoom: () => cmds.current.zoomBox(),
      moreRecords: () => setPopup('more'),
      textBold: () => setFontOver((f) => ({ ...f, datasheetFontWeight: (f.datasheetFontWeight ?? settings0.datasheetFontWeight) >= 600 ? 400 : 700 })),
      textItalic: () => setFontOver((f) => ({ ...f, datasheetFontItalic: !(f.datasheetFontItalic ?? settings0.datasheetFontItalic) })),
      textUnderline: () => setFontOver((f) => ({ ...f, datasheetFontUnderline: !(f.datasheetFontUnderline ?? settings0.datasheetFontUnderline) })),
      textFontSize: () => setPopup('fontSize'), textFont: () => setPopup('font'), textFontColor: () => setPopup('fontColor'), textBackColor: () => setPopup('backColor'),
      datasheetFormatting: () => void cmds.current.formatBox(),
      textAlignLeft: () => cmds.current.alignFields('left'), textAlignCenter: () => cmds.current.alignFields('center'), textAlignRight: () => cmds.current.alignFields('right'),
      recordsTotals: () => { setRegion(scrollAt.current); setTotalsOn((v) => !v); },
      datasheetGridlines: () => setGridlines((g) => { const on = !(g.horizontal || g.vertical); return { horizontal: on, vertical: on }; }), // both lines or none
      ...(tab.kind === 'table' || tab.kind === 'query' ? { exportText: () => cmds.current.exportData('text'), exportExcel: () => cmds.current.exportData('excel'), exportXml: () => cmds.current.exportData('xml'), exportMore: async () => { const f = await chooseMoreExport(modal); if (f) await cmds.current.exportData(f); } } : {}), // a form's datasheet exports the pane's selection
    });
    return offCommands;
  }, [tab.id, ro, hasFilter, fieldHandlers]);
  useEffect(() => registerCommandStates(tab.id, { datasheetGridlines: { enabled: true, active: gridlines.horizontal || gridlines.vertical } }), [tab.id, gridlines]);
  useEffect(() => registerCommandStates(tab.id, { recordsTotals: { enabled: true, active: totalsOn } }), [tab.id, totalsOn]);
  // a linked table (file or server) keeps its data macros in its own file: the Table tab's buttons are off (T2)
  useEffect(() => (link ? registerCommandStates(tab.id, Object.fromEntries([...DATA_EVENTS, 'namedMacro'].map((id) => [id, { enabled: false }]))) : undefined), [tab.id, link]);
  const alignAt = aligns[shape?.design.fields[selection.current?.cell[0] ?? selection.columns.first() ?? -1]?.name ?? ''];
  const fontSize = fontOver.datasheetFontSize ?? settings0.datasheetFontSize;
  useEffect(() => registerCommandStates(tab.id, {
    textBold: { enabled: true, active: (fontOver.datasheetFontWeight ?? settings0.datasheetFontWeight) >= 600 },
    textItalic: { enabled: true, active: fontOver.datasheetFontItalic ?? settings0.datasheetFontItalic },
    textUnderline: { enabled: true, active: look.underline },
    textAlignLeft: { enabled: true, active: alignAt === 'left' }, textAlignCenter: { enabled: true, active: alignAt === 'center' }, textAlignRight: { enabled: true, active: alignAt === 'right' },
  }), [tab.id, fontOver, settings0, look, alignAt]);
  useEffect(() => registerCommandStates(tab.id, { undo: { enabled: dirty } }), [tab.id, dirty]);   // Undo: a record being edited
  // Commands on the selected field are enabled by it: Field Size needs a Short Text one (a pending record is saved first by every command).
  const picked = shape?.design.fields[selection.current?.cell[0] ?? selection.columns.first() ?? -1]?.props;
  useEffect(() => {
    if (tab.kind !== 'table' || source) return;
    const has = picked !== undefined;
    const numeric = picked?.type === 'number' || picked?.type === 'currency';
    const keyed = has && picked.type !== 'autoNumber';
    return registerCommandStates(tab.id, {
      deleteField: { enabled: has }, nameCaption: { enabled: has }, defaultValue: { enabled: keyed }, fieldSize: { enabled: picked?.type === 'shortText' }, modifyLookups: { enabled: !!picked && LOOKUP_TYPES.includes(picked.type) },
      dataType: { enabled: has }, format: { enabled: has && FORMATS_BY_TYPE[picked.type].length > 0 },
      currencyFormat: { enabled: numeric }, percentFormat: { enabled: numeric }, commaFormat: { enabled: numeric },
      increaseDecimals: { enabled: numeric }, decreaseDecimals: { enabled: numeric },
      required: { enabled: keyed, active: !!picked?.required }, unique: { enabled: keyed, active: picked?.indexed === 'yesNoDuplicates' },
      indexed: { enabled: keyed, active: !!picked && picked.indexed !== 'no' },
    });
  }, [tab.id, tab.kind, source, picked]);
  useEffect(() => registerModeGuard(tab.id, () => cmds.current.leave()), [tab.id]);
  // C3 R10: another workstation wrote: the rows are read again, unless a row is being edited (pending, or a cell editor open
  // in this sheet): the pending row is placed by its index, which another workstation's insert, delete or sorted key would
  // move onto another record. A refresh skipped so is run once the editing ends (saved, dropped, the editor closed).
  useEffect(() => onDataRefresh(() => {
    const l = live.current;
    if (!l.shape) return;
    missedRefresh.current = true;
    cmds.current.refreshIfMissed(l.active && cellEditorOpen());
  }), []);
  useEffect(() => { if (!dirty) cmds.current.refreshIfMissed(live.current.active && cellEditorOpen()); }, [dirty]);

  // The totals: SQLite computes each field's function over every row the filter keeps (an aggregate request on the source). A
  // source that cannot (a server's) answers none: then every row is read first (as Find does, MAX_LOADED_ROWS at most) and the
  // function runs over the stored values. Delayed, so that the pages landing while one scrolls make one request.
  useEffect(() => {
    if (!totalsOn || !shape || !Object.keys(totalFns).length) return;
    let stale = false;
    const timer = setTimeout(() => void (async () => {
      const wanted = shape.design.fields.flatMap((fd, col) => {
        const fn = totalFns[fd.name];
        return fn && totalFnsFor(fd.props.type, !!fd.props.lookup).includes(fn) ? [{ fd, col, fn }] : [];
      });
      let all: (number | string | null)[] | undefined;
      try {
        const { tab: tb, source: src } = live.current;
        all = (await api.sources.page(src ?? { kind: 'table', name: tb.name }, { offset: 0, limit: 0, count: false, ...(activeFilter(filter) ? { filter: activeFilter(filter)! } : {}), ...withParams(), aggregates: wanted.map((w) => ({ field: w.fd.name, fn: w.fn })) })).aggregates;
      } catch { all = undefined; }
      if (stale) return;
      const n = Math.min(rows.current.count, MAX_LOADED_ROWS);
      if (!all && n) await shape.cache.ensure(0, n - 1, () => stale);
      if (stale) return;
      const out: Record<string, string> = {};
      wanted.forEach(({ fd, col, fn }, i) => {
        let v: number | string | null;
        if (all) v = all[i] ?? null;
        else {
          const values: unknown[] = [];
          for (let row = 0; row < n; row++) values.push(shape.cache.get(row)?.values[col]);
          v = totalOf(fn, values);
        }
        if (v === null) out[fd.name] = '';
        else if (fn === 'count' || fn === 'stdev' || fn === 'var') out[fd.name] = new Intl.NumberFormat(shape.locale, { maximumFractionDigits: 4 }).format(v as number);
        else {
          const cell = toCell(fd, v, { locale: shape.locale, lang: i18n.language.startsWith('fr') ? 'fr' : 'en', ...(shape.year4 ? { fourDigitYear: true } : {}), readOnly: true });
          out[fd.name] = cell.kind === GridCellKind.Text ? cell.displayData : String(v);
        }
      });
      setTotals(out);
    })().catch(() => { /* a page that cannot be read is told by the grid */ }), 150);
    return () => { stale = true; clearTimeout(timer); };
  }, [totalsOn, totalFns, shape, version, filter, i18n.language]);

  const getCellContent = useCallback(([col, row]: Item): GridCell => {
    if (!shape) return LOADING;
    const field = shape.design.fields[col];
    const p = buffer.pending;
    if (rows.current.more && row >= rows.current.count) { shape.cache.get(row); return LOADING; } // the next page, read here
    const isNew = row >= rows.current.count;
    const saved = isNew ? undefined : shape.cache.get(row);
    if (!isNew && !saved) return LOADING;
    // Read-only: during a save, other rows while one is pending, rows from before a sort/delete until their page lands.
    const locked = ro || busyRef.current || (p !== null && p.rowIndex !== row) || (!isNew && !shape.cache.fresh(row)) || (!!shape.src && !shape.src.editable[col])
      || (!isNew && Number.isNaN(saved!.rowid)) // a row without its key record (R5)
      || serverComputed(field.props); // a column its server computes (C4 M2)
    const lookup = lookups.get(field.name)?.list;
    let cell: GridCell;
    const looked = p?.rowIndex === row ? buffer.looked : {}; // AutoLookup's values (R4), under what was typed since
    if (p?.rowIndex === row && Object.hasOwn(p.changes, field.name)) cell = inputCell(field, p.changes[field.name], { readOnly: locked, locale: shape.locale, lookup });
    else if (Object.hasOwn(looked, field.name)) cell = toCell(field, looked[field.name] ?? null, { locale: shape.locale, lang: i18n.language.startsWith('fr') ? 'fr' : 'en', ...(shape.year4 ? { fourDigitYear: true } : {}), readOnly: locked, lookup });
    else if (isNew && field.props.type === 'autoNumber') cell = { kind: GridCellKind.Text, data: '', displayData: t('datasheet.newRecord'), allowOverlay: false, readonly: true };
    else {
      // The new record's row shows the default values, as stored values (display and edit text).
      const value = isNew ? shape.defaults[col] ?? null : saved?.values[col] ?? null;
      cell = toCell(field, value, { locale: shape.locale, lang: i18n.language.startsWith('fr') ? 'fr' : 'en', ...(shape.year4 ? { fourDigitYear: true } : {}), readOnly: locked, lookup });
    }
    if (checkTruncated && !(p?.rowIndex === row && Object.hasOwn(p.changes, field.name))) cell = truncateNumber(field, cell, widths[field.name] ?? look.columnPx, measure);
    if (error && p?.rowIndex === row && error.field === field.name) cell = { ...cell, themeOverride: { bgCell: palette.error } };
    const align = aligns[field.name];
    if (align && cell.kind === GridCellKind.Text) cell = { ...cell, contentAlign: align };
    return cell;
  }, [aligns, shape, lookups, ro, busy, error, palette, version, t, i18n.language, checkTruncated, measure, widths, look]); // busy, version: Glide redraws when the function changes

  const cellAt = useRef(getCellContent);
  cellAt.current = getCellContent;
  // Copy reads the cells of rows never shown: their pages are loaded first (a few at a time), then the cells are read. Rows
  // from MAX_LOADED_ROWS on are not read: blank unless already loaded (shown), and told once (Find tells it too: findInSheet).
  const cappedTold = useRef(false);
  const cellsFor = (r: Rectangle, signal: AbortSignal) => async () => {
    const s = live.current.shape;
    const last = Math.min(r.y + r.height - 1, rows.current.count - 1);
    if (s && last >= r.y && (await s.cache.ensure(r.y, last, () => signal.aborted)) && !cappedTold.current) {
      cappedTold.current = true;
      void modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'datasheet.findCapped', buttons: ['ok'] });
    }
    const cell = (x: number, y: number): GridCell =>
      y < MAX_LOADED_ROWS || s?.cache.fresh(y) ? cellAt.current([x, y]) : { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
    return Array.from({ length: r.height }, (_, dy) => Array.from({ length: r.width }, (_, dx) => cell(fieldOf(r.x + dx), r.y + dy)));
  };
  // Access's keys (O2): a move goes through select, as a click (leaving the pending row saves it; refused, the selection comes back)
  const keysEnv = useRef<EditKeysEnv>(null!);
  keysEnv.current = {
    // the keys move through the grid's columns (hidden fields skipped, frozen ones first)
    cellAt: ([c, r]) => cellAt.current([fieldOf(c), r]), selected: () => mapSelection(live.current.selection, gridOf).current,
    cols: () => orderRef.current.length, rows: () => rows.current.count + (rows.current.adding ? 1 : 0) + (live.current.ro ? 0 : 1), // past a new record: another one
    moveTo: ([col, row]) => select(cellSelection(fieldOf(col), row)),
  };
  useEditKeys(wrap, keysEnv);

  // A Lookup field gets its drop-down list, a field with an input mask the masked editor. Glide gives only the cell: the
  // edited one is the selected one.
  const provideEditor = useCallback<ProvideEditorCallback<GridCell>>((cell) => {
    const col = live.current.selection.current?.cell[0];
    const fd = col === undefined ? undefined : live.current.shape?.design.fields[col];
    if (cell.kind !== GridCellKind.Text || cell.readonly || !fd) return undefined;
    const lookup = live.current.lookups.get(fd.name);
    if (lookup) return lookup.editor as ReturnType<ProvideEditorCallback<GridCell>>;
    if (!fd.props.inputMask || !MASK_TYPES.includes(fd.props.type)) return undefined;
    return maskedEditor(fd.props.inputMask) as ReturnType<ProvideEditorCallback<GridCell>>;
  }, []);

  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => (buffer.pending?.rowIndex === row ? { bgCell: palette.pending, bgCellMedium: palette.pending } : undefined),
    [palette, version],
  );

  // A sorted column shows its arrow, a filtered one the funnel (the arrow over it when sorted too), in the accent colour.
  const columns = useMemo<GridColumn[]>(() => (shape?.design.fields ?? []).map((fd) => {
    const dir = sort?.field === fd.name ? sort.dir : null;
    const filtered = !!activeFilter(filter)?.some((x) => x.field === fd.name);
    return {
      id: fd.name, title: fd.props.caption || fd.name, width: widths[fd.name] ?? stored[fd.name] ?? look.columnPx, hasMenu: true, // the column menu (R14)
      ...headerDecor(fd.props.type, dir, filtered, palette.theme.accentColor!),
    };
  }), [shape, sort, filter, widths, stored, palette]);
  // What the grid gets: the shown fields' columns, cells and selection, in its own column indexes
  const gridColumns = useMemo(() => view.order.flatMap((i) => (columns[i] ? [columns[i]] : [])), [columns, view]);
  const gridCell = useCallback(([c, r]: Item): GridCell => { const col = view.order[c]; return col === undefined ? LOADING : getCellContent([col, r]); }, [getCellContent, view]);
  const gridSelection = useMemo(() => mapSelection(selection, (c) => view.order.indexOf(c)), [selection, view]);

  // The pending row's selector shows a pencil (drawn over the canvas, where Glide draws the row number).
  const pencil = useRowPencil(editor, wrap, buffer.pending?.rowIndex ?? null);

  /** « Edit List Items »: the field's own table, a query column's origin. */
  const listTarget = (field: string): { table: string; field: string } => {
    const origin = shape?.src?.info.fields.find((f) => f.name === field)?.origin;
    return origin ?? { table: tab.name, field };
  };

  if (unsupported) return <div className="doc-empty muted" role="alert" data-testid="datasheet-unsupported">{t('datasheet.unsupported')}</div>;
  if (!shape) return <div className="datasheet" aria-busy />;

  const { count, adding, more } = rows.current;
  return (
    <div className="datasheet">
      <div className="ds-grid" ref={wrap} role="region" aria-label={t('datasheet.grid', { name: tab.name })} aria-busy={busy} data-testid="datasheet"
        onPointerDownCapture={() => { appendClick.current = false; resizing.current = false; }}>
        <DataEditor ref={editor} theme={theme} verticalBorder={gridlines.vertical} drawCell={look.underline ? drawUnderline : undefined} minColumnWidth={20} maxColumnWidth={2112} columns={gridColumns} freezeColumns={view.frozen} rows={count + (more || adding ? 1 : 0)} headerIcons={HEADER_ICONS}
          getCellContent={gridCell} provideEditor={provideEditor} getRowThemeOverride={getRowThemeOverride} getCellsForSelection={cellsFor}
          gridSelection={gridSelection} onGridSelectionChange={(s) => select(mapSelection(s, fieldOf))} onCellEdited={([c, r], v) => onCellEdited([fieldOf(c), r], v)} onFinishedEditing={() => refreshIfMissed(false)}
          onRowAppended={ro || more ? undefined : onRowAppended} onCellClicked={(_, e) => { if (appendClick.current) e.preventDefault(); }} trailingRowOptions={ro || more ? undefined : { hint: t('datasheet.nav.new'), tint: true }}
          onDelete={(s) => onDelete(mapSelection(s, fieldOf))} onPaste={onPaste} onKeyDown={onKeyDown} keybindings={{ search: false, activateCell: ' |shift+Enter' }}
          rowMarkers={{ kind: 'clickable-number', width: 44 }} rowHeight={rowHeight} headerHeight={HEADER_HEIGHT} smoothScrollX smoothScrollY
          onColumnResize={onColumnResize} onHeaderMenuClick={(col, b) => { if (!resizing.current) void cmds.current.filterMenu(fieldOf(col), { x: b.x, y: b.y + b.height }); }}
          onVisibleRegionChanged={(r, tx) => { idle(); if (buffer.pending) scrolled(); scrollAt.current = { x: r.x, tx }; if (totalsOn) setRegion((cur) => (cur.x === r.x && cur.tx === tx ? cur : scrollAt.current)); }}
          width="100%" height="100%" />
        {(popup === 'goTo' || popup === 'select') && (
          <RibbonPopup anchor={popup === 'goTo' ? 'goTo' : 'selectMenu'} testId={`${popup}-menu`} labelKey={`ribbon.cmd.${popup === 'goTo' ? 'goTo' : 'selectMenu'}`} onClose={() => setPopup(null)}>
            {popup === 'goTo'
              ? (['first', 'previous', 'next', 'last', 'new'] as const).map((w) => (
                <button key={w} type="button" role="menuitem" data-testid={`goto-${w}`} disabled={w === 'new' && ro} onClick={() => { setPopup(null); void goTo(w); }}>{t(`datasheet.goTo.${w}`)}</button>
              ))
              : (['record', 'all'] as const).map((w) => (
                <button key={w} type="button" role="menuitem" data-testid={`select-${w}`} onClick={() => { setPopup(null); void selectRecords(w); }}>{t(`datasheet.select.${w}`)}</button>
              ))}
          </RibbonPopup>
        )}
        {popup === 'fontSize' && (
          <RibbonPopup anchor="textFontSize" testId="font-size-menu" labelKey="ribbon.cmd.textFontSize" onClose={() => setPopup(null)}>
            {FONT_SIZES.map((pt) => (
              <button key={pt} type="button" role="menuitemradio" aria-checked={pt === fontSize} data-testid={`font-size-${pt}`}
                onClick={() => { setPopup(null); setFontOver((f) => ({ ...f, datasheetFontSize: pt })); setRowHeight(datasheetLook({ ...settings0, datasheetFontSize: pt }).rowHeight); }}>{pt}</button>
            ))}
          </RibbonPopup>
        )}
        {popup === 'font' && (
          <RibbonPopup anchor="textFont" testId="font-menu" labelKey="ribbon.cmd.textFont" onClose={() => setPopup(null)}>
            {EMBEDDED_FONTS.map((f) => (
              <button key={f.family} type="button" role="menuitemradio" aria-checked={f.family === skin.font} data-testid={`font-${f.family.replace(/ /g, '-')}`} style={{ fontFamily: `"${f.family}"` }}
                onClick={() => { setPopup(null); setSkin((k) => ({ ...k, font: f.family })); }}>{f.family}</button>
            ))}
          </RibbonPopup>
        )}
        {(popup === 'fontColor' || popup === 'backColor') && (
          <RibbonPopup anchor={popup === 'fontColor' ? 'textFontColor' : 'textBackColor'} testId={`${popup}-menu`} role="dialog" labelKey={`ribbon.cmd.${popup === 'fontColor' ? 'textFontColor' : 'textBackColor'}`} onClose={() => setPopup(null)}>
            <Swatches testId={`${popup}-choices`} value={popup === 'fontColor' ? skin.text : skin.back}
              onPick={(c) => { setPopup(null); setSkin((k) => (popup === 'fontColor' ? { ...k, text: c } : { ...k, back: c })); }} />
          </RibbonPopup>
        )}
        {popup === 'more' && (
          <RibbonPopup anchor="moreRecords" testId="more-records-menu" labelKey="ribbon.cmd.moreRecords" onClose={() => setPopup(null)}>
            <button type="button" role="menuitem" data-testid="more-row-height" onClick={() => { setPopup(null); void moreSize('rowHeight'); }}>{t('datasheet.more.rowHeight')}</button>
            <button type="button" role="menuitem" data-testid="more-hide" disabled={!picked} onClick={() => { setPopup(null); hideFields(); }}>{t('datasheet.more.hide')}</button>
            <button type="button" role="menuitem" data-testid="more-unhide" onClick={() => { setPopup(null); void unhideFields(); }}>{t('datasheet.more.unhide')}</button>
            <button type="button" role="menuitem" data-testid="more-freeze" disabled={!picked} onClick={() => { setPopup(null); freezeFields(); }}>{t('datasheet.more.freeze')}</button>
            <button type="button" role="menuitem" data-testid="more-unfreeze" disabled={!frozen.length} onClick={() => { setPopup(null); freezeFields(false); }}>{t('datasheet.more.unfreeze')}</button>
            <button type="button" role="menuitem" data-testid="more-column-width" disabled={!picked} onClick={() => { setPopup(null); void moreSize('columnWidth'); }}>{t('datasheet.more.columnWidth')}</button>
          </RibbonPopup>
        )}
        {popup === 'moreFields' && design && (
          <RibbonPopup anchor="moreFields" testId="more-fields-menu" labelKey="ribbon.cmd.moreFields" onClose={() => setPopup(null)}>
            {design.moreFieldsFor(shape.design).map((m) => (
              <button key={`${m.type}-${m.numberSize ?? ''}`} type="button" role="menuitem" data-testid={`more-fields-${m.numberSize ?? m.type}`}
                onClick={() => { setPopup(null); void design?.addMoreField(fieldsEnv, m); }}>
                {m.numberSize ? `${t('fieldType.number')} — ${t(`fieldProp.numberSizes.${m.numberSize}`)}` : t(`fieldType.${m.type}`)}
              </button>
            ))}
          </RibbonPopup>
        )}
        {popup === 'dataType' && picked && design && (
          <RibbonPopup anchor="dataType" testId="data-type-menu" labelKey="ribbon.cmd.dataType" onClose={() => setPopup(null)}>
            {design.FIELD_TYPES.filter((x) => x !== 'autoNumber' || x === picked.type || design?.moreFieldsFor(shape.design).some((m) => m.type === 'autoNumber')).map((x) => (
              <button key={x} type="button" role="menuitemradio" aria-checked={x === picked.type} data-testid={`data-type-${x}`}
                onClick={() => { setPopup(null); void design?.setDataType(fieldsEnv, x); }}>{t(`fieldType.${x}`)}</button>
            ))}
          </RibbonPopup>
        )}
        {popup === 'format' && picked && design && (
          <RibbonPopup anchor="format" testId="format-menu" labelKey="ribbon.cmd.format" onClose={() => setPopup(null)}>
            <button type="button" role="menuitem" data-testid="format-none" onClick={() => { setPopup(null); void design?.setFormat(fieldsEnv, null); }}>{t('tableFields.formatNone')}</button>
            {FORMATS_BY_TYPE[picked.type].map((x) => (
              <button key={x} type="button" role="menuitem" data-testid={`format-${x}`} onClick={() => { setPopup(null); void design?.setFormat(fieldsEnv, x); }}>{t(`format.${x}`)}</button>
            ))}
          </RibbonPopup>
        )}
        {popup === 'validation' && design && (
          <RibbonPopup anchor="validation" testId="validation-menu" labelKey="ribbon.cmd.validation" onClose={() => setPopup(null)}>
            {(['fieldRule', 'fieldText', 'recordRule', 'recordText'] as ValidationItem[]).map((x) => (
              <button key={x} type="button" role="menuitem" data-testid={`validation-${x}`} disabled={x.startsWith('field') && !picked}
                onClick={() => { setPopup(null); void design?.editValidation(fieldsEnv, x); }}>{t(`tableFields.validation.${x}`)}</button>
            ))}
          </RibbonPopup>
        )}
        {pencil && <RowPencil at={pencil} background={palette.pending} title={t('datasheet.pending')} />}
        {listEdit !== null && shape && design && (
          // Saved: the structure changed, so the datasheet reads design, rows and lists again (tableSaved).
          <design.EditListDialog {...listTarget(listEdit)} locale={shape.locale} readOnly={ro}
            onClose={(saved) => {
              setListEdit(null);
              if (!saved) return;
              dispatch({ type: 'tableSaved', name: listTarget(listEdit).table });
              // a query's tab is not that table's: its lists are read again here
              if (shape.src) loadLookups((fd) => readLookup(fd), shape.design, shape.locale, editList).then((m) => { if (alive.current && live.current.shape === shape) setLookups(m); }, dataError);
            }} />
        )}
      </div>
      {totalsOn && (
        <div className="ds-totals" style={{ height: rowHeight }} role="group" aria-label={t('datasheet.totals.label')} data-testid="datasheet-totals">
          {totalsLayout(gridColumns.map((c) => ('width' in c ? c.width : look.columnPx)), view.frozen, region.x, region.tx, 44).map((b, c) => {
            const fd = shape.design.fields[view.order[c] ?? -1];
            if (!b || !fd) return null;
            const fn = totalFns[fd.name];
            return (
              <label key={fd.name} className={`ds-total${c < view.frozen ? ' ds-total-frozen' : ''}`} style={{ left: b.left, width: b.width }}>
                <span data-testid={`total-value-${fd.name}`}>{fn ? totals[fd.name] ?? '' : ''}</span>
                <select data-testid={`total-${fd.name}`} aria-label={`${t('datasheet.totals.label')} — ${fd.props.caption || fd.name}`} value={fn ?? ''}
                  onChange={(e) => { const v = e.target.value as TotalFn | ''; setTotalFns((cur) => { const next = { ...cur }; delete next[fd.name]; if (v) next[fd.name] = v; return next; }); }}>
                  <option value="">{t('datasheet.totals.none')}</option>
                  {totalFnsFor(fd.props.type, !!fd.props.lookup).map((f) => <option key={f} value={f}>{t(`report.totals.${TOTAL_LABEL[f]}`)}</option>)}
                </select>
              </label>
            );
          })}
          <span className="ds-total ds-total-head" style={{ left: 0, width: 44 }} title={t('datasheet.totals.label')}>Σ</span>
        </div>
      )}
      {error && (
        <div className="ds-error" role="alert" data-testid="datasheet-error">
          <CircleAlert className="ic ic-sm" aria-hidden />
          {t('datasheet.fieldError', errorParams(error))}
        </div>
      )}
      <NavigationBar current={rowOf(selection)} count={count} more={more} canAdd={!ro} note={notUpdatable ? t('query.readOnly') : undefined}
        onGo={(row) => void navGo(row)}
        filter={!filter.items.length ? 'none' : filter.active ? 'on' : 'off'} onToggleFilter={toggleFilter}
        onNew={() => void newRecord()} />
      {finding > 0 && <FindDialog key={finding} find={(o) => cmds.current.findInSheet(o)} initialTab={findTab}
        replace={{ one: (o, w) => cmds.current.replaceOne(o, w), all: (o, w) => cmds.current.replaceAll(o, w) }}
        close={() => { setFinding((k) => -k); requestAnimationFrame(() => { if (!cellEditorOpen()) editor.current?.focus(); }); }} />}
      {menu && (
        <FilterMenu menu={menu} hasFilter={menu.kind === 'field' ? filter.items.some((x) => x.field === menu.field.name) : filter.items.length > 0}
          onPick={pickSelection} onClear={clearFilter}
          onClose={(escaped) => { setMenu(null); if (escaped) editor.current?.focus(); }}
          onSort={(dir) => { setMenu(null); if (menu.kind === 'field') void sortBy(dir, colOf(menu.field)); }}
          onClearField={() => { setMenu(null); if (menu.kind === 'field') void setCriteria(menu.field.name, ''); }}
          onTyped={() => { setMenu(null); if (menu.kind === 'field') void filterField(colOf(menu.field)); }}
          onValues={(b) => {
            setMenu(null);
            if (menu.kind !== 'field') return;
            if (b) built.current.set(menu.field.name, b);
            void setCriteria(menu.field.name, b?.criteria ?? '');
          }} />
      )}
    </div>
  );
}
