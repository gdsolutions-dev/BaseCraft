// Options d'un export en fichier texte (contenu de useModal().custom) : séparateur, délimiteur de texte, noms de champs, encodage.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXPORT_ENCODINGS, EXPORT_QUALIFIERS, type ExportTextSpec } from '../../shared/exchange';

const DELIMITERS = [[',', 'comma'], [';', 'semicolon'], ['\t', 'tab'], ['|', 'pipe']] as const;

export function ExportTextDialog({ initial, onClose }: { initial: ExportTextSpec; onClose(v: ExportTextSpec | null): void }) {
  const { t } = useTranslation();
  const [spec, setSpec] = useState(initial);
  const set = <K extends keyof ExportTextSpec>(k: K, v: ExportTextSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onClose(spec); }}>
      <fieldset className="modal-field">
        <legend>{t('exchange.text.delimiter')}</legend>
        {DELIMITERS.map(([d, name]) => (
          <label key={name}>
            <input type="radio" name="delimiter" data-testid={`export-text-delimiter-${name}`} checked={spec.delimiter === d} onChange={() => set('delimiter', d)} />
            {t(`exchange.text.${name}`)}
          </label>
        ))}
      </fieldset>
      <label className="modal-field">
        <span>{t('exchange.text.qualifier')}</span>
        <select data-testid="export-text-qualifier" value={spec.qualifier} onChange={(e) => set('qualifier', e.target.value as ExportTextSpec['qualifier'])}>
          {EXPORT_QUALIFIERS.map((q) => <option key={q} value={q}>{q === '' ? t('exchange.text.qualifierNone') : q}</option>)}
        </select>
      </label>
      <label className="modal-field">
        <input type="checkbox" data-testid="export-text-header" checked={spec.hasHeader} onChange={(e) => set('hasHeader', e.target.checked)} />
        {t('exchange.text.header')}
      </label>
      <label className="modal-field">
        <span>{t('exchange.text.encoding')}</span>
        <select data-testid="export-text-encoding" value={spec.encoding} onChange={(e) => set('encoding', e.target.value as ExportTextSpec['encoding'])}>
          {EXPORT_ENCODINGS.map((x) => <option key={x} value={x}>{t(`exchange.text.${x}`)}</option>)}
        </select>
      </label>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="export-text-ok">{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="export-text-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}
