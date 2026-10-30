// Mode Création : grille des champs en haut, « Propriétés du champ » en bas, enregistrement par Ctrl+S ou le ruban.
import { ChevronRight, KeyRound, Link } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayContext } from '../../shared/expr/localize';
import type { FieldType } from '../../shared/field-types';
import { localeInfo } from '../../shared/locale-format';
import { api } from '../bridge';
import type { DocViewProps } from '../shell/DocumentTabs';
import { useErrorDialog, useModal } from '../shell/Modal';
import { nameErrorKey } from '../shell/NavPane';
import { Splitter } from '../shell/Splitter';
import { SPLIT_DEFAULT, loadRatio, pxToRatio, ratioToPx, saveRatio } from '../shell/splitter-model';
import { registerCommands, registerModeGuard } from '../shell/ribbon-model';
import { TABLE_KEY, designOf, designReducer, emptyDesign, fromDesign, savedModel, toSaveRequest, withDefaultPrimaryKey, type DesignAction, type DesignModel, fieldNameTooLong, longFieldNames } from './design-model';
import { FIELD_TYPES, FieldPropertiesPanel } from './FieldPropertiesPanel';
import { TablePropertiesPanel } from './TablePropertiesPanel';
import { runSave } from './save-table';
import { editIndexes } from './IndexesDialog';
import './table-design.css';

type Expression = 'prop-defaultValue' | 'prop-validationRule' | 'table-prop-validationRule'; // the test id of an expression field
type ViewAction = DesignAction | { type: 'load'; model: DesignModel };
const viewReducer = (m: DesignModel, a: ViewAction): DesignModel => (a.type === 'load' ? a.model : designReducer(m, a));
const SPLIT_KEY = 'basecraft.design.splitRatio'; // grid height / available height, per user
const BAR = 6; // splitter thickness (px)
const GRID_MIN = 34 + 3 * 30; // header + 3 rows
const PROPS_MIN = 128; // heading + tab bar + 2 rows
const CELL = /^design-row-(\d+)-(key|name|type|desc)$/;

