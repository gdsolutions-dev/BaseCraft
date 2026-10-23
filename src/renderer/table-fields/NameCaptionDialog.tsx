// Table Fields › Name & Caption: the selected field's name, caption and description (Access's "Enter Field Properties").
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sameName, type FieldDef, type TableDesign } from '../../shared/field-types';
import type { ModalApi } from '../shell/Modal';
import { nameErrorKey } from '../shell/name-error';

export interface NameCaption { name: string; caption: string; description: string }

export function editNameCaption(modal: ModalApi, design: TableDesign, field: FieldDef): Promise<NameCaption | null> {
  return modal.custom<NameCaption>((close) => <NameCaptionDialog design={design} field={field} onClose={close} />, { titleKey: 'tableFields.nameCaptionTitle' });
}

function NameCaptionDialog({ design, field, onClose }: { design: TableDesign; field: FieldDef; onClose(v: NameCaption | null): void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(field.name);
  const [caption, setCaption] = useState(field.props.caption ?? '');
  const [description, setDescription] = useState(field.props.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const ok = () => {
    const key = nameErrorKey(name) ?? (design.fields.some((f) => f !== field && sameName(f.name, name)) ? 'tableFields.nameTaken' : null);
    if (key) setError(t(key));
    else onClose({ name, caption, description });
  };
  const input = (id: string, label: string, value: string, set: (v: string) => void) => (
    <label className="modal-field">
      <span>{label}</span>
      <input data-testid={`name-caption-${id}`} value={value} spellCheck={false} aria-invalid={id === 'name' && error !== null}
        onChange={(e) => { set(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} autoFocus={id === 'name'} />
    </label>
  );
  return (
    <div>
      {input('name', t('tableFields.name'), name, setName)}
      {input('caption', t('tableFields.caption'), caption, setCaption)}
      {input('description', t('tableFields.description'), description, setDescription)}
      {error && <p className="modal-error" role="alert" data-testid="name-caption-error">{error}</p>}
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="name-caption-ok" onClick={ok}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="name-caption-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
