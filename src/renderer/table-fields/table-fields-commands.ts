// Table Fields tab (Add & Delete, Properties): each command builds a new design with the pure helpers of field-edit.ts and
// saves it as Design view does (saveTableInteractive: data-loss, relation and rule questions), then the datasheet reloads.
import { createElement } from 'react';
import type { DisplayContext } from '../../shared/expr/localize';
import { toDisplay } from '../../shared/expr/localize';
import { validateDesign, sameName, type FieldProps, type FieldType, type NumberSize, type TableDesign } from '../../shared/field-types';
import { ExpressionBuilder } from '../expr/ExpressionBuilder';
import { i18n } from '../i18n';
import type { ModalApi } from '../shell/Modal';
import type { CommandHandlers } from '../shell/ribbon-model';
import { saveTableInteractive } from '../table-design/save-table';
import { addField, namedFormatPatch, patchField, patchTable, removeField, renameField, stepDecimals, toggleIndex, type FieldEdit } from './field-edit';
import { editNameCaption } from './NameCaptionDialog';

export interface TableFieldsEnv {
  table: string; design(): TableDesign | null; selectedField(): string | null; modal: ModalApi; readOnly: boolean;
  flushPending(): Promise<boolean>; designOpen(): boolean;
  /** Resolves once the datasheet shows the new structure; `select`: the field whose column is selected again (null: none). */
  reload(select: string | null): Promise<void>;
  /** Expressions are shown in the interface language and the base's region (Expression Builder); null until known. */
  displayContext(): DisplayContext | null;
}

/** More Fields: what its menu offers. */
export type MoreField = { type: FieldType; numberSize?: NumberSize };
const MORE_FIELDS: MoreField[] = [
  { type: 'longText' }, { type: 'hyperlink' },
  ...(['byte', 'integer', 'single', 'double', 'decimal'] as const).map((numberSize) => ({ type: 'number' as const, numberSize })),
  { type: 'autoNumber' },
];
/** AutoNumber is its table's primary key: offered only for a table with neither an AutoNumber nor another key. */
export const moreFieldsFor = (d: TableDesign | null): MoreField[] =>
  MORE_FIELDS.filter((m) => m.type !== 'autoNumber' || (!!d && !d.fields.some((f) => f.props.type === 'autoNumber' || f.props.primaryKey)));

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;

/** One command at a time: a second one asked while one is in flight (dialogs, save, reload) would build from the old design. */
const inFlight = new WeakSet<TableFieldsEnv>();

/** The common path of every command. `build` returns null when the user cancels or there is nothing to do. */
async function run(env: TableFieldsEnv, needsField: boolean, build: (d: TableDesign, field: string | null) => Promise<FieldEdit | null> | FieldEdit | null) {
  if (env.readOnly || inFlight.has(env)) return;
  inFlight.add(env);
  try {
    if (env.designOpen()) {
      await env.modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'tableFields.designOpen', params: { name: env.table }, buttons: ['ok'] });
      return;
    }
    if (!(await env.flushPending())) return;
    const d = env.design();
    const field = env.selectedField();
    if (!d || (needsField && !field)) return;
    const e = await build(d, field);
    if (!e) return;
    if (!(await saveTableInteractive(env.modal, { originalName: env.table, design: e.design, mapping: e.mapping, allowDataLoss: false }))) return;
    // The column to select again: the new field, else the edited one (renamed or not), else the one now at the deleted field's place.
    const at = field ? d.fields.findIndex((f) => sameName(f.name, field)) : -1;
    const target = e.mapping.find((m) => m.sourceName === null)?.name ?? e.mapping.find((m) => field && m.sourceName !== null && sameName(m.sourceName, field))?.name
      ?? e.design.fields[Math.min(Math.max(at, 0), e.design.fields.length - 1)]?.name ?? null;
    await env.reload(target);
  } finally {
    inFlight.delete(env);
  }
}

/** A More Fields menu item: the field is added after the selected column. */
export const addMoreField = (env: TableFieldsEnv, m: MoreField) => addTyped(env, m.type, m.numberSize)();

const addTyped = (env: TableFieldsEnv, type: FieldType, numberSize?: NumberSize) => () =>
  run(env, false, (d, field) => addField(d, field, type, { base: t('tableFields.newField'), ...(numberSize ? { numberSize } : {}) }));

const fieldOf = (d: TableDesign, field: string | null) => d.fields.find((x) => sameName(x.name, field ?? ''))!;
const withField = (env: TableFieldsEnv, fn: (p: FieldProps) => Partial<FieldProps> | null) =>
  run(env, true, (d, field) => { const patch = fn(fieldOf(d, field).props); return patch && patchField(d, field!, patch); });

/** Data Type popup: the same change as Design view (changeType keeps what applies; the save asks about data loss). An AutoNumber is the key (R7). */
export const setDataType = (env: TableFieldsEnv, type: FieldType) => withField(env, (p) =>
  p.type === type ? null : { type, ...(type === 'autoNumber' ? { primaryKey: true, indexed: 'yesNoDuplicates' as const } : {}) });
/** Format popup: a named format by id, or null for none. */
export const setFormat = (env: TableFieldsEnv, format: string | null) => withField(env, (p) => (p.format === (format ?? undefined) ? null : { format: format ?? undefined }));

