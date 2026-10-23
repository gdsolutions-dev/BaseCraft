// « Modifier les éléments de la liste » (Access) : les éléments d'une liste de valeurs, un par ligne, et la valeur par défaut
// du champ ; enregistré par le chemin normal de la structure de la table (tables.save, donc alterTable).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { listItemStored, listItemText } from '../../shared/coerce';
import { lookupOf, type FieldDef, type FieldType, type TableDesign } from '../../shared/field-types';
import { localeInfo } from '../../shared/locale-format';
import { api } from '../bridge';
import { trapFocus, useErrorDialog } from '../shell/Modal';

/** The Default Value (a canonical expression) of a stored list item: a Number's canonical number, else a text literal. */
export const itemDefault = (type: FieldType, stored: string): string =>
  type === 'number' && /^-?\d+(\.\d+)?$/.test(stored) ? stored : `"${stored.replaceAll('"', '""')}"`;

/** The items as typed, one per line: trimmed, blank lines kept (the cells of a multi-column list and its heads stay aligned),
 *  blank lines at the end left out. */
function linesOf(text: string): string[] {
  const lines = text.split('\n').map((x) => x.trim());
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

interface Props { table: string; field: string; locale: string; readOnly: boolean; onClose(saved: boolean): void }

export function EditListDialog({ table, field, locale, readOnly, onClose }: Props) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const ref = useRef<HTMLDivElement>(null);
  const info = useMemo(() => localeInfo(locale), [locale]);
  const [state, setState] = useState<{ design: TableDesign; fd: FieldDef; initial: string } | null>(null);
  const [text, setText] = useState('');
  // The Default Value's item: followed by its line while the number of lines stays the same (renamed in place), else by its text.
  const [def, setDef] = useState({ index: -1, text: '', lines: 0 });
  const [busy, setBusy] = useState(false);

  // The field as saved now (the datasheet's design may be older).
  useEffect(() => {
    api.tables.design(table).then((design) => {
      const fd = design.fields.find((x) => x.name === field);
      const l = fd && lookupOf(fd);
      if (!fd || l?.kind !== 'values') return onClose(false);
      const items = l.values.map((v) => listItemText(fd.props.type, v, info));
      const index = l.values.findIndex((v) => v !== '' && itemDefault(fd.props.type, v) === fd.props.defaultValue);
      setState({ design, fd, initial: items[index] ?? '' });
      setText(items.join('\n'));
      setDef({ index, text: items[index] ?? '', lines: linesOf(items.join('\n')).length });
    }, (e) => { void showError(e); onClose(false); });
  }, []);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.();
  }, []);
  useEffect(() => { if (state) ref.current?.querySelector('textarea')?.focus(); }, [state]);

  const items = linesOf(text);
  const at = def.index >= 0 && items.length === def.lines && items[def.index] ? def.index : def.text ? items.indexOf(def.text) : -1;
  const chosen = at >= 0 ? items[at]! : '';
  const lost = def.text !== '' && at < 0; // its item is gone: said, not dropped silently
  const save = async () => {
    if (!state || busy) return;
    const { design, fd, initial } = state;
    const type = fd.props.type;
    const props = { ...fd.props, lookup: { ...fd.props.lookup!, values: items.map((x) => listItemStored(type, x, info)) } };
    // Unchanged, the Default Value stays as it is (even one that is no list item); otherwise it becomes the chosen item, or none.
    if (chosen !== initial) {
      if (chosen) props.defaultValue = itemDefault(type, listItemStored(type, chosen, info));
      else delete props.defaultValue;
    }
    const fields = design.fields.map((x) => (x === fd ? { ...x, props } : x));
    setBusy(true);
    try {
      const r = await api.tables.save({ originalName: design.name, design: { ...design, fields }, mapping: fields.map((x) => ({ name: x.name, sourceName: x.name })), allowDataLoss: false });
      if (r.ok) return onClose(true);
      await showError(new Error(`bc:${r.reason}`));
    } catch (e) {
      await showError(e);
    }
    setBusy(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // the shell's shortcuts and the grid's keys stay behind
    if (e.key === 'Escape') { e.preventDefault(); onClose(false); } else trapFocus(e, ref.current);
  };

  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal card edit-list" role="dialog" aria-modal="true" aria-labelledby="edit-list-title" data-testid="edit-list" onKeyDown={onKeyDown}>
        <h2 id="edit-list-title" className="modal-title">{t('fieldProp.editList.title')}</h2>
        <label className="modal-field">
          <span>{t('fieldProp.editList.items')}</span>
          <textarea data-testid="edit-list-items" rows={8} spellCheck={false} value={text} disabled={!state} readOnly={readOnly} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="modal-field">
          <span>{t('fieldProp.editList.default')}</span>
          <select data-testid="edit-list-default" value={at} disabled={!state || readOnly}
            onChange={(e) => { const i = Number(e.target.value); setDef({ index: i, text: items[i] ?? '', lines: items.length }); }}>
            <option value={-1} />
            {items.map((x, i) => (x === '' ? null : <option key={i} value={i}>{x}</option>))}
          </select>
          {lost && <span className="modal-error" role="alert" data-testid="edit-list-default-lost">{t('fieldProp.editList.defaultLost', { value: def.text })}</span>}
        </label>
        <div className="modal-buttons">
          <button className="btn btn-primary" data-testid="edit-list-ok" disabled={!state || busy || readOnly} onClick={() => void save()}>{t('dialog.button.ok')}</button>
          <button className="btn" data-testid="edit-list-cancel" onClick={() => onClose(false)}>{t('dialog.button.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
