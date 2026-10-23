// Formulaire en mode Formulaire : charge la définition, crée les enregistrements (FormRecords) et choisit l'affichage selon le
// mode de l'onglet (M10 : `run` = l'affichage par défaut, formulaire unique ou continu ; `datasheet` = feuille de données). Les
// trois affichages partagent les enregistrements, la saisie, les règles des contrôles, les calculs, les commandes du ruban, F5
// et la garde de mode.
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { CellInput, SqlValue } from '../../shared/coerce';
import { flattenControls, type ControlDef, type DesignDoc } from '../../shared/design/model';
import { effectiveProp } from '../../shared/design/properties';
import { toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { sameName, type FieldDef } from '../../shared/field-types';
import { localeInfo } from '../../shared/locale-format';
import type { RecordSourceRef, SourceField, SourceInfo } from '../../shared/record-source';
import { api } from '../bridge';
import { promptParameters } from '../query/prompt-parameters';
import { i18n } from '../i18n';
import { activeFilter, NO_FILTER, selectionCriteria, withCriteria, type FilterState, type SelectionFilter } from '../datasheet/filter-model';
import { FilterMenu, type FilterMenuState } from '../datasheet/FilterMenu';
import { editText, lookupList } from '../datasheet/datasheet-cells';
import { confirmDelete, fieldErrorParams, showRelatedRefusal } from '../datasheet/record-messages';
import { flushCellEditor } from '../datasheet/grid-shared';
import { ExpressionBuilder } from '../expr/ExpressionBuilder';
import type { DocViewProps } from '../shell/DocumentTabs';
import { errorMessage, useErrorDialog, useModal, type ModalApi } from '../shell/Modal';
import { registerCommands, registerModeGuard, type CommandId } from '../shell/ribbon-model';
import { flashStatus } from '../shell/StatusBar';
import type { Value } from '../../shared/expr/ast';
import { buildCalcEnv, checkControlRule, controlDefaults, FAILED, Latest, unboundDefaults, type CalcResult } from './calc';
import { boundField, controlTexts, isUnbound } from './control-values';
import type { ListState, RunCtx, RunnerApi, SubformHost, UnboundValue } from './controls/run-ctx';
import { parseFormDoc } from './form-def';
import './form-nav-menu';
import { FormRecords, type FormDataApi, type RecordError, type RecordSnapshot } from './record-controller';
import { listOptions, loadRowSource, outOfList, rowOfText } from './row-source';
import { errorsByControl, prop, tabSequence } from './run-model';
import { SingleFormView } from './SingleFormView';
import { ContinuousFormView } from './ContinuousFormView';
import { FormDatasheet } from './FormDatasheet';
import { datasheetColumns, firstRun, initialView, openingMode, runViewFor } from './views';
import './form.css';

const dataApi: FormDataApi = {
  describe: (ref) => api.sources.describe(ref),
  page: (ref, req) => api.sources.page(ref, req),
  insert: (table, values) => api.rows.insert(table, values),
  update: (table, rowid, changes) => api.rows.update(table, rowid, changes),
  delete: (table, rowids) => api.rows.delete(table, rowids),
};
const NO_INFO: SourceInfo = { fields: [], updatable: false, parameters: [] };
const FOCUSABLE = 'input, textarea, button, [role="listbox"], [tabindex]:not([tabindex="-1"])';
let nextViewId = 0;

type Loaded = { doc: DesignDoc; records: FormRecords; key: number } | { error: { key: string; params?: Record<string, unknown> } };
const langOf = (): 'fr' | 'en' => (i18n.language.startsWith('fr') ? 'fr' : 'en');
/** « Entrer une valeur de paramètre » for a form's, a subform's or a list's source (C3). */
const asker = (modal: ModalApi, region: string) => (ps: SourceInfo['parameters']) => promptParameters(modal, ps, localeInfo(region));

export function FormRunView(p: DocViewProps) {
  const { t } = useTranslation();
  const { tab, readOnly } = p;
  const modal = useModal();
  const [region, setRegion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => { void api.app.getSettings().then((s) => setRegion(s.region), () => setRegion('en-US')); }, []);
  const name = useRef(tab.name);
  name.current = tab.name;   // a rename keeps the records and the entry under way
  const opening = useRef({ tab, dispatch: p.dispatch });
  opening.current = { tab, dispatch: p.dispatch };

  useEffect(() => {
    if (region === null) return;
    let current = true;
    api.objects.get('form', name.current).then((r) => {
      if (!current) return;
      let doc: DesignDoc;
      try { doc = parseFormDoc(r.definition).doc; } catch { setLoaded({ error: { key: 'form.invalidDefinition' } }); return; }
      // opened from the Navigation Pane (generic path, mode run): its Default View; Datasheet is the tab's datasheet mode
      const o = opening.current;
      if (firstRun(o.tab.id) && o.tab.mode === 'run' && openingMode(doc) === 'datasheet') o.dispatch({ type: 'setMode', id: o.tab.id, mode: 'datasheet' });
      const records = recordsFor(doc, region, readOnly);
      // its parameters asked once, before the first page; Cancel does not open it (Access), with no error
      void records.open(asker(modal, region)).then((ok) => {
        if (!current) return;
        if (ok) setLoaded({ doc, records, key: ++nextViewId }); else o.dispatch({ type: 'close', id: o.tab.id });
      });
    }, (e) => { if (current) setLoaded({ error: errorMessage(e) }); });
    return () => { current = false; };
  }, [tab.reloadToken, region, readOnly]);

  if (loaded && 'error' in loaded) return <div className="doc-empty muted" role="alert" data-testid="form-run-error">{t(loaded.error.key, loaded.error.params)}</div>;
  if (!loaded || region === null) return <div className="frun" aria-busy />;
  return <FormRunner key={loaded.key} doc={loaded.doc} records={loaded.records} region={region} readOnly={readOnly} active={p.active} name={tab.name}
    mode={tab.mode === 'datasheet' ? 'datasheet' : 'run'} ancestors={[tab.name]} tab={{ id: tab.id, dispatch: p.dispatch }} />;
}

/** The form's records, as its definition allows them; a subform's are linked (no record until the master's values come). */
function recordsFor(doc: DesignDoc, region: string, readOnly: boolean, childFields?: string[]): FormRecords {
  const all = doc.sections.flatMap((s) => flattenControls(s.controls));
  const allow = (n: string) => effectiveProp(doc.props, n, 'form') !== false;
  const records: FormRecords = new FormRecords(dataApi, {
    ref: doc.recordSource, locale: region, readOnly, allowAdditions: allow('AllowAdditions'), allowEdits: allow('AllowEdits'), allowDeletions: allow('AllowDeletions'),
    ...(childFields?.length ? { link: { childFields, values: null } } : {}),
    newRecordValues: () => controlDefaults(all, records.snapshot.info ?? NO_INFO, { locale: region, lang: langOf(), now: () => new Date() }),
  });
  return records;
}

/** A subform control's link to the form it shows (SubformCtl). */
export interface EmbedLink {
  master: FormRecords;                         // the master's records: a leave hook saves the subform's record first
  childFields: string[];                       // Link Child Fields ([]: not linked, the subform is not filtered)
  values: SqlValue[] | null;                   // the master's values of Link Master Fields (null: no record, or new and not saved)
  register(api: RunnerApi | null): void;
  exit(dir: 1 | -1): void;                     // Tab past the last control (or before the first): the master's next stop
  focusWanted(): boolean;                      // entered while the master's new record was saved: the focus once read again (once)
  filter(has: boolean): void;                  // whether the form with the focus in it (it, or one of its subforms) is filtered
  dirty(sources: RecordSourceRef[]): void;     // the sources with a record being edited, its own and its subforms' (the tab's)
  current(): SqlValue[] | null;                // the master's values now (`values` is those of the last render)
}

/** A subform: the form `name` in its Default View, with its own records, read once (the master's next values filter them). */
export const EmbeddedForm = memo(function EmbeddedForm({ name, sub, embed, readOnly }: { name: string; sub: SubformHost; embed: EmbedLink; readOnly: boolean }) {
  const { t } = useTranslation();
  const modal = useModal();
  const [loaded, setLoaded] = useState<{ doc: DesignDoc; records: FormRecords; key: number } | 'missing' | null>(null);
  const fields = embed.childFields.join(';');
  useEffect(() => {
    let current = true;
    api.objects.get('form', name).then((r) => {
      if (!current) return;
      let doc: DesignDoc;
      try { doc = parseFormDoc(r.definition).doc; } catch { setLoaded('missing'); return; }
      const records = recordsFor(doc, sub.region, readOnly, embed.childFields);
      setLoaded({ doc, records, key: ++nextViewId });
      void records.open(asker(modal, sub.region));   // once, not on each master record; Cancel: an empty frame, no additions
    }, () => { if (current) setLoaded('missing'); });
    return () => { current = false; };
  }, [name, sub.region, readOnly, fields]);   // eslint-disable-line react-hooks/exhaustive-deps -- the child fields by their text
  if (loaded === 'missing') return <div className="frun-subform-error" role="alert" data-testid="form-subform-error">{t('form.subform.missing', { name })}</div>;
  if (!loaded) return null;
  return <FormRunner key={loaded.key} doc={loaded.doc} records={loaded.records} region={sub.region} readOnly={readOnly} active={sub.active}
    name={name} mode="embedded" ancestors={[...sub.ancestors, name]} embed={embed} />;
});

interface RunnerProps {
  doc: DesignDoc; records: FormRecords; region: string; readOnly: boolean; active: boolean;
  name: string;                                        // the form's name (messages, the datasheet's label)
  mode: 'run' | 'datasheet' | 'embedded';              // a subform has no tab mode: its Default View
  ancestors: string[];                                 // its name and the forms above it
  tab?: { id: string; dispatch: DocViewProps['dispatch'] };   // a document tab's form: ribbon, mode guard, dirty bullet, F5
  embed?: EmbedLink;                                   // a subform
}

function FormRunner({ tab, active, readOnly, doc, records, region, name, mode, ancestors, embed }: RunnerProps) {
  const { t, i18n: i18 } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const lang: 'fr' | 'en' = i18.language.startsWith('fr') ? 'fr' : 'en';
  const snap = useSyncExternalStore(useCallback((cb) => records.subscribe(cb), [records]), () => records.snapshot);
  const info = snap.info;
  const root = useRef<HTMLDivElement>(null);
  const [viewId] = useState(() => `frun${++nextViewId}`);
  const [focused, setFocused] = useState<string | null>(null);
  const lastFocused = useRef<string | null>(null);   // the control that has (or last had) the focus: a subform's when it is in it
  const lastOwn = useRef<string | null>(null);       // the last of this form's own controls focused
  const [calc, setCalc] = useState<{ values: unknown; results: Record<string, CalcResult> }>({ values: null, results: {} });
  const [calcTick, setCalcTick] = useState(0);
  const [filter, setFilterState] = useState<FilterState>(NO_FILTER);
  const filterRef = useRef(filter);
  const [menu, setMenu] = useState<FilterMenuState | null>(null);
  const latest = useRef(new Latest());
  const checks = useRef<Promise<void>>(Promise.resolve());
  const shownError = useRef<unknown>(undefined);
  const subs = useRef(new Map<string, RunnerApi>());   // the subform controls' forms, by control name

  const all = useMemo(() => doc.sections.flatMap((s) => flattenControls(s.controls)), [doc]);
  const byName = useMemo(() => new Map(all.map((c) => [c.name, c])), [all]);
  const display = useMemo(() => ({ locale: region, lang }), [region, lang]);
  const base = useMemo(() => ({ locale: region, lang, now: () => new Date() }), [region, lang]);
  // Tab stops of each section (a tab control: its strip, then its page shown); Tab on the Detail's last one goes to the next
  // record (Cycle = All Records).
  const [pages, setPages] = useState<Record<string, number>>({});
  const setPage = useCallback((n: string, i: number) => setPages((p) => (p[n] === i ? p : { ...p, [n]: i })), []);
  const sequences = useMemo(() => {
    const out = new Map<string, { seq: string[]; detail: boolean }>();
    for (const s of doc.sections) { const seq = tabSequence(s, pages); for (const n of seq) out.set(n, { seq, detail: s.kind === 'detail' }); }
    return out;
  }, [doc, pages]);
  const tabRank = (n: string) => { const i = [...sequences.keys()].indexOf(n); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const stops = useMemo(() => new Set(sequences.keys()), [sequences]);
  const ro = readOnly || snap.refused;

  // the new record shows its default values at once (sent only on insert: newRecordValues)
  const [defaults, setDefaults] = useState<{ values: unknown; map: Record<string, SqlValue> }>({ values: null, map: {} });
  useEffect(() => {
    const s = records.snapshot;
    if (!s.isNew || !s.info) return;
    void controlDefaults(all, s.info, base).then((map) => {
      const shown = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, typeof v === 'boolean' ? Number(v) : v]));
      if (records.snapshot.values === s.values) setDefaults({ values: s.values, map: shown });
    }, () => { /* blank */ });
  }, [snap.values, snap.isNew, all, base]);
  // a subform's new record: its link values too (Access fills them at once; written on insert)
  const newDefaults = (s: RecordSnapshot) => (s.isNew ? { ...(defaults.values === s.values ? defaults.map : {}), ...records.linkDefaults } : {});
  const shownDefaults = newDefaults(snap);
  const storedOf = (s = records.snapshot) => ({
    ...Object.fromEntries((s.info?.fields ?? []).map((f, i) => [f.name, s.values[i] ?? null])),
    ...newDefaults(s),
  });

  // unbound inputs: their values live in the form, seeded from their Default Value and kept across records (Access)
  const [unbound, setUnbound] = useState<Record<string, UnboundValue & { changed?: boolean }>>({});
  const unboundRef = useRef(unbound);
  const atFocus = useRef<Record<string, UnboundValue | undefined>>({});   // each unbound control's value when it got the focus (Escape)
  const putUnbound = (next: typeof unbound) => { unboundRef.current = next; setUnbound(next); };
  useEffect(() => {
    void unboundDefaults(all, base).then((d) => {
      putUnbound({ ...Object.fromEntries(Object.entries(d).map(([k, value]) => [k, { value }])), ...unboundRef.current });
      setCalcTick((n) => n + 1);
    }, () => { /* blank */ });
  }, [all]);   // once per definition
  const editUnbound = (c: ControlDef, value: Value, text?: string) => { putUnbound({ ...unboundRef.current, [c.name]: { value, text, changed: true } }); };
  // unbound inputs' own errors (their rule, Limit To List), by control name: the form's, not the record's (they never block its
  // save, and a field of the same name keeps its own errors)
  const [ownErrors, setOwnErrors] = useState<Record<string, RecordError>>({});
  const ownRef = useRef(ownErrors);
  const putOwn = (next: Record<string, RecordError>) => { ownRef.current = next; setOwnErrors(next); };

  // combo and list boxes: their rows, read when the form opens, after Shift+F9 and after each of the form's own saves (L4)
  const listCtls = useMemo(() => all.filter((c) => c.kind === 'comboBox' || c.kind === 'listBox'), [all]);
  const [lists, setLists] = useState<Record<string, ListState>>({});
  // a bound combo's text typed that matched no row (Limit To List compares it with the shown texts, the combo shows it as typed)
  const [typedTexts, setTypedTexts] = useState<Record<string, string>>({});
  const typedRef = useRef(typedTexts);
  const setTyped = (n: string, text: string | undefined) => {
    const { [n]: was, ...rest } = typedRef.current;
    if (was === text) return;
    typedRef.current = text === undefined ? rest : { ...rest, [n]: text };
    setTypedTexts(typedRef.current);
  };
  const clearTyped = () => { if (Object.keys(typedRef.current).length) { typedRef.current = {}; setTypedTexts({}); } };
  useEffect(clearTyped, [snap.values]);   // another record (or the record saved): its entry was its own
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const [listTick, setListTick] = useState(0);
  const listLatest = useRef(new Latest());
  const listParams = useRef(new Map<string, Promise<Record<string, CellInput> | null>>());
  const waitInfo = doc.recordSource !== null && !info && snap.status !== 'error';   // a bound value is converted for its field
  useEffect(() => {
    if (!listCtls.length || waitInfo) return;
    const tok = listLatest.current.next();
    void (async () => {
      let tables: string[] = [], queries: string[] = [];
      try {
        const [ts, os] = await Promise.all([api.tables.list(), api.objects.list()]);
        tables = ts.map((x) => x.name);
        queries = os.filter((o) => o.kind === 'query').map((o) => o.name);
      } catch { /* every table source then says it is unknown */ }
      const ctx = { ...display, tables, queries };
      // a list's parameters: asked on its first read only (its later reads reuse the answer, Cancel included)
      const ask = (c: ControlDef) => (ps: SourceInfo['parameters']) => {
        let v = listParams.current.get(c.name);
        if (!v) listParams.current.set(c.name, v = asker(modal, region)(ps));
        return v;
      };
      const read = await Promise.all(listCtls.map((c) => loadRowSource(c, info ? boundField(c, info) : null, dataApi, ctx, ask(c))));
      if (!listLatest.current.isCurrent(tok)) return;
      setLists(Object.fromEntries(listCtls.map((c, i) => [c.name, { ...read[i], data: lookupList(read[i].data), options: listOptions(read[i].data) }])));
    })();
  }, [listCtls, waitInfo, info, display, listTick, snap.saves]);
  const extraOf = () => Object.fromEntries(Object.entries(unboundRef.current).map(([k, u]) => [k, u.value]));

  // calculated controls: on each record shown or saved, and when a changed control is left (Access recalculates then)
  useEffect(() => {
    const tok = latest.current.next();
    const s = records.snapshot;
    void buildCalcEnv(all, s.info ?? NO_INFO, storedOf(s), s.pending, base, extraOf()).then((env) => {
      if (latest.current.isCurrent(tok)) setCalc({ values: s.values, results: env.results });
    }, () => { /* an evaluator failure leaves the controls blank */ });
  }, [snap.values, snap.info, calcTick, all, base, defaults]);
  const results = calc.values === snap.values ? calc.results : {};   // never a result computed for another record
  // Continuous Forms and Datasheet: the other rows' calculated controls, by row (its values as read: a row read again is
  // calculated again); a new cache when what they depend on changes (the old one's late results go nowhere: Latest)
  const hasCalc = useMemo(() => all.some((c) => typeof c.props.ControlSource === 'string' && c.props.ControlSource.startsWith('=')), [all]);
  const rowCalc = useMemo(() => new WeakMap<SqlValue[], Record<string, CalcResult> | null>(), [all, info, base, calcTick]);
  const rowCalcRef = useRef(rowCalc);
  rowCalcRef.current = rowCalc;
  const [, rowCalcDone] = useReducer((n: number) => n + 1, 0);
  const doneQueued = useRef(false);   // the rows' results shown together, once per frame
  const calcFor = (values: SqlValue[]): Record<string, CalcResult> => {
    if (!hasCalc || !info) return {};
    const got = rowCalc.get(values);
    if (got !== undefined) return got ?? {};
    rowCalc.set(values, null);
    const stored = Object.fromEntries(info.fields.map((f, k) => [f.name, values[k] ?? null]));
    void buildCalcEnv(all, info, stored, {}, base, extraOf()).then((env) => {
      rowCalc.set(values, env.results);
      if (rowCalcRef.current !== rowCalc || doneQueued.current) return;
      doneQueued.current = true;
      requestAnimationFrame(() => { doneQueued.current = false; rowCalcDone(); });
    }, () => { /* blank */ });
    return {};
  };
  // the new record's row when it is not current: its default values (one array per definition: its calculations are cached)
  const blankRow = useMemo(() => info?.fields.map(() => null) ?? [], [info]);
  const [newRow, setNewRow] = useState<{ info: SourceInfo; values: SqlValue[] } | null>(null);
  useEffect(() => {
    if (!info) return;
    let current = true;
    void controlDefaults(all, info, base).then((map) => {
      const values = info.fields.map((f) => { const v = map[f.name]; return v === undefined ? null : typeof v === 'boolean' ? Number(v) : v; });
      if (current) setNewRow({ info, values });
    }, () => { /* blank */ });
    return () => { current = false; };
  }, [all, info, base]);
  const newRowValues = newRow?.info === info ? newRow.values : blankRow;

  /** The control's own checks against its typed value: a combo box's Limit To List (a text in no row; A2-R17: on entry only),
   *  then its Validation Rule. A bound control's error joins the record's control errors (they block its save), an unbound
   *  one's the form's own errors; a check that passes takes its error away. The control's error now, else null. */
  const checkRule = async (c: ControlDef): Promise<RecordError | null> => {
    const s = records.snapshot;
    const info = s.info ?? NO_INFO;
    const f = boundField(c, info);
    const list = c.kind === 'comboBox' && prop(c, 'LimitToList') === true ? listsRef.current[c.name] : undefined;
    let err: RecordError | null = null;
    if (f) {
      const k = Object.keys(s.pending).find((n) => sameName(n, f.name));
      const typed = k === undefined ? undefined : s.pending[k];
      if (typed !== undefined && list && outOfList(list.data, typed, typedRef.current[c.name], (v) => editText(f, v, region))) {
        err = { field: f.name, code: 'notInList' };
      } else if (typed !== undefined) {
        const env = await buildCalcEnv(all, info, storedOf(s), s.pending, base, extraOf());
        const v = env.fields[f.name];
        if (v !== FAILED && v !== undefined) err = await checkControlRule(c, v, info, base);
      }
      if (records.snapshot.values !== s.values) return null;   // another record meanwhile: its errors are its own
      const before = records.getControlErrors();
      const next = [...before.filter((e) => !sameName(e.field, f.name)), ...(err ? [err] : [])];
      if (JSON.stringify(before) !== JSON.stringify(next)) records.setControlErrors(next);
      return err;
    }
    if (!isUnbound(c)) return null;
    const u = unboundRef.current[c.name];
    if (u?.changed) {
      err = list && u.text && rowOfText(list.data, u.text) < 0 ? { field: c.name, code: 'notInList' } : await checkControlRule(c, u.value, info, base);
    }
    if (unboundRef.current[c.name] !== u) return ownRef.current[c.name] ?? null;   // changed meanwhile: its next blur checks it
    const { [c.name]: had, ...rest } = ownRef.current;
    if (err) putOwn({ ...rest, [c.name]: err }); else if (had) putOwn(rest);
    return err;
  };
  const queue = <T,>(p: () => Promise<T>): Promise<T | undefined> => {
    const run = checks.current.then(p).catch(() => undefined);   // a failed check blocks nothing
    checks.current = run.then(() => undefined);
    return run;
  };
  /** The focused control's rule is checked before a save or a move (a ribbon click leaves it without its blur being done). */
  const settle = () => {
    flushCellEditor();   // Datasheet view: an open cell editor's text goes to its record first (Ctrl+S, Shift+F9, a sort…)
    const c = lastFocused.current ? byName.get(lastFocused.current) : undefined;
    return queue(() => (c ? checkRule(c) : Promise.resolve(null)));
  };

  const focusHook = useRef<((n: string) => boolean) | null>(null);   // Datasheet view: the control's column on the current record
  /** This form's own elements (never a subform's, which has the same test ids and control names). */
  const own = (el: Element | null): boolean => !!el && el.closest('.frun') === root.current;
  const ownOne = <E extends Element>(sel: string): E | undefined => [...(root.current?.querySelectorAll<E>(sel) ?? [])].find(own);
  /** The control on the current record (Continuous Forms: never one of another row's); a subform: its own control. */
  const focusCtl = (n: string) => {
    if (focusHook.current?.(n)) return;
    const el = [...(root.current?.querySelectorAll<HTMLElement>(`[data-ctl="${CSS.escape(n)}"]`) ?? [])].find((e) => own(e) && !e.closest('[data-row-other]'));
    if (el?.classList.contains('frun-subform')) { subs.current.get(n)?.focusIn(); return; }
    const target = el && (el.matches(FOCUSABLE) ? el
      : el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], [role="radio"][tabindex="0"]') ?? el.querySelector<HTMLElement>('[role="radio"]'));
    target?.focus();
  };
  /** Now, and once rendered (the box gives the focus back on closing), unless another dialog has taken it meanwhile. */
  const focusBack = (n: string) => {
    focusCtl(n);
    requestAnimationFrame(() => { if (!document.querySelector('[aria-modal="true"]')) focusCtl(n); });
  };
  const boxOpen = useRef(false);
  /** After a refused save or move: Access's message box with the first error (in tab order), then the focus on its control.
   *  After a control's own check failed (`own`: that control and its error): that one. Nothing when the refusal is not an entry
   *  error (a rejected write has its own box). */
  const showRefusal = async (own?: { name: string; err: RecordError }): Promise<void> => {
    if (boxOpen.current) return;   // one box at a time (a blur and a save can both find the same error)
    const s = records.snapshot;
    const { byControl, orphan } = errorsByControl(s.errors, doc, s.info ?? NO_INFO);
    const first = own?.name ?? Object.keys(byControl).sort((a, b) => tabRank(a) - tabRank(b))[0];
    const err = own?.err ?? (first ? byControl[first] : orphan[0]);
    if (!err || document.querySelector('[aria-modal="true"]')) return;
    if (first) focusBack(first);   // the box gives the focus back to it
    boxOpen.current = true;
    const field = own && ownRef.current[own.name] === own.err ? undefined : fieldDef(err.field);   // an unbound control's error names the control
    try {
      await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'datasheet.fieldError', params: fieldErrorParams(err, field, ctx, t), buttons: ['ok'] });
    } finally {
      boxOpen.current = false;
    }
    if (first) focusBack(first);
  };
  const attempt = async (op: () => Promise<boolean>): Promise<boolean> => {
    await settle();
    const ok = await op();
    if (!ok) await showRefusal();
    return ok;
  };
  /** A move the user asks for: keys typed from now on go to the record it reaches (type-ahead), not to the one left. */
  const userAttempt = (op: () => Promise<boolean>): Promise<boolean> => {
    records.expectMove();
    return attempt(op).finally(() => records.endExpected());
  };
  const firstStop = () => { const d = doc.sections.find((s) => s.kind === 'detail'); return d ? tabSequence(d)[0] : undefined; };

  const edit = (f: SourceField, input: CellInput) => { records.edit(f.name, input); };
  const onFocusOf = (n: string) => {
    // given the focus back while its own check refuses (after the box): it keeps its value from before the entry, for Escape
    if (!ownRef.current[n]) atFocus.current[n] = unboundRef.current[n];
    lastFocused.current = n;
    lastOwn.current = n;
    setFocused(n);
  };
  /** A check that fails, each time the control is left (a datasheet cell: each time it is edited): its message box, and the
   *  focus stays in the control until the entry is fixed or undone (Access). */
  const checked = (c: ControlDef) => {
    void queue(() => checkRule(c)).then((err) => { setCalcTick((n) => n + 1); if (err) void showRefusal({ name: c.name, err }); });
  };
  /** Escape: once, the control's change; again (nothing left on it), the whole record. */
  const undo = (c: ControlDef) => {
    const s = records.snapshot;
    const f = s.info ? boundField(c, s.info) : null;
    const was = atFocus.current[c.name];
    if (isUnbound(c) && unboundRef.current[c.name] !== was) {
      const { [c.name]: _, ...rest } = unboundRef.current;
      putUnbound(was ? { ...rest, [c.name]: was } : rest);
      const { [c.name]: _e, ...others } = ownRef.current;
      putOwn(others);   // its own error goes with it (never a field's of the same name)
    } else if (f && Object.keys(s.pending).some((k) => sameName(k, f.name))) {
      records.undoField(f.name);
      setTyped(c.name, undefined);
    } else {
      records.undoRecord();
      clearTyped();
    }
    setCalcTick((n) => n + 1);
  };
  const events = (c: ControlDef) => ({
    onFocus: () => onFocusOf(c.name),
    onBlur: (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;   // inside the same option group
      setFocused((v) => (v === c.name ? null : v));
      checked(c);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (c.kind === 'tabControl') return;   // the strip holds no entry: the record stays as it is
        e.preventDefault();
        undo(c);
      } else if ((e.key === 'PageDown' || e.key === 'PageUp') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();   // Access: the next or previous record, the focus staying in this control
        void userAttempt(() => (e.key === 'PageDown' ? records.next() : records.previous()));
      } else if ((e.key === 'Home' || e.key === 'End') && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();   // Access: the first field of the first record, the last field of the last record
        const first = e.key === 'Home';
        const d = doc.sections.find((x) => x.kind === 'detail');
        const seq = d ? tabSequence(d, pages) : [];
        const n = first ? seq[0] : seq[seq.length - 1];
        void userAttempt(() => (first ? records.first() : records.last())).then((ok) => { if (ok && n) requestAnimationFrame(() => focusCtl(n)); });
      } else if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void attempt(() => records.save());
      } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (tabFrom(c.name, e.shiftKey ? -1 : 1)) e.preventDefault();   // not a tab stop: the browser's order
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
        && (c.kind === 'textBox' || c.kind === 'checkBox' || c.kind === 'optionButton') && e.target instanceof HTMLInputElement) {
        // Access (Arrow key behavior: Next field): the next or previous field; a multi-line text box (textarea) keeps its caret
        if (tabFrom(c.name, e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
      }
    },
  });
  /** A subform at the end of its records (dir 1: the new record untouched, or the last one with no additions; dir -1: the first):
   *  Tab goes on to the master's next control rather than to another record. */
  const atEdge = (dir: 1 | -1): boolean => {
    const s = records.snapshot;
    return dir > 0 ? (s.isNew ? !s.dirty : s.index >= s.total - 1 && !s.canAdd) : s.index <= 0;
  };
  const tabOut = (dir: 1 | -1): boolean => {
    if (!embed || !atEdge(dir)) return false;
    embed.exit(dir);
    return true;
  };
  /** Tab from the stop `name`: the next stop that takes the focus (one that cannot is passed over); past the Detail's last, the
   *  next record (the new record saved first goes to another new record), or out of a subform at its end. False: not a stop. */
  const tabFrom = (name: string, dir: 1 | -1): boolean => {
    const at = sequences.get(name);
    if (!at) return false;
    const from = document.activeElement;
    const tryFrom = (list: string[]) => list.some((n) => { focusCtl(n); return document.activeElement !== from; });
    const k = at.seq.indexOf(name);
    const ahead = dir > 0 ? at.seq.slice(k + 1) : at.seq.slice(0, k).reverse();
    if (tryFrom(ahead)) return true;
    const around = dir > 0 ? at.seq.slice(0, k) : at.seq.slice(k + 1).reverse();
    if (!at.detail) { tryFrom(around); return true; }
    if (tabOut(dir)) return true;
    void userAttempt(() => (dir < 0 ? records.previous() : records.snapshot.isNew ? records.newRecord() : records.next())).then((ok) => {
      if (ok) requestAnimationFrame(() => tryFrom(dir > 0 ? at.seq : [...at.seq].reverse()));
    });
    return true;
  };

  // errors: under their control, else in the message bar
  const ctx: DisplayContext = useMemo(() => ({ lang, region: localeInfo(region) }), [lang, region]);
  const fieldDef = (name: string): FieldDef | undefined => { const f = info?.fields.find((x) => sameName(x.name, name)); return f && { name: f.name, props: f.props }; };
  const { byControl, orphan } = errorsByControl(snap.errors, doc, info ?? NO_INFO);
  const errors = {
    ...Object.fromEntries(Object.entries(byControl).map(([n, e]) => [n, fieldErrorParams(e, fieldDef(e.field), ctx, t).message])),
    ...Object.fromEntries(Object.entries(ownErrors).map(([n, e]) => [n, fieldErrorParams(e, undefined, ctx, t).message])),
  };
  const messages = orphan.map((e) => t('datasheet.fieldError', fieldErrorParams(e, fieldDef(e.field), ctx, t)));
  // Datasheet view: the first error, in tab order, under the grid (as the table's datasheet)
  const firstOwn = Object.keys(ownErrors).sort((a, b) => tabRank(a) - tabRank(b))[0];
  const firstBound = Object.keys(byControl).sort((a, b) => tabRank(a) - tabRank(b))[0];
  const sheetError = firstBound ? t('datasheet.fieldError', fieldErrorParams(byControl[firstBound], fieldDef(byControl[firstBound].field), ctx, t))
    : messages[0] ?? (firstOwn ? t('datasheet.fieldError', fieldErrorParams(ownErrors[firstOwn], undefined, ctx, t)) : null);

  // a rejected write: once, in a message box (a bc:readOnly one also makes the form read-only: snap.refused)
  useEffect(() => {
    if (snap.writeError === undefined || snap.writeError === shownError.current) return;
    shownError.current = snap.writeError;
    void showError(snap.writeError);
  }, [snap.writeError, showError]);

  // Back on this tab: the records are read again where the form stands (changed elsewhere meanwhile), nothing saved
  const wasActive = useRef(active);
  useEffect(() => {
    const back = active && !wasActive.current;
    wasActive.current = active;
    if (back) void records.reload();
  }, [active, records]);

  // a record being edited here or in a subform: the tab is dirty (its bullet; an action query on its sources is refused)
  const [subDirty, setSubDirty] = useState<Record<string, RecordSourceRef[]>>({});
  const dirtySources = [...(snap.dirty && doc.recordSource ? [doc.recordSource] : []), ...Object.values(subDirty).flat()];
  const dirtyKey = JSON.stringify(dirtySources);
  useEffect(() => { embed?.dirty(dirtySources); }, [embed, dirtyKey]);   // eslint-disable-line react-hooks/exhaustive-deps -- by their text
  useEffect(() => () => embed?.dirty([]), [embed]);
  const tabId = tab?.id;
  const dispatch = tab?.dispatch;
  useEffect(() => { if (tabId) dispatch?.({ type: 'setDirty', id: tabId, dirty: dirtySources.length > 0, sources: dirtySources }); }, [dirtyKey, tabId, dispatch]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (tabId) dispatch?.({ type: 'setDirty', id: tabId, dirty: false }); }, [tabId, dispatch]);

  // ---- filters (A2's FilterState), sorts, ribbon
  const focusedField = (): { c: ControlDef; f: SourceField } | null => {
    const c = lastFocused.current ? byName.get(lastFocused.current) : undefined;
    const s = records.snapshot;
    const f = c && s.info ? boundField(c, s.info) : null;
    return c && f ? { c, f } : null;
  };
  /** The focus back on the form (after a ribbon command): the last control, else the Detail's first stop. */
  const back = () => requestAnimationFrame(() => {
    const n = lastFocused.current ?? firstStop();
    if (n && !document.querySelector('[aria-modal="true"]')) focusCtl(n);
  });
  const applyFilter = async (next: FilterState) => {
    await settle();
    const items = activeFilter(next) ?? [];
    const ok = await records.setFilter(items);
    if (ok || JSON.stringify(records.snapshot.filter) === JSON.stringify(items)) { filterRef.current = next; setFilterState(next); }
    if (ok) back(); else await showRefusal();
  };
  const setCriteria = async (field: string, criteria: string) => {
    let next: FilterState;
    try { next = withCriteria(filterRef.current, field, criteria); } catch (e) { await showError(e); return; }
    await applyFilter(next);
  };
  const menuAt = (id: CommandId) => {
    const r = document.querySelector(`[data-testid="cmd-${id}"]`)?.getBoundingClientRect() ?? root.current?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: r?.bottom ?? 0 };
  };
  const fd = (f: SourceField): FieldDef => ({ name: f.name, props: f.props });

  const filterSelection = async () => {
    const at = focusedField();
    if (!at || !(await attempt(() => records.save()))) return;
    const s = records.snapshot;
    if (s.isNew || !s.info || s.index >= s.total) return;
    const value = s.values[s.info.fields.indexOf(at.f)] ?? null;   // the stored value (a Lookup: its bound value)
    try { selectionCriteria('equals', fd(at.f), value); } catch (e) { await showError(e); return; }
    const shown = controlTexts(at.c, at.f, value, undefined, display).display;
    setMenu({ kind: 'selection', field: fd(at.f), value, shown, ...menuAt('filterSelection') });
  };
  const filterField = async () => {
    const at = focusedField();
    const ref = doc.recordSource;
    if (!at || !ref || !(await attempt(() => records.save()))) return;
    const current = filterRef.current.items.find((x) => sameName(x.field, at.f.name))?.criteria ?? '';
    let initial = current;
    try { if (current) initial = toDisplay(current, ctx, { criteria: true }); } catch { /* as stored */ }
    const validate = async (criteria: string): Promise<string | null> => {
      try {
        const params = records.sourceParams;
        await api.sources.page(ref, { offset: 0, limit: 1, filter: activeFilter(withCriteria(filterRef.current, at.f.name, criteria)), ...(params && { params }) });
        return null;
      } catch (e) {
        const m = errorMessage(e);
        return t(m.key, m.params);
      }
    };
    const criteria = await modal.custom<string>((close) => (
      <ExpressionBuilder ctx={{ ...ctx, fields: (records.snapshot.info?.fields ?? []).map((x) => x.name), criteria: true }} initial={initial} close={close} validate={validate}
        label={t('datasheet.filter.fieldLabel', { field: at.f.props.caption || at.f.name })} />
    ), { titleKey: 'datasheet.filter.fieldTitle' });
    if (criteria !== null) await setCriteria(at.f.name, criteria);
  };
  const toggleFilter = () => { const f = filterRef.current; if (f.items.length) void applyFilter({ ...f, active: !f.active }); };

  const sortBy = async (dir: 'asc' | 'desc' | null) => {
    const at = focusedField();
    if (dir !== null && !at) return;
    if (await attempt(() => records.setSort(dir && at ? [{ field: at.f.name, dir }] : []))) back();
  };
  const newRecord = async () => {
    if (!(await userAttempt(() => records.newRecord()))) return;
    const n = firstStop();
    if (n) { focusCtl(n); requestAnimationFrame(() => focusCtl(n)); }   // at once: what is typed next goes there
  };
  const deleteRecord = async () => {
    flushCellEditor();
    const s = records.snapshot;
    if (s.busy) return;   // a move under way (the datasheet refuses it the same way)
    const rec = records.currentRecord;   // the record deleted: never one that became current while the box was open
    if (s.isNew) { await records.deleteCurrent(rec); back(); return; }   // the new record: its entry is undone
    // its subforms' entries first (refused: the focus stays on the one in error, nothing is deleted)
    for (const sf of [...subs.current.values()]) if (!(await sf.save())) return;
    const table = s.info?.keyTable;
    if (!table || !s.canDelete || !(await confirmDelete(modal, table, 1))) { back(); return; }
    const r = await records.deleteCurrent(rec);
    if (r && !r.ok) await showRelatedRefusal(modal, r);
    back();   // deleted (on the next record) or refused: back to the form
  };

  /** Before the view goes: its subforms' records, then its own, are saved; refused, discarding is asked, as the datasheet does
   *  (on close: close anyway, the entry lost?). Yes discards, No stays on the record in error. */
  const leave = async (reason: 'mode' | 'close'): Promise<boolean> => {
    for (const s of [...subs.current.values()]) if (!(await s.leave(reason))) return false;
    await settle();
    if (await records.save()) return true;
    await showRefusal();
    const r = await modal.confirm({ titleKey: 'datasheet.discardTitle', messageKey: reason === 'close' ? 'form.closeDiscard' : 'datasheet.discard',
      params: { name }, buttons: ['yes', 'no'], defaultButton: 'no' });
    if (r !== 'yes') return false;
    records.undoRecord();
    return true;
  };
  /** Its subforms' records, then its own: saved, or the refusal's message box (and false). */
  const saveAll = async (): Promise<boolean> => {
    for (const s of [...subs.current.values()]) if (!(await s.save())) return false;
    return attempt(() => records.save());
  };

  // the record commands (ribbon, Shift+F9), on this form; `run` sends them to the subform that has the focus (Access)
  const handlers: Record<string, () => unknown> = {
    newRecord, deleteRecord, save: () => attempt(() => records.save()),
    sortAsc: () => sortBy('asc'), sortDesc: () => sortBy('desc'), sortClear: () => sortBy(null),
    filter: filterField, filterSelection, filterAdvanced: () => setMenu({ kind: 'advanced', ...menuAt('filterAdvanced') }), filterToggle: toggleFilter,
    refresh: () => refresh(true),
  };
  /** Requery: saves first; lists read again (once: a save made by the requery has already read them). `ask` (Shift+F9, on this
   *  form or its master): the source's parameters asked again first, here then in each subform (Cancel keeps the records).
   *  `linkPending`: a subform whose master's values changed, read by its link effect (unless new values were given here). */
  async function refresh(ask: boolean, linkPending = false): Promise<boolean> {
    const saves = records.snapshot.saves;
    if (ask && !(await saveAll())) return false;   // Access's order: the record being edited saved first, then the parameters asked
    const ps = records.snapshot.info?.parameters ?? [];
    const values = ask && ps.length ? await asker(modal, region)(ps) : undefined;
    if (values === null) return false;
    if (linkPending && !values) return true;
    if (!(await attempt(() => records.requery(values)))) return false;
    if (records.snapshot.saves === saves) setListTick((n) => n + 1);
    for (const sf of [...subs.current.values()]) await sf.requery(ask);   // its subforms too, on the same master record or not
    return true;
  }
  const run = (cmd: string) => {
    const s = lastFocused.current ? subs.current.get(lastFocused.current) : undefined;
    if (s) s.run(cmd); else void handlers[cmd]?.();
  };
  const hasFilter = filter.items.length > 0;
  // Toggle Filter follows the form that has the focus: this one, or the subform it is in (which reports its own)
  const [subFilters, setSubFilters] = useState<Record<string, boolean>>({});
  const focusedFilter = focused !== null && Object.hasOwn(subFilters, focused) ? subFilters[focused] : hasFilter;
  useEffect(() => { embed?.filter(focusedFilter); }, [embed, focusedFilter]);
  useEffect(() => {
    if (!tabId) return undefined;
    const on = (cmd: string) => () => cmds.current.run(cmd);
    return registerCommands(tabId, {
      // read-only (also a refused write before the session says so): no record command
      ...(ro ? {} : { newRecord: on('newRecord'), deleteRecord: on('deleteRecord'), save: on('save') }),
      sortAsc: on('sortAsc'), sortDesc: on('sortDesc'), sortClear: on('sortClear'), filter: on('filter'), filterSelection: on('filterSelection'),
      filterAdvanced: on('filterAdvanced'), ...(focusedFilter ? { filterToggle: on('filterToggle') } : {}), refresh: on('refresh'),
    });
  }, [tabId, ro, focusedFilter, records]);
  useEffect(() => (tabId ? registerModeGuard(tabId, (reason) => cmds.current.leave(reason)) : undefined), [tabId]);

  // a subform: the master's moves save its record first; it follows the master's record (its record saved before it reads
  // again); its master drives it through `api`
  useEffect(() => embed?.master.addLeaveHook(() => cmds.current.saveAll()), [embed?.master]);
  const linkKey = embed && embed.childFields.length ? JSON.stringify(embed.values) : null;
  const applied = useRef('null');   // the records start with no master values
  const badLink = !!embed && embed.childFields.length > 0 && snap.status === 'ready'   // (a source that cannot be read says so)
    && (!info || embed.childFields.some((n) => !info.fields.some((f) => sameName(f.name, n))));
  useEffect(() => {
    if (linkKey === null || !info || badLink || applied.current === linkKey) return;
    const key = linkKey;
    applied.current = key;
    // refused (its record cannot be saved): tried again after its next save or once its entry is undone; read again with the focus in it (entered while the
    // master's new record was being saved): the focus on its control, on its first record or its new record. Overtaken by a
    // later link read (false too): not a refusal, that read's key stands
    void attempt(() => records.setLink(embed!.values)).then((ok) => {
      if (!ok) { if (applied.current === key) applied.current = 'stale'; }
      // (the focused cell may have gone with the rows read again: the focus is then nowhere)
      else if (embed!.focusWanted() || root.current?.closest('.frun-subform')?.contains(document.activeElement)) requestAnimationFrame(() => cmds.current.focusIn());
    });
  }, [linkKey, info, badLink, snap.saves, snap.dirty]);   // eslint-disable-line react-hooks/exhaustive-deps -- dirty: retried once undone
  useEffect(() => {
    if (!embed) return undefined;
    embed.register({
      run: (cmd) => cmds.current.run(cmd), leave: (reason) => cmds.current.leave(reason), save: () => cmds.current.saveAll(),
      focusIn: () => cmds.current.focusIn(),
      // its master's Requery: read again, unless the master's values changed and no new parameters were given (its link effect reads it then)
      requery: (ask) => cmds.current.refresh(ask, embed.childFields.length > 0 && JSON.stringify(embed.current()) !== applied.current),
    });
    return () => embed.register(null);
  }, [embed]);

  // F5 (Access): the record number box, its text selected (a document's form, not a subform's)
  useEffect(() => {
    if (!active || !tabId) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'F5' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || document.querySelector('[aria-modal="true"]')) return;
      const input = ownOne<HTMLInputElement>('[data-testid="nav-record-input"]');
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, tabId]);

  const view = mode === 'embedded' ? initialView(doc) : runViewFor(mode, doc);
  // Type-ahead (Access): the keys typed while a move the user asked for is under way (New Record, Next, Page Down…) go to the
  // record it reaches, in the control focused there (its text replaced, caret at the end); dropped, with a word in the status bar, when the
  // move does not reach it, or on Enter, Tab, Escape, a click or the focus leaving the form. Not in Datasheet view (the grid's keys).
  // Only the form whose move is under way has keys to take: the others let them through. Every user move goes through
  // userAttempt (a Continuous Forms row or a datasheet row too: the grid's own keys are never taken, see onKey).
  const ahead = useRef<string | null>(null);   // the keys handed over, applied once the focus has settled on the record reached
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const dropped = () => flashStatus('form.typeAheadDropped');
    const isText = (e: Element | null): e is HTMLInputElement | HTMLTextAreaElement =>
      e instanceof HTMLTextAreaElement || (e instanceof HTMLInputElement && e.type === 'text');
    const apply = () => {
      const text = ahead.current;
      ahead.current = null;
      if (!text) return;
      let target = document.activeElement;
      if (!isText(target) || !own(target)) {
        const n = records.snapshot.isNew ? firstStop() : lastFocused.current ?? firstStop();
        if (n) focusCtl(n);
        target = document.activeElement;
      }
      if (!isText(target) || !own(target) || target.readOnly || target.disabled) { dropped(); return; }
      // the whole field replaced, as Access selects it on entering (Behavior Entering Field: Select Entire Field, not yet a property);
      // through the control's own onChange (AutoExpand, typed text…)
      const value = text;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')!.set!.call(target, value);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.setSelectionRange(value.length, value.length);
    };
    records.setTypeAheadHandler(({ text, applied }) => {
      if (!applied) { dropped(); return; }
      ahead.current = text;   // after the view's own focus move (a frame after the move ends)
      requestAnimationFrame(() => requestAnimationFrame(apply));
    });
    const stop = () => { records.cancelTypeAhead(); if (ahead.current) { ahead.current = null; dropped(); } };
    const onKey = (e: globalThis.KeyboardEvent) => {
      // this form's keys (not its grid's), or keys sent from outside any form and any field (a ribbon button clicked)
      const at = e.target instanceof Element ? e.target : null;
      if (!at || (own(at) ? !!at.closest('.ds-grid') : !!at.closest('.frun, [aria-modal="true"], input, textarea, select, [contenteditable]'))) return;
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') { stop(); return; }
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      if (ahead.current !== null) ahead.current = (ahead.current + e.key).slice(0, 64);   // handed over, not yet applied
      else if (!records.typeAhead(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onFocus = (e: globalThis.FocusEvent) => { if (!(e.target instanceof Node && el.contains(e.target))) stop(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', stop, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      records.setTypeAheadHandler(null);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', stop, true);
      document.removeEventListener('focusin', onFocus, true);
    };
  }, [records, view]);   // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useMemo(() => datasheetColumns(doc, info ?? NO_INFO), [doc, info]);
  // Continuous Forms: the record changed with the focus left on the row it was on (Page Down, its record selector): the same
  // control on the current record keeps it, so that typing goes on there
  useEffect(() => {
    const el = document.activeElement;
    const n = el?.closest('[data-ctl]')?.getAttribute('data-ctl');
    if (n && el?.closest('[data-row-other]') && own(el)) focusCtl(n);
  }, [snap.index, snap.isNew]);
  const wasView = useRef(view);
  useEffect(() => {   // Form view <-> Datasheet view: the focus follows, on the same control
    if (wasView.current === view) return;
    wasView.current = view;
    if (active) back();
  }, [view]);

  /** The focus entering a subform: the master's modified record is saved first; refused, the focus goes back to the master (the
   *  box has put it on the control in error, else on its last control). */
  const enterSub = async (n: string): Promise<boolean> => {
    if (!records.snapshot.dirty) return true;
    if (await attempt(() => records.save())) return true;
    const frame = ownOne<HTMLElement>(`[data-ctl="${CSS.escape(n)}"]`);
    if (frame?.contains(document.activeElement)) {
      const back = lastOwn.current ?? firstStop();
      if (back) focusCtl(back);
    }
    return false;
  };
  const focusIn = () => { const n = lastFocused.current ?? firstStop(); if (n) focusCtl(n); };
  // the latest of these for the effects and the subforms' callbacks (declared here, read only once rendered)
  /** Before a tab control shows another page: the subforms of the page it leaves saved (they go with it); refused: it stays. */
  const leavePage = async (tc: string, page: number): Promise<boolean> => {
    const on = (byName.get(tc)?.children ?? []).filter((k) => (typeof k.props.PageIndex === 'number' ? k.props.PageIndex : 0) === page);
    for (const k of flattenControls(on)) {
      const sf = k.kind === 'subform' ? subs.current.get(k.name) : undefined;
      if (sf && !(await sf.save())) return false;
    }
    return true;
  };
  const cmds = useRef({ leave, run, saveAll, tabFrom, enterSub, focusIn, refresh, leavePage });
  cmds.current = { leave, run, saveAll, tabFrom, enterSub, focusIn, refresh, leavePage };
  const sub: SubformHost = useMemo(() => ({
    records, ancestors, readOnly: ro, active, region, root,
    enter: (n) => cmds.current.enterSub(n),
    register: (n, a) => {
      if (a) { subs.current.set(n, a); return; }
      subs.current.delete(n);
      setSubFilters(({ [n]: _, ...rest }) => rest);
    },
    filterOf: (n, has) => setSubFilters((f) => (f[n] === has ? f : { ...f, [n]: has })),
    dirtyOf: (n, sources) => setSubDirty((d) => (JSON.stringify(d[n] ?? []) === JSON.stringify(sources) ? d : { ...d, [n]: sources })),
    leavePage: (tc, page) => cmds.current.leavePage(tc, page),
    exit: (n, dir) => { cmds.current.tabFrom(n, dir); },
    focusOf: (n) => { lastFocused.current = n; setFocused(n); },
  }), [records, JSON.stringify(ancestors), ro, active, region]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (snap.status === 'error' || badLink) {
    const m = errorMessage(snap.error);
    return (
      <div className="frun" ref={root} data-testid="form-run">
        {badLink
          ? <div className="frun-subform-error" role="alert" data-testid="form-subform-error">{t('form.subform.badLink')}</div>
          : <div className="doc-empty muted" role="alert" data-testid="form-run-error">{t(m.key, m.params)}</div>}
      </div>
    );
  }
  const x: RunCtx = { snap, info, results, defaults: shownDefaults, display, t, focused, errors, stops, id: (n) => `${viewId}-${n}`, edit, unbound, editUnbound, events, pages, setPage, lists, typed: typedTexts, setTyped, sub };
  /** Another record, made current; then the focus on `n` there (the control clicked: already focused), else on the last control. */
  const goRow = (i: number, n?: string) => void userAttempt(() => records.goTo(i)).then((ok) => {
    if (!ok) return;
    const target = n ?? lastFocused.current ?? firstStop();
    if (target) requestAnimationFrame(() => { focusCtl(target); onFocusOf(target); });
  });
  /** Another row of Continuous Forms or of the datasheet: its values as read (blank while its page loads), its calculations,
   *  no entry, no error; focusing one of its controls makes it current. Unbound controls show the form's value, as in Access. */
  const rowCtx = (i: number): RunCtx => {
    const values = i >= snap.total ? newRowValues : records.row(i);
    return {
      ...x, results: values ? calcFor(values) : {}, defaults: {}, focused: null, errors: {}, typed: {}, other: true,
      snap: { ...snap, status: values ? snap.status : 'loading', index: i, isNew: i >= snap.total, values: values ?? [], pending: {}, dirty: false, errors: [], editable: false },
      id: (n) => `${viewId}-r${i}-${n}`, edit: () => {},
      events: (c) => ({ onFocus: () => goRow(i, c.name), onBlur: () => {}, onKeyDown: () => {} }),
    };
  };
  const filterState = !filter.items.length ? 'none' : filter.active ? 'on' : 'off';
  const onGo = (row: number) => void userAttempt(() => records.goTo(row));
  const nav = { messages, filter: filterState, onGo, onNew: () => void newRecord(), onToggleFilter: toggleFilter } as const;
  return (
    <>
      {view === 'single' && <SingleFormView doc={doc} x={x} root={root} {...nav} />}
      {view === 'continuous' && <ContinuousFormView doc={doc} x={x} rowCtx={rowCtx} root={root} onRow={(i) => goRow(i)} {...nav} />}
      {view === 'datasheet' && (
        <FormDatasheet columns={columns} byName={byName} x={x} rowCtx={rowCtx} root={root} focusHook={focusHook} {...nav}
          ro={ro} locale={region} lang={lang} onRow={(i) => userAttempt(() => records.goTo(i))} onFocusControl={onFocusOf}
          onEdited={checked} onEscape={undo} onDeleteRecord={() => { if (!ro) void deleteRecord(); }} error={sheetError} name={name} onTabOut={embed ? tabOut : undefined} />
      )}
      {menu && (
        <FilterMenu menu={menu} hasFilter={hasFilter}
          onPick={(kind: SelectionFilter) => { if (menu.kind !== 'selection') return; setMenu(null); void setCriteria(menu.field.name, selectionCriteria(kind, menu.field, menu.value)); }}
          onClear={() => { setMenu(null); void applyFilter(NO_FILTER); }}
          onClose={(escaped) => { setMenu(null); if (escaped) back(); }} />
      )}
    </>
  );
}
