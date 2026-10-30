// Messages des enregistrements, partagés par la feuille de données et les formulaires : confirmation de suppression (effets réels
// des clés étrangères), refus « related », texte d'une erreur de champ.
import type { TFunction } from 'i18next';
import type { BasecraftApi, CascadeChild, DeleteResult } from '../../shared/api';
import type { FieldErrorCode } from '../../shared/coerce';
import { toDisplay, type DisplayContext } from '../../shared/expr/localize';
import type { FieldDef, TableDesign } from '../../shared/field-types';
import type { ModalApi } from '../shell/Modal';

type DeleteKey = 'datasheet.delete' | 'datasheet.deleteCascade' | 'datasheet.deleteModifies' | 'datasheet.deleteCascadeModifies';

/** ON DELETE CASCADE deletes related records, SET NULL / SET DEFAULT modify them (A2-R14, A2-R15). */
export function deleteMessageKey(effects: CascadeChild['effect'][]): DeleteKey {
  return `datasheet.delete${effects.includes('deleted') ? 'Cascade' : ''}${effects.includes('modified') ? 'Modifies' : ''}` as DeleteKey;
}

// Read when called (the bridge is the window's: absent from unit tests, which pass their own).
const bridge = (): BasecraftApi => (window as unknown as { basecraft: BasecraftApi }).basecraft;

/** Asks before deleting `count` records of `table`, with the real keys' effects; a cascadeChildren that fails: asked without.
 *  « Modifications des enregistrements » off (`enabled`, read now): yes without asking. A refusal (related records) is still shown by the caller. */
export async function confirmDelete(modal: ModalApi, table: string, count: number,
  relations: Pick<BasecraftApi['relations'], 'cascadeChildren'> = bridge().relations,
  enabled: () => Promise<boolean> = async () => (await bridge().app.getSettings()).confirmRecordChanges): Promise<boolean> {
  if (!(await enabled())) return true;
  let effects: CascadeChild['effect'][] = [];
  try { effects = (await relations.cascadeChildren(table)).map((c) => c.effect); } catch { /* asked without */ }
  const r = await modal.confirm({ titleKey: 'datasheet.deleteTitle', messageKey: deleteMessageKey(effects), params: { count }, buttons: ['yes', 'no'], defaultButton: 'no' });
  return r === 'yes';
}

/** A delete refused because related records exist (no cascade). */
export async function showRelatedRefusal(modal: ModalApi, r: Extract<DeleteResult, { ok: false }>): Promise<void> {
  await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'datasheet.related', params: { table: r.table, context: r.table === undefined ? 'unnamed' : undefined }, buttons: ['ok'] });
}

/** The table's rule refused the record (Access's record-level rule): its rule shown in display form, when known. */
export function tableRuleMessage(table: string, rule: string | undefined, ctx: DisplayContext, t: TFunction): string {
  if (!rule) return t('fieldError.tableRule', { table, context: 'short' });
  let shown = rule;
  try { shown = toDisplay(rule, ctx); } catch { /* as stored */ }
  return t('fieldError.tableRule', { rule: shown, table });
}

/** The words of a field error (`context` 'record': the table's rule, no field: datasheet.fieldError_record shows the message alone): the field's caption, and the error's own message, else the code's (a control rule: form.controlValidation),
 *  which quotes a broken field rule in its display form. */
export function fieldErrorParams(e: { field: string; code: FieldErrorCode | 'controlValidation' | 'noMaster'; message?: string; table?: string }, field: FieldDef | undefined,
  ctx: DisplayContext, t: TFunction, design?: Pick<TableDesign, 'validationRule'>): { field: string; message: string; context?: 'record' } {
  if (e.field === '' && e.code === 'validation') return { field: '', message: e.message || tableRuleMessage(e.table ?? '', design?.validationRule, ctx, t), context: 'record' };
  if (e.field === '' && e.code === 'expressionError') return { field: '', message: t('fieldError.tableRuleError', { table: e.table ?? '' }), context: 'record' };
  const name = field?.props.caption || e.field;
  if (e.message) return { field: name, message: e.message };
  if (e.code === 'controlValidation') return { field: name, message: t('form.controlValidation') };
  if (e.code === 'noMaster') return { field: name, message: t('form.subform.noMaster') };   // a subform under a master not saved
  if (e.code !== 'validation') return { field: name, message: t(`fieldError.${e.code}`, { table: e.table ?? '', context: e.table === undefined && e.code === 'related' ? 'unnamed' : undefined }) };
  const rule = field?.props.validationRule ?? '';
  let shown = rule;
  try { shown = toDisplay(rule, ctx, { criteria: true }); } catch { /* as stored */ }
  return { field: name, message: t('fieldError.validation', { rule: shown }) };
}
