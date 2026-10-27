// Mode Création d'une requête, comme dans Access : le volet des tables en haut, la grille de création en bas, séparés par une
// barre déplaçable. La grille n'est jamais stockée : elle est relue du SQL enregistré (parseSql puis toQbe) et réécrite en SQL
// à l'enregistrement (fromQbe puis printSql), avec la disposition des boîtes. Le même éditeur sert au Générateur de requête
// (RowSourceBuilder : Contenu d'une liste de choix, Source d'un formulaire ou d'un état), qui rend un SQL au lieu d'enregistrer une requête. Le mode SQL fait partie du
// Mode Création (DocMode inchangé) : la grille s'y écrit en SQL, le texte revient dans la grille s'il se lit et si elle peut le
// montrer (sinon, comme dans Access, la requête reste en mode SQL), et l'enregistrement y garde le texte normalisé.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Relation } from '../../shared/api';
import { ExprSyntaxError, type ExprErrorCode, type Span } from '../../shared/expr/ast';
import type { DisplayContext } from '../../shared/expr/localize';
import { sameName } from '../../shared/field-types';
import { localeInfo } from '../../shared/locale-format';
import { isSelectBody, type ParamDecl, type Query } from '../../shared/query/ast';
import { invalidQueryError } from '../../shared/query/definition';
import { printSql } from '../../shared/query/print';
import { fromQbe, oneLine, toQbe, type IsField, type QbeDesign, type QbeKind } from '../../shared/query/qbe';
import { parseSql } from '../../shared/query/sql-parser';
import { api } from '../bridge';
import { autoLayout, type Point } from '../relations/relations-layout';
import type { DocViewProps } from '../shell/DocumentTabs';
import type { AppDispatch } from '../shell/nav-menu';
import type { DocTab } from '../state/app-state';
import { useErrorDialog, useModal } from '../shell/Modal';
import { ModalTab, shellDispatch } from '../shell/modal-tab';
import { nameErrorKey } from '../shell/NavPane';
import { MODAL_SCOPE, modeGuard, registerCommandStates, registerCommands, registerModeGuard, type CommandId } from '../shell/ribbon-model';
import { Splitter } from '../shell/Splitter';
import { SPLIT_DEFAULT, loadRatio, pxToRatio, ratioToPx, saveRatio } from '../shell/splitter-model';
import { JoinDialog } from './JoinDialog';
import { QbeGrid } from './QbeGrid';
import { designProblem, editable, pruneInvalid, emptyQbe, fieldEntry, outputAll, qbeReducer, type GridColumn, type QbeAction } from './qbe-edit';
import { ParametersDialog } from './ParametersDialog';
import { QueryPropertiesDialog, TopValuesDialog, type QueryProps } from './QueryProperties';
import { QueryRunView } from './QueryRunView';
import { runActionFlow } from './run-action';
import { SqlView } from './SqlView';
import { ShowTableDialog } from './ShowTableDialog';
import { TablePane, type PaneBox } from './TablePane';
import './query-design.css';

// ---------- The catalog: tables, queries, relations, and the fields of each source shown ----------

type Fields = PaneBox['fields'];
interface Catalog { tables: string[]; queries: string[]; relations: Relation[]; fields: Map<string, Fields> }

/** A source's fields: a table's design (its key marked), else a saved query's output; none when it cannot be read. */
async function readFields(name: string, tables: string[]): Promise<Fields> {
  try {
    if (tables.some((n) => sameName(n, name))) return (await api.tables.design(name)).fields.map((f) => ({ name: f.name, key: !!f.props.primaryKey }));
    return (await api.sources.describe({ kind: 'query', name })).fields.map((f) => ({ name: f.name, key: false }));
  } catch {
    return []; // a missing source: its box is empty, saving or running the query names it
  }
}

/** Lists read again with `token`; `ensure` reads the fields of new sources (and resolves once they are known). */
function useCatalog(token: number) {
  const [catalog, setCatalog] = useState<Catalog>({ tables: [], queries: [], relations: [], fields: new Map() });
  const cache = useRef({ lists: null as Promise<Omit<Catalog, 'fields'>> | null, fields: new Map<string, Fields>() });
  const lists = () => (cache.current.lists ??= Promise.all([api.tables.list(), api.objects.list('query'), api.relations.list()])
    .then(([t, q, r]) => ({ tables: t.map((x) => x.name), queries: q.map((x) => x.name), relations: r })));
  // A new token (a save, a change elsewhere): the lists and the fields already shown are read again; until then the
  // previous ones stay (the boxes never go empty, the Table row and the parameter rule keep working).
  useEffect(() => {
    const shown = [...cache.current.fields.keys()];
    cache.current = { lists: null, fields: new Map() };
    void ensure(shown, true).catch(() => {});
  }, [token]);
  const ensure = async (names: string[], refresh = false): Promise<Map<string, Fields>> => {
    const c = cache.current;
    const l = await lists();
    const missing = [...new Set(names)].filter((n) => !c.fields.has(n));
    for (const [n, f] of await Promise.all(missing.map(async (n) => [n, await readFields(n, l.tables)] as const))) c.fields.set(n, f);
    if ((missing.length || refresh) && c === cache.current) setCatalog({ ...l, fields: new Map(c.fields) });
    return c.fields;
  };
  return { catalog, ensure };
}

const isFieldOf = (fields: Map<string, Fields>): IsField => (source, field) => {
  const f = fields.get(source);
  return f === undefined || f.some((x) => sameName(x.name, field)); // unknown source: Task 7's rule (the only source's field)
};

