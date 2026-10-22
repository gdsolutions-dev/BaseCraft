// « Propriétés du champ », onglet Général : seules les propriétés qui s'appliquent au type du champ.
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FORMATS_BY_TYPE, namedFormatId } from '../../shared/expr/format';
import { MaskSyntaxError, parseMask, type MaskErrorCode } from '../../shared/expr/input-mask';
import type { DisplayContext } from '../../shared/expr/localize';
import { MASK_TYPES, type FieldProps, type FieldType, type NumberSize } from '../../shared/field-types';
import { ExpressionField } from '../expr/ExpressionField';
import type { InvalidCode } from './design-model';

// Objects typed as Record<…>: the compiler checks that every type is listed.
export const FIELD_TYPES = Object.keys({
  autoNumber: 0, shortText: 0, longText: 0, number: 0, currency: 0, dateTime: 0, yesNo: 0, hyperlink: 0,
} satisfies Record<FieldType, 0>) as FieldType[];
const NUMBER_SIZES = Object.keys({ byte: 0, integer: 0, longInteger: 0, single: 0, double: 0, decimal: 0 } satisfies Record<NumberSize, 0>) as NumberSize[];
const INDEXED: FieldProps['indexed'][] = ['no', 'yesDuplicates', 'yesNoDuplicates'];
const TEXT_TYPES: FieldType[] = ['shortText', 'longText', 'hyperlink'];
const DECIMALS = ['auto', ...Array.from({ length: 16 }, (_, i) => String(i))];

interface Props {
  props: FieldProps | null; disabled: boolean; onProp(key: string, value: unknown): void
  /** Expressions: display context (null until the region is known), the row's key, its unreadable entries. */
  ctx: DisplayContext | null; rowKey: string; invalid: Partial<Record<string, InvalidCode>>
  onInvalid(key: string, code: InvalidCode | null): void
}

/** The input mask, stored as typed (not an expression): checked when left (or Enter); an unreadable one stays shown with its
 *  error and blocks the save. Cleared: the key is omitted. */
function MaskField({ id, value, disabled, error, onCommit, onInvalid }: {
  id: string; value: string | undefined; disabled: boolean; error: InvalidCode | undefined
  onCommit(v: string | undefined): void; onInvalid(code: MaskErrorCode | null): void
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const text = draft ?? value ?? '';
    try {
      if (text !== '') parseMask(text);
    } catch (e) {
      if (!(e instanceof MaskSyntaxError)) throw e;
      onInvalid(e.code);
      return;
    }
    if (text !== (value ?? '')) onCommit(text || undefined);
    if (error) onInvalid(null);
    setDraft(null);
  };
  return (
    <>
      <input id={id} data-testid="prop-inputMask" disabled={disabled} spellCheck={false} value={draft ?? value ?? ''} aria-invalid={!!error}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      {error && <div className="pval-error" role="alert" data-testid="prop-inputMask-error">{t(`expr.error.${error}`)}</div>}
    </>
  );
}

