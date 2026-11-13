// Create › Labels: the source, the sheet of labels, the font size, the lines of a label (text and [Fields]) and the sort field; the
// report is made by labelReport (columns, Across then Down), saved and opened in Print Preview or Design view.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecordSourceRef } from '../../shared/record-source';
import { uniqueReportName } from '../../shared/report/instant';
import { api } from '../bridge';
import { errorMessage, type ModalApi } from '../shell/Modal';
import { LABEL_SHEETS, labelGeometry, labelReport, lineExpression, type LabelSheet } from './label-wizard-model';
import type { WizardResult } from './QueryWizard';
import { NameStep, nameError, refName, SourceSelect, useInfo, useSources, WizardShell } from './WizardShell';

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20];
const MAX_LINES = 8;
const CUSTOM = 'custom';
const MM = 1440 / 25.4;

/** `initial`: the Navigation Pane's table or query. */
export const labelWizard = (modal: ModalApi, initial?: RecordSourceRef): Promise<WizardResult | null> =>
  modal.custom<WizardResult>((close) => <LabelWizard onClose={close} initial={initial} />, { titleKey: 'ribbon.cmd.labels' });

function LabelWizard({ onClose, initial }: { onClose(v: WizardResult | null): void; initial?: RecordSourceRef }) {
  const { t } = useTranslation();
  const sources = useSources();
  const [reports, setReports] = useState<string[]>([]);
  useEffect(() => { void api.objects.list('report').then((l) => setReports(l.map((x) => x.name)), () => undefined); }, []);
  const [step, setStep] = useState(0);
  const [src, setSrc] = useState<RecordSourceRef | undefined>(initial);
  const [sheetId, setSheetId] = useState('L7160');
  const [custom, setCustom] = useState({ width: 70, height: 40, columns: 3, left: 5, top: 10 });   // mm
  const [fontSize, setFontSize] = useState(10);
  const [lines, setLines] = useState<string[]>(['']);
  const [sort, setSort] = useState('');
  const [title, setTitle] = useState<string | null>(null);
  const [open, setOpen] = useState<'run' | 'design'>('run');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = src ?? sources[0];
  const info = useInfo(a);
  const names = info?.fields.map((f) => f.name) ?? [];
  const sheet: LabelSheet = sheetId === CUSTOM
    ? { paper: 'a4', width: Math.round(custom.width * MM), height: Math.round(custom.height * MM), columns: Math.round(custom.columns), left: Math.round(custom.left * MM), top: Math.round(custom.top * MM) }
    : LABEL_SHEETS[sheetId]!;
  const sheetOk = sheet.columns >= 1 && sheet.columns <= 10 && sheet.width > 0 && sheet.left >= 0 && sheet.top >= 0 && labelGeometry(sheet).fits;
  const shown = title ?? uniqueReportName(reports, t('wizard.labelsOf', { source: refName(a) }));
  const problem = nameError(shown, reports, t);
  const setLine = (i: number, v: string) => setLines((l) => l.map((x, j) => (j === i ? v : x)));
  const num = (k: keyof typeof custom, label: string) => (
    <label className="modal-field"><span>{label}</span>
      <input type="number" min={0} step="0.1" data-testid={`wiz-label-${k}`} value={custom[k]} onChange={(e) => setCustom({ ...custom, [k]: Number(e.target.value) })} /></label>
  );

  const finish = async () => {
    if (!a || !info) return;
    setBusy(true);
    try {
      const doc = labelReport({ ...a, name: refName(a) }, names, { sheet, fontSize, lines, sort: sort || null });
      const res = await api.objects.save('report', shown, doc, null);
      if (res.ok) return onClose({ name: shown, open });
      setError(t(`dialog.op.${res.reason}`));
    } catch (e) { const m = errorMessage(e); setError(t(m.key, m.params)); }
    setBusy(false);
  };

  return (
    <WizardShell testId="label-wizard" step={step} steps={4} canNext={step === 0 ? !!info && sheetOk : step === 1 ? lines.some((l) => lineExpression(l, names)) : true}
      canFinish={!problem} busy={busy} error={error}
      onBack={() => { setStep(step - 1); setError(null); }} onNext={() => setStep(step + 1)} onFinish={() => void finish()} onCancel={() => onClose(null)}>
      {step === 0 && (
        <>
          <p>{t('wizard.labelSheet')}</p>
          <SourceSelect sources={sources} value={a} onChange={(r) => { setSrc(r); setLines(['']); setSort(''); setTitle(null); }} />
          <select className="modal-field" data-testid="wiz-label-sheet" aria-label={t('wizard.labelSheet')} value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
            {Object.entries(LABEL_SHEETS).map(([id, s]) => <option key={id} value={id}>{s.name}</option>)}
            <option value={CUSTOM}>{t('wizard.labelCustom')}</option>
          </select>
          {sheetId === CUSTOM && (
            <>
              {num('width', t('wizard.labelWidth'))}{num('height', t('wizard.labelHeight'))}{num('columns', t('wizard.labelColumns'))}
              {num('left', t('wizard.labelMarginLeft'))}{num('top', t('wizard.labelMarginTop'))}
              {!sheetOk && <p className="wiz-error" data-testid="wiz-label-nofit">{t('wizard.labelNoFit')}</p>}
            </>
          )}
        </>
      )}
      {step === 1 && (
        <>
          <label className="modal-field"><span>{t('wizard.labelFont')}</span>
            <select data-testid="wiz-label-font" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <p>{t('wizard.labelLines')}</p>
          {lines.map((l, i) => (
            <div className="wiz-row" key={i}>
              <input className="modal-field" data-testid={`wiz-label-line-${i}`} aria-label={t('wizard.labelLine', { n: i + 1 })} autoComplete="off" spellCheck={false} value={l} onChange={(e) => setLine(i, e.target.value)} />
              <select data-testid={`wiz-label-insert-${i}`} aria-label={t('wizard.labelInsertField')} value="" onChange={(e) => e.target.value && setLine(i, `${l}[${e.target.value.replace(/]/g, ']]')}]`)}>
                <option value="">{t('wizard.labelInsertField')}</option>
                {names.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <button type="button" className="btn" disabled={lines.length < 2} aria-label={t('wizard.labelRemoveLine')} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <div><button type="button" className="btn" data-testid="wiz-label-addline" disabled={lines.length >= MAX_LINES} onClick={() => setLines([...lines, ''])}>{t('wizard.labelAddLine')}</button></div>
        </>
      )}
      {step === 2 && (
        <>
          <p>{t('wizard.labelSort')}</p>
          <select className="modal-field" data-testid="wiz-label-sort" aria-label={t('wizard.labelSort')} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="" />
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </>
      )}
      {step === 3 && (
        <NameStep questionKey="wizard.labelName" name={shown} onName={setTitle} error={problem} open={open} onOpen={setOpen}
          openKey="wizard.openLabels" designKey="wizard.openReportDesign" />
      )}
    </WizardShell>
  );
}
