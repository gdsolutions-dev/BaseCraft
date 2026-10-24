// Mode Feuille de données : grille virtualisée (Glide), enregistrement par ligne comme Access, tri, filtres, barre de navigation.
import {
  CompactSelection, DataEditor, GridCellKind, type DataEditorRef, type EditableGridCell, type GridCell,
  type GridColumn, type GridKeyEventArgs, type GridSelection, type Item, type ProvideEditorCallback, type ProvideEditorCallbackResult,
  type Rectangle, type TextCell, type Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldFilter, LookupData, RowPage, RowWriteResult } from '../../shared/api';
import type { CellInput, FieldErrorCode, SqlValue } from '../../shared/coerce';
import { FORMATS_BY_TYPE } from '../../shared/expr/format';
import { toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { lookupOf, MASK_TYPES, sameName, type FieldDef, type FieldType, type TableDesign } from '../../shared/field-types';
import { localeInfo } from '../../shared/locale-format';
import { toOrigin, type RecordSourceRef, type SourceInfo } from '../../shared/record-source';
import { api } from '../bridge';
import type { DocViewProps } from '../shell/DocumentTabs';
import { ExpressionBuilder } from '../expr/ExpressionBuilder';
import { bcErrorCode, useErrorDialog, useModal } from '../shell/Modal';
import { exportSource } from '../exchange/export';
import { registerCommands, registerCommandStates, registerModeGuard, type CommandId } from '../shell/ribbon-model';
import { RibbonPopup } from '../designer/RibbonPopup';
import { FIELD_TYPES } from '../table-design/FieldPropertiesPanel';
import { addMoreField, editValidation, moreFieldsFor, setDataType, setFormat, tableFieldsCommands, type TableFieldsEnv, type ValidationItem } from '../table-fields/table-fields-commands';
import { defaultValues, editText, fromEdit, inputCell, lookupList, pasteAllowed, toCell, type LookupList } from './datasheet-cells';
import { activeFilter, NO_FILTER, selectionCriteria, withCriteria, type FilterState, type SelectionFilter } from './filter-model';
import { installEditorCommitFix } from './glide-keyboard';
import {
  cellSelection, flushCellEditor, HEADER_HEIGHT, HEADER_ICONS, headerDecor, LOADING, NO_SELECTION, ROW_HEIGHT, rowOf, RowPencil, scrollGridToRow,
  useColumnWidths, useNonAsciiTyping, usePalette, useRowPencil,
} from './grid-shared';
import { EditListDialog } from './EditListDialog';
import { findCommands, goToRow, type GoTo } from './find-commands';
import { FilterMenu, type FilterMenuState } from './FilterMenu';
import { hasLookupEditor, lookupEditor } from './LookupEditor';
import { maskedEditor } from './MaskedEditor';
import { NavigationBar } from './NavigationBar';
import { MAX_LOADED_ROWS, PageCache } from './page-cache';
import { confirmDelete, fieldErrorParams, showRelatedRefusal } from './record-messages';
import { RowBuffer } from './row-buffer';
import './datasheet.css';

installEditorCommitFix();

/** A query's datasheet: its columns (`editable`: from the key table of an updatable query) and, per column, the index of its
 *  field in the key table's design (a written row's values come back in that order). */
type SourceShape = { info: SourceInfo; editable: boolean[]; back: (number | null)[] };
type Shape = { design: TableDesign; locale: string; cache: PageCache; defaults: SqlValue[] /* shown on the new record's row */; src?: SourceShape };
type Sort = { field: string; dir: 'asc' | 'desc' } | null;
type FieldError = { field: string; code: FieldErrorCode; message?: string; table?: string };
/** Lookup fields' lists, by field name (a field whose list is empty or gone is shown and edited as a plain field). */
type Lookups = Map<string, { list: LookupList; editor: ProvideEditorCallbackResult<TextCell> }>;


const WIDTH: Record<FieldType, number> = { autoNumber: 80, shortText: 170, longText: 240, number: 110, currency: 120, dateTime: 150, yesNo: 80, hyperlink: 200 };



/** The lists of the design's Lookup fields, read once per view (and again on a reload or when the tab comes back). `editList`:
 *  « Edit List Items » of a value list that allows it. */
async function loadLookups(read: (fd: FieldDef) => Promise<LookupData> | null, design: TableDesign, locale: string, editList: { open(field: string): void; disabled(): boolean }): Promise<Lookups> {
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
        ...(l.kind === 'values' && l.allowValueListEdits ? { editList: { open: () => editList.open(fd.name), disabled: editList.disabled } } : {}),
      }),
    });
  }
  return out;
}