export function TableDesignView({ tab, readOnly, dispatch, link }: DocViewProps) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [model, set] = useReducer(viewReducer, undefined, emptyDesign);
  const [picked, setPicked] = useState<number[]>([]); // rows selected with the row selectors (Ctrl/Shift for several)
  const anchor = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const [ratio, setRatio] = useState(() => loadRatio(SPLIT_KEY));
  // An existing table is usable once its design is loaded (until then, a save would take it for a new table).
  const ready = !!tab.isNew || model.originalName !== null;
  const [avail, setAvail] = useState(0); // height shared by the two panes, kept up to date on window resize
  const banner = useRef<HTMLDivElement>(null); // a linked table's banner (C1 R8) takes its room above the panes
  const linked = !!link;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const above = () => (banner.current ? banner.current.getBoundingClientRect().bottom - el.getBoundingClientRect().top : 0);
    const measure = () => setAvail(Math.max(0, el.clientHeight - BAR - above()));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (banner.current) ro.observe(banner.current); // its text wraps on a narrow window
    return () => ro.disconnect();
  }, [linked, ready]);
  const gridPx = ratioToPx(ratio, avail, GRID_MIN, PROPS_MIN);
  const setGridPx = (px: number) => { const r = pxToRatio(px, avail); setRatio(r); saveRatio(SPLIT_KEY, r); };
  const lastExpression = useRef<Expression>('prop-validationRule'); // the Builder command's target (its field's test id)
  const loaded = useRef<{ name: string; token: number } | null>(null);
  const busy = useRef(false); // synchronous twin of `saving` (a key repeat must not start a second save)
  const [saving, setSaving] = useState(false); // the whole save flow: grid, properties and commands are locked
  const [sheet, setSheet] = useState(false); // the table's Property Sheet, on the right
  const [region, setRegion] = useState<string | null>(null); // expressions are shown with the region's separators
  useEffect(() => { void api.app.getSettings().then((s) => setRegion(s.region), () => setRegion('en-US')); }, []);
  const lang = i18n.language.startsWith('fr') ? 'fr' : 'en';
  const ctx = useMemo<DisplayContext | null>(() => (region === null ? null : { lang, region: localeInfo(region) }), [lang, region]);
  const live = useRef({ model, readOnly, tab, picked, ready });
  live.current = { model, readOnly, tab, picked, ready };

  useEffect(() => {
    if (tab.isNew) return;
    const prev = loaded.current;
    loaded.current = { name: tab.name, token: tab.reloadToken };
    if (prev && prev.token === tab.reloadToken) {
      if (prev.name === tab.name) return; // nothing new (or our own save, which reloads by itself)
      // Renamed from the navigation pane while edited: keep the edits, save under the new name.
      if (live.current.model.dirty) { set({ type: 'load', model: { ...live.current.model, originalName: tab.name } }); return; }
    }
    let current = true;
    api.tables.design(tab.name).then(
      (d) => { if (current) { set({ type: 'load', model: fromDesign(d, live.current.tab.description) }); setPicked([]); } },
      (e) => { if (current) void showError(e); },
    );
    return () => { current = false; };
  }, [tab.name, tab.isNew, tab.reloadToken, showError]);

  useEffect(() => { if (tab.description !== undefined) set({ type: 'setDescription', description: tab.description }); }, [tab.description]);
  useEffect(() => { dispatch({ type: 'setDirty', id: tab.id, dirty: model.dirty }); }, [model.dirty, tab.id, dispatch]);
  useEffect(() => () => { void dispatch({ type: 'setDirty', id: tab.id, dirty: false }); }, [tab.id, dispatch]); // edits leave with the view

  useEffect(() => {
    if (!focusNext.current || saving) return;
    root.current?.querySelector<HTMLElement>(`[data-testid="${focusNext.current}"]`)?.focus();
    focusNext.current = null;
  });

  const targets = () => {
    const { picked: p, model: m } = live.current;
    return (p.length ? p : [m.selected]).filter((i) => i < m.rows.length);
  };
  const message = (messageKey: string, params?: object) => modal.confirm({ titleKey: 'dialog.errorTitle', messageKey, params, buttons: ['ok'] });

  const askName = (initial: string) => modal.prompt({
    titleKey: 'designer.saveAsTitle', labelKey: 'designer.tableNameLabel', initial,
    validate: (v) => { const k = nameErrorKey(v); return k && t(k); },
  });

  /** A field that commits when left (an expression) gives its entry to the model, which has rendered once this resolves. */
  const flush = async () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !root.current?.contains(el)) return;
    el.blur();
    await new Promise((r) => setTimeout(r));
  };

  /** Unreadable expressions, one line each; the save refuses while there are any. */
  const invalidLines = (m: DesignModel) => Object.entries(m.invalid).map(([k, code]) => {
    const sep = k.lastIndexOf(':');
    const r = m.rows.find((x) => x.key === k.slice(0, sep));
    const message = t('designer.propError', { prop: t(`fieldProp.${k.slice(sep + 1)}`), message: t(`expr.error.${code}`) });
    if (k.startsWith(`${TABLE_KEY}:`)) return t('designer.tableErrors', { message }); // the Property Sheet's
    return t('designer.fieldError', { field: r?.name || t('designer.unnamedField'), message });
  });

  /** The whole save flow; true when the table is saved. */
  const save = async (): Promise<boolean> => {
    const { readOnly: ro, ready: ok, tab: doc } = live.current;
    if (ro || !ok || busy.current) return false;
    busy.current = true;
    const focused = root.current?.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.testid : undefined;
    if (focused) focusNext.current = focused; // given back once the grid is unlocked
    try {
      await flush(); // before the view locks: a disabled input is never left (no blur)
      setSaving(true);
      let m = live.current.model;
      if (Object.keys(m.invalid).length) {
        await message('designer.invalidExpressions', { detail: invalidLines(m).join('\n') });
        return false;
      }
      const long = longFieldNames(m);
      if (long.length) {
        const lines = long.map((r) => t('designer.fieldError', { field: r.name, message: t('designError.nameTooLong') }));
        await message('designer.designErrors', { detail: lines.join('\n') });
        return false;
      }
      const isNew = m.originalName === null;
      let name = m.originalName ?? (await askName(doc.name));
      if (name === null) return false;
      // As in Access, a new table without a key gets the offer of one.
      if (isNew && !toSaveRequest(m, name, false).design.fields.some((x) => x.props.primaryKey)) {
        const r = await modal.confirm({ titleKey: 'designer.noKeyTitle', messageKey: 'designer.noKey', buttons: ['yes', 'no', 'cancel'] });
        if (r === 'cancel') return false;
        if (r === 'yes') { m = withDefaultPrimaryKey(m, t('designer.defaultIdName')); set({ type: 'load', model: m }); }
      }
      const done = await runSave(modal, (n, f) => ({ ...toSaveRequest(m, n, f.allowDataLoss), ...(f.acceptExistingViolations ? { acceptExistingViolations: true } : {}) }), name, askName);
      if (!done) return false;
      const { req } = done;
      name = done.name;
      // Saved: the model maps each field to itself at once, so a second save, or a failed reload below, can never
      // send the old mapping (a rename would fail, a swap would swap the data back).
      set({ type: 'load', model: savedModel(m, req) });
      loaded.current = { name, token: doc.reloadToken + 1 }; // tableSaved bumps it; this save reloads by itself
      dispatch(isNew ? { type: 'tableSaved', name, tabId: doc.id } : { type: 'tableSaved', name });
      try {
        const d = await api.tables.design(name);
        set({ type: 'load', model: { ...fromDesign(d), selected: live.current.model.selected } });
      } catch (e) {
        await showError(e);
      }
      return true;
    } catch (e) {
      await showError(e);
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const deleteRows = async () => {
    const { model: m } = live.current;
    const idx = targets();
    const existing = idx.filter((i) => m.rows[i].sourceName !== null);
    if (existing.length) {
      const names = existing.map((i) => t('designer.quoted', { name: m.rows[i].sourceName })).join(', ');
      const r = await modal.confirm({ titleKey: 'designer.deleteTitle', messageKey: 'designer.deleteMessage', params: { names }, buttons: ['yes', 'no'], defaultButton: 'no' });
      if (r !== 'yes') return;
    }
    if (live.current.model !== m) return; // edited meanwhile: the indices may no longer match
    set({ type: 'deleteRows', indices: idx });
    setPicked([]);
  };

  const primaryKey = () => set({ type: 'togglePrimaryKey', indices: targets() });
  const insertRows = () => {
    const at = Math.min(live.current.model.selected, live.current.model.rows.length);
    set({ type: 'addRow', at });
    setPicked([]);
    focusNext.current = `design-row-${at}-name`;
  };
  /** Before the view goes: true to let it go. As in Access, a change of mode requires the save (No stays in design);
   *  a close offers to drop the edits ("No"). */
  const leave = async (reason: 'mode' | 'close'): Promise<boolean> => {
    if (busy.current) return false;
    await flush();
    const { model: m, tab: doc } = live.current;
    if (!m.dirty) return true;
    if (reason === 'mode') {
      const r = await modal.confirm({ titleKey: 'designer.saveFirstTitle', messageKey: 'designer.mustSaveFirst', params: { name: doc.name }, buttons: ['yes', 'no'] });
      return r === 'yes' && (await save());
    }
    const r = await modal.confirm({ titleKey: 'designer.saveFirstTitle', messageKey: 'designer.saveFirst', params: { name: doc.name }, buttons: ['yes', 'no', 'cancel'] });
    return r === 'no' || (r === 'yes' && (await save()));
  };

  /** Builder (ribbon): the « … » of the expression property last focused (Validation Rule before any). */
  const builder = () => root.current?.querySelector<HTMLButtonElement>(`[data-testid="${lastExpression.current}-build"]`)?.click();

  /** Test Validation Rules: the stored rows against each field's rule; as in Access, the table is saved first. */
  const testRules = async () => {
    await flush();
    const { model: m, tab: doc } = live.current;
    if (m.dirty || m.originalName === null) {
      const r = await modal.confirm({ titleKey: 'designer.saveFirstTitle', messageKey: 'designer.mustSaveFirst', params: { name: doc.name }, buttons: ['yes', 'no'] });
      if (r !== 'yes' || !(await save())) return;
    }
    const name = live.current.model.originalName;
    if (name === null) return;
    try {
      const failed = await api.tables.testRules(name);
      const list = failed.map((x) => (x.field === '' ? t('designer.testRulesTable', { count: x.rows }) // the table's rule
        : t('designer.testRulesField', { field: x.field, count: x.rows }))).join('\n');
      await modal.confirm({
        titleKey: 'ribbon.cmd.testValidationRules', messageKey: failed.length ? 'designer.testRulesFailed' : 'designer.testRulesPassed', params: { list }, buttons: ['ok'],
      });
    } catch (e) {
      await showError(e);
    }
  };

  /** Indexes (ribbon): the dialog edits the open design, saved with the table as in Access; read-only base: shown only. */
  const indexes = async () => {
    await flush();
    const { model: m, readOnly: ro, tab: doc } = live.current;
    const next = await editIndexes(modal, designOf(m, doc.name), ro);
    if (next && live.current.model === m) set({ type: 'setIndexes', design: next }); // edited meanwhile: the rows may no longer match
  };

  const cmds = useRef({ save, primaryKey, insertRows, deleteRows, leave, builder, testRules, indexes });
  cmds.current = { save, primaryKey, insertRows, deleteRows, leave, builder, testRules, indexes };
  useEffect(() => {
    // The ribbon already refuses these in a read-only base; the handlers refuse them too, and during a save.
    const writable = (id: 'save' | 'primaryKey' | 'insertRows' | 'deleteRows' | 'builder') => async () => {
      if (!live.current.readOnly && live.current.ready && !busy.current) await cmds.current[id]();
    };
    const offCommands = registerCommands(tab.id, {
      save: writable('save'), primaryKey: writable('primaryKey'), insertRows: writable('insertRows'), deleteRows: writable('deleteRows'),
      builder: writable('builder'),
      testValidationRules: async () => { if (live.current.ready && !busy.current) await cmds.current.testRules(); },
      indexes: async () => { if (live.current.ready && !busy.current) await cmds.current.indexes(); },
      propertySheet: () => setSheet((v) => !v), // also F4 (App.tsx); shown in a read-only base, its fields disabled
    });
    const offGuard = registerModeGuard(tab.id, (reason) => cmds.current.leave(reason));
    return () => { offCommands(); offGuard(); };
  }, [tab.id]);

  // A cell of the trailing empty row first creates the field.
  const edit = (i: number, a: DesignAction) => {
    if (i === live.current.model.rows.length) set({ type: 'addRow' });
    set(a);
  };

  const pick = (i: number, e: MouseEvent) => {
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      setPicked(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else {
      anchor.current = i;
      setPicked((cur) => (!(e.ctrlKey || e.metaKey) ? [i] : cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));
    }
    set({ type: 'select', index: i });
  };

  const onFocusRow = (i: number, target: EventTarget) => {
    const col = CELL.exec((target as HTMLElement).dataset?.testid ?? '')?.[2];
    if (col && col !== 'key') { setPicked([]); anchor.current = i; }
    if (i !== live.current.model.selected) set({ type: 'select', index: i });
  };

  // Tab / Shift+Tab follow the DOM order (name, type, description, next row); arrows up/down change rows.
  const onKeyDown = (e: KeyboardEvent) => {
    const m = CELL.exec((e.target as HTMLElement).dataset?.testid ?? '');
    if (!m) return;
    const [i, col] = [Number(m[1]), m[2]];
    if (col === 'key' && e.key === 'Delete') {
      e.preventDefault();
      if (!readOnly && !busy.current) void deleteRows();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
      const next = root.current?.querySelector<HTMLElement>(`[data-testid="design-row-${i + (e.key === 'ArrowDown' ? 1 : -1)}-${col}"]`);
      e.preventDefault(); // also in the type list, as in Access: Alt+Down opens it
      next?.focus();
    }
  };

  if (!ready) return <div className="designer" ref={root} />;
  const rows = readOnly ? model.rows : [...model.rows, null];
  const locked = readOnly || saving;
  const current = model.rows[model.selected];
  return (
    <div className="tdesign" ref={root} aria-busy={saving}
      onFocus={(e) => { const m = /^prop-(defaultValue|validationRule)$|^table-prop-validationRule$/.exec(e.target.dataset.testid ?? ''); if (m) lastExpression.current = m[0] as Expression; }}>
      <div className="designer">
      {link && ( // C1 R8: read-only (the shell passes readOnly), its structure belongs to its file
        <div ref={banner} className="banner banner-info tdesign-link" role="status" data-testid="design-link-banner">
          <Link className="ic" aria-hidden /><span className="banner-text">{t('link.designBanner', { path: link.path })}</span>
        </div>
      )}
      <div className="dgrid-wrap" data-testid="design-grid-pane" style={avail > 0 ? { flex: 'none', height: gridPx } : undefined}>
        <table className="dgrid" aria-label={t('designer.grid')}>
          <colgroup><col className="c-sel" /><col className="c-name" /><col className="c-type" /><col /></colgroup>
          <thead>
            <tr>
              <th className="gutter"><span className="sr-only">{t('designer.colSelector')}</span></th>
              <th>{t('designer.colName')}</th>
              <th>{t('designer.colType')}</th>
              <th>{t('designer.colDesc')}</th>
            </tr>
          </thead>
          <tbody onKeyDown={onKeyDown}>
            {rows.map((r, i) => {
              const n = i + 1;
              const pk = !!r?.props.primaryKey;
              const cls = [i === model.selected && 'is-current', picked.includes(i) && 'is-picked', !r && 'is-new'].filter(Boolean).join(' ');
              return (
                <tr key={i} className={cls} onFocus={(e) => onFocusRow(i, e.target)}>
                  <td className="gutter">
                    <button tabIndex={-1} data-testid={`design-row-${i}-key`} data-primary-key={pk || undefined} aria-pressed={picked.includes(i)}
                      aria-label={t(pk ? 'designer.rowSelectorKey' : 'designer.rowSelector', { n })} onClick={(e) => pick(i, e)}>
                      {pk ? <KeyRound className="ic ic-sm key" aria-hidden /> : i === model.selected ? <ChevronRight className="ic ic-sm" aria-hidden /> : null}
                    </button>
                  </td>
                  <td>
                    <input data-testid={`design-row-${i}-name`} aria-label={t('designer.cellName', { n })} disabled={locked} spellCheck={false}
                      aria-invalid={!!r && fieldNameTooLong(r)} aria-describedby={r && fieldNameTooLong(r) ? `design-row-${i}-name-error` : undefined}
                      value={r?.name ?? ''} onChange={(e) => edit(i, { type: 'setName', index: i, name: e.target.value })} />
                    {r && fieldNameTooLong(r) && (
                      <span id={`design-row-${i}-name-error`} className="field-error" role="alert" data-testid={`design-row-${i}-name-error`}>{t('designError.nameTooLong')}</span>
                    )}
                  </td>
                  <td>
                    <select data-testid={`design-row-${i}-type`} aria-label={t('designer.cellType', { n })} disabled={locked}
                      value={r?.props.type ?? ''} onChange={(e) => edit(i, { type: 'setType', index: i, fieldType: e.target.value as FieldType })}>
                      {!r && <option value="" hidden />}
                      {FIELD_TYPES.map((x) => <option key={x} value={x}>{t(`fieldType.${x}`)}</option>)}
                    </select>
                  </td>
                  <td>
                    <input data-testid={`design-row-${i}-desc`} aria-label={t('designer.cellDesc', { n })} disabled={locked}
                      value={r?.props.description ?? ''} onChange={(e) => edit(i, { type: 'setProp', index: i, key: 'description', value: e.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Splitter testId="design-splitter" label={t('designer.splitter')} total={avail} value={gridPx} min={GRID_MIN} max={avail - PROPS_MIN}
        onChange={setGridPx} onReset={() => { setRatio(SPLIT_DEFAULT); saveRatio(SPLIT_KEY, SPLIT_DEFAULT); }} />
      <FieldPropertiesPanel props={current?.props ?? null} disabled={locked} ctx={ctx} rowKey={current?.key ?? ''} fieldName={current?.name ?? ''}
        invalid={Object.fromEntries(Object.entries(model.invalid).filter(([k]) => k.startsWith(`${current?.key}:`)).map(([k, c]) => [k.slice(k.lastIndexOf(':') + 1), c]))}
        onProp={(key, value) => set({ type: 'setProp', index: model.selected, key, value })}
        onInvalid={(key, code) => set({ type: 'setInvalid', index: model.selected, key, code })} />
      </div>
      {sheet && ctx && <TablePropertiesPanel model={model} disabled={locked} dispatch={set}
        ctx={{ ...ctx, fields: model.rows.map((r) => r.name).filter(Boolean), criteria: false }} />}
    </div>
  );
}
