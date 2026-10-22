// « Avancé… » : la spécification d'import complète (format, encodage, dates et nombres, champs), enregistrable dans la base.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ENCODINGS, IMPORT_TYPES, type ImportField, type ImportSpec } from '../../shared/import-text';
import { api } from '../bridge';
import { trapFocus, useErrorDialog, useModal } from '../shell/Modal';

const DELIMS: [string, string][] = [['\t', 'tab'], [';', 'semicolon'], [',', 'comma'], [' ', 'space']];
const INDEXED = ['no', 'yesDuplicates', 'yesNoDuplicates'] as const;
const oneChar = (s: string) => [...s].length === 1;

/** Fenêtre modale empilée au-dessus de l'assistant (Échap = annuler, Tab reste dedans). */
export function StackedDialog({ titleKey, testId, onCancel, children, wide }: { titleKey: string; testId: string; onCancel(): void; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => before?.focus?.();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); } else trapFocus(e, ref.current);
  };
  return (
    <div className="modal-backdrop iw-stacked">
      <div ref={ref} className={`modal card iw-sub${wide ? ' iw-sub-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`}
        data-testid={testId} onKeyDown={onKeyDown}>
        <h2 id={`${testId}-title`} className="modal-title">{t(titleKey)}</h2>
        {children}
      </div>
    </div>
  );
}