/** Validation popup: Field Validation Rule / Message, Record Validation Rule / Message. */
export type ValidationItem = 'fieldRule' | 'fieldText' | 'recordRule' | 'recordText';
export const editValidation = (env: TableFieldsEnv, which: ValidationItem) => run(env, which.startsWith('field'), async (d, field) => {
  const f = which.startsWith('field') ? fieldOf(d, field) : null;
  const rule = which.endsWith('Rule');
  const current = (f ? f.props[rule ? 'validationRule' : 'validationText'] : d[rule ? 'validationRule' : 'validationText']) ?? '';
  const patch = (v: string): FieldEdit => (f ? patchField(d, f.name, { [rule ? 'validationRule' : 'validationText']: v || undefined }) : patchTable(d, { [rule ? 'validationRule' : 'validationText']: v }));
  if (!rule) {
    const v = await env.modal.prompt({
      titleKey: 'tableFields.validationTextTitle', labelKey: f ? 'tableFields.fieldValidationTextLabel' : 'tableFields.recordValidationTextLabel', labelParams: { field: f?.name },
      initial: current, validate: (x) => ([...x].length <= 255 ? null : t('designError.validationTextSize')),
    });
    return v === null ? null : patch(v);
  }
  const ctx = env.displayContext();
  if (!ctx) return null;
  let shown = current;
  try { if (shown) shown = toDisplay(shown, ctx, { criteria: true }); } catch { /* shown as stored */ }
  // the design-time check of the rule (readable; a field rule names its own field only), on the design as it would be saved
  const validate = async (canonical: string) => {
    const e = validateDesign(patch(canonical).design).find((x) => x.prop === 'validationRule' && x.field === f?.name);
    return e ? t(`designError.${e.code}`, { prop: t('fieldProp.validationRule') }) : null;
  };
  const v = await env.modal.custom<string>((close) => createElement(ExpressionBuilder, {
    ctx: { ...ctx, fields: f ? [f.name] : d.fields.map((x) => x.name), criteria: true }, initial: shown, close, validate,
    label: t(f ? 'tableFields.fieldValidationRuleLabel' : 'tableFields.recordValidationRuleLabel', { field: f?.name }),
  }), { titleKey: 'builder.title' });
  return v === null ? null : patch(v);
});

export function tableFieldsCommands(env: TableFieldsEnv): CommandHandlers {
  return {
    addShortText: addTyped(env, 'shortText'), addNumber: addTyped(env, 'number'), addCurrency: addTyped(env, 'currency'),
    addDateTime: addTyped(env, 'dateTime'), addYesNo: addTyped(env, 'yesNo'),
    deleteField: () => run(env, true, async (d, field) => {
      const r = await env.modal.confirm({ titleKey: 'tableFields.confirmDeleteTitle', messageKey: 'tableFields.confirmDelete', params: { name: field }, buttons: ['yes', 'no'], defaultButton: 'no' });
      return r === 'yes' ? removeField(d, field!) : null;
    }),
    nameCaption: () => run(env, true, async (d, field) => {
      const f = d.fields.find((x) => x.name === field)!;
      const r = await editNameCaption(env.modal, d, f);
      return r && renameField(d, f.name, r.name, r.caption || undefined, r.description || undefined);
    }),
    defaultValue: () => run(env, true, async (d, field) => {
      const ctx = env.displayContext();
      const f = d.fields.find((x) => x.name === field)!;
      if (!ctx || f.props.type === 'autoNumber') return null;
      let shown = f.props.defaultValue ?? '';
      try { if (shown) shown = toDisplay(shown, ctx); } catch { /* shown as stored */ }
      // the design-time check of the Default Value property (readable, no field, no aggregate), on the design as it would be saved
      const validate = async (canonical: string) => {
        const e = validateDesign(patchField(d, f.name, { defaultValue: canonical || undefined }).design).find((x) => x.prop === 'defaultValue' && x.field === f.name);
        return e ? t(`designError.${e.code}`, { prop: t('fieldProp.defaultValue') }) : null;
      };
      const v = await env.modal.custom<string>((close) => createElement(ExpressionBuilder, {
        ctx: { ...ctx, fields: [], criteria: false }, initial: shown, close, validate, label: t('tableFields.defaultValueLabel', { field: f.name }),
      }), { titleKey: 'builder.title' });
      return v === null ? null : patchField(d, f.name, { defaultValue: v || undefined });
    }),
    currencyFormat: () => withField(env, (p) => namedFormatPatch(p, 'currency')),
    percentFormat: () => withField(env, (p) => namedFormatPatch(p, 'percent')),
    commaFormat: () => withField(env, (p) => namedFormatPatch(p, 'comma')),
    increaseDecimals: () => withField(env, (p) => (p.type === 'number' || p.type === 'currency' ? stepDecimals(p, 1) : null)),
    decreaseDecimals: () => withField(env, (p) => (p.type === 'number' || p.type === 'currency' ? stepDecimals(p, -1) : null)),
    // an existing value that breaks the new rule is asked about by the save (Required: refused with the count; Unique: refused)
    required: () => withField(env, (p) => (p.type === 'autoNumber' ? null : { required: !p.required })),
    unique: () => withField(env, (p) => (p.type === 'autoNumber' ? null : toggleIndex(p, 'unique'))),
    indexed: () => withField(env, (p) => (p.type === 'autoNumber' ? null : toggleIndex(p, 'indexed'))),
    fieldSize: () => run(env, true, async (d, field) => {
      const f = d.fields.find((x) => x.name === field)!;
      if (f.props.type !== 'shortText') return null;
      const v = await env.modal.prompt({
        titleKey: 'tableFields.fieldSizeTitle', labelKey: 'tableFields.fieldSizeLabel', initial: String(f.props.size ?? 255),
        validate: (x) => (/^\d+$/.test(x.trim()) && +x >= 1 && +x <= 255 ? null : t('tableFields.fieldSizeInvalid')),
      });
      return v === null ? null : patchField(d, f.name, { size: Number(v) });
    }),
  };
}
