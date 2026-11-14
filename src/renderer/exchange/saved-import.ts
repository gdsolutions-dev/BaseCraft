// External Data › Saved Imports: the list, and the one chosen run again with its file asked as the first time. A new table that
// already exists (the first run made it) receives the rows as an append, the file's columns going to the fields as they were named.
import { createElement } from 'react';
import { sameName } from '../../shared/field-types';
import type { ImportPlan } from '../../shared/import-text';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { errorMessage, type ModalApi } from '../shell/Modal';
import { SavedImportsDialog } from './SavedImportsDialog';

/** Resolves true when rows were imported (the caller refreshes the Navigation Pane). */
export async function runSavedImport(modal: ModalApi): Promise<boolean> {
  const name = await modal.custom<string>((close) => createElement(SavedImportsDialog, { onClose: close }), { titleKey: 'ribbon.cmd.savedImports' });
  if (name === null) return false;
  try {
    const s = (await api.exchange.savedImportList())[name];
    if (!s) return false;
    const path = await (s.source === 'text' ? api.importText.pickFile() : api.importExcel.pickFile(s.source === 'xml' ? 'xml' : undefined));
    if (!path) return false;
    let plan: ImportPlan = s.plan;
    if (plan.target.kind === 'new') {
      const { table } = plan.target;
      if ((await api.tables.list()).some((x) => sameName(x.name, table))) {
        plan = { spec: plan.spec, target: { kind: 'append', table, mapping: plan.spec.fields.map((f) => (f.skip ? null : f.name)) } };
      }
    }
    const r = s.source === 'text' ? await api.importText.run(path, plan) : await api.importExcel.run(path, s.sheet!, plan.spec.hasHeader, plan);
    const t = i18n.t.bind(i18n);
    const message = !r.ok
      ? r.reason === 'nameExists' ? t('dialog.op.nameExists') : r.reason === 'danglingKey' ? t('importText.error.danglingKey', { name: plan.target.table, table: r.table })
        : r.errors.map((x) => t(`designError.${x.code}`, { field: x.field ?? '' })).join('\n')
      : [t('importText.finish.imported', { count: r.imported, table: r.table }),
        r.errors > 0 ? t('importText.finish.errors', { count: r.errors, table: r.errorTable }) : t('importText.finish.noErrors')].join('\n');
    await modal.confirm({ titleKey: r.ok ? 'importText.finish.doneTitle' : 'dialog.errorTitle', messageKey: 'exchange.message', params: { text: message }, buttons: ['ok'] });
    return r.ok;
  } catch (e) {
    const m = errorMessage(e);
    await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: m.key, params: m.params, buttons: ['ok'] });
    return false;
  }
}