export function FieldPropertiesPanel({ props: p, disabled, onProp, ctx, rowKey, invalid, onInvalid }: Props) {
  const { t } = useTranslation();
  const uid = useId(); // several design tabs stay mounted at once
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const items: [string, ReactNode][] = [];
  const control = (key: string, el: ReactNode) => items.push([key, el]);
  const common = (key: string) => ({ id: uid + key, 'data-testid': `prop-${key}`, disabled });
  const number = (key: 'size' | 'precision' | 'scale', min: number, max: number) => control(key,
    <input type="number" {...common(key)} min={min} max={max} value={p?.[key] ?? ''} onChange={(e) => onProp(key, num(e.target.value))} />);
  const check = (key: 'required' | 'allowZeroLength') => control(key,
    <input type="checkbox" {...common(key)} checked={!!p?.[key]} onChange={(e) => onProp(key, e.target.checked)} />);

  if (p) {
    if (p.type === 'shortText') number('size', 1, 255);
    if (p.type === 'number') {
      control('numberSize', (
        <select {...common('numberSize')} value={p.numberSize ?? 'longInteger'} onChange={(e) => onProp('numberSize', e.target.value)}>
          {NUMBER_SIZES.map((s) => <option key={s} value={s}>{t(`fieldProp.numberSizes.${s}`)}</option>)}
        </select>
      ));
      if (p.numberSize === 'decimal') { number('precision', 1, 28); number('scale', 0, 28); }
    }
    if (p.type === 'number' || p.type === 'currency') {
      control('decimalPlaces', (
        <select {...common('decimalPlaces')} value={String(p.decimalPlaces ?? 'auto')}
          onChange={(e) => onProp('decimalPlaces', e.target.value === 'auto' ? 'auto' : Number(e.target.value))}>
          {DECIMALS.map((d) => <option key={d} value={d}>{d === 'auto' ? t('fieldProp.auto') : d}</option>)}
        </select>
      ));
    }
    // Editable list: the type's named formats (stored by id, shown translated) or a free custom format (stored as typed).
    const named = FORMATS_BY_TYPE[p.type];
    const label = (id: string) => t(`format.${id}`);
    control('format', (
      <>
        <input {...common('format')} list={`${uid}formats`} value={named.some((n) => n === p.format) ? label(p.format!) : p.format ?? ''}
          onChange={(e) => onProp('format', named.find((n) => label(n) === e.target.value || n === namedFormatId(e.target.value)) ?? e.target.value)} />
        <datalist id={`${uid}formats`}>{named.map((n) => <option key={n} value={label(n)} />)}</datalist>
      </>
    ));
    if (MASK_TYPES.includes(p.type)) {
      control('inputMask', <MaskField key={rowKey + 'inputMask'} id={uid + 'inputMask'} value={p.inputMask} disabled={disabled} error={invalid.inputMask}
        onCommit={(v) => onProp('inputMask', v)} onInvalid={(code) => onInvalid('inputMask', code)} />);
    }
    control('caption', <input {...common('caption')} value={p.caption ?? ''} onChange={(e) => onProp('caption', e.target.value)} />);
    if (p.type !== 'autoNumber' && ctx) {
      // Keyed by row: a draft left unreadable in another field's panel never shows here.
      const expression = (key: 'defaultValue' | 'validationRule') => control(key, (
        <ExpressionField key={rowKey + key} id={uid + key} testId={`prop-${key}`} value={p[key]} criteria={key === 'validationRule'} ctx={ctx}
          disabled={disabled} error={invalid[key]} onCommit={(v) => onProp(key, v)} onInvalid={(code) => onInvalid(key, code)} />
      ));
      expression('defaultValue');
      expression('validationRule');
      control('validationText', <input {...common('validationText')} value={p.validationText ?? ''} onChange={(e) => onProp('validationText', e.target.value)} />);
    }
    if (p.type !== 'autoNumber') check('required');
    if (TEXT_TYPES.includes(p.type)) check('allowZeroLength');
    control('indexed', (
      // An AutoNumber is the table's key: its index is fixed.
      <select {...common('indexed')} disabled={disabled || p.type === 'autoNumber'} value={p.indexed} onChange={(e) => onProp('indexed', e.target.value)}>
        {INDEXED.map((v) => <option key={v} value={v}>{t(`fieldProp.indexedValues.${v}`)}</option>)}
      </select>
    ));
  }

  return (
    <section className="fprops" aria-label={t('designer.propsTitle')}>
      <div className="fprops-head">{t('designer.propsTitle')}</div>
      <div className="ptabs" role="tablist">
        <button className="ptab is-active" role="tab" aria-selected="true" id={`${uid}general`}>{t('designer.general')}</button>
      </div>
      <div className="plist" role="tabpanel" aria-labelledby={`${uid}general`}>
        {p ? items.map(([key, el]) => (
          <div className="prow" key={key}>
            <label htmlFor={uid + key}>{t(`fieldProp.${key}`)}</label>
            <div className="pval">{el}</div>
          </div>
        )) : <p className="fprops-empty muted">{t('designer.noField')}</p>}
      </div>
    </section>
  );
}
