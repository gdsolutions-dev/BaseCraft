// Assistant « Importer un fichier texte » (Données externes → Fichier texte) : source et destination, format,
// séparateur ou largeurs, options des champs, clé primaire, fin. Le fichier est lu et importé par le processus principal.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TableSummary } from '../../shared/api';
import { sameName, type TableDesign } from '../../shared/field-types';
import { IMPORT_TYPES, type ImportField, type ImportProgress, type ImportResult, type ImportSpec, type PrimaryKeyChoice, type TextPreview } from '../../shared/import-text';
import { api } from '../bridge';
import { bcErrorCode, trapFocus, useErrorDialog } from '../shell/Modal';
import { nameErrorKey } from '../shell/NavPane';
import { AdvancedDialog } from './AdvancedDialog';
import { FixedRuler } from './FixedRuler';
import { PreviewGrid } from './PreviewGrid';
import {
  defaultTableName, fieldsError, fileName, keyError, mapByName, mappingError, stepsFor, structuralChange, type Step,
} from './wizard-model';
import './import-text.css';

type Done = Extract<ImportResult, { ok: true }>;
/** pendingRow(table): a datasheet of that table has a row being edited (the import is then refused). */
interface Props { tables: TableSummary[]; pendingRow(table: string): boolean; onClose(): void; onImported(r: Done): void }

const DELIMS: [string, string][] = [['\t', 'tab'], [';', 'semicolon'], [',', 'comma'], [' ', 'space']];
const INDEXED = ['no', 'yesDuplicates', 'yesNoDuplicates'] as const;
const ENCODING_LABEL: Record<string, string> = { 'utf-8': 'UTF-8', 'windows-1252': 'Windows-1252', 'utf-16le': 'UTF-16 LE' };

