// Exécution d'une requête action, comme dans Access : les paramètres, le nombre de lignes à confirmer (Non par défaut), puis
// l'exécution ; des lignes refusées font demander « Exécuter quand même ? », une table existante « La remplacer ? ».
import type { QueryRef } from '../../shared/api';
import type { CellInput } from '../../shared/coerce';
import { defaultProps, sameName } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import type { RecordSourceRef } from '../../shared/record-source';
import { isSelectBody, type Query } from '../../shared/query/ast';
import { parseSql } from '../../shared/query/sql-parser';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { contentBlocked } from '../shell/Banners';
import { bcErrorCode, type ModalApi, type ModalButton } from '../shell/Modal';
import type { AppDispatch } from '../shell/nav-menu';
import type { DocTab } from '../state/app-state';
import { promptParameters } from './prompt-parameters';

export type ActionOutcome = 'done' | 'cancelled' | 'blocked' | 'failed';
export type ActionKind = 'makeTable' | 'append' | 'update' | 'delete';

const parse = (sql: string): Query | null => { try { return parseSql(sql); } catch { return null; } };
const kindOf = (q: Query): ActionKind | null => {
  const k = q.body.k;
  return isSelectBody(q) ? null : k === 'insert' ? 'append' : k === 'select' || k === 'union' ? 'makeTable' : k;
};

let openTabs: () => readonly DocTab[] = () => [];
/** The shell's open documents (App), read when an action query is about to run. */
export function setOpenTabs(fn: () => readonly DocTab[]): void { openTabs = fn; }
/** `table` is in use, as Access's lock refuses it: a datasheet of it, or of a query that writes it, or a form (Form or
 *  Datasheet view, A4) with a record being edited on a source that writes it (its own or a subform's: the tab's dirtySources) (saved after the run, it would land on the
 *  rows the query changed: a lost update, a deleted row, another table's row after a replace) or, for a Make-Table that
 *  replaces it, a design of it not saved (reloaded over the edits). */
async function inUse(table: string, makeTable: boolean): Promise<boolean> {
  const keyTable = async (ref: RecordSourceRef) => (await api.sources.describe(ref).catch(() => null))?.keyTable;
  for (const x of openTabs()) {
    if (!x.dirty || x.isNew) continue;
    if (x.kind === 'table' && x.name === table && (x.mode === 'datasheet' || makeTable)) return true;
    if (x.kind === 'query' && x.mode === 'run' && await keyTable({ kind: 'query', name: x.name }) === table) return true;
    if (x.kind === 'form' && x.mode !== 'design') {
      // the sources whose record is being edited, the form's own or a subform's, as the form publishes them with its tab
      for (const src of x.dirtySources ?? []) if (src.kind === 'table' ? sameName(src.name, table) : sameName(await keyTable(src) ?? '', table)) return true;
    }
  }
  return false;
}

/** The tables a run of `kind` on `table` writes: the table, then, transitively, for a Delete the tables its rows' deletion
 *  reaches (ON DELETE CASCADE: deleted, and their own cascades; SET NULL / SET DEFAULT: modified), for an Update the
 *  children of relations with Cascade Update Related Fields (whichever fields the query sets: a superset). */
async function writtenTables(table: string, kind: ActionKind): Promise<string[]> {
  const out = [table];
  if (kind !== 'delete' && kind !== 'update') return out;
  const relations = kind === 'update' ? (await api.relations.list()).filter((r) => r.enforce && r.cascadeUpdate) : [];
  const expand = [table]; // deleted (or updated) rows: their cascades go on
  while (expand.length) {
    const t = expand.shift()!;
    const next = kind === 'delete' ? await api.relations.cascadeChildren(t)
      : relations.filter((r) => r.parentTable === t).map((r) => ({ table: r.childTable, effect: 'deleted' as const }));
    for (const c of next) {
      if (out.includes(c.table)) continue;
      out.push(c.table);
      if (c.effect === 'deleted') expand.push(c.table);
    }
  }
  return out;
}

/** `bc:missingParameter||<name>` or `bc:invalidParameter|<code>|<name>` of a rejected call. */
const parameterError = (e: unknown) => {
  const m = /\bbc:(missingParameter|invalidParameter)\|[^|]*\|(.*)$/s.exec(e instanceof Error ? e.message : String(e));
  return m ? { missing: m[1] === 'missingParameter', name: m[2]! } : null;
};

/**
 * Runs the action query `ref` (on a read-only base: refused at once, `dialog.op.readOnly`): its parameters asked in order (each one actionCount says is missing, with its PARAMETERS type
 * when declared; a value the main process cannot convert is shown, then asked again), the count confirmed
 * (`query.action.confirm_<kind>`, default No) unless a table it writes, itself or by cascade, is in use (`query.action.inUse`), then runAction; `rowErrors` asks `query.action.partial`, Access's sentence
 * with the refused rows counted by cause (Yes: the valid rows are written), `tableExists` asks `query.action.replace` (Yes: replaced). Any other refusal or error is shown. After a
 * run, the open table and query datasheets read their rows again (`dispatch`), a Make-Table's table its design, and the
 * Navigation Pane its lists. While the base's active content is not enabled, actionCount refuses (`bc:contentDisabled`): `query.action.contentDisabled`
 * is shown at once, before any parameter, count or question. `warnings: false` (SetWarnings Off) answers the count, partial-failure and replace questions Yes
 * unseen; refusals and errors are still shown.
 * Resolves how it ended (its message already shown): 'done', 'cancelled' (a question answered No, a parameter cancelled),
 * 'blocked' (content not enabled), 'failed' (refused or an error). A macro's action fails unless 'done'.
 */