/** A query's column (SourceField) as a field of the grid. */
const columnOf = (f: SourceInfo['fields'][number]): FieldDef => ({ name: f.name, props: f.props });

/**
 * Without `source`: a table's datasheet (rows.*, tables.design). With `source` (a query, A3): its rows through sources.page
 * with `params` (kept for the tab's life); writes only through an updatable source, on its key table (toOrigin), only in its
 * key table's columns; a multi-table source is read-only (no new record, `query.readOnly` in the navigation bar).
 */
export interface DatasheetProps extends DocViewProps { source?: Exclude<RecordSourceRef, { kind: 'table' }>; params?: Record<string, CellInput> }

export function DatasheetView({ tab, active, readOnly, dispatch, source, params, designOpen }: DatasheetProps) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const palette = usePalette();
  const editor = useRef<DataEditorRef>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const [lookups, setLookups] = useState<Lookups>(new Map());
  // The ribbon menu open under its button: Table Fields (More Fields, Data Type, Format, Validation) and Home › Find (Go To, Select).
  const [popup, setPopup] = useState<'moreFields' | 'dataType' | 'format' | 'validation' | 'goTo' | 'select' | null>(null);
  const [searching, setSearching] = useState(false); // Home › Find: the grid's search bar
  // Table Fields commands waiting for the structure to be read again, and the column to select then.
  const reloading = useRef<{ select: string | null; waiters: (() => void)[] }>({ select: null, waiters: [] });
  const [listEdit, setListEdit] = useState<string | null>(null); // the field whose « Edit List Items » box is open
  const editList = { open: setListEdit, disabled: () => live.current.ro };
  const [sort, setSort] = useState<Sort>(null);
  const [filter, setFilter] = useState<FilterState>(NO_FILTER);
  const [menu, setMenu] = useState<FilterMenuState | null>(null);
  const [selection, setSelectionState] = useState<GridSelection>(NO_SELECTION);
  const [error, setError] = useState<FieldError | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [refused, setRefused] = useState(false); // a write was refused as read-only (lock lost meanwhile)
  const [busy, setBusy] = useState(false); // a row is being saved: the grid is locked
  const [widths, onColumnResize] = useColumnWidths();
  const [version, bump] = useReducer((n: number) => n + 1, 0); // rows or pending edits changed: redraw
  const [, scrolled] = useReducer((n: number) => n + 1, 0);
  // Synchronous state (read right after an await, before React renders): saved rows count, new record's row shown.
  const rows = useRef({ count: 0, adding: false });
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
  const notUpdatable = !!shape?.src && !shape.src.info.updatable; // a multi-table (or grouped…) query
  const ro = readOnly || refused || notUpdatable;
  const live = useRef({ tab, shape, sort, filter, selection, ro, lookups, source, params });
  live.current = { tab, shape, sort, filter, selection, ro, lookups, source, params };
  /** The order and filter of every page request (set in `live` before React renders: read right after an await). */
  const query = () => {
    const { sort: s, filter: f } = live.current;
    const items = activeFilter(f);
    return { ...(s ? { sort: s } : {}), ...(items ? { filter: items } : {}) };
  };

  // The data, from the table (rows.*) or from the query (sources.page with the tab's parameter values; writes on its key table).
  const withParams = () => (live.current.params ? { params: live.current.params } : {});
  const countRows = (filter?: FieldFilter[]): Promise<number> => {
    const src = live.current.source;
    if (!src) return api.rows.count(live.current.tab.name, filter);
    return api.sources.page(src, { offset: 0, limit: 0, ...(filter ? { filter } : {}), ...withParams() }).then((p) => p.total);
  };
  const pageRows = async (offset: number, limit: number): Promise<RowPage> => {
    const src = live.current.source;
    const q = query();
    if (!src) return api.rows.page(live.current.tab.name, { offset, limit, ...q });
    const p = await api.sources.page(src, { offset, limit, ...(q.sort ? { sort: [q.sort] } : {}), ...(q.filter ? { filter: q.filter } : {}), ...withParams() });
    return { rows: p.rows.map((values, i) => ({ rowid: p.rowids[i] ?? 0 /* read-only source: never written */, values })) };
  };
  /** The table rows are written to and deleted from (a query's key table). */
  const dataTable = () => live.current.shape?.src?.info.keyTable ?? live.current.tab.name;
  const readLookup = (fd: FieldDef, src = live.current.shape?.src): Promise<LookupData> | null => {
    if (!live.current.source) return api.rows.lookup(live.current.tab.name, fd.name);
    const origin = src?.info.fields.find((f) => f.name === fd.name)?.origin; // a query's column: its field's list
    return origin ? api.rows.lookup(origin.table, origin.field) : null;
  };
  /** A query's row: its columns to the key table's fields (toOrigin), the answer back to its columns. */
  const writeSource = async (src: SourceShape, rowid: number | null, changes: Record<string, CellInput>): Promise<RowWriteResult> => {
    const w = toOrigin(src.info, changes);
    if (!w) return { ok: false, errors: [{ field: Object.keys(changes)[0] ?? '', code: 'readOnly', message: t('query.readOnly') }] };
    const r = rowid === null ? await api.rows.insert(w.table, w.values) : await api.rows.update(w.table, rowid, w.values);
    if (!r.ok) {
      const column = (field: string) => src.info.fields.find((f) => f.origin && sameName(f.origin.table, w.table) && sameName(f.origin.field, field))?.name ?? field;
      return { ok: false, errors: r.errors.map((e) => ({ ...e, field: column(e.field) })) };
    }
    return { ok: true, rowid: r.rowid, values: src.back.map((i) => (i === null ? null : r.values[i] ?? null)) };
  };

  /** Also in `live` at once: a save that ends before React renders reads the selection the user just moved to. */
  const setSelection = (sel: GridSelection) => { live.current.selection = sel; setSelectionState(sel); };
  const [buffer] = useState(() => new RowBuffer((rowid, changes) => {
    const src = live.current.shape?.src;
    if (src) return writeSource(src, rowid, changes);
    const name = live.current.tab.name; // renamed meanwhile: the row goes to the table under its new name
    return rowid === null ? api.rows.insert(name, changes) : api.rows.update(name, rowid, changes);
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
          // The box is part of the attempt: a save asked while it is open shares this one (never a second box).
          if (out.status === 'failed') { await showFailure(p.rowIndex, out.errors); return false; }
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
                setRows({ count });
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
        await writeError(e);
        const at = live.current.selection.current?.cell; // the row stays to be saved, selected (Access)
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
        let src: SourceShape | undefined;
        const [table, settings] = await Promise.all([source ? null : api.tables.design(name), api.app.getSettings()]);
        if (source) {
          const info = await api.sources.describe(source);
          const key = info.updatable && info.keyTable !== undefined ? await api.tables.design(info.keyTable) : null;
          const fromKey = info.fields.map((f) => !!key && !!f.origin && sameName(f.origin.table, key.name));
          const back = info.fields.map((f, k) => (fromKey[k] ? key!.fields.findIndex((x) => sameName(x.name, f.origin!.field)) : -1));
          src = { info, editable: fromKey, back: back.map((i) => (i < 0 ? null : i)) };
        }
        const design: TableDesign = src ? { name, fields: src.info.fields.map(columnOf) } : table!;
        // A sort and the criteria of fields still there are kept (a reload after a structure change); the others go.
        const has = (field: string) => design.fields.some((x) => sameName(x.name, field));
        const keptSort = live.current.sort && has(live.current.sort.field) ? live.current.sort : null;
        const items = live.current.filter.items.filter((x) => has(x.field));
        let keptFilter: FilterState = items.length ? { ...live.current.filter, items } : NO_FILTER;
        let count: number;
        try {
          count = await countRows(activeFilter(keptFilter));
        } catch (e) {
          if (keptFilter === NO_FILTER) throw e;
          keptFilter = NO_FILTER; // a criterion the changed field no longer accepts
          count = await countRows();
        }
        const [defaults, lists] = await Promise.all([defaultValues(design, settings.region), loadLookups((fd) => readLookup(fd, src), design, settings.region, editList)]);
        if (!current) return;
        const cache = new PageCache((offset, limit) => pageRows(offset, limit));
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
        rows.current = { count, adding: false };
        setShape({ design, locale: settings.region, cache, defaults, ...(src ? { src } : {}) });
        setLookups(lists);
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
  }, [tab.reloadToken]);

  // Rows changed elsewhere (an import appended to this table, or Refresh): the rows and their count are read again; structure,
  // sort, filter and a pending row stay.
  const reloadRows = () => {
    void countRows(activeFilter(live.current.filter)).then((count) => {
      if (!alive.current) return;
      live.current.shape?.cache.invalidate();
      setRows({ count });
    }, dataError);
  };
  useEffect(() => { if (tab.dataToken) reloadRows(); }, [tab.dataToken]);

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

  const scrollToRow = (row: number) => scrollGridToRow(wrap.current, row);
  const goRow = (row: number) => {
    const col = live.current.selection.current?.cell[0] ?? firstEditable();
    select(cellSelection(col, row));
    // Once the selection is rendered (Glide selects the first visible cell when it gets the focus without one), and
    // the scroll too (Glide's focus scrolls by a delta from its last rendered position). Only once the row left is saved:
    // refused, the message box keeps the focus and the grid stays on the cell in error.
    void (committing.current ?? Promise.resolve(true)).then((ok) => {
      if (ok) requestAnimationFrame(() => { scrollToRow(row); requestAnimationFrame(() => editor.current?.focus()); });
    });
  };
  /** Home > Find > Go To. */
  const goTo = (where: GoTo) => {
    const target = goToRow(where, rowOf(live.current.selection), rows.current.count);
    if (target === 'new') void newRecord();
    else if (target !== null) goRow(target);
  };
  /** Home > Find > Select: the current record, or all records. */
  const selectRecords = (what: 'record' | 'all') => {
    const { count, adding } = rows.current;
    const row = rowOf(live.current.selection);
    if (what === 'record' ? row === null : count === 0) return;
    select({ columns: CompactSelection.empty(), rows: CompactSelection.fromSingleSelection(what === 'all' ? [0, count + (adding ? 1 : 0)] : row!) });
  };

  const firstEditable = () => {
    const s = live.current.shape;
    return Math.max(0, s?.design.fields.findIndex((x, k) => x.props.type !== 'autoNumber' && (!s.src || s.src.editable[k])) ?? 0);
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
    if (rowid === undefined || (s.src && !s.src.editable[col])) return; // a query's computed column, or another table's
    const field = s.design.fields[col];
    buffer.edit(row, rowid, field.name, fromEdit(field, cell));
    bump();
  };

  const onRowAppended = async (): Promise<undefined> => {
    appendClick.current = true; // a keyboard append has no mouse-up: the next pointer press clears it
    const shown = rows.current.count + (rows.current.adding ? 1 : 0);
    if (live.current.ro || !(await commitRow())) return undefined; // a row in error keeps the focus
    // A row saved out of the filter: the grid has no more rows than before, and Glide, which waits for more, would never
    // select the new record. Appended again once rendered with the new count, it does.
    if (rows.current.count + 1 <= shown) {
      const col = live.current.selection.current?.cell[0] ?? firstEditable();
      requestAnimationFrame(() => requestAnimationFrame(() => void editor.current?.appendRow(col)));
      return undefined;
    }
    if (!rows.current.adding) setRows({ adding: true });
    return undefined; // Glide then selects the new row (the old trailing row's index) and opens its editor
  };

  /** Rowids of the given rows (ascending), as shown; rows never loaded are read in one request. */
  const rowids = async (indices: number[]): Promise<number[]> => {
    const s = live.current.shape;
    const ids = indices.map((i) => s?.cache.get(i)?.rowid);
    if (ids.some((x) => x === undefined)) {
      const lo = indices[0];
      const page = await pageRows(lo, indices[indices.length - 1] - lo + 1);
      indices.forEach((i, k) => { ids[k] ??= page.rows[i - lo]?.rowid; });
    }
    return ids.filter((x): x is number => x !== undefined);
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
    const existing = targets.filter((i) => i < rows.current.count);
    if (existing.length) {
      // The real keys decide (A2-R14, A2-R15): ON DELETE CASCADE deletes related records, SET NULL / SET DEFAULT modify them.
      if (!(await confirmDelete(modal, dataTable(), existing.length))) return;
    }
    if (dropsPending || targets.includes(rows.current.count)) discardRow();
    if (!existing.length) return;
    try {
      const r = await api.rows.delete(dataTable(), await rowids(existing));
      if (!r.ok) await showRelatedRefusal(modal, r);
    } catch (e) {
      await writeError(e);
    }
    try {
      const n = await countRows(activeFilter(live.current.filter));
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

  /** A criterion a query source refuses comes back as bc:invalidArgument (contract 1.2): shown as the table's bc:invalidFilter. */
  const filterError = (e: unknown): unknown => (live.current.source && bcErrorCode(e) === 'invalidArgument' ? new Error('bc:invalidFilter') : e);

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
    setRows({ count, adding: false });
    const col = live.current.selection.current?.cell[0] ?? firstEditable();
    setSelection(count ? cellSelection(col, 0) : NO_SELECTION);
    // Back to the grid (not to the ribbon or the closed menu), once the selection is rendered; never behind a dialog.
    requestAnimationFrame(() => { if (!document.querySelector('[aria-modal="true"]')) editor.current?.focus(); });
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

  /** Access's Filter on the selected column: its criteria in the Expression Builder (display form). Empty: no criteria on this
   *  field. A criterion the base refuses keeps the builder open with the text and the reason. */
  const filterField = async () => {
    flushCellEditor();
    if (!(await commitRow())) return;
    const at = selectedField();
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

  const toggleFilter = () => { const f = live.current.filter; if (f.items.length) void applyFilter({ ...f, active: !f.active }); };
  const clearFilter = () => { setMenu(null); void applyFilter(NO_FILTER); };


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

  /** External Data › Export › Text File or Excel: this datasheet's rows, in its current order and filter (a query's with its
   *  parameters). The record being edited is saved first, as Access does; refused, nothing is exported. */
  const exportData = async (format: 'text' | 'excel') => {
    flushCellEditor();
    if (!(await commitRow())) return;
    const { tab: tb, source: src, params: ps } = live.current;
    const q = query();
    return exportSource(modal, { ref: src ?? { kind: 'table', name: tb.name }, ...(ps ? { params: ps } : {}), ...(q.sort ? { sort: [q.sort] } : {}), ...(q.filter ? { filter: q.filter } : {}) }, tb.name, format);
  };

  /** Table Fields (a table tab only): the commands edit the structure through the same save as Design view. Read at call time. */
  const designOpenRef = useRef(designOpen);
  designOpenRef.current = designOpen;
  const fieldsEnv = useRef<TableFieldsEnv>({
    get table() { return live.current.tab.name; }, get readOnly() { return live.current.ro; }, modal,
    design: () => live.current.shape?.design ?? null,
    selectedField: () => selectedFieldRef.current()?.field.name ?? null,
    flushPending: async () => { flushCellEditor(); return commitRowRef.current(); },
    designOpen: () => !!designOpenRef.current,
    // Resolves once the new structure is shown (or after 10 s, should the reload never come): the next command builds from it.
    reload: (select) => new Promise<void>((done) => {
      reloading.current.select = select;
      reloading.current.waiters.push(done);
      setTimeout(() => { reloading.current.select = null; done(); }, 10_000); // never selects that column at a later, unrelated reload
      dispatch({ type: 'tableSaved', name: live.current.tab.name });
    }),
    displayContext: () => (live.current.shape ? { lang: i18n.language.startsWith('fr') ? 'fr' : 'en', region: localeInfo(live.current.shape.locale) } : null),
  }).current;
  const fieldHandlers = useMemo(() => tableFieldsCommands(fieldsEnv), [fieldsEnv]);
  commitRowRef.current = commitRow;
  selectedFieldRef.current = selectedField;
  const cmds = useRef({ newRecord, deleteRecords, sortBy, leave, save, reloadRows, filterField, filterSelection, toggleFilter, menuAt, exportData });
  cmds.current = { newRecord, deleteRecords, sortBy, leave, save, reloadRows, filterField, filterSelection, toggleFilter, menuAt, exportData };
  const hasFilter = filter.items.length > 0;
  useEffect(() => {
    // Read-only (also a refused write before the session says so): the ribbon offers no record command.
    const offCommands = registerCommands(tab.id, {
      ...(ro ? {} : { newRecord: () => cmds.current.newRecord(), deleteRecord: () => cmds.current.deleteRecords() }),
      sortAsc: () => cmds.current.sortBy('asc'),
      sortDesc: () => cmds.current.sortBy('desc'),
      sortClear: () => cmds.current.sortBy(null),
      filter: () => cmds.current.filterField(),
      filterSelection: () => cmds.current.filterSelection(),
      filterAdvanced: () => setMenu({ kind: 'advanced', ...cmds.current.menuAt('filterAdvanced') }),
      ...(hasFilter ? { filterToggle: () => cmds.current.toggleFilter() } : {}),
      save: () => cmds.current.save(),
      ...(tab.kind === 'table' && !source ? {
        ...fieldHandlers, moreFields: () => setPopup('moreFields'), dataType: () => setPopup('dataType'), format: () => setPopup('format'), validation: () => setPopup('validation'),
      } : {}),
      ...(tab.kind === 'table' || tab.kind === 'query' ? findCommands({ openSearch: () => setSearching(true), openMenu: (m) => setPopup(m) }) : {}),
      refresh: () => cmds.current.reloadRows(), // Shift+F9 (Requery)
      ...(tab.kind === 'table' || tab.kind === 'query' ? { exportText: () => cmds.current.exportData('text'), exportExcel: () => cmds.current.exportData('excel') } : {}), // a form's datasheet exports the pane's selection
    });
    return offCommands;
  }, [tab.id, ro, hasFilter, fieldHandlers]);
  // Commands on the selected field are enabled by it: Field Size needs a Short Text one (a pending record is saved first by every command).
  const picked = shape?.design.fields[selection.current?.cell[0] ?? selection.columns.first() ?? -1]?.props;
  useEffect(() => {
    if (tab.kind !== 'table' || source) return;
    const has = picked !== undefined;
    const numeric = picked?.type === 'number' || picked?.type === 'currency';
    const keyed = has && picked.type !== 'autoNumber';
    return registerCommandStates(tab.id, {
      deleteField: { enabled: has }, nameCaption: { enabled: has }, defaultValue: { enabled: keyed }, fieldSize: { enabled: picked?.type === 'shortText' },
      dataType: { enabled: has }, format: { enabled: has && FORMATS_BY_TYPE[picked.type].length > 0 },
      currencyFormat: { enabled: numeric }, percentFormat: { enabled: numeric }, commaFormat: { enabled: numeric },
      increaseDecimals: { enabled: numeric }, decreaseDecimals: { enabled: numeric },
      required: { enabled: keyed, active: !!picked?.required }, unique: { enabled: keyed, active: picked?.indexed === 'yesNoDuplicates' },
      indexed: { enabled: keyed, active: !!picked && picked.indexed !== 'no' },
    });
  }, [tab.id, tab.kind, source, picked]);
  useEffect(() => registerModeGuard(tab.id, () => cmds.current.leave()), [tab.id]);

  const getCellContent = useCallback(([col, row]: Item): GridCell => {
    if (!shape) return LOADING;
    const field = shape.design.fields[col];
    const p = buffer.pending;
    const isNew = row >= rows.current.count;
    const saved = isNew ? undefined : shape.cache.get(row);
    if (!isNew && !saved) return LOADING;
    // Read-only: during a save, other rows while one is pending, rows from before a sort/delete until their page lands.
    const locked = ro || busyRef.current || (p !== null && p.rowIndex !== row) || (!isNew && !shape.cache.fresh(row)) || (!!shape.src && !shape.src.editable[col]);
    const lookup = lookups.get(field.name)?.list;
    let cell: GridCell;
    if (p?.rowIndex === row && Object.hasOwn(p.changes, field.name)) cell = inputCell(field, p.changes[field.name], { readOnly: locked, locale: shape.locale, lookup });
    else if (isNew && field.props.type === 'autoNumber') cell = { kind: GridCellKind.Text, data: '', displayData: t('datasheet.newRecord'), allowOverlay: false, readonly: true };
    else {
      // The new record's row shows the default values, as stored values (display and edit text).
      const value = isNew ? shape.defaults[col] ?? null : saved?.values[col] ?? null;
      cell = toCell(field, value, { locale: shape.locale, lang: i18n.language.startsWith('fr') ? 'fr' : 'en', readOnly: locked, lookup });
    }
    if (error && p?.rowIndex === row && error.field === field.name) cell = { ...cell, themeOverride: { bgCell: palette.error } };
    return cell;
  }, [shape, lookups, ro, busy, error, palette, version, t, i18n.language]); // busy, version: Glide redraws when the function changes

  const cellAt = useRef(getCellContent);
  cellAt.current = getCellContent;
  // Find and copy read the cells of rows never shown: their pages are loaded first (a few at a time), then the cells are read.
  // Rows from MAX_LOADED_ROWS on are not read for them: blank unless already loaded (shown), and told once.
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
    return Array.from({ length: r.height }, (_, dy) => Array.from({ length: r.width }, (_, dx) => cell(r.x + dx, r.y + dy)));
  };
  useNonAsciiTyping(wrap, cellAt, () => live.current.selection.current?.cell);

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
      id: fd.name, title: fd.props.caption || fd.name, width: widths[fd.name] ?? WIDTH[fd.props.type],
      ...headerDecor(fd.props.type, dir, filtered, palette.theme.accentColor!),
    };
  }), [shape, sort, filter, widths, palette]);

  // The pending row's selector shows a pencil (drawn over the canvas, where Glide draws the row number).
  const pencil = useRowPencil(editor, wrap, buffer.pending?.rowIndex ?? null);

  /** « Edit List Items »: the field's own table, a query column's origin. */
  const listTarget = (field: string): { table: string; field: string } => {
    const origin = shape?.src?.info.fields.find((f) => f.name === field)?.origin;
    return origin ?? { table: tab.name, field };
  };

  if (unsupported) return <div className="doc-empty muted" role="alert" data-testid="datasheet-unsupported">{t('datasheet.unsupported')}</div>;
  if (!shape) return <div className="datasheet" aria-busy />;

  const { count, adding } = rows.current;
  return (
    <div className="datasheet">
      <div className="ds-grid" ref={wrap} role="region" aria-label={t('datasheet.grid', { name: tab.name })} aria-busy={busy} data-testid="datasheet"
        onPointerDownCapture={() => { appendClick.current = false; }}>
        <DataEditor ref={editor} theme={palette.theme} columns={columns} rows={count + (adding ? 1 : 0)} headerIcons={HEADER_ICONS}
          getCellContent={getCellContent} provideEditor={provideEditor} getRowThemeOverride={getRowThemeOverride} getCellsForSelection={cellsFor}
          gridSelection={selection} onGridSelectionChange={select} onCellEdited={onCellEdited}
          onRowAppended={ro ? undefined : onRowAppended} onCellClicked={(_, e) => { if (appendClick.current) e.preventDefault(); }} trailingRowOptions={ro ? undefined : { hint: t('datasheet.nav.new'), tint: true }}
          onDelete={onDelete} onPaste={onPaste} onKeyDown={onKeyDown} keybindings={{ search: false }} showSearch={searching} onSearchClose={() => setSearching(false)}
          rowMarkers={{ kind: 'clickable-number', width: 44 }} rowHeight={ROW_HEIGHT} headerHeight={HEADER_HEIGHT} smoothScrollX smoothScrollY
          onColumnResize={onColumnResize}
          onVisibleRegionChanged={() => { if (buffer.pending) scrolled(); }}
          width="100%" height="100%" />
        {(popup === 'goTo' || popup === 'select') && (
          <RibbonPopup anchor={popup === 'goTo' ? 'goTo' : 'selectMenu'} testId={`${popup}-menu`} labelKey={`ribbon.cmd.${popup === 'goTo' ? 'goTo' : 'selectMenu'}`} onClose={() => setPopup(null)}>
            {popup === 'goTo'
              ? (['first', 'previous', 'next', 'last', 'new'] as const).map((w) => (
                <button key={w} type="button" role="menuitem" data-testid={`goto-${w}`} disabled={w === 'new' && ro} onClick={() => { setPopup(null); goTo(w); }}>{t(`datasheet.goTo.${w}`)}</button>
              ))
              : (['record', 'all'] as const).map((w) => (
                <button key={w} type="button" role="menuitem" data-testid={`select-${w}`} onClick={() => { setPopup(null); selectRecords(w); }}>{t(`datasheet.select.${w}`)}</button>
              ))}
          </RibbonPopup>
        )}
        {popup === 'moreFields' && (
          <RibbonPopup anchor="moreFields" testId="more-fields-menu" labelKey="ribbon.cmd.moreFields" onClose={() => setPopup(null)}>
            {moreFieldsFor(shape.design).map((m) => (
              <button key={`${m.type}-${m.numberSize ?? ''}`} type="button" role="menuitem" data-testid={`more-fields-${m.numberSize ?? m.type}`}
                onClick={() => { setPopup(null); void addMoreField(fieldsEnv, m); }}>
                {m.numberSize ? `${t('fieldType.number')} — ${t(`fieldProp.numberSizes.${m.numberSize}`)}` : t(`fieldType.${m.type}`)}
              </button>
            ))}
          </RibbonPopup>
        )}
        {popup === 'dataType' && picked && (
          <RibbonPopup anchor="dataType" testId="data-type-menu" labelKey="ribbon.cmd.dataType" onClose={() => setPopup(null)}>
            {FIELD_TYPES.filter((x) => x !== 'autoNumber' || x === picked.type || moreFieldsFor(shape.design).some((m) => m.type === 'autoNumber')).map((x) => (
              <button key={x} type="button" role="menuitemradio" aria-checked={x === picked.type} data-testid={`data-type-${x}`}
                onClick={() => { setPopup(null); void setDataType(fieldsEnv, x); }}>{t(`fieldType.${x}`)}</button>
            ))}
          </RibbonPopup>
        )}
        {popup === 'format' && picked && (
          <RibbonPopup anchor="format" testId="format-menu" labelKey="ribbon.cmd.format" onClose={() => setPopup(null)}>
            <button type="button" role="menuitem" data-testid="format-none" onClick={() => { setPopup(null); void setFormat(fieldsEnv, null); }}>{t('tableFields.formatNone')}</button>
            {FORMATS_BY_TYPE[picked.type].map((x) => (
              <button key={x} type="button" role="menuitem" data-testid={`format-${x}`} onClick={() => { setPopup(null); void setFormat(fieldsEnv, x); }}>{t(`format.${x}`)}</button>
            ))}
          </RibbonPopup>
        )}
        {popup === 'validation' && (
          <RibbonPopup anchor="validation" testId="validation-menu" labelKey="ribbon.cmd.validation" onClose={() => setPopup(null)}>
            {(['fieldRule', 'fieldText', 'recordRule', 'recordText'] as ValidationItem[]).map((x) => (
              <button key={x} type="button" role="menuitem" data-testid={`validation-${x}`} disabled={x.startsWith('field') && !picked}
                onClick={() => { setPopup(null); void editValidation(fieldsEnv, x); }}>{t(`tableFields.validation.${x}`)}</button>
            ))}
          </RibbonPopup>
        )}
        {pencil && <RowPencil at={pencil} background={palette.pending} title={t('datasheet.pending')} />}
        {listEdit !== null && shape && (
          // Saved: the structure changed, so the datasheet reads design, rows and lists again (tableSaved).
          <EditListDialog {...listTarget(listEdit)} locale={shape.locale} readOnly={ro}
            onClose={(saved) => {
              setListEdit(null);
              if (!saved) return;
              dispatch({ type: 'tableSaved', name: listTarget(listEdit).table });
              // a query's tab is not that table's: its lists are read again here
              if (shape.src) loadLookups((fd) => readLookup(fd), shape.design, shape.locale, editList).then((m) => { if (alive.current && live.current.shape === shape) setLookups(m); }, dataError);
            }} />
        )}
      </div>
      {error && (
        <div className="ds-error" role="alert" data-testid="datasheet-error">
          <CircleAlert className="ic ic-sm" aria-hidden />
          {t('datasheet.fieldError', errorParams(error))}
        </div>
      )}
      <NavigationBar current={rowOf(selection)} count={count} canAdd={!ro} note={notUpdatable ? t('query.readOnly') : undefined}
        onGo={goRow}
        filter={!filter.items.length ? 'none' : filter.active ? 'on' : 'off'} onToggleFilter={toggleFilter}
        onNew={() => void newRecord()} />
      {menu && (
        <FilterMenu menu={menu} hasFilter={filter.items.length > 0} onPick={pickSelection} onClear={clearFilter}
          onClose={(escaped) => { setMenu(null); if (escaped) editor.current?.focus(); }} />
      )}
    </div>
  );
}
