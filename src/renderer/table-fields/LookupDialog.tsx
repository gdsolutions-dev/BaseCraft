// Table Fields › Modify Lookups: the selected field's lookup in one dialog (Access opens its Lookup Wizard). The Lookup tab of
// Design view stays the place for the other lookup properties; those of an existing lookup are kept.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withRowSourceType, wizardColumns, sameName, type FieldDef, type LookupProps } from '../../shared/field-types';
import { api } from '../bridge';
import type { ModalApi } from '../shell/Modal';

/** The lookup to save (undefined: none), or null when cancelled. */
export type LookupEdit = { lookup: LookupProps | undefined };

export function editLookup(modal: ModalApi, field: FieldDef): Promise<LookupEdit | null> {
  return modal.custom<LookupEdit>((close) => <LookupDialog field={field} onClose={close} />, { titleKey: 'ribbon.cmd.modifyLookups' });
}

function LookupDialog({ field, onClose }: { field: FieldDef; onClose(v: LookupEdit | null): void }) {
  const { t } = useTranslation();
  const l = field.props.lookup;
  const [kind, setKind] = useState<'none' | LookupProps['kind']>(l?.kind ?? 'none');
  const [source, setSource] = useState(l && l.kind !== 'values' ? l.table : '');
  const [list, setList] = useState(l?.kind === 'values' ? l.values.join('\n') : '');
  const [limit, setLimit] = useState(l?.limitToList ?? false);
  const [sources, setSources] = useState<string[]>([]);   // the tables and the saved queries (the Row Source of a Table/Query lookup)
  useEffect(() => {
    void Promise.all([api.tables.list(), api.objects.list('query')]).then(([tb, qs]) => setSources([...tb.map((x) => x.name), ...qs.map((x) => x.name)]), () => undefined);
  }, []);
  const ok = async () => {
    if (kind === 'none') return onClose({ lookup: undefined });
    const base: LookupProps = l ?? { kind: 'values', values: [], limitToList: false };
    if (kind === 'values') {
      const values = list.split('\n').map((x) => x.trim());
      while (values.length && values[values.length - 1] === '') values.pop();
      return onClose({ lookup: { ...withRowSourceType(base, 'values'), limitToList: limit, values } as LookupProps });
    }
    const table = source.trim();
    const next = { ...withRowSourceType(base, kind), limitToList: limit, table } as LookupProps;
    // A table newly named takes the wizard's columns: bound to its key, showing the next field.
    let columns = null;
    if (kind === 'table' && !(l?.kind === 'table' && sameName(l.table, table)) && sources.some((n) => sameName(n, table))) {
      try { columns = wizardColumns((await api.tables.design(table)).fields); } catch { /* a query: the lookup keeps its columns */ }
    }
    onClose({ lookup: columns ? { ...next, ...columns } : next });
  };
  const valid = kind === 'none' || kind === 'values' || source.trim() !== '';
  return (
    <div>
      <label className="modal-field">
        <span>{t('fieldProp.rowSourceType')}</span>
        <select data-testid="lookup-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="none">{t('tableFields.formatNone')}</option>
          {(['table', 'values', 'fieldList'] as const).map((v) => <option key={v} value={v}>{t(`fieldProp.rowSourceTypes.${v}`)}</option>)}
        </select>
      </label>
      {kind === 'values' && (
        <label className="modal-field">
          <span>{t('tableFields.lookupValues')}</span>
          <textarea data-testid="lookup-values" rows={6} value={list} onChange={(e) => setList(e.target.value)} />
        </label>
      )}
      {(kind === 'table' || kind === 'fieldList') && (
        <label className="modal-field">
          <span>{t('fieldProp.rowSource')}</span>
          <input data-testid="lookup-source" list="lookup-sources" value={source} spellCheck={false} onChange={(e) => setSource(e.target.value)} />
          <datalist id="lookup-sources">{sources.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
      )}
      {kind !== 'none' && kind !== 'fieldList' && (
        <label className="modal-field">
          <input data-testid="lookup-limit" type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} /> <span>{t('fieldProp.limitToList')}</span>
        </label>
      )}
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="lookup-ok" disabled={!valid} onClick={() => void ok()}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="lookup-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