export async function runActionFlow(ref: QueryRef, deps: { modal: ModalApi; region: LocaleInfo; showError(e: unknown): Promise<void>; dispatch?: AppDispatch; warnings?: boolean }): Promise<ActionOutcome> {
  const { modal } = deps;
  const ask = (messageKey: string, params: object): Promise<ModalButton> => deps.warnings === false ? Promise.resolve('yes')
    : modal.confirm({ titleKey: 'query.action.title', messageKey, params, buttons: ['yes', 'no'], defaultButton: 'no' });
  const message = (messageKey: string, params: object = {}) => modal.confirm({ titleKey: 'query.action.title', messageKey, params, buttons: ['ok'] });
  try {
    const sql = ref.kind === 'sql' ? ref.sql : ((await api.objects.get('query', ref.name)).definition as { sql: string }).sql;
    const q = parse(sql);
    const kind = q && kindOf(q);
    if (!q || !kind) throw new Error('bc:notSelectQuery'); // a select query that cannot run: a saved query it reads became an action query
    if ((await api.base.state())?.readOnly) { await message('dialog.op.readOnly'); return 'failed'; } // before any parameter or count
    const values: Record<string, CellInput> = {};
    let count: number;
    let table: string;
    for (;;) {
      try {
        ({ count, table } = await api.queries.actionCount(ref, values));
        break;
      } catch (e) {
        const p = parameterError(e);
        if (p === null || Object.hasOwn(values, p.name) === p.missing) throw e; // asked already, or a value never given
        if (!p.missing) {
          await deps.showError(e);
          delete values[p.name];
        }
        const name = p.name;
        const decl = q.params.find((x) => sameName(x.name, name)); // as bindQuery types a declared parameter
        const param = decl ? { name, type: decl.type, props: { ...defaultProps(decl.type), ...(decl.numberSize && { numberSize: decl.numberSize }), required: false } }
          : { name, type: null };
        const got = await promptParameters(modal, [param], deps.region);
        if (got === null) return 'cancelled';
        Object.assign(values, got);
      }
    }
    for (const t of await writtenTables(table, kind)) {
      if (await inUse(t, kind === 'makeTable')) { await message('query.action.inUse', { table: t }); return 'failed'; }
    }
    if ((await ask(`query.action.confirm_${kind}`, { count })) !== 'yes') return 'cancelled';
    // Make-Table: the table it may replace, as spelled now (a replace may change its spelling: `totaux` -> `Totaux`)
    const into = q.body.k === 'select' ? q.body.into : undefined;
    const before = into === undefined ? undefined : (await api.tables.list()).find((t) => sameName(t.name, into))?.name;
    const opts = { skipFailures: false, replaceTable: false };
    for (;;) {
      const r = await api.queries.runAction(ref, values, { ...opts });
      if (r.ok) break;
      if (r.reason === 'rowErrors') {
        const e = r.errors[0]!;
        const unnamed = e.table === undefined && e.code === 'related' ? 'unnamed' : undefined;
        const text = e.field === '' && e.code === 'validation' ? e.message ?? i18n.t('fieldError.tableRule', { table: e.table ?? '', context: 'short' }) // the table's rule
          : e.field === '' && e.code === 'expressionError' ? i18n.t('fieldError.tableRuleError', { table: e.table ?? '' }) // … that cannot be computed
          : e.field === '' ? i18n.t('query.action.relatedRow', { table: e.table ?? '', context: unnamed }) // a delete refused
          : i18n.t('datasheet.fieldError', { field: e.field, message: e.message ?? (e.code === 'validation' ? i18n.t('query.action.validation')
            : i18n.t(`fieldError.${e.code}`, { table: e.table ?? '', context: unnamed })) });
        const records = (n: number) => i18n.t('query.action.records', { count: n });
        const { conversion, key, lock, validation } = r.byCause;
        // Access's sentence: the fields set to Null (type conversion), then the records refused by cause
        const params = { total: r.total, message: text, conversion: i18n.t('query.action.fields', { count: conversion }), key: records(key), lock: records(lock),
          validation: records(validation) };
        if ((await ask('query.action.partial', params)) !== 'yes') return 'cancelled';
        opts.skipFailures = true;
      } else if (r.reason === 'tableExists') {
        if ((await ask('query.action.replace', { table: r.table })) !== 'yes') return 'cancelled';
        opts.replaceTable = true;
      } else if (r.reason === 'badColumnName') {
        await message('query.action.badColumnName', { column: r.column });
        return 'failed';
      } else {
        const table = 'table' in r ? r.table : '';
        await message(r.reason === 'related' || r.reason === 'nameExists' ? `query.action.${r.reason}` : `dialog.op.${r.reason}`,
          { table, context: r.reason === 'related' && !table ? 'unnamed' : undefined });
        return 'failed';
      }
    }
    const dispatch = deps.dispatch;
    if (dispatch) {
      const tables = await api.tables.list();
      if (into !== undefined) { // a new or replaced table: its open tabs take its spelling and read it again, as after a save
        const made = tables.find((t) => sameName(t.name, into))?.name ?? into;
        if (before !== undefined && before !== made) void dispatch({ type: 'tableRenamed', from: before, to: made });
        void dispatch({ type: 'tableSaved', name: made });
      }
      void dispatch({ type: 'listsChanged' });
      for (const t of tables) void dispatch({ type: 'tableDataChanged', name: t.name });
      void dispatch({ type: 'queryDataChanged' });
    }
    return 'done';
  } catch (e) {
    if (bcErrorCode(e) === 'contentDisabled') { // also when it changed between the count and the run
      contentBlocked();   // the message points at the security bar: a dismissed one comes back
      await message('query.action.contentDisabled');
      return 'blocked';
    }
    await deps.showError(e);
    return 'failed';
  }
}
