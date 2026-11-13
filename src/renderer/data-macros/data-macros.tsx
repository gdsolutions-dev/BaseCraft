// Table data macros (T2): the Table tab's five event buttons open the macro designer on « <Table> : <Event> » (an embedded macro
// tab whose Save writes into the table's metadata); Named Macro, Create Data Macros and Rename/Delete Macro open one list dialog.
// ponytail: one dialog serves all three buttons (events: Edit / Delete, named macros: Edit / Rename / Delete / New).
import { useTranslation } from 'react-i18next';
import { sameName } from '../../shared/field-types';
import { DATA_EVENTS, type DataEvent, type DataMacros } from '../../shared/macro/data-macro';
import { emptyMacro, type MacroDef } from '../../shared/macro/model';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { openEmbedded } from '../macro/embedded';
import type { DesignShellEnv } from '../design/hooks';
import type { ModalApi } from '../shell/Modal';
import type { CommandHandlers } from '../shell/ribbon-model';
import { nameErrorKey } from '../shell/name-error';
import type { AppDispatch } from '../shell/nav-menu';
import '../database-tools/database-tools.css';

export interface DataMacroEnv { modal: ModalApi; dispatch: AppDispatch; table(): string | null }

type Target = { event: DataEvent } | { named: string };
type Choice = { act: 'edit' | 'delete' | 'rename'; target: Target } | { act: 'new' };

const eventLabel = (e: DataEvent): string => i18n.t(`ribbon.cmd.${e}`);
const isEmpty = (d: MacroDef | undefined): boolean => !d || d.items.every((i) => i.k === 'comment');

/** The set with `def` stored for `target` (an empty macro removes it) or, with null, with that macro removed. */
function withMacro(dm: DataMacros, target: Target, def: MacroDef | null): DataMacros {
  if ('event' in target) {
    const { [target.event]: _old, ...events } = dm.events ?? {};
    return { ...dm, events: def && !isEmpty(def) ? { ...events, [target.event]: def } : events };
  }
  const named = Object.fromEntries(Object.entries(dm.named ?? {}).filter(([n]) => n !== target.named));
  return { ...dm, named: def ? { ...named, [target.named]: def } : named };
}

/** Reads the table's current set, applies `change`, writes it back (a refusal rejects: the caller shows it). */
async function update(table: string, change: (dm: DataMacros) => DataMacros): Promise<void> {
  await api.tables.saveDataMacros(table, change(await api.tables.dataMacros(table)));
}

/** Opens the designer on the macro of `target` (a new named macro starts empty and is stored by its first Save). */
export async function editDataMacro(env: DataMacroEnv, table: string, target: Target): Promise<void> {
  const dm = await api.tables.dataMacros(table);
  const def = 'event' in target ? dm.events?.[target.event] : dm.named?.[target.named];
  const label = 'event' in target ? eventLabel(target.event) : target.named;
  openEmbedded(env.dispatch, {
    owner: `data:${table}`, title: `${table} : ${label}`, def: def ?? emptyMacro(), data: 'event' in target ? target.event : 'named',
    save: async (d) => { await update(table, (cur) => withMacro(cur, target, d)); return true; },
  });
}

/** The ribbon handlers (registered by the shell's design commands): they act on the active table, a datasheet or its Design view. */
export function dataMacroCommands(env: DesignShellEnv): CommandHandlers {
  const active = (): string | null => {
    const s = env.live.current.state;
    const tab = s.tabs.find((x) => x.id === s.activeId);
    return tab && tab.kind === 'table' && !tab.isNew && !tab.embedded ? tab.name : null;
  };
  const denv: DataMacroEnv = { modal: env.modal, dispatch: env.dispatch, table: active };
  const on = (f: (table: string) => Promise<void>) => async () => {
    const table = active();
    if (!table) return;
    try { await f(table); } catch (e) {
      await env.modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'dataMacro.saveFailed', params: { detail: e instanceof Error ? e.message : String(e) }, buttons: ['ok'] });
    }
  };
  return {
    ...Object.fromEntries(DATA_EVENTS.map((e) => [e, on((t) => editDataMacro(denv, t, { event: e }))])) as CommandHandlers,
    namedMacro: on((t) => dataMacrosDialog(denv, t, 'named')),
    createDataMacros: on((t) => dataMacrosDialog(denv, t, 'all')),
    renameDeleteMacro: on((t) => dataMacrosDialog(denv, t, 'all')),
  };
}

