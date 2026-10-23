// The interactive part of saving a table (shared by the Design view and Table Fields): the answers to the data-loss,
// relation and existing-violation questions, and the error messages.
import { i18n } from '../i18n';
import type { SaveTableRequest, SaveTableResult } from '../../shared/api';
import { api } from '../bridge';
import type { ModalApi } from '../shell/Modal';

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;
const message = (modal: ModalApi, messageKey: string, params?: object) => modal.confirm({ titleKey: 'dialog.errorTitle', messageKey, params, buttons: ['ok'] });

/** Explains a failed save; true when the caller should try again (with allowDataLoss after a lossy answer). */
async function explain(modal: ModalApi, r: Exclude<SaveTableResult, { ok: true }>): Promise<boolean> {
  switch (r.reason) {
    case 'lossy':
      return (await modal.confirm({ titleKey: 'designer.lossyTitle', messageKey: 'designer.lossy', params: { count: r.lossyRows }, buttons: ['yes', 'no'], defaultButton: 'no' })) === 'yes';
    case 'design': {
      const text = (e: (typeof r.errors)[number]) => t(`designError.${e.code}`, e.prop ? { prop: t(`fieldProp.${e.prop}`) } : {});
      const table = (e: (typeof r.errors)[number]) => e.code === 'invalidExpression' || e.code === 'validationTextSize'; // the Property Sheet's
      const lines = r.errors.map((e) => (e.field === undefined ? (table(e) ? t('designer.tableErrors', { message: text(e) }) : text(e))
        : t('designer.fieldError', { field: e.field || t('designer.unnamedField'), message: text(e) })));
      await message(modal, 'designer.designErrors', { detail: [...new Set(lines)].join('\n') });
      return false;
    }
    case 'required': await message(modal, 'designer.required', { count: r.rows, field: r.field }); return false;
    case 'duplicate': await message(modal, 'designer.duplicate', { field: r.field }); return false;
    case 'external': await message(modal, 'designer.external'); return false;
    case 'relationField':
      await message(modal, r.relation ? 'designer.relationField' : 'designer.foreignKeyField', { field: r.field, relation: r.relation, table: r.table });
      return false;
    case 'viewBroken': await message(modal, 'designer.viewBroken', { name: r.view }); return false;
    case 'validationExisting':
      return (await modal.confirm({ titleKey: 'designer.validationExistingTitle', messageKey: 'designer.validationExisting', params: { count: r.rows }, buttons: ['yes', 'no'], defaultButton: 'no' })) === 'yes';
    case 'readOnly': await message(modal, 'dialog.op.readOnly'); return false;
    case 'nameExists': case 'danglingKey': return true; // handled by the caller: another name is asked
  }
}

/** The save loop: asks the questions and retries; the request that went through, or null (refused or cancelled).
 *  `askName` is the Design view's: another table name after a clash (without it a clash cannot happen). */
export async function runSave(
  modal: ModalApi, build: (name: string, flags: { allowDataLoss: boolean; acceptExistingViolations?: boolean }) => SaveTableRequest,
  name: string, askName?: (current: string) => Promise<string | null>,
): Promise<{ req: SaveTableRequest; name: string } | null> {
  let allowDataLoss = false;
  let acceptExistingViolations = false;
  for (;;) {
    const req = build(name, { allowDataLoss, ...(acceptExistingViolations ? { acceptExistingViolations } : {}) });
    const r = await api.tables.save(req);
    if (r.ok) return { req, name };
    if (r.reason === 'nameExists' || r.reason === 'danglingKey') {
      await (r.reason === 'danglingKey' ? message(modal, 'designer.danglingKey', { table: r.table, newName: name }) : message(modal, 'dialog.op.nameExists'));
      const next = askName ? await askName(name) : null;
      if (next === null) return null;
      name = next;
      continue;
    }
    if (!(await explain(modal, r))) return null;
    if (r.reason === 'validationExisting') acceptExistingViolations = true;
    else allowDataLoss = true;
  }
}

/** Saves an existing table's new design; true = saved. Errors from the data process are thrown to the caller. */
export async function saveTableInteractive(modal: ModalApi, req: SaveTableRequest): Promise<boolean> {
  return (await runSave(modal, (_n, f) => ({ ...req, allowDataLoss: f.allowDataLoss, ...(f.acceptExistingViolations ? { acceptExistingViolations: true } : {}) }), req.design.name)) !== null;
}
