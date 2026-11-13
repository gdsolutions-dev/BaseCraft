// What the Query, Form and Report wizards share: the step frame (Back, Next, Finish, Cancel), the Available/Selected fields picker,
// the source list and the name step. The import wizard's frame is tied to its own steps, so this one is separate.
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { sameName } from '../../shared/field-types';
import type { RecordSourceRef, SourceInfo } from '../../shared/record-source';
import { api } from '../bridge';
import { nameErrorKey } from '../shell/NavPane';
import './wizard.css';

interface ShellProps { testId: string; step: number; steps: number; canNext: boolean; canFinish: boolean; busy?: boolean; error?: string | null;
  onBack(): void; onNext(): void; onFinish(): void; onCancel(): void; children: ReactNode }

export function WizardShell({ testId, step, steps, canNext, canFinish, busy, error, onBack, onNext, onFinish, onCancel, children }: ShellProps) {
  const { t } = useTranslation();
  return (
    <div className="wiz" data-testid={testId} data-step={step}>
      <div className="wiz-body">{children}</div>
      {error && <p className="wiz-error" role="alert" data-testid="wiz-error">{error}</p>}
      <div className="modal-buttons">
        <button type="button" className="btn" data-testid="wiz-back" disabled={step === 0 || busy} onClick={onBack}>{t('importText.button.back')}</button>
        {step < steps - 1
          ? <button type="button" className="btn btn-primary" data-testid="wiz-next" disabled={!canNext || busy} onClick={onNext}>{t('importText.button.next')}</button>
          : <button type="button" className="btn btn-primary" data-testid="wiz-finish" disabled={!canFinish || busy} onClick={onFinish}>{t('importText.button.finish')}</button>}
        <button type="button" className="btn" data-testid="wiz-cancel" disabled={busy} onClick={onCancel}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}

/** The wizards' tables and saved queries, each with its fields (the lists a wizard offers). */
export function useSources(): RecordSourceRef[] {
  const [list, setList] = useState<RecordSourceRef[]>([]);
  useEffect(() => {
    void Promise.all([api.tables.list(), api.objects.list('query')]).then(([tb, qs]) =>
      setList([...tb.map((x): RecordSourceRef => ({ kind: 'table', name: x.name })), ...qs.map((x): RecordSourceRef => ({ kind: 'query', name: x.name }))]), () => undefined);
  }, []);
  return list;
}

/** The fields of a source, null while they load (or when it cannot be read). */
export function useInfo(ref: RecordSourceRef | undefined): SourceInfo | null {
  const [info, setInfo] = useState<{ key: string; info: SourceInfo } | null>(null);
  const key = ref && ref.kind !== 'sql' ? `${ref.kind}:${ref.name}` : '';
  useEffect(() => {
    if (!ref) return;
    let live = true;
    void api.sources.describe(ref).then((i) => { if (live) setInfo({ key, info: i }); }, () => { if (live) setInfo(null); });
    return () => { live = false; };
  }, [key]);
  return info?.key === key ? info.info : null;
}

export const refName = (r: RecordSourceRef | undefined): string => (r && r.kind !== 'sql' ? r.name : '');

/** The Tables/Queries list (a table and a query never share a name). */
export function SourceSelect({ sources, value, onChange, testId = 'wiz-source' }: { sources: RecordSourceRef[]; value: RecordSourceRef | undefined; onChange(r: RecordSourceRef): void; testId?: string }) {
  const { t } = useTranslation();
  return (
    <select className="modal-field" data-testid={testId} aria-label={t('wizard.source')} value={refName(value)}
      onChange={(e) => { const r = sources.find((x) => refName(x) === e.target.value); if (r) onChange(r); }}>
      {sources.map((r) => <option key={refName(r)} value={refName(r)}>{refName(r)}</option>)}
    </select>
  );
}

/** Available Fields / Selected Fields with the » « buttons (double click moves one); the order of Selected is the order chosen. */
export function FieldPicker({ all, chosen, onChange, testId = 'wiz' }: { all: string[]; chosen: string[]; onChange(v: string[]): void; testId?: string }) {
  const { t } = useTranslation();
  const [left, setLeft] = useState<string[]>([]);
  const [right, setRight] = useState<string[]>([]);
  const free = all.filter((n) => !chosen.some((c) => sameName(c, n)));
  const picked = (e: ChangeEvent<HTMLSelectElement>) => [...e.target.selectedOptions].map((o) => o.value);
  const add = (names: string[]) => { onChange([...chosen, ...free.filter((n) => names.includes(n))]); setLeft([]); };
  const remove = (names: string[]) => { onChange(chosen.filter((n) => !names.includes(n))); setRight([]); };
  return (
    <div className="wiz-pick">
      <div>
        <label htmlFor={`${testId}-avail`}>{t('wizard.available')}</label>
        <select id={`${testId}-avail`} multiple size={8} data-testid={`${testId}-avail`} value={left} onChange={(e) => setLeft(picked(e))}>
          {free.map((n) => <option key={n} value={n} onDoubleClick={() => add([n])}>{n}</option>)}
        </select>
      </div>
      <div className="wiz-moves">
        <button type="button" className="btn" data-testid={`${testId}-add`} disabled={!left.length} onClick={() => add(left)}>&gt;</button>
        <button type="button" className="btn" data-testid={`${testId}-addall`} disabled={!free.length} onClick={() => add(free)}>&gt;&gt;</button>
        <button type="button" className="btn" data-testid={`${testId}-remove`} disabled={!right.length} onClick={() => remove(right)}>&lt;</button>
        <button type="button" className="btn" data-testid={`${testId}-removeall`} disabled={!chosen.length} onClick={() => remove(chosen)}>&lt;&lt;</button>
      </div>
      <div>
        <label htmlFor={`${testId}-chosen`}>{t('wizard.selected')}</label>
        <select id={`${testId}-chosen`} multiple size={8} data-testid={`${testId}-chosen`} value={right} onChange={(e) => setRight(picked(e))}>
          {chosen.map((n) => <option key={n} value={n} onDoubleClick={() => remove([n])}>{n}</option>)}
        </select>
      </div>
    </div>
  );
}

/** The name error of a new object (empty, invalid, or taken among `taken`), null when the name is fine. */
export function nameError(name: string, taken: string[], t: (k: string) => string): string | null {
  const k = nameErrorKey(name);
  if (k) return t(k);
  return taken.some((x) => sameName(x, name)) ? t('dialog.op.nameExists') : null;
}

/** The last step: the object's name and how it opens. */
export function NameStep({ questionKey, name, onName, error, open, onOpen, openKey, designKey }: {
  questionKey: string; name: string; onName(v: string): void; error: string | null; open: 'run' | 'design'; onOpen(v: 'run' | 'design'): void;
  openKey: string; designKey: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="modal-field">
        <span>{t(questionKey)}</span>
        <input data-testid="wiz-name" autoComplete="off" spellCheck={false} value={name} aria-invalid={!!error} onChange={(e) => onName(e.target.value)} />
      </label>
      {error && <p className="wiz-error" data-testid="wiz-name-error">{error}</p>}
      <div className="wiz-radios" role="radiogroup">
        <label><input type="radio" name="wiz-open" data-testid="wiz-open-run" checked={open === 'run'} onChange={() => onOpen('run')} />{t(openKey)}</label>
        <label><input type="radio" name="wiz-open" data-testid="wiz-open-design" checked={open === 'design'} onChange={() => onOpen('design')} />{t(designKey)}</label>
      </div>
    </>
  );
}
