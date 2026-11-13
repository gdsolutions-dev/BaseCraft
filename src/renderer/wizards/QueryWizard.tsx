// Create › Query Wizard: Simple, Crosstab, Find Duplicates and Find Unmatched, as Access offers them. Each ends in a saved query
// (SQL from query-wizard-model) opened in its datasheet or its Design view.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecordSourceRef } from '../../shared/record-source';
import { sameName } from '../../shared/field-types';
import { api } from '../bridge';
import { errorMessage, type ModalApi } from '../shell/Modal';
import { crosstabQuery, duplicatesQuery, isSummable, QUERY_AGGS, simpleQuery, unmatchedQuery, type QueryAgg } from './query-wizard-model';
import { FieldPicker, NameStep, nameError, refName, SourceSelect, useInfo, useSources, WizardShell } from './WizardShell';

type Kind = 'simple' | 'crosstab' | 'duplicates' | 'unmatched';
const KINDS: Kind[] = ['simple', 'crosstab', 'duplicates', 'unmatched'];
export type WizardResult = { name: string; open: 'run' | 'design' };

export const queryWizard = (modal: ModalApi): Promise<WizardResult | null> =>
  modal.custom<WizardResult>((close) => <QueryWizard onClose={close} />, { titleKey: 'ribbon.cmd.queryWizard' });

