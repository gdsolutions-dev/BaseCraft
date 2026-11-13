// Create › Form Wizard: the fields, the layout and the title; the form is the Create › Form one over the picked fields, saved and opened.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecordSourceRef } from '../../shared/record-source';
import { api } from '../bridge';
import { formLabels, uniqueFormName } from '../form/form-def';
import { errorMessage, type ModalApi } from '../shell/Modal';
import { wizardForm, type FormLayoutChoice } from './form-wizard-model';
import type { WizardResult } from './QueryWizard';
import { FieldPicker, NameStep, nameError, refName, SourceSelect, useInfo, useSources, WizardShell } from './WizardShell';

const LAYOUTS: FormLayoutChoice[] = ['columnar', 'tabular', 'datasheet', 'justified'];

export const formWizard = (modal: ModalApi): Promise<WizardResult | null> =>
  modal.custom<WizardResult>((close) => <FormWizard onClose={close} />, { titleKey: 'ribbon.cmd.formWizard' });

function FormWizard({ onClose }: { onClose(v: WizardResult | null): void }) {
  const { t } = useTranslation();
  const sources = useSources();
  const [forms, setForms] = useState<string[]>([]);
  useEffect(() => { void api.objects.list('form').then((l) => setForms(l.map((x) => x.name)), () => undefined); }, []);
  const [step, setStep] = useState(0);
  const [src, setSrc] = useState<RecordSourceRef>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [layout, setLayout] = useState<FormLayoutChoice>('columnar');
  const [title, setTitle] = useState<string | null>(null);
  const [open, setOpen] = useState<'run' | 'design'>('run');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = src ?? sources[0];
  const info = useInfo(a);
  const shown = title ?? uniqueFormName(forms, refName(a));
  const problem = nameError(shown, forms, t);

  const finish = async () => {
    if (!a || !info) return;
    setBusy(true);
    try {
      const fields = chosen.flatMap((n) => info.fields.filter((f) => f.name === n));
      const doc = wizardForm(a, shown, { ...info, fields }, formLabels(t), layout);
      const res = await api.objects.save('form', shown, doc, null);
      if (res.ok) return onClose({ name: shown, open });
      setError(t(`dialog.op.${res.reason}`));
    } catch (e) { const m = errorMessage(e); setError(t(m.key, m.params)); }
    setBusy(false);
  };

  return (
    <WizardShell testId="form-wizard" step={step} steps={3} canNext={step === 0 ? chosen.length > 0 && !!info : true} canFinish={!problem} busy={busy} error={error}
      onBack={() => { setStep(step - 1); setError(null); }} onNext={() => setStep(step + 1)} onFinish={() => void finish()} onCancel={() => onClose(null)}>
      {step === 0 && (
        <>
          <p>{t('wizard.fieldsQuestion')}</p>
          <SourceSelect sources={sources} value={a} onChange={(r) => { setSrc(r); setChosen([]); setTitle(null); }} />
          <FieldPicker all={info?.fields.map((f) => f.name) ?? []} chosen={chosen} onChange={setChosen} />
        </>
      )}
      {step === 1 && (
        <>
          <p>{t('wizard.formLayout')}</p>
          <div className="wiz-radios" role="radiogroup">
            {LAYOUTS.map((l) => (
              <label key={l}><input type="radio" name="wiz-layout" data-testid={`wiz-layout-${l}`} checked={layout === l} onChange={() => setLayout(l)} />{t(`wizard.formLayouts.${l}`)}</label>
            ))}
          </div>
        </>
      )}
      {step === 2 && (
        <NameStep questionKey="wizard.formTitle" name={shown} onName={setTitle} error={problem} open={open} onOpen={setOpen}
          openKey="wizard.openForm" designKey="wizard.openFormDesign" />
      )}
    </WizardShell>
  );
}