export function ImportTextWizard({ tables, pendingRow, onClose, onImported }: Props) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const seq = useRef(0); // only the latest preview request counts
  const [path, setPath] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);
  const [pv, setPv] = useState<TextPreview | null>(null);
  const [spec, setSpec] = useState<ImportSpec | null>(null);
  const [mode, setMode] = useState<'new' | 'append'>('new');
  const [appendTable, setAppendTable] = useState(tables[0]?.name ?? '');
  const [appendDesign, setAppendDesign] = useState<TableDesign | null>(null);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [pk, setPk] = useState<PrimaryKeyChoice>({ kind: 'auto' });
  const [table, setTable] = useState('');
  const [step, setStep] = useState<Step>('source');
  const [col, setCol] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const steps = stepsFor(spec?.format ?? 'delimited', mode);
  const index = steps.indexOf(step);
  const running = progress !== null;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.();
  }, []);
  useEffect(() => { body.current?.querySelector<HTMLElement>('input:not([disabled]), select, button')?.focus(); }, [step, result]);

  /** New preview for `next`; a change of cutting takes the fields deduced again (unless they still fit a saved spec). */
  const reparse = async (next: ImportSpec, keepFields: boolean) => {
    if (!loaded) return;
    const n = ++seq.current;
    setBusy(true);
    try {
      const p = await api.importText.preview(loaded, next);
      if (n !== seq.current) return;
      const fields = keepFields && next.fields.length === p.columns ? next.fields : p.inferred;
      setPv(p);
      setSpec({ ...p.spec, fields });
      setCol((c) => Math.min(c, p.columns - 1));
      if (appendDesign) setMapping(mapByName(fields.map((f) => f.name), appendDesign));
    } catch (e) {
      void showError(e);
    } finally {
      if (n === seq.current) setBusy(false);
    }
  };
  const change = (patch: Partial<ImportSpec>) => {
    if (!spec) return;
    const next = { ...spec, ...patch };
    void reparse(next, !structuralChange(spec, next));
  };
  const setField = (i: number, patch: Partial<ImportField>) => {
    setError(null);
    setSpec((s) => (s ? { ...s, fields: s.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) } : s));
  };

  /** Leaving the first step: the file is analysed (once per path), the destination table read. */
  const loadSource = async (): Promise<boolean> => {
    const p = path.trim();
    if (!p) { setError(t('importText.error.noFile')); return false; }
    let fields = spec?.fields ?? [];
    if (p !== loaded) {
      try {
        const r = await api.importText.preview(p, null);
        setPv(r); setSpec(r.spec); setLoaded(p); setCol(0);
        fields = r.spec.fields;
        setTable(defaultTableName(p, tables.map((x) => x.name), t('designer.newTableName', { n: 1 })));
      } catch (e) {
        const code = bcErrorCode(e);
        if (code === 'invalidArgument') setError(t('importText.error.fileNotFound'));
        else if (code === 'emptyFile') setError(t('importText.error.emptyFile'));
        else void showError(e);
        return false;
      }
    }
    if (mode === 'append') {
      if (!appendTable) { setError(t('importText.error.noTable')); return false; }
      try {
        const d = await api.tables.design(appendTable);
        setAppendDesign(d);
        setMapping(mapByName(fields.map((f) => f.name), d));
      } catch (e) { void showError(e); return false; }
    } else setAppendDesign(null);
    return true;
  };

  /** Checks of a step; an error keeps the user on it. */
  const check = (s: Step): string | null => {
    if (!spec) return null;
    if (s === 'delimited' && ([...spec.delimiter].length !== 1 || spec.delimiter === spec.qualifier)) return t('importText.error.otherChar');
    if (s === 'fields') {
      if (mode === 'append') { const k = mappingError(mapping); return k && t(k); }
      const e = fieldsError(spec);
      if (e?.index !== undefined) setCol(e.index);
      return e && t(e.key);
    }
    if (s === 'key' && mode === 'new') { const k = keyError(spec, pk); return k && t(k); }
    if (s === 'finish' && mode === 'new') {
      const k = nameErrorKey(table);
      if (k) return t(k);
      if (tables.some((x) => sameName(x.name, table))) return t('importText.error.tableExists', { name: table });
    }
    return null;
  };

  const next = async () => {
    setError(null);
    if (step === 'source' && !(await loadSource())) return;
    const e = check(step);
    if (e) { setError(e); return; }
    setStep(steps[index + 1]);
  };
  const back = () => { setError(null); setStep(steps[index - 1]); };

  const finish = async () => {
    setError(null);
    for (const s of steps) {
      const e = check(s);
      if (e) { setStep(s); setError(e); return; }
    }
    if (!spec || !loaded) return;
    if (mode === 'append' && pendingRow(appendTable)) { setError(t('importText.error.pendingRow', { table: appendTable })); return; }
    const plan = mode === 'new'
      ? { spec, target: { kind: 'new' as const, table, primaryKey: pk } }
      : { spec, target: { kind: 'append' as const, table: appendTable, mapping } };
    setProgress({ done: 0, total: 1 });
    const off = api.importText.onProgress(setProgress);
    try {
      const r = await api.importText.run(loaded, plan);
      if (r.ok) { setResult(r); onImported(r); }
      else if (r.reason === 'nameExists') { setStep('finish'); setError(t('importText.error.tableExists', { name: table })); }
      else { setStep('fields'); setError(r.errors.map((x) => t(`designError.${x.code}`, { field: x.field ?? '' })).join('\n')); }
    } catch (e) {
      void showError(e);
    } finally {
      off();
      setProgress(null);
    }
  };

  const browse = async () => {
    try {
      const p = await api.importText.pickFile();
      if (p) { setPath(p); setError(null); }
    } catch (e) { void showError(e); }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // the shell's shortcuts do not reach the page behind
    if (e.key === 'Escape' && !running && !advanced) { e.preventDefault(); onClose(); } else trapFocus(e, ref.current);
  };

  const radio = (name: string, testId: string, checked: boolean, onChange: () => void, label: ReactNode, disabled = false) => (
    <label className={`iw-radio${disabled ? ' is-disabled' : ''}`}>
      <input type="radio" name={name} data-testid={testId} checked={checked} disabled={disabled} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
  const headings = spec?.fields.map((f) => f.name) ?? [];
  // every sampled number was ambiguous (« 1,250 »): the region's decimal symbol was assumed, said here (changeable in Advanced…)
  const assumedHint = pv?.assumedDecimal && spec
    ? <p className="iw-hint" role="note" data-testid="import-assumed-decimal">{t('importText.fields.assumedDecimal', { sep: spec.decimalSep })}</p>
    : null;
  const file = loaded ? fileName(loaded) : '';

  const renderStep = (): ReactNode => {
    switch (step) {
      case 'source':
        return (
          <>
            <p className="iw-intro">{t('importText.source.intro')}</p>
            <label className="iw-row iw-row-file">
              <span>{t('importText.source.file')}</span>
              {/* read-only: the main process only reads a file chosen in its own open dialog */}
              <input className="iw-input" data-testid="import-path" value={path} readOnly spellCheck={false} title={path} />
              <button type="button" className="btn" data-testid="import-browse" onClick={() => void browse()}>{t('importText.source.browse')}</button>
            </label>
            <fieldset className="iw-box">
              <legend>{t('importText.source.destination')}</legend>
              {radio('dest', 'import-dest-new', mode === 'new', () => setMode('new'), t('importText.source.newTable'))}
              <div className="iw-inline">
                {radio('dest', 'import-dest-append', mode === 'append', () => setMode('append'), t('importText.source.append'), tables.length === 0)}
                <select className="iw-input" data-testid="import-append-table" value={appendTable} disabled={mode !== 'append'}
                  aria-label={t('importText.source.append')} onChange={(e) => setAppendTable(e.target.value)}>
                  {tables.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                </select>
              </div>
              {radio('dest', 'import-dest-link', false, () => {}, <>{t('importText.source.link')} <em className="muted">({t('importText.source.linkNote')})</em></>, true)}
            </fieldset>
          </>
        );
      case 'format':
        return (
          <>
            <p className="iw-intro">{t('importText.format.intro', { format: t(spec!.format === 'fixed' ? 'importText.format.nameFixed' : 'importText.format.nameDelimited') })}</p>
            <div className="iw-box iw-plain">
              {radio('format', 'import-format-delimited', spec!.format === 'delimited', () => change({ format: 'delimited' }), t('importText.format.delimited'))}
              {radio('format', 'import-format-fixed', spec!.format === 'fixed', () => change({ format: 'fixed' }), t('importText.format.fixed'))}
            </div>
            <div className="iw-caption">
              <span>{t('importText.preview', { file })}</span>
              <span className="muted" data-testid="import-encoding">{t('importText.format.encoding', { encoding: ENCODING_LABEL[pv!.encoding] })}</span>
            </div>
            <pre className="iw-lines" data-testid="import-lines">{pv!.lines.map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join('\n')}</pre>
          </>
        );
      case 'delimited': {
        const isOther = !DELIMS.some(([c]) => c === spec!.delimiter);
        return (
          <>
            <p className="iw-intro">{t('importText.delimited.intro')}</p>
            <div className="iw-options">
              <fieldset className="iw-box">
                <legend>{t('importText.delimited.delimiter')}</legend>
                <div className="iw-inline iw-wrap">
                  {DELIMS.map(([c, k]) => radio('delim', `import-delim-${k}`, spec!.delimiter === c, () => change({ delimiter: c }), t(`importText.delimited.${k}`)))}
                  {radio('delim', 'import-delim-other', isOther, () => change({ delimiter: '|' }), t('importText.delimited.other'))}
                  <input className="iw-input iw-input-xs" data-testid="import-delim-other-char" maxLength={1} disabled={!isOther}
                    aria-label={t('importText.delimited.otherChar')} value={isOther ? spec!.delimiter : ''}
                    onChange={(e) => { if ([...e.target.value].length === 1) change({ delimiter: e.target.value }); }} />
                </div>
              </fieldset>
              <div className="iw-side">
                <label className="iw-check">
                  <input type="checkbox" data-testid="import-has-header" checked={spec!.hasHeader} onChange={(e) => change({ hasHeader: e.target.checked })} />
                  {t('importText.delimited.hasHeader')}
                </label>
                <label className="iw-row">
                  <span>{t('importText.delimited.qualifier')}</span>
                  <select className="iw-input" data-testid="import-qualifier" value={spec!.qualifier} onChange={(e) => change({ qualifier: e.target.value as ImportSpec['qualifier'] })}>
                    <option value="">{t('importText.delimited.qualifierNone')}</option>
                    <option value={'"'}>"</option>
                    <option value="'">'</option>
                  </select>
                </label>
              </div>
            </div>
            <PreviewGrid headings={headings} rows={pv!.rows} />
          </>
        );
      }
      case 'fixed':
        return (
          <>
            <p className="iw-intro">{t('importText.fixed.intro')}</p>
            <FixedRuler lines={pv!.lines} breaks={spec!.breaks} onChange={(b) => change({ breaks: b })} />
            <PreviewGrid headings={headings} rows={pv!.rows} />
          </>
        );
      case 'fields': {
        const f = spec!.fields[col];
        if (mode === 'append') {
          const targets = appendDesign?.fields.filter((x) => x.props.type !== 'autoNumber') ?? [];
          return (
            <>
              <p className="iw-intro">{t('importText.fields.appendIntro', { table: appendTable })}</p>
              {assumedHint}
              <div className="iw-options iw-field-opts">
                <label className="iw-row"><span>{t('importText.column', { n: col + 1 })}</span><strong>{f?.name}</strong></label>
                <label className="iw-row">
                  <span>{t('importText.fields.target')}</span>
                  <select className="iw-input" data-testid="import-field-target" value={mapping[col] ?? ''}
                    onChange={(e) => { setError(null); setMapping((m) => m.map((x, i) => (i === col ? e.target.value || null : x))); }}>
                    <option value="">{t('importText.fields.skipColumn')}</option>
                    {targets.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                  </select>
                </label>
              </div>
              <PreviewGrid headings={headings.map((h, i) => `${h} → ${mapping[i] ?? t('importText.fields.skipped')}`)} rows={pv!.rows}
                selected={col} onSelect={setCol} dimmed={mapping.map((m) => m === null)} />
            </>
          );
        }
        return (
          <>
            <p className="iw-intro">{t('importText.fields.intro')}</p>
            {assumedHint}
            {f && (
              <div className="iw-options iw-field-opts">
                <label className="iw-row"><span>{t('importText.fields.name')}</span>
                  <input className="iw-input" data-testid="import-field-name" value={f.name} onChange={(e) => setField(col, { name: e.target.value })} /></label>
                <label className="iw-row"><span>{t('importText.fields.type')}</span>
                  <select className="iw-input" data-testid="import-field-type" value={f.type} onChange={(e) => setField(col, { type: e.target.value as ImportField['type'] })}>
                    {IMPORT_TYPES.map((x) => <option key={x} value={x}>{t(`importText.type.${x}`)}</option>)}
                  </select></label>
                <label className="iw-row"><span>{t('importText.fields.indexed')}</span>
                  <select className="iw-input" data-testid="import-field-indexed" value={f.indexed} onChange={(e) => setField(col, { indexed: e.target.value as ImportField['indexed'] })}>
                    {INDEXED.map((x) => <option key={x} value={x}>{t(`fieldProp.indexedValues.${x}`)}</option>)}
                  </select></label>
                <label className="iw-check">
                  <input type="checkbox" data-testid="import-field-skip" checked={f.skip} onChange={(e) => setField(col, { skip: e.target.checked })} />
                  {t('importText.fields.skip')}
                </label>
              </div>
            )}
            <PreviewGrid headings={headings} rows={pv!.rows} selected={col} onSelect={setCol} dimmed={spec!.fields.map((x) => x.skip)} />
          </>
        );
      }
      case 'key': {
        const kept = spec!.fields.filter((x) => !x.skip);
        const own = pk.kind === 'field' ? pk.field : kept[0]?.name ?? '';
        return (
          <>
            <p className="iw-intro">{t('importText.key.intro')}</p>
            <div className="iw-box iw-plain">
              {radio('pk', 'import-pk-auto', pk.kind === 'auto', () => setPk({ kind: 'auto' }), t('importText.key.auto'))}
              <div className="iw-inline">
                {radio('pk', 'import-pk-own', pk.kind === 'field', () => setPk({ kind: 'field', field: own }), t('importText.key.own'))}
                <select className="iw-input" data-testid="import-pk-field" value={own} disabled={pk.kind !== 'field'} aria-label={t('importText.key.own')}
                  onChange={(e) => setPk({ kind: 'field', field: e.target.value })}>
                  {kept.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                </select>
              </div>
              {radio('pk', 'import-pk-none', pk.kind === 'none', () => setPk({ kind: 'none' }), t('importText.key.none'))}
            </div>
            <PreviewGrid headings={[...(pk.kind === 'auto' ? [t('designer.defaultIdName')] : []), ...kept.map((x) => x.name)]}
              rows={pv!.rows.map((r, n) => [...(pk.kind === 'auto' ? [String(n + 1)] : []), ...r.filter((_v, i) => !spec!.fields[i]?.skip)])} />
          </>
        );
      }
      case 'finish':
        return (
          <>
            <p className="iw-intro">{t('importText.finish.intro')}</p>
            {mode === 'new' ? (
              <label className="iw-row iw-row-file">
                <span>{t('importText.finish.table')}</span>
                <input className="iw-input" data-testid="import-table-name" value={table} onChange={(e) => { setTable(e.target.value); setError(null); }} />
              </label>
            ) : <p data-testid="import-append-to">{t('importText.finish.appendTo', { table: appendTable })}</p>}
            {running && (
              <div className="iw-progress">
                <span>{t('importText.finish.running')}</span>
                <progress data-testid="import-progress" max={progress!.total || 1} value={progress!.done} />
              </div>
            )}
          </>
        );
    }
  };

  const title = result ? t('importText.finish.doneTitle') : t(`importText.step.${step}`);
  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal card iw" role="dialog" aria-modal="true" aria-labelledby="iw-title" aria-describedby="iw-step"
        data-testid="import-wizard" onKeyDown={onKeyDown}>
        <header className="iw-head">
          <h2 id="iw-title" className="modal-title">{t('importText.title')}</h2>
          <div id="iw-step" className="iw-step" data-testid="import-step" data-step={result ? 'done' : step}>
            {!result && <span className="muted">{t('importText.stepOf', { n: index + 1, total: steps.length })} · </span>}{title}
          </div>
        </header>
        <div ref={body} className="iw-body" aria-busy={busy || running}>
          {result ? (
            <div className="iw-summary" data-testid="import-summary" role="status">
              <p data-testid="import-summary-imported">{t('importText.finish.imported', { count: result.imported, table: result.table })}</p>
              <p data-testid="import-summary-errors">{result.errors > 0
                ? t('importText.finish.errors', { count: result.errors, table: result.errorTable })
                : t('importText.finish.noErrors')}</p>
            </div>
          ) : renderStep()}
        </div>
        {error && <div className="modal-error iw-error" role="alert" data-testid="import-error">{error}</div>}
        <footer className="modal-buttons iw-buttons">
          {result ? (
            <button className="btn btn-primary" data-testid="import-btn-close" onClick={onClose}>{t('importText.button.close')}</button>
          ) : (
            <>
              <button className="btn" data-testid="import-btn-advanced" disabled={!spec || running} onClick={() => setAdvanced(true)}>{t('importText.button.advanced')}</button>
              <span className="iw-spacer" />
              <button className="btn" data-testid="import-btn-cancel" disabled={running} onClick={onClose}>{t('importText.button.cancel')}</button>
              <button className="btn" data-testid="import-btn-back" disabled={index === 0 || running || busy} onClick={back}>{t('importText.button.back')}</button>
              <button className={step === 'finish' ? 'btn' : 'btn btn-primary'} data-testid="import-btn-next" disabled={index === steps.length - 1 || running || busy}
                onClick={() => void next()}>{t('importText.button.next')}</button>
              <button className={step === 'finish' ? 'btn btn-primary' : 'btn'} data-testid="import-btn-finish" disabled={step === 'source' || running || busy}
                onClick={() => void finish()}>{t('importText.button.finish')}</button>
            </>
          )}
        </footer>
      </div>
      {advanced && spec && (
        <AdvancedDialog spec={spec} onCancel={() => setAdvanced(false)}
          onOk={(s, fromSaved) => { setAdvanced(false); void reparse(s, fromSaved || !structuralChange(spec, s)); }} />
      )}
    </div>
  );
}