function QueryWizard({ onClose }: { onClose(v: WizardResult | null): void }) {
  const { t } = useTranslation();
  const sources = useSources();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>('simple');
  const [src, setSrc] = useState<RecordSourceRef>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [summary, setSummary] = useState(false);
  const [aggs, setAggs] = useState<Record<string, QueryAgg[]>>({});
  const [count, setCount] = useState(false);
  const [srcB, setSrcB] = useState<RecordSourceRef>();
  const [keyA, setKeyA] = useState<string>();
  const [keyB, setKeyB] = useState<string>();
  const [column, setColumn] = useState<string>();
  const [value, setValue] = useState<string>();
  const [fn, setFn] = useState<QueryAgg | 'Count'>('Sum');
  const [name, setName] = useState<string | null>(null);
  const [open, setOpen] = useState<'run' | 'design'>('run');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const a = src ?? sources[0];
  const b = srcB ?? sources.find((x) => refName(x) !== refName(a));
  const infoA = useInfo(a), infoB = useInfo(kind === 'unmatched' ? b : undefined);
  const namesA = infoA?.fields.map((f) => f.name) ?? [], namesB = infoB?.fields.map((f) => f.name) ?? [];
  const typeOf = (n: string) => infoA?.fields.find((f) => f.name === n)?.type ?? 'shortText';
  const key = {
    a: keyA ?? namesA[0] ?? '', b: keyB ?? namesB[0] ?? '',
    column: column ?? namesA.find((n) => !chosen.includes(n)) ?? '', value: value ?? namesA.find((n) => isSummable(typeOf(n))) ?? namesA[0] ?? '',
  };
  const aName = refName(a), bName = refName(b);
  const defaults: Record<Kind, string> = { simple: t('wizard.queryName.simple', { source: aName }), crosstab: t('wizard.queryName.crosstab', { source: aName }),
    duplicates: t('wizard.queryName.duplicates', { source: aName }), unmatched: t('wizard.queryName.unmatched', { a: aName, b: bName }) };
  const shown = name ?? defaults[kind];
  const nameProblem = nameError(shown, sources.map(refName), t);
  const summable = chosen.filter((n) => isSummable(typeOf(n)));
  const pickSource = (r: RecordSourceRef) => { setSrc(r); setChosen([]); setAggs({}); setKeyA(undefined); setColumn(undefined); setValue(undefined); };

  const canNext = [true,
    kind === 'unmatched' ? !!a && !!b && refName(a) !== refName(b) && !!key.a && !!key.b : chosen.length > 0 && !!infoA,
    kind === 'simple' ? !summary || count || summable.some((n) => aggs[n]?.length) : kind === 'unmatched' ? chosen.length > 0
      : kind === 'crosstab' ? !!key.column && !!key.value && !chosen.includes(key.column) : true][step] ?? false;

  const sql = (): string => {
    const picked = chosen.map((n) => ({ name: n, type: typeOf(n) }));
    switch (kind) {
      case 'simple': return simpleQuery(aName, picked, summary ? { aggs, count } : undefined);
      case 'duplicates': return duplicatesQuery(aName, chosen, extra);
      case 'unmatched': return unmatchedQuery(aName, key.a, bName, key.b, chosen);
      case 'crosstab': return crosstabQuery(aName, chosen, key.column, key.value, fn);
    }
  };
  // Find Duplicates: the first step's picks are the compared fields, the second step's the ones shown in addition
  const [extra, setExtra] = useState<string[]>([]);
  const finish = async () => {
    setBusy(true);
    try {
      const res = await api.objects.save('query', shown, { formatVersion: '1.0', sql: sql() }, null);
      if (res.ok) return onClose({ name: shown, open });
      setError(t(`dialog.op.${res.reason}`));
    } catch (e) { const m = errorMessage(e); setError(t(m.key, m.params)); }
    setBusy(false);
  };
  const toggleAgg = (n: string, f: QueryAgg) => setAggs((v) => ({ ...v, [n]: v[n]?.includes(f) ? v[n].filter((x) => x !== f) : [...(v[n] ?? []), f] }));
  const fieldSelect = (names: string[], v: string, set: (n: string) => void, testId: string, skip: string[] = []) => (
    <select className="modal-field" data-testid={testId} value={v} onChange={(e) => set(e.target.value)}>
      {names.filter((n) => !skip.some((s) => sameName(s, n))).map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );

  return (
    <WizardShell testId="query-wizard" step={step} steps={4} canNext={canNext} canFinish={!nameProblem} busy={busy} error={error}
      onBack={() => { setStep(step - 1); setError(null); }} onNext={() => setStep(step + 1)} onFinish={() => void finish()} onCancel={() => onClose(null)}>
      {step === 0 && (
        <div className="wiz-radios" role="radiogroup">
          <p>{t('wizard.queryWhich')}</p>
          {KINDS.map((k) => (
            <label key={k}><input type="radio" name="wiz-kind" data-testid={`wiz-kind-${k}`} checked={kind === k} onChange={() => { setKind(k); setChosen([]); setName(null); }} />{t(`wizard.queryKind.${k}`)}</label>
          ))}
        </div>
      )}
      {step === 1 && kind !== 'unmatched' && (
        <>
          <p>{kind === 'duplicates' ? t('wizard.dupFields') : kind === 'crosstab' ? t('wizard.crossRows') : t('wizard.fieldsQuestion')}</p>
          <SourceSelect sources={sources} value={a} onChange={pickSource} />
          <FieldPicker all={namesA} chosen={chosen} onChange={setChosen} />
        </>
      )}
      {step === 1 && kind === 'unmatched' && (
        <>
          <p>{t('wizard.unmatchedA')}</p>
          <SourceSelect sources={sources} value={a} onChange={(r) => { setSrc(r); setKeyA(undefined); setChosen([]); }} />
          <p>{t('wizard.unmatchedB')}</p>
          <SourceSelect sources={sources} value={b} onChange={(r) => { setSrcB(r); setKeyB(undefined); }} testId="wiz-source-b" />
          <p>{t('wizard.unmatchedKey')}</p>
          <div className="wiz-row">{fieldSelect(namesA, key.a, setKeyA, 'wiz-key-a')} = {fieldSelect(namesB, key.b, setKeyB, 'wiz-key-b')}</div>
        </>
      )}
      {step === 2 && kind === 'simple' && (
        <>
          <p>{t('wizard.detailOrSummary')}</p>
          <div className="wiz-radios" role="radiogroup">
            <label><input type="radio" name="wiz-sum" data-testid="wiz-detail" checked={!summary} onChange={() => setSummary(false)} />{t('wizard.detail')}</label>
            <label><input type="radio" name="wiz-sum" data-testid="wiz-summary" checked={summary} onChange={() => setSummary(true)} />{t('wizard.summary')}</label>
          </div>
          {summary && (
            <div className="wiz-radios">
              {summable.map((n) => (
                <div className="wiz-row" key={n}><span>{n}</span>
                  {QUERY_AGGS.map((f) => (
                    <label key={f}><input type="checkbox" data-testid={`wiz-agg-${n}-${f}`} checked={!!aggs[n]?.includes(f)} onChange={() => toggleAgg(n, f)} />{t(`query.total.${f.toLowerCase()}`)}</label>
                  ))}
                </div>
              ))}
              <label><input type="checkbox" data-testid="wiz-count" checked={count} onChange={(e) => setCount(e.target.checked)} />{t('wizard.countRecords', { source: aName })}</label>
            </div>
          )}
        </>
      )}
      {step === 2 && kind === 'duplicates' && (
        <>
          <p>{t('wizard.dupExtra')}</p>
          <FieldPicker all={namesA.filter((n) => !chosen.includes(n))} chosen={extra} onChange={setExtra} testId="wiz-extra" />
        </>
      )}
      {step === 2 && kind === 'unmatched' && (
        <>
          <p>{t('wizard.fieldsQuestion')}</p>
          <FieldPicker all={namesA} chosen={chosen} onChange={setChosen} />
        </>
      )}
      {step === 2 && kind === 'crosstab' && (
        <>
          <p>{t('wizard.crossColumn')}</p>
          {fieldSelect(namesA, key.column, setColumn, 'wiz-column', chosen)}
          <p>{t('wizard.crossValue')}</p>
          <div className="wiz-row">
            {fieldSelect(namesA, key.value, setValue, 'wiz-value')}
            <select data-testid="wiz-fn" value={fn} onChange={(e) => setFn(e.target.value as QueryAgg | 'Count')}>
              {[...QUERY_AGGS, 'Count' as const].map((f) => <option key={f} value={f}>{t(`query.total.${f.toLowerCase()}`)}</option>)}
            </select>
          </div>
        </>
      )}
      {step === 3 && (
        <NameStep questionKey="wizard.queryTitle" name={shown} onName={setName} error={nameProblem} open={open} onOpen={setOpen}
          openKey="wizard.openQuery" designKey="wizard.openQueryDesign" />
      )}
    </WizardShell>
  );
}