// ---------- The editor's model ----------

/** `epoch`: bumped when criteria rows are inserted or deleted, the grid remounts (a cell's pending text never lands on
 *  another row). */
interface Model { design: QbeDesign; positions: Record<string, Point>; invalid: Record<string, string>; dirty: boolean; epoch: number }
type ModelAction = QbeAction | { type: 'load'; model: Model } | { type: 'move'; alias: string; p: Point; dirty: boolean }
  | { type: 'place'; positions: Record<string, Point> } | { type: 'invalid'; key: string; code: string | null } | { type: 'clean' }
  | { type: 'touch' } /* edited outside the grid (SQL view, description) */;

const emptyModel = (design: QbeDesign = emptyQbe(), positions: Record<string, Point> = {}): Model => ({ design, positions, invalid: {}, dirty: false, epoch: 0 });
const aliasOf = (t: { name: string; alias?: string }) => t.alias ?? t.name;

function modelReducer(m: Model, a: ModelAction): Model {
  switch (a.type) {
    case 'load': return a.model;
    case 'move': return { ...m, positions: { ...m.positions, [a.alias]: a.p }, dirty: m.dirty || a.dirty };
    case 'place': return { ...m, positions: a.positions };
    case 'clean': return { ...m, dirty: false };
    case 'touch': return { ...m, dirty: true };
    case 'invalid': {
      const invalid = { ...m.invalid };
      if (a.code) invalid[a.key] = a.code; else delete invalid[a.key];
      return { ...m, invalid };
    }
    default: {
      const design = qbeReducer(m.design, a);
      const positions = a.type === 'removeTable'
        ? Object.fromEntries(Object.entries(m.positions).filter(([k]) => !sameName(k, a.alias))) : m.positions;
      if (a.type === 'insertRow' || a.type === 'deleteRow') {
        const invalid = Object.fromEntries(Object.entries(m.invalid).filter(([k]) => !k.includes(':criteria')));
        return { ...m, design, invalid, dirty: true, epoch: m.epoch + 1 };
      }
      return { ...m, design, positions, invalid: pruneInvalid(m.invalid, design), dirty: true };
    }
  }
}

/** The grid as SQL text, or the reason it cannot be saved (a `bc:invalidQuery|…` error, shown by useErrorDialog). */
function gridSql(m: Model, isField: IsField): { sql: string; q: Query } | { error: Error } {
  const problem = designProblem(m.design);
  if (problem) return { error: new Error(problem) };
  try {
    const q = fromQbe(m.design, isField);
    return { sql: printSql(q), q };
  } catch (e) {
    return { error: invalidQueryError(e, false) ?? e as Error };
  }
}

// ---------- The editor: table pane, splitter, grid, Show Table and Join Properties ----------

interface EditorProps {
  model: Model; set: Dispatch<ModelAction>; catalog: Catalog; ensure(names: string[]): Promise<unknown>; readOnly: boolean; ctx: DisplayContext;
  /** The query being designed (left out of Show Table's queries: a query cannot use itself). */
  self: string | null;
  showTable: boolean; setShowTable(on: boolean): void; selected: number; setSelected(col: number): void;
  /** Table Names: the grid's Table row shown (Access's option, on by default). */
  tableRow?: boolean;
  /** The pane's height in px, null for its CSS default (the Query Builder dialog). */
  split: { px: number; set(px: number): void; reset(): void; min: number; max: number; total: number } | null;
}

function QbeEditor({ model, set, catalog, ensure, readOnly, ctx, self, showTable, setShowTable, selected, setSelected, split, tableRow = true }: EditorProps) {
  const { t } = useTranslation();
  const pane = useRef<HTMLDivElement>(null);
  const [joinEdit, setJoinEdit] = useState<number | null>(null);
  const d = model.design;
  const fieldsOf = (name: string): Fields => catalog.fields.get(name) ?? [...catalog.fields].find(([n]) => sameName(n, name))?.[1] ?? [];
  const boxes: PaneBox[] = d.tables.map((x) => ({ alias: aliasOf(x), fields: fieldsOf(x.name) }));

  // New boxes take a free place; the fields of new sources (and of an Append's target) are read.
  useEffect(() => {
    const aliases = d.tables.map(aliasOf);
    if (aliases.some((a) => !model.positions[a])) {
      const size = { w: pane.current?.clientWidth || 800, h: pane.current?.clientHeight || 300 };
      set({ type: 'place', positions: autoLayout(aliases, { tables: model.positions }, size).tables });
    }
    void ensure([...d.tables.map((x) => x.name), ...(d.kind === 'append' && d.target ? [d.target] : [])]);
  }, [d.tables, d.kind, d.target]);

  const add = (names: string[]) => { for (const name of names) set({ type: 'addTable', name, relations: catalog.relations }); };
  /** As Access fills the Table row from the Field cell (an expression has none). */
  const onField = (col: number, canonical: string) => {
    const e = canonical ? fieldEntry(canonical, boxes.map((b) => ({ alias: b.alias, fields: b.fields.map((f) => f.name) })), d.columns[col]?.table) : { field: '' };
    set({ type: 'setCell', col, row: 'field', value: e.field });
    set({ type: 'setCell', col, row: 'table', value: e.table ?? '' });
  };
  const join = joinEdit === null ? undefined : d.joins[joinEdit];

  return (
    <>
      <div ref={pane} className="qbe-pane-wrap" style={split ? { flex: 'none', height: split.px, display: 'flex' } : { flex: 1, minHeight: 0, display: 'flex' }}>
        <TablePane boxes={boxes} joins={d.joins} positions={model.positions} readOnly={readOnly}
          onMove={(alias, p, done) => set({ type: 'move', alias, p, dirty: done && !readOnly })}
          onAddField={(alias, field) => set({ type: 'addField', table: alias, field })}
          onJoin={(j) => set({ type: 'addJoin', join: j })} onEditJoin={setJoinEdit}
          onRemoveJoin={(index) => set({ type: 'removeJoin', index })} onRemoveTable={(alias) => set({ type: 'removeTable', alias })} />
      </div>
      {split && (
        <Splitter testId="qbe-splitter" label={t('query.splitter')} total={split.total} value={split.px} min={split.min} max={split.max}
          onChange={split.set} onReset={split.reset} />
      )}
      <QbeGrid key={model.epoch} design={d} boxes={boxes} ctx={ctx} readOnly={readOnly} selected={selected} invalid={model.invalid} tableRow={tableRow}
        targetFields={d.kind === 'append' && d.target ? fieldsOf(d.target).map((f) => f.name) : []}
        onSelect={setSelected} onCell={(col, row, value) => set({ type: 'setCell', col, row, value })} onField={onField}
        onInvalid={(key, code: ExprErrorCode | null) => set({ type: 'invalid', key, code })}
        onDropField={(col, alias, field) => set({ type: 'addField', table: alias, field, at: col })}
        onMoveColumn={(from, to) => { set({ type: 'moveColumn', from, to }); setSelected(to); }} />
      {showTable && (
        <ShowTableDialog tables={catalog.tables} queries={catalog.queries.filter((n) => self === null || !sameName(n, self))}
          onAdd={add} onClose={() => setShowTable(false)} />
      )}
      {join && (
        <JoinDialog join={join} onCancel={() => setJoinEdit(null)}
          onOk={(kind) => { setJoinEdit(null); set({ type: 'setJoinKind', index: joinEdit!, kind }); }} />
      )}
    </>
  );
}