/** The list dialog (`scope` 'named': the named macros only), looping until it is closed or a macro is opened. */
export async function dataMacrosDialog(env: DataMacroEnv, table: string, scope: 'all' | 'named'): Promise<void> {
  for (;;) {
    const dm = await api.tables.dataMacros(table);
    const c = await env.modal.custom<Choice>((close) => <DataMacrosList dm={dm} scope={scope} onChoose={close} />,
      { titleKey: scope === 'named' ? 'dataMacro.namedTitle' : 'dataMacro.title', titleParams: { table } });
    if (!c) return;
    try {
      if (c.act === 'new') {
        const name = await askName(env.modal, '', dm);
        if (name) { await editDataMacro(env, table, { named: name }); return; }
      } else if (c.act === 'edit') { await editDataMacro(env, table, c.target); return; }
      else if (c.act === 'delete') {
        const label = 'event' in c.target ? eventLabel(c.target.event) : c.target.named;
        if (await env.modal.confirm({ titleKey: 'dataMacro.title', messageKey: 'dataMacro.deleteAsk', params: { name: label, table }, buttons: ['yes', 'no'], defaultButton: 'no' }) === 'yes') {
          await update(table, (cur) => withMacro(cur, c.target, null));
        }
      } else if ('named' in c.target) {
        const old = c.target.named;
        const name = await askName(env.modal, old, dm);
        if (name && name !== old) await update(table, (cur) => ({ ...cur, named: Object.fromEntries(Object.entries(cur.named ?? {}).map(([n, d]) => [n === old ? name : n, d])) }));
      }
    } catch (e) {
      await env.modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'dataMacro.saveFailed', params: { detail: e instanceof Error ? e.message : String(e) }, buttons: ['ok'] });
    }
  }
}

const askName = (modal: ModalApi, initial: string, dm: DataMacros): Promise<string | null> => modal.prompt({
  titleKey: 'ribbon.cmd.namedMacro', labelKey: 'dataMacro.nameLabel', initial,
  validate: (v) => {
    const k = nameErrorKey(v);
    if (k) return i18n.t(k);
    return Object.keys(dm.named ?? {}).some((n) => sameName(n, v.trim()) && n !== initial) ? i18n.t('dataMacro.nameExists') : null;
  },
}).then((v) => (v === null ? null : v.trim()));

function DataMacrosList({ dm, scope, onChoose }: { dm: DataMacros; scope: 'all' | 'named'; onChoose(c: Choice | null): void }) {
  const { t } = useTranslation();
  const named = Object.keys(dm.named ?? {});
  const row = (key: string, label: string, target: Target, defined: boolean, rename: boolean) => (
    <li key={key}>
      <span>{label}</span>{!defined && <small className="muted"> {t('dataMacro.empty')}</small>}{' '}
      <button type="button" className="btn" data-testid={`datamacro-edit-${key}`} onClick={() => onChoose({ act: 'edit', target })}>{t('dataMacro.edit')}</button>
      {rename && <button type="button" className="btn" data-testid={`datamacro-rename-${key}`} onClick={() => onChoose({ act: 'rename', target })}>{t('dataMacro.rename')}</button>}
      <button type="button" className="btn" data-testid={`datamacro-delete-${key}`} disabled={!defined} onClick={() => onChoose({ act: 'delete', target })}>{t('dataMacro.delete')}</button>
    </li>
  );
  return (
    <div data-testid="datamacro-dialog">
      {scope === 'all' && (
        <section>
          <h3>{t('dataMacro.events')}</h3>
          <ul className="dbt-list">{DATA_EVENTS.map((e) => row(e, eventLabel(e), { event: e }, !!dm.events?.[e], false))}</ul>
        </section>
      )}
      <section>
        <h3>{t('dataMacro.named')}</h3>
        {named.length ? <ul className="dbt-list" data-testid="datamacro-named">{named.map((n) => row(`named-${n}`, n, { named: n }, true, true))}</ul>
          : <p className="muted">{t('dataMacro.noNamed')}</p>}
        <button type="button" className="btn" data-testid="datamacro-new" onClick={() => onChoose({ act: 'new' })}>{t('dataMacro.new')}</button>
      </section>
      <div className="modal-buttons">
        <button type="button" className="btn" data-testid="datamacro-close" onClick={() => onChoose(null)}>{t('dataMacro.close')}</button>
      </div>
    </div>
  );
}
