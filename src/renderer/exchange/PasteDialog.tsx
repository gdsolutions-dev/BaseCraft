// Boîte Coller (A6) : nom de l'objet collé et, pour une table copiée, structure seule / structure et données / ajout de données.
import { createElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uniqueName } from '../../shared/import-text';
import type { ModalApi } from '../shell/Modal';
import type { ObjectClip } from './object-clipboard';
import { pasteError, takenNames, type PasteNames } from './paste';

export type PasteMode = 'structure' | 'data' | 'append';

const MODES: PasteMode[] = ['structure', 'data', 'append'];

function PasteForm({ clip, names, onClose }: { clip: ObjectClip; names: PasteNames; onClose(v: { name: string; mode: PasteMode } | null): void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => clip.cut ? clip.name : uniqueName(t('nav.paste.copyOf', { name: clip.name }), takenNames(clip.kind, names)));
  const [mode, setMode] = useState<PasteMode>('data');
  const tableCopy = clip.kind === 'table' && !clip.cut;
  const m = tableCopy ? mode : 'data';
  const key = pasteError(clip, name, m, names);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!key) onClose({ name, mode: m }); }}>
      <label className="modal-field">
        <span>{t(m === 'append' ? 'nav.paste.targetLabel' : 'nav.paste.nameLabel')}</span>
        <input data-testid="paste-name" value={name} autoFocus aria-invalid={key !== null} onChange={(e) => setName(e.target.value)} />
        {key && <span className="modal-error" role="alert" data-testid="paste-error">{t(key)}</span>}
      </label>
      {tableCopy && (
        <fieldset className="modal-field">
          {MODES.map((x) => (
            <label key={x}>
              <input type="radio" name="paste-mode" data-testid={`paste-mode-${x}`} checked={mode === x} onChange={() => setMode(x)} />
              {t(`nav.paste.mode.${x}`)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="paste-ok" disabled={key !== null}>{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="paste-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}

export const askPaste = (modal: ModalApi, clip: ObjectClip, names: PasteNames): Promise<{ name: string; mode: PasteMode } | null> =>
  modal.custom((close) => createElement(PasteForm, { clip, names, onClose: close }), { titleKey: clip.cut ? 'nav.paste.titleMove' : 'nav.paste.title' });