/** The region's display context (null until known), as the table designer reads it. */
function useDisplayContext(): DisplayContext | null {
  const { i18n } = useTranslation();
  const [region, setRegion] = useState<string | null>(null);
  useEffect(() => { void api.app.getSettings().then((s) => setRegion(s.region), () => setRegion('en-US')); }, []);
  const lang = i18n.language.startsWith('fr') ? 'fr' : 'en';
  return useMemo(() => (region === null ? null : { lang, region: localeInfo(region) }), [lang, region]);
}

/** Invalid cells, one line each (row, column number, message). */
function invalidLines(m: Model, t: TFunction): string[] {
  const cols = m.design.columns as GridColumn[];
  return Object.entries(m.invalid).map(([k, code]) => {
    const [id, row] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    const i = cols.findIndex((c) => String(c.uid) === id);
    const col = i >= 0 ? i + 1 : Number(id.slice(3)) + 1;
    const label = t(row === 'criteria0' ? 'query.row.criteria' : row.startsWith('criteria') ? 'query.row.or' : `query.row.${row}`);
    return t('query.cellError', { row: label, col, message: t(`expr.error.${code}`) });
  });
}

const SPLIT_KEY = 'basecraft.query.splitRatio';
const BAR = 6, PANE_MIN = 120, GRID_MIN = 140;
const KIND_COMMANDS: [CommandId, QbeKind][] = [
  ['selectQuery', 'select'], ['makeTableQuery', 'makeTable'], ['appendQuery', 'append'], ['updateQuery', 'update'], ['deleteQuery', 'delete'],
  ['crosstabQuery', 'crosstab'],
];

// ---------- SQL view requests (Navigation Pane, the datasheet's status bar, Create > SQL Query) ----------

const sqlRequests: string[] = [];
const sqlListeners = new Set<() => void>();
const sqlRequested = (name: string): number => sqlRequests.findIndex((n) => sameName(n, name));
/** Opens the query `name` in its SQL view: a one-shot request for `name`, then `open` in mode `design`; the view takes the
 *  request when it mounts, or at once when that query's tab is already open. `isNew`: a new query (Create > SQL Query). The
 *  shell's dispatch answers a promise when the open document's mode guard has its say: refused, the request goes. */
export function openSqlView(dispatch: AppDispatch, name: string, isNew = false): void {
  sqlRequests.push(name);
  sqlListeners.forEach((l) => l());
  const done = dispatch(isNew ? { type: 'open', kind: 'query', name, mode: 'design', isNew: true } : { type: 'open', kind: 'query', name, mode: 'design' });
  if (done instanceof Promise) {
    void done.then((ok) => { const i = sqlRequested(name); if (ok === false && i >= 0) sqlRequests.splice(i, 1); });
  }
}

type SqlError = { code: string; span: Span };
/** An empty text where a statement is needed (saving, Parameters). */
const EMPTY: SqlError = { code: 'unexpectedEnd', span: { start: 0, end: 0 } };
/** The SQL text read: its tree, or the parser's error (null for an empty text: an empty grid). */
function readSql(text: string): { q: Query } | { error: SqlError } | null {
  if (!text.trim()) return null;
  try { return { q: parseSql(text) }; } catch (e) {
    if (e instanceof ExprSyntaxError) return { error: { code: e.code, span: e.span } };
    throw e;
  }
}

// ---------- The query's Design view: the grid, or its SQL view ----------

/** The Query Builder's hooks (RowSourceBuilder): the design it opens on (null: only SQL view can show `sql`), Save (the
 *  property's new SQL, set when the builder closes), Run (its datasheet), Close (the tab's). */
