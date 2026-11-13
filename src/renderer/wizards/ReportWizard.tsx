// Create › Report Wizard: fields, grouping levels, sort order, summary values and orientation, then the title; the report is the
// Create › Report one (wizardReport), saved and opened in Print Preview or Design view.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formulaLang } from '../../shared/i18n';
import type { RecordSourceRef } from '../../shared/record-source';
import { uniqueReportName } from '../../shared/report/instant';
import type { PageSetup } from '../../shared/report/model';
import { api } from '../bridge';
import { i18n } from '../i18n';
import type { TotalFn } from '../report/design/grouping-model';
import { printMargins } from '../settings-store';
import { errorMessage, type ModalApi } from '../shell/Modal';
import { isSummable, QUERY_AGGS } from './query-wizard-model';
import type { WizardResult } from './QueryWizard';
import { MAX_LEVELS, wizardReport } from './report-wizard-model';
import { FieldPicker, NameStep, nameError, refName, SourceSelect, useInfo, useSources, WizardShell } from './WizardShell';

export const reportWizard = (modal: ModalApi): Promise<WizardResult | null> =>
  modal.custom<WizardResult>((close) => <ReportWizard onClose={close} />, { titleKey: 'ribbon.cmd.reportWizard' });

function ReportWizard({ onClose }: { onClose(v: WizardResult | null): void }) {
  const { t } = useTranslation();
  const sources = useSources();
  const [reports, setReports] = useState<string[]>([]);
  useEffect(() => { void api.objects.list('report').then((l) => setReports(l.map((x) => x.name)), () => undefined); }, []);
  const [step, setStep] = useState(0);
  const [src, setSrc] = useState<RecordSourceRef>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [sorts, setSorts] = useState<{ field: string; desc: boolean }[]>([]);
  const [totals, setTotals] = useState<Record<string, TotalFn[]>>({});
  const [summaryOnly, setSummaryOnly] = useState(false);
  const [orientation, setOrientation] = useState<PageSetup['orientation']>('portrait');
  const [title, setTitle] = useState<string | null>(null);
  const [open, setOpen] = useState<'run' | 'design'>('run');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = src ?? sources[0];
  const info = useInfo(a);
  const typeOf = (n: string) => info?.fields.find((f) => f.name === n)?.type ?? 'shortText';
  const summable = chosen.filter((n) => isSummable(typeOf(n)));
  const wanted = summable.some((n) => totals[n]?.length);
  const shown = title ?? uniqueReportName(reports, refName(a));
  const problem = nameError(shown, reports, t);
  const pickSource = (r: RecordSourceRef) => { setSrc(r); setChosen([]); setGroups([]); setSorts([]); setTotals({}); setTitle(null); };
  const pickFields = (v: string[]) => { setChosen(v); setGroups((g) => g.filter((x) => v.includes(x))); setSorts((s) => s.filter((x) => v.includes(x.field))); };
  const setSort = (i: number, v: { field: string; desc: boolean } | null) =>
    setSorts((s) => { const c = [...s]; if (v) c[i] = v; else c.splice(i, 1); return c; });
  const toggleTotal = (n: string, f: TotalFn) => setTotals((v) => ({ ...v, [n]: v[n]?.includes(f) ? v[n].filter((x) => x !== f) : [...(v[n] ?? []), f] }));

  const finish = async () => {
    if (!a || !info) return;
    setBusy(true);
    try {
      const doc = wizardReport({ ...a, name: refName(a) }, info, { title: shown, fields: chosen, groups, sorts, totals, summaryOnly: summaryOnly && wanted, orientation },
        { lang: formulaLang(i18n.language), margins: printMargins() });
      const res = await api.objects.save('report', shown, doc, null);
      if (res.ok) return onClose({ name: shown, open });
      setError(t(`dialog.op.${res.reason}`));
    } catch (e) { const m = errorMessage(e); setError(t(m.key, m.params)); }
    setBusy(false);
  };

  return (
    <WizardShell testId="report-wizard" step={step} steps={5} canNext={step === 0 ? chosen.length > 0 && !!info : true} canFinish={!problem} busy={busy} error={error}
      onBack={() => { setStep(step - 1); setError(null); }} onNext={() => setStep(step + 1)} onFinish={() => void finish()} onCancel={() => onClose(null)}>
      {step === 0 && (
        <>
          <p>{t('wizard.fieldsQuestion')}</p>
          <SourceSelect sources={sources} value={a} onChange={pickSource} />
          <FieldPicker all={info?.fields.map((f) => f.name) ?? []} chosen={chosen} onChange={pickFields} />
        </>
      )}
      {step === 1 && (
        <>
          <p>{t('wizard.reportGroups', { max: MAX_LEVELS })}</p>
          <FieldPicker all={chosen} chosen={groups} onChange={(v) => setGroups(v.slice(0, MAX_LEVELS))} testId="wiz-groups" />
        </>
      )}
      {step === 2 && (
        <>
          <p>{t('wizard.reportSort', { max: MAX_LEVELS })}</p>
          {Array.from({ length: Math.min(MAX_LEVELS, sorts.length + 1) }, (_, i) => (
            <div className="wiz-row" key={i}>
              <select className="modal-field" data-testid={`wiz-sort-${i}`} aria-label={t('wizard.sortField', { n: i + 1 })} value={sorts[i]?.field ?? ''}
                onChange={(e) => setSort(i, e.target.value ? { field: e.target.value, desc: sorts[i]?.desc ?? false } : null)}>
                <option value="" />
                {chosen.filter((n) => n === sorts[i]?.field || !sorts.some((s) => s.field === n)).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <button type="button" className="btn" data-testid={`wiz-sortdir-${i}`} disabled={!sorts[i]} onClick={() => setSort(i, { field: sorts[i]!.field, desc: !sorts[i]!.desc })}>
                {t(sorts[i]?.desc ? 'query.sort.desc' : 'query.sort.asc')}
              </button>
            </div>
          ))}
        </>
      )}
      {step === 3 && (
        <>
          {summable.length > 0 && (
            <>
              <p>{t('wizard.reportSummary')}</p>
              {summable.map((n) => (
                <div className="wiz-row" key={n}><span>{n}</span>
                  {QUERY_AGGS.map((f) => (
                    <label key={f}><input type="checkbox" data-testid={`wiz-total-${n}-${f}`} checked={!!totals[n]?.includes(f)} onChange={() => toggleTotal(n, f)} />{t(`query.total.${f.toLowerCase()}`)}</label>
                  ))}
                </div>
              ))}
              <div className="wiz-radios" role="radiogroup">
                <label><input type="radio" name="wiz-sumonly" data-testid="wiz-detail" checked={!summaryOnly || !wanted} disabled={!wanted} onChange={() => setSummaryOnly(false)} />{t('wizard.detailAndSummary')}</label>
                <label><input type="radio" name="wiz-sumonly" data-testid="wiz-summaryonly" checked={summaryOnly && wanted} disabled={!wanted} onChange={() => setSummaryOnly(true)} />{t('wizard.summaryOnly')}</label>
              </div>
            </>
          )}
          <p>{t('wizard.reportLayout')}</p>
          <div className="wiz-radios" role="radiogroup">
            <label><input type="radio" name="wiz-layout" checked readOnly />{t('wizard.stepped')}</label>
            {(['portrait', 'landscape'] as const).map((o) => (
              <label key={o}><input type="radio" name="wiz-orient" data-testid={`wiz-orient-${o}`} checked={orientation === o} onChange={() => setOrientation(o)} />{t(`report.pageSetup.${o}`)}</label>
            ))}
          </div>
        </>
      )}
      {step === 4 && (
        <NameStep questionKey="wizard.reportTitle" name={shown} onName={setTitle} error={problem} open={open} onOpen={setOpen}
          openKey="wizard.openReport" designKey="wizard.openReportDesign" />
      )}
    </WizardShell>
  );
}
