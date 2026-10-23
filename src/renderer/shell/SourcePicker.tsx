// Choix d'une source (table ou requête) pour le formulaire instantané (A4) et l'état instantané (A5).
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecordSourceRef } from '../../shared/record-source';
import { api } from '../bridge';
import type { ModalApi } from './Modal';
import { initialSource, refKey, sourceOptions, type NamedSource } from './source-picker-model';

let hint: NamedSource | null = null;
/** The shell keeps this up to date: the active table or query document, else the navigation pane selection (sourceHint). */
export function setSourceHint(h: NamedSource | null): void { hint = h; }

/**
 * Asks for a table or a query. `preselect` is selected when it is listed; when it is undefined, the active document or the
 * navigation pane selection is; null asks for no preselection. Resolves null when cancelled.
 */
export async function pickSource(modal: ModalApi, opts: { titleKey: string; preselect?: RecordSourceRef | null }): Promise<RecordSourceRef | null> {
  const [tables, objects] = await Promise.all([api.tables.list(), api.objects.list('query')]);
  const options = sourceOptions(tables.map((x) => x.name), objects.map((o) => o.name));
  const first = initialSource(options, opts.preselect, hint);
  return modal.custom<RecordSourceRef>((close) => <SourceList options={options} first={first} onClose={close} />, { titleKey: opts.titleKey });
}

function SourceList({ options, first, onClose }: { options: NamedSource[]; first: number; onClose(v: RecordSourceRef | null): void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(first >= 0 ? refKey(options[first]!) : '');
  const chosen = options.find((o) => refKey(o) === value) ?? null;
  const pick = () => { if (chosen) onClose({ kind: chosen.kind, name: chosen.name }); };
  const group = (kind: NamedSource['kind'], labelKey: string) => {
    const list = options.filter((o) => o.kind === kind);
    return list.length > 0 && (
      <optgroup label={t(labelKey)}>
        {list.map((o) => <option key={refKey(o)} value={refKey(o)}>{o.name}</option>)}
      </optgroup>
    );
  };
  if (!options.length) {
    return (
      <>
        <p className="modal-message" data-testid="source-picker-empty">{t('sourcePicker.empty')}</p>
        <div className="modal-buttons"><button className="btn btn-primary" data-testid="source-picker-cancel" onClick={() => onClose(null)}>{t('dialog.button.ok')}</button></div>
      </>
    );
  }
  return (
    <>
      <label className="modal-field">
        <span>{t('sourcePicker.label')}</span>
        <select size={12} data-testid="source-picker-list" value={value} onChange={(e) => setValue(e.target.value)} onDoubleClick={pick}
          onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); pick(); } }}>
          {group('table', 'nav.tables')}
          {group('query', 'nav.queries')}
        </select>
      </label>
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="source-picker-ok" disabled={!chosen} onClick={pick}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="source-picker-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </>
  );
}