interface BuilderHooks { start: { design: QbeDesign | null; sql: string }; update(sql: string): void; run(sql: string): void; close(): void }

export function QueryDesignView({ tab, readOnly, dispatch, builder }: DocViewProps & { builder?: BuilderHooks }) {
  const { t } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const ctx = useDisplayContext();
  const startDesign = builder?.start.design;
  const [model, set] = useReducer(modelReducer, undefined, () => emptyModel(startDesign ? editable(startDesign) : undefined));
  const { catalog, ensure } = useCatalog(tab.reloadToken);
  const [state, setState] = useState<{ original: string | null; extra: Record<string, unknown> } | null>(
    tab.isNew ? { original: null, extra: {} } : null);
  const [view, setView] = useState<'grid' | 'sql'>(builder && !startDesign ? 'sql' : 'grid');
  const [sql, setSql] = useState(builder && !startDesign ? builder.start.sql : '');
  const [sqlError, setSqlError] = useState<SqlError | null>(null);
  const [tableRow, setTableRow] = useState(true);
  // as in Access, on a new query (not one opened in SQL view); the builder, on an empty Record Source
  const [showTable, setShowTable] = useState(() => builder ? !!startDesign && !startDesign.tables.length
    : !!tab.isNew && !readOnly && sqlRequested(tab.name) < 0);
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState(0);
  const busy = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const lastExpr = useRef<string | null>(null);
  const lastRow = useRef(0); // the criteria row last focused (Insert / Delete Rows)
  const loaded = useRef<{ name: string; token: number } | null>(null);
  /** The description (property sheet), read when first shown, written with the next save. */
  const description = useRef<{ stored: string; value: string } | null>(tab.isNew ? { stored: '', value: '' } : null);
  const [ratio, setRatio] = useState(() => loadRatio(SPLIT_KEY));
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setAvail(Math.max(0, el.clientHeight - BAR));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state === null, view]);
  const { parsed, gridless } = useMemo(() => {
    const r = view === 'sql' ? readSql(sql) : null;
    const q = r && 'q' in r ? r.q : null;
    // only SQL view can show this text (UNION, a derived table…): Design View is off, as in Access
    return { parsed: q, gridless: q !== null && toQbe(q) === null };
  }, [view, sql]);
  const live = useRef({ model, state, tab, readOnly, catalog, view, sql });
  live.current = { model, state, tab, readOnly, catalog, view, sql };

  // Opening: the stored SQL read back into the grid, with the catalog (a parameter shown as a column stays bare); what the
  // grid cannot show opens in SQL view.
  useEffect(() => {
    if (tab.isNew) return;
    const prev = loaded.current;
    loaded.current = { name: tab.name, token: tab.reloadToken };
    if (prev && prev.token === tab.reloadToken) {
      if (prev.name === tab.name) return; // our own save, or nothing new
      // renamed from the Navigation Pane while edited: keep the edits, save under the new name
      if (live.current.model.dirty) { setState((s) => s && { ...s, original: tab.name }); return; }
    }
    let current = true;
    (async () => {
      const got = await api.objects.get('query', tab.name);
      const def = got.definition as { sql: string; layout?: { tables: Record<string, Point> } } & Record<string, unknown>;
      const { formatVersion: _v, sql: text, layout, ...extra } = def;
      const r = readSql(text);
      const first = r && 'q' in r ? toQbe(r.q) : null;
      const fields = first ? await ensure(first.tables.map((x) => x.name)) : new Map();
      const d = first && r && 'q' in r ? toQbe(r.q, isFieldOf(fields)) : null;
      if (!current) return;
      set({ type: 'load', model: emptyModel(d ? editable(d) : emptyQbe(), { ...layout?.tables }) });
      setState({ original: got.name, extra });
      if (!d || live.current.view === 'sql') { // stored SQL the grid cannot show (or that no longer parses: written elsewhere)
        setSql(text);
        setSqlError(r && 'error' in r ? r.error : null);
        setView('sql');
      }
    })().catch((e) => { if (current) void showError(e); });
    return () => { current = false; };
  }, [tab.name, tab.isNew, tab.reloadToken]);

  // the builder's grid: the fields of its sources
  useEffect(() => { if (startDesign) void ensure(startDesign.tables.map((x) => x.name)).catch(() => {}); }, []);

  useEffect(() => { dispatch({ type: 'setDirty', id: tab.id, dirty: model.dirty }); }, [model.dirty, tab.id, dispatch]);
  useEffect(() => () => { void dispatch({ type: 'setDirty', id: tab.id, dirty: false }); }, [tab.id, dispatch]);

  const message = (messageKey: string, params?: object) => modal.confirm({ titleKey: 'dialog.errorTitle', messageKey, params, buttons: ['ok'] });
  const askName = (initial: string) => modal.prompt({
    titleKey: 'designer.saveAsTitle', labelKey: 'query.nameLabel', initial, validate: (v) => { const k = nameErrorKey(v); return k && t(k); },
  });
  /** An expression cell commits when left: its entry reaches the model before the save reads it. */
  const flush = async () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !root.current?.contains(el)) return;
    el.blur();
    await new Promise((r) => setTimeout(r));
  };

  /** The text the save stores: the grid's SQL, or in SQL view the normalised text (printSql(parseSql(text))); null when it
   *  cannot be saved (the reason is shown). */
  const savedSql = async (): Promise<string | null> => {
    const { model: m, catalog: cat, view: v, sql: text } = live.current;
    if (v === 'sql') {
      const r = readSql(text);
      if (!r || 'error' in r) { setSqlError({ ...(r ? r.error : EMPTY) }); return null; }
      return printSql(r.q);
    }
    if (Object.keys(m.invalid).length) { await message('query.invalidCells', { detail: invalidLines(m, t).join('\n') }); return null; }
    const r = gridSql(m, isFieldOf(cat.fields));
    if ('error' in r) { await showError(r.error); return null; }
    return r.sql;
  };

  /** The builder's Save (Access): the grid's SQL becomes the property's, set when the builder closes. */
  const builderSave = async (): Promise<boolean> => {
    if (busy.current) return false;
    await flush();
    const text = await savedSql();
    if (text === null) return false;
    builder!.update(oneLine(text));
    set({ type: 'clean' });
    return true;
  };
  /** The builder's Save As (Access): a saved query of the grid, the builder going on. */
  const builderSaveAs = async () => {
    if (busy.current) return;
    await flush();
    const text = await savedSql();
    if (text === null) return;
    let name = await askName(t('query.newName', { n: 1 }));
    while (name !== null) {
      const res = await api.objects.save('query', name, { formatVersion: '1.0', sql: text, layout: { tables: live.current.model.positions } }, null);
      if (res.ok) { dispatch({ type: 'objectSaved', kind: 'query', name }); return; }
      await message(`dialog.op.${res.reason}`, { name, table: '', view: '' });
      if (res.reason !== 'nameExists') return;
      name = await askName(name);
    }
  };
  /** The builder's Run (Access): its datasheet, in its tab; an action query runs as anywhere. */
  const builderRun = async () => {
    if (busy.current) return;
    await flush();
    const text = await savedSql();
    if (text !== null) builder!.run(text);
  };

  /** The whole save flow; true when the query is saved. */
  const save = async (): Promise<boolean> => {
    if (builder) return builderSave();
    const { readOnly: ro, state: s } = live.current;
    if (ro || !s || busy.current) return false;
    busy.current = true;
    try {
      await flush();
      setSaving(true);
      const { model: m, tab: doc } = live.current;
      const text = await savedSql();
      if (text === null) return false;
      const isNew = s.original === null;
      let name = s.original ?? (await askName(doc.name));
      if (name === null) return false;
      const definition = { ...s.extra, formatVersion: '1.0', sql: text, layout: { tables: m.positions } };
      for (;;) {
        const res = await api.objects.save('query', name, definition, s.original);
        if (res.ok) break;
        if (res.reason !== 'nameExists' || !isNew) { await message(`dialog.op.${res.reason}`, { name, table: '', view: '' }); return false; }
        await message('dialog.op.nameExists');
        name = await askName(name);
        if (name === null) return false;
      }
      const desc = description.current;
      // the description goes with the save; when it cannot be written, the query is saved but stays modified (its message)
      let descFailed: (() => Promise<unknown>) | null = null;
      if (desc && desc.value !== desc.stored) {
        try {
          const r = await api.objects.setDescription('query', name, desc.value || null);
          if (r.ok) desc.stored = desc.value;
          else descFailed = () => message(`dialog.op.${r.reason}`, { name, newName: '', table: '', view: '' });
        } catch (e) { descFailed = () => showError(e); }
      }
      if (!descFailed) set({ type: 'clean' });
      if (live.current.view === 'sql') setSql(text);
      setState({ ...s, original: name });
      loaded.current = { name, token: doc.reloadToken + 1 }; // objectSaved bumps it: this save needs no reload
      dispatch(isNew ? { type: 'objectSaved', kind: 'query', name, tabId: doc.id } : { type: 'objectSaved', kind: 'query', name });
      if (descFailed) { await descFailed(); return false; }
      return true;
    } catch (e) {
      await showError(e);
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  /** Before the view goes (Access): a change of mode needs the save; a close offers to drop the edits. */
  const leave = async (reason: 'mode' | 'close'): Promise<boolean> => {
    if (busy.current) return false;
    await flush();
    const { model: m, tab: doc, readOnly: ro } = live.current;
    if (builder) { // its run needs no save; closing it changed asks to update the property (Access)
      if (reason === 'mode' || !m.dirty) return true;
      const r = await modal.confirm({ titleKey: 'fieldProp.queryBuilder', messageKey: 'query.builderSave', buttons: ['yes', 'no', 'cancel'] });
      return r === 'no' || (r === 'yes' && (await save()));
    }
    if (ro || (!m.dirty && !(reason === 'mode' && doc.isNew))) return true;
    if (reason === 'mode') {
      const r = await modal.confirm({ titleKey: 'query.saveFirstTitle', messageKey: 'query.mustSaveFirst', params: { name: doc.name }, buttons: ['yes', 'no'] });
      return r === 'yes' && (await save());
    }
    const r = await modal.confirm({ titleKey: 'query.saveFirstTitle', messageKey: 'query.saveFirst', params: { name: doc.name }, buttons: ['yes', 'no', 'cancel'] });
    return r === 'no' || (r === 'yes' && (await save()));
  };

  /** Query Type: Make-Table and Append ask for their table (Append's must exist), as Access's dialog does. */
  const setKind = async (kind: QbeKind) => {
    let target: string | undefined;
    if (kind === 'makeTable' || kind === 'append') {
      const { model: m, catalog: cat } = live.current;
      const name = await modal.prompt({
        titleKey: kind === 'append' ? 'query.target.appendTitle' : 'query.target.makeTableTitle', labelKey: 'query.target.label', initial: m.design.target ?? '',
        validate: (v) => { const k = nameErrorKey(v) ?? (kind === 'append' && !cat.tables.some((n) => sameName(n, v)) ? 'dialog.error.queryBind_unknownTarget' : null); return k && t(k, { detail: v }); },
      });
      if (name === null) return;
      target = cat.tables.find((n) => sameName(n, name)) ?? name;
    }
    set({ type: 'setKind', kind, target });
  };

  /** Grid -> SQL view: printSql(fromQbe(design)); an empty grid gives an empty text. A grid that cannot be saved stays. */
  const toSql = async () => {
    if (live.current.view === 'sql' || busy.current) return;
    await flush();
    const { model: m, catalog: cat } = live.current;
    if (Object.keys(m.invalid).length) { await message('query.invalidCells', { detail: invalidLines(m, t).join('\n') }); return; }
    let text = '';
    if (m.design.tables.length || m.design.columns.some((c) => c.field.trim())) {
      const r = gridSql(m, isFieldOf(cat.fields));
      if ('error' in r) { await showError(r.error); return; }
      text = r.sql;
    }
    setShowTable(false);
    setSql(text);
    setSqlError(null);
    setView('sql');
  };

  /** SQL view -> grid: a text that does not parse shows its error (its range selected) and stays; one the grid cannot show
   *  stays too (Design View is off). The boxes keep their places. */
  const toGrid = async () => {
    const { view: v, sql: text, model: m } = live.current;
    if (v !== 'sql') return;
    const r = readSql(text);
    if (r && 'error' in r) { setSqlError({ ...r.error }); return; }
    const first = r ? toQbe(r.q) : emptyQbe();
    if (!first) return;
    const d = r ? toQbe(r.q, isFieldOf(await ensure(first.tables.map((x) => x.name)))) ?? first : first;
    set({ type: 'load', model: { ...emptyModel(editable(d), m.positions), dirty: m.dirty } });
    setSqlError(null);
    setView('grid');
  };

  /** Query Parameters: the grid's declarations, or in SQL view the PARAMETERS clause of the text (which must parse). */
  const parameters = async () => {
    const { view: v, sql: text, model: m } = live.current;
    const r = v === 'sql' ? readSql(text) : null;
    if (v === 'sql' && (!r || 'error' in r)) { setSqlError({ ...(r && 'error' in r ? r.error : EMPTY) }); return; }
    const params = r && 'q' in r ? r.q.params : m.design.params;
    const got = await modal.custom<ParamDecl[]>((close) => <ParametersDialog params={params} onClose={close} />, { titleKey: 'query.params.title' });
    if (got === null) return;
    if (!r || !('q' in r)) { set({ type: 'setProps', params: got }); return; }
    setSql(printSql({ ...r.q, params: got }));
    setSqlError(null);
    set({ type: 'touch' });
  };

  /** Top Values (the ribbon's box) and the property sheet. */
  const returnValues = async () => {
    const got = await modal.custom<{ top: QbeDesign['top'] | null }>((close) => <TopValuesDialog top={live.current.model.design.top} onClose={close} />,
      { titleKey: 'query.props.top' });
    if (got) set({ type: 'setProps', top: got.top });
  };
  const propertySheet = async () => {
    const { state: s, model: m } = live.current;
    if (!description.current) {
      const o = s?.original ? (await api.objects.list('query')).find((x) => sameName(x.name, s.original!)) : undefined;
      description.current = { stored: o?.description ?? '', value: o?.description ?? '' };
    }
    const desc = description.current;
    const d = m.design;
    const got = await modal.custom<QueryProps>((close) => (
      <QueryPropertiesDialog kind={d.kind} ctx={ctx!} initial={{ description: desc.value, outputAll: outputAll(d), distinct: d.distinct, top: d.top ?? null, headings: d.headings ?? [] }} onClose={close} />
    ), { titleKey: 'query.props.title' });
    if (!got) return;
    if (got.description !== desc.value) { desc.value = got.description; set({ type: 'touch' }); }
    if (JSON.stringify([got.outputAll, got.distinct, got.top]) !== JSON.stringify([outputAll(d), d.distinct, d.top ?? null])) {
      set({ type: 'setProps', top: got.top, distinct: got.distinct, outputAll: got.outputAll });
    }
    if (JSON.stringify(got.headings) !== JSON.stringify(d.headings ?? [])) set({ type: 'setProps', headings: got.headings });
  };

  /** Run of an action query (Task 10): the grid's SQL, or the SQL view's text, as it stands (Access runs the design, saved
   *  or not), through runActionFlow. */
  const runAction = async () => {
    await flush();
    const text = await savedSql();
    if (text === null) return;
    const region = localeInfo((await api.app.getSettings()).region);
    await runActionFlow({ kind: 'sql', sql: text }, { modal, region, showError, dispatch });
  };

  // A SQL view request (openSqlView): taken once the query is read, at once when the tab is already open.
  useEffect(() => {
    const l = () => setRequests((n) => n + 1);
    sqlListeners.add(l);
    return () => { sqlListeners.delete(l); };
  }, []);
  useEffect(() => {
    if (!state) return; // a saved query: read first
    const i = sqlRequested(tab.name);
    if (i < 0) return;
    sqlRequests.splice(i, 1);
    void toSql();
  }, [requests, state === null, tab.name]);

  const kind = model.design.kind;
  // a crosstab has a datasheet (read-only, B4 R9), never an action query's run
  const runnable = view === 'sql'
    ? parsed !== null && isSelectBody(parsed)
    : kind === 'select' || kind === 'crosstab';
  const action = view === 'sql' ? parsed !== null && !runnable : !runnable;
  const topKind = ['select', 'makeTable', 'append'].includes(kind);
  const cmds = useRef({ save, leave, setKind, toSql, toGrid, parameters, returnValues, propertySheet, runAction, builderSaveAs, builderRun });
  cmds.current = { save, leave, setKind, toSql, toGrid, parameters, returnValues, propertySheet, runAction, builderSaveAs, builderRun };
  useEffect(() => {
    const writable = (fn: () => unknown) => () => {
      if (!live.current.readOnly && live.current.state && !busy.current) void fn();
    };
    const col = () => Math.min(selected, live.current.model.design.columns.length);
    const grid = view === 'grid' ? {
      // a Row Source or Record Source is never a crosstab's grid (B4 R12)
      ...Object.fromEntries(KIND_COMMANDS.filter(([, k]) => !builder || k !== 'crosstab').map(([id, k]) => [id, writable(() => cmds.current.setKind(k))])),
      addTables: writable(() => setShowTable(true)),
      insertColumns: writable(() => set({ type: 'insertColumn', at: col() })),
      deleteColumns: writable(() => { if (col() < live.current.model.design.columns.length) set({ type: 'deleteColumn', at: col() }); }),
      insertRows: writable(() => set({ type: 'insertRow', at: lastRow.current })),
      deleteRows: writable(() => set({ type: 'deleteRow', at: lastRow.current })),
      // a crosstab's Total row is forced on (B4 R13)
      ...(kind !== 'crosstab' ? { queryTotals: writable(() => set({ type: 'setTotals', on: !live.current.model.design.totals })) } : {}),
      // Top Values: a SELECT's TOP (Select, Make-Table, Append), as in Access
      ...(topKind ? { returnValues: writable(() => cmds.current.returnValues()) } : {}),
      propertySheet: writable(() => cmds.current.propertySheet()),
      tableNames: () => setTableRow((on) => !on),
      // Union queries are SQL-specific (Access): the query goes to SQL view to write its UNION
      unionQuery: writable(() => cmds.current.toSql()),
      // the Expression Builder of the expression cell last focused, else the selected column's Field
      builder: writable(() => root.current?.querySelector<HTMLButtonElement>(`[data-testid="${lastExpr.current ?? `qbe-cell-field-${col()}`}-build"]`)?.click()),
    } : {};
    const offCommands = registerCommands(tab.id, {
      save: writable(() => cmds.current.save()),
      ...(runnable && !builder ? { runQuery: () => { void dispatch({ type: 'setMode', id: tab.id, mode: 'run' }); } } : {}),
      ...(runnable && builder ? { runQuery: () => void cmds.current.builderRun(), viewDatasheet: () => void cmds.current.builderRun() } : {}),
      ...(builder ? { builderSaveAs: () => void cmds.current.builderSaveAs() } : {}),
      // not gated on a read-only base: the run says why it cannot write (dialog.op.readOnly)
      ...(action ? { runQuery: () => { if (live.current.state && !busy.current) void cmds.current.runAction(); } } : {}),
      viewSql: () => { // before the query is read: a request, taken once it is
        if (live.current.state) void cmds.current.toSql(); else { sqlRequests.push(live.current.tab.name); setRequests((n) => n + 1); }
      },
      ...(view === 'sql' ? { viewDesign: () => { if (live.current.state && !busy.current) void cmds.current.toGrid(); } } : {}),
      parameters: writable(() => cmds.current.parameters()),
      ...grid,
    });
    const offStates = registerCommandStates(tab.id, view === 'sql'
      ? { viewSql: { active: true }, viewDesign: { active: false, enabled: !gridless } }
      : { tableNames: { active: tableRow }, ...Object.fromEntries(KIND_COMMANDS.map(([id, k]) => [id, { active: k === kind }])) });
    const offGuard = registerModeGuard(tab.id, (reason) => cmds.current.leave(reason));
    return () => { offCommands(); offStates(); offGuard(); };
  }, [tab.id, runnable, action, selected, dispatch, view, gridless, tableRow, topKind, kind]);

  if (!state || !ctx) return <div className="qd" ref={root} aria-busy />;
  if (view === 'sql') {
    return (
      <div className="qd" ref={root} aria-busy={saving}>
        <SqlView sql={sql} error={sqlError} readOnly={readOnly || saving} notice={gridless ? t('query.sqlOnly') : null}
          onChange={(text) => { setSql(text); setSqlError(null); set({ type: 'touch' }); }} />
      </div>
    );
  }
  const panePx = ratioToPx(1 - ratio, avail, PANE_MIN, GRID_MIN); // the stored ratio is the grid's share (default 0.6: tables 40 %)
  const setPane = (px: number) => { const r = 1 - pxToRatio(px, avail); setRatio(r); saveRatio(SPLIT_KEY, r); };
  return (
    <div className="qd" ref={root} aria-busy={saving}
      onFocus={(e) => {
        const id = (e.target as HTMLElement).dataset.testid ?? '';
        if (/^qbe-cell-(field|criteria\d+|updateTo)-\d+$/.test(id)) lastExpr.current = id;
        const row = /^qbe-cell-criteria(\d+)-\d+$/.exec(id);
        if (row) lastRow.current = Number(row[1]);
      }}>
      <QbeEditor model={model} set={set} catalog={catalog} ensure={ensure} readOnly={readOnly || saving} ctx={ctx} self={state.original}
        showTable={showTable} setShowTable={setShowTable} selected={selected} setSelected={setSelected} tableRow={tableRow}
        split={avail > 0 ? { px: panePx, set: setPane, reset: () => { setRatio(SPLIT_DEFAULT); saveRatio(SPLIT_KEY, SPLIT_DEFAULT); }, min: PANE_MIN, max: avail - GRID_MIN, total: avail } : null} />
    </div>
  );
}

// ---------- The Query Builder of a Row Source or a Record Source (A2-R18), in a modal tab as in Access ----------

const BUILDER_SCOPE = `${MODAL_SCOPE}builder`;
const BUILDER_RUN_SCOPE = `${MODAL_SCOPE}builder-run`;

/** The design the builder opens on: an empty one, the table named, or the SQL read back (null when the grid cannot show it). */
async function builderDesign(text: string, table: string | undefined, ensure: (names: string[]) => Promise<Map<string, Fields>>): Promise<QbeDesign | null> {
  if (!text.trim() || table) return { ...emptyQbe(), tables: table ? [{ name: table }] : [] };
  const r = readSql(text);
  // a crosstab is no Row Source (B4 R12): SQL view only, where running or using it says why
  const first = r && 'q' in r && r.q.body.k !== 'crosstab' ? toQbe(r.q) : null;
  if (!first || !r || !('q' in r)) return null;
  return toQbe(r.q, isFieldOf(await ensure(first.tables.map((x) => x.name))));
}

/**
 * The Query Builder over a Row Source (a lookup's, a list control's) or a Record Source (a form's, a report's), as in Access:
 * on a table it first asks to make a query of it; on a saved query it opens that query in Design view instead. Otherwise it is
 * Query Design itself (splitter, SQL view, the Query Design ribbon with its Close group, Run to a datasheet) in a tab that holds
 * everything else back until it closes; closing a changed design asks to save the SQL and update the property. Gives the SQL
 * saved (Save, or Yes on closing) on one line (the property is one line), else null.
 */
export function RowSourceBuilder({ rowSource, onClose }: { rowSource: string; onClose(sql: string | null): void }) {
  const { t } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const { ensure } = useCatalog(0);
  const [start, setStart] = useState<BuilderHooks['start'] | null>(null);
  const [running, setRunning] = useState<{ sql: string; token: number } | null>(null);
  const result = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [tables, queries] = await Promise.all([api.tables.list(), api.objects.list('query')]);
      const find = (list: { name: string }[]) => list.find((x) => sameName(x.name, rowSource.trim()))?.name;
      const query = find(queries);
      if (query) { void shellDispatch({ type: 'open', kind: 'query', name: query, mode: 'design' }); onClose(null); return; }
      const table = find(tables);
      if (table && await modal.confirm({ titleKey: 'fieldProp.queryBuilder', messageKey: 'query.builderOnTable', buttons: ['yes', 'no'] }) !== 'yes') {
        onClose(null);
        return;
      }
      setStart({ design: await builderDesign(rowSource, table, ensure), sql: rowSource });
    })().catch((e) => { void showError(e).then(() => onClose(null)); });
  }, []);

  /** The tab's close (its cross, the ribbon's Close): the design has its say (Yes / No / Cancel), then the SQL saved goes. */
  const close = async () => {
    const guard = modeGuard(BUILDER_SCOPE);
    if (guard && !(await guard('close'))) return;
    onClose(result.current);
  };
  const name = t('fieldProp.queryBuilder');
  const live = useRef({ close, running, name });
  live.current = { close, running, name };
  // the tab's own commands, whichever view is in front: Close, and Design or SQL View back from the datasheet
  useEffect(() => registerCommands(MODAL_SCOPE, {
    builderClose: () => void live.current.close(),
    viewDesign: () => { if (live.current.running) setRunning(null); },
    viewSql: () => {
      if (!live.current.running) return;
      sqlRequests.push(live.current.name);   // taken by the design once shown (openSqlView's request)
      setRunning(null);
      sqlListeners.forEach((l) => l());
    },
  }), []);

  const hooks = useMemo<BuilderHooks | null>(() => start && {
    start, update: (sql) => { result.current = sql; }, run: (sql) => setRunning((r) => ({ sql, token: (r?.token ?? 0) + 1 })), close: () => void live.current.close(),
  }, [start]);
  // its views' tabs: never in the tab bar, their scopes serve the ribbon
  const designTab = useMemo<DocTab>(() => ({ id: BUILDER_SCOPE, kind: 'query', name, mode: 'design', dirty: false, reloadToken: 0, isNew: true }), [name]);
  const runTab = useMemo<DocTab>(() => ({ id: BUILDER_RUN_SCOPE, kind: 'query', name, mode: 'run', dirty: false, reloadToken: running?.token ?? 0 }), [name, running?.token]);
  // the datasheet's end (a parameter cancelled, an error, an action query run) goes back to the design
  const dispatch = useCallback<AppDispatch>((a) => (a.type === 'close' && a.id === BUILDER_RUN_SCOPE ? setRunning(null) : shellDispatch(a)), []);

  if (!hooks) return null;   // the question on a table comes first
  return (
    <ModalTab labelKey="fieldProp.queryBuilder" testId="rowsource-builder" onRequestClose={() => void close()}
      scope={running ? BUILDER_RUN_SCOPE : BUILDER_SCOPE} kind="query" mode={running ? 'run' : 'design'}>
      <section className="doc" hidden={!!running}>
        <QueryDesignView tab={designTab} active={!running} readOnly={false} dispatch={dispatch} builder={hooks} />
      </section>
      {running && (
        <section className="doc">
          <QueryRunView tab={runTab} active readOnly={false} dispatch={dispatch} sql={running.sql} />
        </section>
      )}
    </ModalTab>
  );
}
