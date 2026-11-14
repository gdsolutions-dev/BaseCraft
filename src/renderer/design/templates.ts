// Form and report templates (Options > Object Designers): a new form or report in Design view starts from the properties and
// section settings of the form or report the options name, when the open base has one (else the built-in blank document).
import type { DesignDoc } from '../../shared/design/model';
import { applyTemplate } from '../../shared/design/template';
import { api } from '../bridge';
import { emptyFormDoc } from '../form/form-def';
import { requestNewForm } from '../form/FormDesignView';
import { blankReport } from '../report/design/report-sections';
import { requestNewReport } from '../report/design/ReportDesignView';
import { currentSettings, printMargins } from '../settings-store';

/** A generated document (AutoForm, AutoReport, wizards, More Forms, Navigation Form) with the template's properties and section settings. */
export async function withTemplate(kind: 'form' | 'report', doc: DesignDoc): Promise<DesignDoc> {
  const template = kind === 'form' ? currentSettings().formTemplate : currentSettings().reportTemplate;
  if (!template) return doc;
  try { return applyTemplate(doc, (await api.objects.get(kind, template)).definition, kind, true); } catch { return doc; }
}

/** Call before opening the new tab `name`: its designer then starts from the template. Nothing to do without a template in this base. */
export async function seedTemplate(kind: 'form' | 'report', name: string): Promise<void> {
  const s = currentSettings();
  const template = kind === 'form' ? s.formTemplate : s.reportTemplate;
  if (!template) return;
  let definition: unknown;
  try { definition = (await api.objects.get(kind, template)).definition; } catch { return; }   // no such object here: Access's built-in defaults
  const base = kind === 'form' ? emptyFormDoc(null) : blankReport(printMargins());
  const doc = applyTemplate(base, definition, kind);
  if (doc !== base) (kind === 'form' ? requestNewForm : requestNewReport)(name, doc);
}
