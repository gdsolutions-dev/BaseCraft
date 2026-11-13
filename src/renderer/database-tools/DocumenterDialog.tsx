// Database Documenter (K1): pick objects (a list per type, Select All) and what to describe, then the definitions as a document
// (DocumentDialog: read-only, to print or save as PDF). ponytail: options are global (fields, indexes, relationships for tables;
// controls for forms and reports), not per type; modules are not documented.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObjectKind } from '../../shared/api';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { errorMessage, type ModalApi } from '../shell/Modal';
import { showDocument } from './DocumentDialog';
import { documenterHtml, type DocItem, type DocOptions } from './documents';
import './database-tools.css';

type Kind = 'table' | Exclude<ObjectKind, 'module'>;
const KINDS: Kind[] = ['table', 'query', 'form', 'report', 'macro'];
interface Entry { kind: Kind; name: string }
interface Picked { entries: Entry[]; options: DocOptions }
const key = (e: Entry) => `${e.kind}|${e.name}`;

export async function databaseDocumenter(modal: ModalApi, preselect?: Entry | null): Promise<void> {
  try {
    const [tables, objects] = await Promise.all([api.tables.list(), api.objects.list()]);
    const all: Entry[] = [...tables.map((x) => ({ kind: 'table' as const, name: x.name })), ...objects.filter((o) => o.kind !== 'module').map((o) => ({ kind: o.kind as Kind, name: o.name }))];
    const pick = await modal.custom<Picked>((close) => <Picker all={all} first={preselect ?? null} onClose={close} />, { titleKey: 'ribbon.cmd.databaseDocumenter' });
    if (!pick) return;
    const [relations, base] = await Promise.all([api.relations.list({ localOnly: true }), api.base.state()]);
    const items: DocItem[] = await Promise.all(pick.entries.map(async (e): Promise<DocItem> => e.kind === 'table'
      ? { kind: 'table', name: e.name, design: await api.tables.design(e.name) }
      : { kind: e.kind, name: e.name, definition: (await api.objects.get(e.kind, e.name)).definition }));
    const name = (base?.fileName ?? '').replace(/\.[^.]*$/, '');
    const html = documenterHtml((k, o) => i18n.t(k, o) as string, { base: name, date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(new Date()), items, relations, options: pick.options });
    await showDocument(modal, 'ribbon.cmd.databaseDocumenter', html, `${name || 'BaseCraft'} - ${i18n.t('ribbon.cmd.databaseDocumenter')}`);
  } catch (e) {
    const m = errorMessage(e);
    await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: m.key, params: m.params, buttons: ['ok'] });
  }
}

function Picker({ all, first, onClose }: { all: Entry[]; first: Entry | null; onClose(v: Picked | null): void }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(new Set(first ? [key(first)] : []));
  const [options, setOptions] = useState<DocOptions>({ fields: true, indexes: true, relationships: true, controls: true });
  const toggle = (k: string) => setOn((s) => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n; });
  const everything = on.size === all.length;
  const opt = (id: keyof DocOptions, labelKey: string) => (
    <label key={id}><input type="checkbox" data-testid={`doc-opt-${id}`} checked={options[id]} onChange={(e) => setOptions({ ...options, [id]: e.target.checked })} />{t(labelKey)}</label>
  );
  return (
    <div className="dbt" data-testid="documenter-dialog">
      <label><input type="checkbox" data-testid="doc-all" checked={everything && all.length > 0} onChange={() => setOn(everything ? new Set() : new Set(all.map(key)))} />{t('link.selectAll')}</label>
      <div className="dbt-picks">
        {KINDS.map((kind) => {
          const group = all.filter((e) => e.kind === kind);
          return group.length ? (
            <div key={kind}>
              <div className="dbt-group">{t(`tabs.kind.${kind}`)}</div>
              {group.map((e) => <label key={key(e)} className="dbt-item"><input type="checkbox" data-testid={`doc-${kind}-${e.name}`} checked={on.has(key(e))} onChange={() => toggle(key(e))} />{e.name}</label>)}
            </div>
          ) : null;
        })}
      </div>
      <div className="dbt-opts">
        {opt('fields', 'dbtools.docFields')}{opt('indexes', 'dbtools.docIndexes')}{opt('relationships', 'dbtools.docRelationships')}{opt('controls', 'dbtools.docControls')}
      </div>
      <div className="modal-buttons">
        <button type="button" className="btn btn-primary" data-testid="doc-ok" disabled={!on.size} onClick={() => onClose({ entries: all.filter((e) => on.has(key(e))), options })}>{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="doc-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
