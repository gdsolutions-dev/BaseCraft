// Boîte « Propriétés » d'un objet du volet de navigation (Access : Propriétés de l'objet) : type, nom, description modifiable,
// dates de création et de modification (objets ; une table n'en garde pas). Ouverte par le menu contextuel et par l'onglet Table.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObjectKind, OpResult } from '../../shared/api';
import { sameName } from '../../shared/field-types';
import { api } from '../bridge';
import { formatDateTime, isoToStored } from '../../shared/locale-format';
import { errorMessage, type ModalApi } from './Modal';
import type { AppDispatch } from './nav-menu';

export const MAX_DESCRIPTION = 255;
interface Target { kind: ObjectKind | 'table'; name: string; description: string; created?: string; modified?: string }

/** Reads the object's current properties, then shows the dialog; a saved description refreshes the pane's lists. */
export async function showObjectProperties(modal: ModalApi, ref: { kind: ObjectKind | 'table'; name: string }, readOnly: boolean, dispatch: AppDispatch): Promise<void> {
  const { kind } = ref;
  let target: Target | undefined;
  if (kind === 'table') {
    const x = (await api.tables.list()).find((t) => sameName(t.name, ref.name));
    if (x) target = { kind, name: x.name, description: x.description ?? '' };
  } else {
    const o = (await api.objects.list(kind)).find((t) => sameName(t.name, ref.name));
    if (o) target = { kind, name: o.name, description: o.description ?? '', created: o.created, modified: o.modified };
  }
  if (!target) throw new Error('bc:notFound');
  const { region } = await api.app.getSettings(); // dates shown as the region shows them, like the datasheets
  const saved = await modal.custom<string>((close) => <PropertiesForm target={target} region={region} readOnly={readOnly} onClose={close} />, { titleKey: 'objectProperties.title' });
  if (saved === null) return;
  dispatch(kind === 'table' ? { type: 'tableDescribed', name: target.name, description: saved } : { type: 'listsChanged' });
}

/** Closes with the saved description, or null when nothing was saved. */
function PropertiesForm({ target, region, readOnly, onClose }: { target: Target; region: string; readOnly: boolean; onClose(v: string | null): void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(target.description);
  const [error, setError] = useState<string | null>(null);
  const date = (iso: string) => formatDateTime(isoToStored(iso), region);
  const ok = async () => {
    if (readOnly || text === target.description) return onClose(null);
    let r: OpResult;
    try { r = await api.objects.setDescription(target.kind, target.name, text); } catch (e) { const m = errorMessage(e); setError(t(m.key, m.params)); return; }
    if (r.ok) onClose(text);
    else setError(t(`dialog.op.${r.reason}`, { name: target.name, newName: '', table: '', view: '' }));
  };
  const row = (field: string, value: string) => (
    <div className="props-row"><span className="muted">{t(`objectProperties.${field}`)}</span><span data-testid={`object-properties-${field}`}>{value}</span></div>
  );
  return (
    <div data-testid="object-properties" className="object-properties">
      {row('type', t(`tabs.kind.${target.kind}`))}
      {row('name', target.name)}
      <label className="modal-field">
        <span>{t('objectProperties.description')}</span>
        <textarea data-testid="object-properties-description" rows={3} maxLength={MAX_DESCRIPTION} value={text} readOnly={readOnly}
          onChange={(e) => { setText(e.target.value); setError(null); }} />
      </label>
      {target.created && row('created', date(target.created))}
      {target.modified && row('modified', date(target.modified))}
      {error && <p className="modal-error" role="alert" data-testid="object-properties-error">{error}</p>}
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="object-properties-ok" onClick={() => void ok()}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="object-properties-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