export function AdvancedDialog({ spec, onCancel, onOk }: { spec: ImportSpec; onCancel(): void; onOk(s: ImportSpec, fromSaved: boolean): void }) {
  const { t } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [d, setD] = useState(spec);
  const [fromSaved, setFromSaved] = useState(false);
  const [other, setOther] = useState(DELIMS.some(([c]) => c === spec.delimiter) ? '' : spec.delimiter);
  const [specs, setSpecs] = useState<Record<string, ImportSpec> | null>(null);
  const set = (patch: Partial<ImportSpec>) => setD((x) => ({ ...x, ...patch }));
  const setField = (i: number, patch: Partial<ImportField>) => setD((x) => ({ ...x, fields: x.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const isOther = !DELIMS.some(([c]) => c === d.delimiter);
  const chars = [d.dateSep, d.timeSep, d.decimalSep, d.delimiter];
  const thousandsOk = (d.thousandsSep === '' || oneChar(d.thousandsSep)) && d.thousandsSep !== d.decimalSep && !/\d/.test(d.thousandsSep);
  const valid = chars.every(oneChar) && d.delimiter !== d.qualifier && thousandsOk && !/\d/.test(d.decimalSep);

  const saveAs = async () => {
    const name = await modal.prompt({
      titleKey: 'importText.advanced.saveAsTitle', labelKey: 'importText.advanced.specName', initial: '',
      validate: (v) => (v.trim() === v && v.length > 0 && [...v].length <= 64 ? null : t('importText.error.specName')),
    });
    if (name === null) return;
    try { await api.importText.saveSpec(name, d); } catch (e) { await showError(e); }
  };
  const openSpecs = async () => {
    try { setSpecs(await api.importText.specs()); } catch (e) { await showError(e); }
  };

  const text = (key: keyof ImportSpec, testId: string) => (
    <input className="iw-input iw-input-xs" data-testid={testId} maxLength={2} value={d[key] as string}
      aria-invalid={!oneChar(d[key] as string)} onChange={(e) => set({ [key]: e.target.value })} />
  );
  const row = (label: string, el: ReactNode) => <label className="iw-row"><span>{label}</span>{el}</label>;

  return (
    <StackedDialog titleKey="importText.advanced.title" testId="import-adv" onCancel={onCancel} wide>
      <div className="iw-adv">
        <div className="iw-adv-col">
          <fieldset className="iw-box">
            <legend>{t('importText.advanced.format')}</legend>
            {(['delimited', 'fixed'] as const).map((f) => (
              <label key={f} className="iw-radio">
                <input type="radio" name="adv-format" data-testid={`import-adv-format-${f}`} checked={d.format === f} onChange={() => set({ format: f })} />
                {t(`importText.format.${f === 'fixed' ? 'nameFixed' : 'nameDelimited'}`)}
              </label>
            ))}
            {d.format === 'delimited' && (
              <>
                {row(t('importText.delimited.delimiter'), (
                  <span className="iw-inline">
                    <select className="iw-input" data-testid="import-adv-delimiter" value={isOther ? 'other' : d.delimiter}
                      onChange={(e) => set({ delimiter: e.target.value === 'other' ? other || '|' : e.target.value })}>
                      {DELIMS.map(([c, k]) => <option key={k} value={c}>{t(`importText.delimited.${k}`)}</option>)}
                      <option value="other">{t('importText.delimited.other')}</option>
                    </select>
                    {isOther && (
                      <input className="iw-input iw-input-xs" data-testid="import-adv-delimiter-other" maxLength={2} value={d.delimiter}
                        aria-label={t('importText.delimited.otherChar')} aria-invalid={!oneChar(d.delimiter)}
                        onChange={(e) => { setOther(e.target.value); set({ delimiter: e.target.value }); }} />
                    )}
                  </span>
                ))}
                {row(t('importText.delimited.qualifier'), (
                  <select className="iw-input" data-testid="import-adv-qualifier" value={d.qualifier} onChange={(e) => set({ qualifier: e.target.value as ImportSpec['qualifier'] })}>
                    <option value="">{t('importText.delimited.qualifierNone')}</option>
                    <option value={'"'}>"</option>
                    <option value="'">'</option>
                  </select>
                ))}
              </>
            )}
            {row(t('importText.advanced.encoding'), (
              <select className="iw-input" data-testid="import-adv-encoding" value={d.encoding} onChange={(e) => set({ encoding: e.target.value as ImportSpec['encoding'] })}>
                {ENCODINGS.map((x) => <option key={x} value={x}>{t(`importText.advanced.encodings.${x}`)}</option>)}
              </select>
            ))}
          </fieldset>
          <fieldset className="iw-box">
            <legend>{t('importText.advanced.dates')}</legend>
            {row(t('importText.advanced.dateOrder'), (
              <select className="iw-input" data-testid="import-adv-date-order" value={d.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as ImportSpec['dateOrder'] })}>
                {(['DMY', 'MDY', 'YMD'] as const).map((x) => <option key={x} value={x}>{t(`importText.advanced.dateOrders.${x}`)}</option>)}
              </select>
            ))}
            {row(t('importText.advanced.dateSep'), text('dateSep', 'import-adv-date-sep'))}
            {row(t('importText.advanced.timeSep'), text('timeSep', 'import-adv-time-sep'))}
            <label className="iw-check"><input type="checkbox" data-testid="import-adv-four-digit" checked={d.fourDigitYears} onChange={(e) => set({ fourDigitYears: e.target.checked })} />{t('importText.advanced.fourDigitYears')}</label>
            <label className="iw-check"><input type="checkbox" data-testid="import-adv-leading-zeros" checked={d.leadingZeros} onChange={(e) => set({ leadingZeros: e.target.checked })} />{t('importText.advanced.leadingZeros')}</label>
            {row(t('importText.advanced.decimalSep'), text('decimalSep', 'import-adv-decimal'))}
            {row(t('importText.advanced.thousandsSep'), (
              <input className="iw-input iw-input-xs" data-testid="import-adv-thousands" maxLength={1} value={d.thousandsSep}
                aria-invalid={!thousandsOk} onChange={(e) => set({ thousandsSep: e.target.value })} />
            ))}
          </fieldset>
        </div>
        <fieldset className="iw-box iw-adv-fields">
          <legend>{t('importText.advanced.fieldList')}</legend>
          <div className="iw-grid-wrap">
            <table className="iw-table">
              <thead><tr><th>{t('importText.fields.name')}</th><th>{t('importText.fields.type')}</th><th>{t('importText.fields.indexed')}</th><th>{t('importText.fields.skip')}</th></tr></thead>
              <tbody>
                {d.fields.map((f, i) => (
                  <tr key={i}>
                    <td><input className="iw-input" data-testid={`import-adv-field-name-${i}`} aria-label={`${t('importText.fields.name')} ${i + 1}`} title={f.name} value={f.name} onChange={(e) => setField(i, { name: e.target.value })} /></td>
                    <td>
                      <select className="iw-input" data-testid={`import-adv-field-type-${i}`} aria-label={`${t('importText.fields.type')} ${i + 1}`} title={t(`importText.type.${f.type}`)} value={f.type} onChange={(e) => setField(i, { type: e.target.value as ImportField['type'] })}>
                        {IMPORT_TYPES.map((x) => <option key={x} value={x}>{t(`importText.type.${x}`)}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="iw-input" data-testid={`import-adv-field-indexed-${i}`} aria-label={`${t('importText.fields.indexed')} ${i + 1}`} value={f.indexed} onChange={(e) => setField(i, { indexed: e.target.value as ImportField['indexed'] })}>
                        {INDEXED.map((x) => <option key={x} value={x}>{t(`fieldProp.indexedValues.${x}`)}</option>)}
                      </select>
                    </td>
                    <td className="iw-center"><input type="checkbox" data-testid={`import-adv-field-skip-${i}`} aria-label={`${t('importText.fields.skip')} ${i + 1}`} checked={f.skip} onChange={(e) => setField(i, { skip: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      </div>
      <div className="modal-buttons iw-buttons">
        <button className="btn" data-testid="import-adv-save-as" disabled={!valid} onClick={() => void saveAs()}>{t('importText.advanced.saveAs')}</button>
        <button className="btn" data-testid="import-adv-specs" onClick={() => void openSpecs()}>{t('importText.advanced.specs')}</button>
        <span className="iw-spacer" />
        <button className="btn btn-primary" data-testid="import-adv-ok" disabled={!valid} onClick={() => onOk(d, fromSaved)}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="import-adv-cancel" onClick={onCancel}>{t('dialog.button.cancel')}</button>
      </div>
      {specs && (
        <SpecsDialog specs={specs} onCancel={() => setSpecs(null)}
          onOpen={(s) => { setD(s); setOther(DELIMS.some(([c]) => c === s.delimiter) ? '' : s.delimiter); setFromSaved(true); setSpecs(null); }}
          onDeleted={(name) => setSpecs((x) => { const n = { ...x }; delete n[name]; return n; })} />
      )}
    </StackedDialog>
  );
}

function SpecsDialog({ specs, onCancel, onOpen, onDeleted }: { specs: Record<string, ImportSpec>; onCancel(): void; onOpen(s: ImportSpec): void; onDeleted(name: string): void }) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const names = Object.keys(specs).sort((a, b) => a.localeCompare(b));
  const [sel, setSel] = useState<string | null>(names[0] ?? null);
  const remove = async (name: string) => {
    try { await api.importText.deleteSpec(name); onDeleted(name); setSel(null); } catch (e) { await showError(e); }
  };
  return (
    <StackedDialog titleKey="importText.advanced.specsTitle" testId="import-specs" onCancel={onCancel}>
      {names.length === 0 ? <p className="modal-message muted">{t('importText.advanced.noSpecs')}</p> : (
        <div className="iw-list" role="listbox" aria-label={t('importText.advanced.specList')}>
          {names.map((n) => (
            <button key={n} type="button" role="option" aria-selected={n === sel} className={n === sel ? 'is-sel' : undefined}
              data-testid={`import-spec-${n}`} onClick={() => setSel(n)} onDoubleClick={() => onOpen(specs[n])}>{n}</button>
          ))}
        </div>
      )}
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="import-specs-open" disabled={!sel} onClick={() => sel && onOpen(specs[sel])}>{t('importText.advanced.open')}</button>
        <button className="btn" data-testid="import-specs-delete" disabled={!sel} onClick={() => sel && void remove(sel)}>{t('importText.advanced.delete')}</button>
        <button className="btn" data-testid="import-specs-cancel" onClick={onCancel}>{t('dialog.button.cancel')}</button>
      </div>
    </StackedDialog>
  );
}
