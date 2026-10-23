// Mode Feuille de données d'un formulaire (M10 : le mode `datasheet` de son onglet) : une grille Glide, une colonne par
// contrôle de saisie du Détail (ordre de tabulation, titre de l'étiquette attachée), les textes des contrôles (Format,
// calculé, liste déroulante avec l'éditeur de liste de la feuille de données). La saisie va à l'enregistrement courant ;
// changer de ligne change d'enregistrement (enregistré d'abord) ; les erreurs teintent leur cellule et s'affichent dessous.
import {
  DataEditor, GridCellKind, type DataEditorRef, type EditableGridCell, type GridCell, type GridColumn,
  type GridKeyEventArgs, type GridSelection, type Item, type ProvideEditorCallback, type ProvideEditorCallbackResult, type TextCell, type Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { ControlDef } from '../../shared/design/model';
import { bool, truthy } from '../../shared/expr/library';
import { editText, toCell, type LookupCell } from '../datasheet/datasheet-cells';
import { installEditorCommitFix } from '../datasheet/glide-keyboard';
import {
  cellSelection, HEADER_HEIGHT, HEADER_ICONS, headerDecor, LOADING, ROW_HEIGHT, rowOf, RowPencil, scrollGridToRow, useColumnWidths,
  useNonAsciiTyping, usePalette, useRowPencil,
} from '../datasheet/grid-shared';
import { pasteAllowed } from '../datasheet/datasheet-cells';
import { sameName } from '../../shared/field-types';
import { useModal } from '../shell/Modal';
import { lookupEditor } from '../datasheet/LookupEditor';
import { NavigationBar } from '../datasheet/NavigationBar';
import '../datasheet/datasheet.css';
import { typedValue } from './calc';
import { controlTexts, isUnbound } from './control-values';
import { isOn } from './controls/CheckBoxCtl';
import { fieldOf, listChoose, listCurrent, NO_LIST, unboundText, type RunCtx, readOnlyNote } from './controls/run-ctx';
import { rowOfText, rowOfValue } from './row-source';
import { controlEnabled, prop } from './run-model';
import type { SingleFormProps } from './SingleFormView';
import type { SheetColumn } from './views';

installEditorCommitFix();

const NUMERIC = ['autoNumber', 'number', 'currency'];
const isList = (c: ControlDef) => c.kind === 'comboBox' || c.kind === 'listBox';
const isCalc = (c: ControlDef) => { const s = prop(c, 'ControlSource'); return typeof s === 'string' && s.startsWith('='); };

export interface FormDatasheetProps extends Omit<SingleFormProps, 'doc'> {
  columns: SheetColumn[];
  byName: Map<string, ControlDef>;
  rowCtx(i: number): RunCtx;                                    // another row's context (the current row uses x)
  focusHook: MutableRefObject<((name: string) => boolean) | null>;   // set here: the form's focusCtl selects the control's cell
  ro: boolean; locale: string; lang: 'fr' | 'en';
  onRow(i: number): Promise<boolean>;                           // another row selected: its record made current (saved first)
  onFocusControl(name: string): void;                           // a column selected on the current record
  onEdited(c: ControlDef): void;                                // a cell edited: the control's checks (Limit To List, rule)
  onEscape(c: ControlDef): void;
  onDeleteRecord(): void;                                        // the current record's row selected, then Delete
  error: string | null;                                         // the first error (a field no control shows included)
  name: string;
  onTabOut?(dir: 1 | -1): boolean;                              // a subform: Tab past the last column (or before the first) leaves it at its end
}

export function FormDatasheet(p: FormDatasheetProps) {
  const { columns, byName, x, rowCtx, root, focusHook, ro, locale, lang, error } = p;
  const { t } = useTranslation();
  const palette = usePalette();
  const modal = useModal();
  const [widths, onColumnResize] = useColumnWidths();
  const [, scrolled] = useState(0);
  const editor = useRef<DataEditorRef>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const { snap } = x;
  const current = snap.index;
  const count = snap.status === 'ready' && !snap.info ? 1 : snap.total + (snap.canAdd ? 1 : 0);   // an unbound form: one row
  const [sel, setSelState] = useState<GridSelection>(() => cellSelection(0, current));

  // Combo and list boxes: the datasheet's list editor, on the rows the form read (Task 9's loadRowSource)
  const editors = useMemo(() => new Map(columns.flatMap((sc): [string, ProvideEditorCallbackResult<TextCell>][] => {
    const c = byName.get(sc.control);
    const list = x.lists[sc.control];
    if (!c || !isList(c) || isCalc(c) || !list?.data.rows.length) return [];
    const f = x.info?.fields.find((k) => k.name === sc.field);
    return [[sc.control, lookupEditor(list.data, { label: sc.title, edit: (v) => (f ? editText(f, v, locale) : v === null ? '' : String(v)) })]];
  })), [columns, byName, x.lists, x.info, locale]);

  const live = useRef({ sel, current, editors, onFocusControl: p.onFocusControl });
  live.current = { ...live.current, current, editors, onFocusControl: p.onFocusControl };
  const setSel = (s: GridSelection | ((cur: GridSelection) => GridSelection)) => {
    const next = typeof s === 'function' ? s(live.current.sel) : s;
    live.current.sel = next;
    setSelState(next);
  };

  const scrollToRow = (row: number) => scrollGridToRow(wrap.current, row);

  // the selection follows the current record (navigation bar, new record, a move refused)
  useEffect(() => {
    setSel((cur) => (rowOf(cur) === current ? cur : cellSelection(cur.current?.cell[0] ?? 0, current)));
    requestAnimationFrame(() => scrollToRow(current));
  }, [current]);

  // the form's focus on a control: its cell on the current record (a control with no column: the cell selected)
  useEffect(() => {
    focusHook.current = (name) => {
      const col = columns.findIndex((c) => c.control === name);
      setSel(cellSelection(col >= 0 ? col : live.current.sel.current?.cell[0] ?? 0, live.current.current));
      if (col >= 0) live.current.onFocusControl(name);   // the control focused, as a focus event says it in Form view
      scrollToRow(live.current.current);
      // now (a message box opening next gives the focus back to the grid), and once the selection is rendered (Glide focuses
      // the selected cell), unless a dialog has taken the focus meanwhile
      const focus = () => { if (!document.querySelector('[aria-modal="true"]')) editor.current?.focus(); };
      focus();
      // again once drawn, unless the focus has gone meanwhile to another form's control (Ctrl+Tab out of a subform)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const a = document.activeElement;
        if (!a?.closest('.frun') || wrap.current?.contains(a)) focus();
      }));
      return true;
    };
    return () => { focusHook.current = null; };
  }, [columns, focusHook]);

  const select = (s: GridSelection) => {
    setSel(s);
    const col = s.current?.cell[0];
    const focusCol = () => { if (col !== undefined && columns[col]) p.onFocusControl(columns[col].control); };
    const row = rowOf(s);
    if (row === null || row === live.current.current) { focusCol(); return; }
    void p.onRow(row).then((ok) => {
      if (ok) focusCol();
      else setSel((cur) => (rowOf(cur) === live.current.current ? cur : cellSelection(col ?? 0, live.current.current)));   // back on the record in error
    });
  };

  /** The control's cell on a row: Access's shown text (Format, list text, calculation), editable on the current record only. */
  const cellOf = (c: ControlDef, rx: RunCtx, isCurrent: boolean): GridCell => {
    const b = fieldOf(c, rx);
    const en = controlEnabled(c, rx.snap, b?.f ?? null);
    const readonly = !isCurrent || ro || en.disabled || en.readOnly;
    const text = (display: string, data = display, locked = readonly, right = false): GridCell =>
      ({ kind: GridCellKind.Text, data, displayData: display, allowOverlay: true, readonly: locked, ...(right ? { contentAlign: 'right' as const } : {}) });
    if (isCalc(c)) {   // calculated: read-only, its result for this row
      const r = rx.results[c.name];
      return text(!r ? '' : r.ok ? r.text : t(`form.calc.${r.code}`), undefined, true);
    }
    if (isList(c)) {
      const list = rx.lists[c.name];
      if (b && b.pending === undefined && list) return toCell(b.f, b.stored, { locale, lang, readOnly: readonly, lookup: list.data });
      const { row, text: shown } = listCurrent(c, rx);   // typed, unbound
      const cell: LookupCell = { kind: GridCellKind.Text, data: shown, displayData: shown, allowOverlay: true, readonly, bound: row >= 0 ? (list ?? NO_LIST).data.rows[row].value : null };
      return cell;
    }
    if (c.kind === 'checkBox' || c.kind === 'optionButton') {
      const u = rx.unbound[c.name]?.value ?? null;
      const on = isUnbound(c) ? u !== null && truthy(u) === true : b ? isOn(b.stored, b.pending) : false;
      return { kind: GridCellKind.Boolean, data: on, allowOverlay: false, readonly };
    }
    if (isUnbound(c)) return text(unboundText(c, rx));
    if (b) {
      if (rx.snap.isNew && b.f.type === 'autoNumber') return text(t('datasheet.newRecord'), '', true);
      const tx = controlTexts(c, b.f, b.stored, b.pending, rx.display);
      return text(tx.display, tx.edit, readonly, NUMERIC.includes(b.f.type));
    }
    return text(prop(c, 'ControlSource') ? t('form.calc.name') : '', '', true);   // bound to an unknown field: #Name?
  };

  const getCellContent = useCallback(([col, row]: Item): GridCell => {
    const c = columns[col] && byName.get(columns[col].control);
    if (!c) return LOADING;
    const isCurrent = row === current;
    const rx = isCurrent ? x : rowCtx(row);
    if (rx.snap.status !== 'ready' && !isUnbound(c)) return LOADING;
    const cell = cellOf(c, rx, isCurrent);
    return isCurrent && x.errors[c.name] !== undefined ? { ...cell, themeOverride: { bgCell: palette.error } } : cell;
  }, [columns, byName, x, rowCtx, current, palette, ro, locale, lang, t]);   // x changes with each record change or entry: Glide redraws
  const cellAt = useRef(getCellContent);
  cellAt.current = getCellContent;

  const onCellEdited = ([col, row]: Item, cell: EditableGridCell) => {
    const c = columns[col] && byName.get(columns[col].control);
    if (!c || row !== live.current.current || ro || isCalc(c)) return;
    const b = fieldOf(c, x);
    const en = controlEnabled(c, x.snap, b?.f ?? null);
    if (en.disabled || en.readOnly) return;
    if (isList(c)) {
      if (cell.kind !== GridCellKind.Text) return;
      // the editor gives the chosen row's bound value as its edit text, else the text typed
      const { data } = x.lists[c.name] ?? NO_LIST;
      let r = rowOfValue(data, cell.data, b ? (v) => editText(b.f, v, locale) : String);
      if (r < 0) r = rowOfText(data, cell.data);
      listChoose(c, x, r, cell.data);
    } else if (cell.kind === GridCellKind.Boolean) {
      if (isUnbound(c)) x.editUnbound(c, bool(cell.data === true)); else if (b) x.edit(b.f, cell.data === true);
    } else if (cell.kind === GridCellKind.Text) {
      if (isUnbound(c)) x.editUnbound(c, typedValue(cell.data, locale), cell.data); else if (b) x.edit(b.f, cell.data);
    } else return;
    p.onEdited(c);
  };

  const onKeyDown = (e: GridKeyEventArgs) => {
    const col = live.current.sel.current?.cell[0];
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && col === (e.shiftKey ? 0 : columns.length - 1) && p.onTabOut?.(e.shiftKey ? -1 : 1)) {
      e.cancel();
      e.preventDefault();   // the browser's own Tab would then move the focus once more
      return;
    }
    if (e.key !== 'Escape') return;   // outside a cell editor (which handles its own): the cell's change, then the record
    const c = col === undefined ? undefined : columns[col] && byName.get(columns[col].control);
    if (!c) return;
    e.cancel();
    p.onEscape(c);
  };

  useNonAsciiTyping(wrap, cellAt, () => live.current.sel.current?.cell);   // « é » opens the editor too (as DatasheetView)

  const provideEditor = useCallback<ProvideEditorCallback<GridCell>>((cell) => {
    const col = live.current.sel.current?.cell[0];
    const sc = col === undefined ? undefined : columns[col];
    if (cell.kind !== GridCellKind.Text || cell.readonly || !sc) return undefined;
    return live.current.editors.get(sc.control) as ReturnType<ProvideEditorCallback<GridCell>>;
  }, [columns]);

  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => (row === current && snap.dirty ? { bgCell: palette.pending, bgCellMedium: palette.pending } : undefined),
    [current, snap.dirty, palette],
  );
  // as the table's datasheet: the field's type icon, the sort arrow or the funnel of the sort and filter applied
  const { sort, filter } = snap;
  const gridColumns = useMemo<GridColumn[]>(() => columns.map((c) => {
    const f = c.field === null ? undefined : x.info?.fields.find((k) => k.name === c.field);
    const dir = f ? sort.find((k) => sameName(k.field, f.name))?.dir ?? null : null;
    const filtered = !!f && filter.some((k) => sameName(k.field, f.name));
    return { id: c.control, title: c.title, width: widths[c.control] ?? c.width, ...headerDecor(f?.type ?? null, dir, filtered, palette.theme.accentColor!) };
  }), [columns, widths, sort, filter, x.info, palette]);
  const pencil = useRowPencil(editor, wrap, snap.dirty ? current : null);   // the modified record's selector

  /** Delete: the current record's row selected (its selector) is deleted the form's way (confirmed); cells of the current record
   *  are cleared; nothing else (several rows, a range over several rows, while busy). */
  const onDelete = (s: GridSelection): boolean => {
    if (ro || snap.busy) return false;
    if (s.rows.length) {
      if (s.rows.length === 1 && s.rows.first() === live.current.current) p.onDeleteRecord();
      return false;
    }
    const r = s.current?.range;
    return !!r && r.height === 1 && r.y === live.current.current;
  };
  /** A paste fills one row at most, the current record's (as the table's datasheet, A1). */
  const onPaste = (target: Item, values: readonly (readonly string[])[]): boolean => {
    if (ro || snap.busy || target[1] !== live.current.current) return false;
    if (pasteAllowed({ rows: values.length })) return true;
    void modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'datasheet.pasteOneRow', buttons: ['ok'] });
    return false;
  };

  return (
    <div className="frun frun-sheet" ref={root} data-testid="form-run">
      <div className="ds-grid" ref={wrap} role="region" aria-label={t('datasheet.grid', { name: p.name })} aria-busy={snap.busy} data-testid="form-datasheet">
        <DataEditor ref={editor} theme={palette.theme} columns={gridColumns} rows={count} headerIcons={HEADER_ICONS}
          getCellContent={getCellContent} provideEditor={provideEditor} getRowThemeOverride={getRowThemeOverride} getCellsForSelection
          gridSelection={sel} onGridSelectionChange={select} onCellEdited={onCellEdited} onKeyDown={onKeyDown}
          onDelete={onDelete} onPaste={onPaste} keybindings={{ search: false }} onColumnResize={onColumnResize}
          onVisibleRegionChanged={() => { if (snap.dirty) scrolled((n) => n + 1); }}
          rowMarkers={{ kind: 'clickable-number', width: 44 }} rowHeight={ROW_HEIGHT} headerHeight={HEADER_HEIGHT} smoothScrollX smoothScrollY
          width="100%" height="100%" />
        {pencil && <RowPencil at={pencil} background={palette.pending} title={t('datasheet.pending')} />}
      </div>
      {error && (
        <div className="ds-error" role="alert" data-testid="form-datasheet-error">
          <CircleAlert className="ic ic-sm" aria-hidden />
          {error}
        </div>
      )}
      <NavigationBar current={snap.status === 'ready' ? current : null} count={snap.total} canAdd={snap.canAdd}
        filter={p.filter} onGo={p.onGo} onNew={p.onNew} onToggleFilter={p.onToggleFilter} note={readOnlyNote(x)} />
    </div>
  );
}
