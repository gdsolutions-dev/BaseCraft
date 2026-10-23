// « Propriétés du champ », onglets Général et Liste de choix : seules les propriétés qui s'appliquent au type du champ.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { listItemStored, listItemText } from '../../shared/coerce';
import { FORMATS_BY_TYPE, namedFormatId } from '../../shared/expr/format';
import { MaskSyntaxError, parseMask, type MaskErrorCode } from '../../shared/expr/input-mask';
import type { DisplayContext } from '../../shared/expr/localize';
import type { LocaleInfo } from '../../shared/locale-format';
import {
  accessColumns, cmToTwips, columnWidthsText, LIST_ROWS, LOOKUP_TYPES, MASK_TYPES, parseColumnWidths, sameName, splitValueList, twipsToCm, wizardColumns, withRowSourceType,
  type FieldProps, type FieldType, type LookupProps, type NumberSize,
} from '../../shared/field-types';
import { api } from '../bridge';
import { ExpressionField } from '../expr/ExpressionField';
import { RowSourceBuilder } from '../query/QueryDesignView';
import { ComboBox } from '../shell/ComboBox';
import { useErrorDialog } from '../shell/Modal';
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
  /** Expressions: display context (null until the region is known), the row's key and field name, its unreadable entries. */
  ctx: DisplayContext | null; rowKey: string; fieldName: string; invalid: Partial<Record<string, InvalidCode>>
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

/** A value list's Row Source: the values separated by « ; » (as Access writes it in every region), read when left (or Enter).
 *  A Number's items are typed and shown in the region, stored canonical (listItemStored). */
function ValuesField({ id, values, type, region, disabled, onCommit }: {
  id: string; values: string[]; type: FieldType; region: LocaleInfo | null; disabled: boolean; onCommit(v: string[]): void
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const next = splitValueList(draft).map((x) => (region ? listItemStored(type, x, region) : x));
    if (next.join(';') !== values.join(';')) onCommit(next);
    setDraft(null);
  };
  const shown = values.map((x) => (region ? listItemText(type, x, region) : x)).join(';');
  return <input id={id} data-testid="prop-rowSource" disabled={disabled} spellCheck={false} value={draft ?? shown}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />;
}

/** A Lookup tab property typed as text: read when left (or Enter); an unreadable entry stays shown with its error and blocks
 *  the save (as an input mask does). `parse`: the value to store (undefined: the key omitted, Access's default), null when
 *  unreadable (`bad`: the error). */
function TextProp({ id, testId, shown, disabled, error, bad, parse, onCommit, onInvalid }: {
  id: string; testId: string; shown: string; disabled: boolean; error: InvalidCode | undefined; bad: InvalidCode
  parse(text: string): { value: unknown } | null; onCommit(v: unknown): void; onInvalid(code: InvalidCode | null): void
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const r = parse(draft.trim());
    if (!r) return onInvalid(bad);
    onCommit(r.value);
    if (error) onInvalid(null);
    setDraft(null);
  };
  return (
    <>
      <input id={id} data-testid={testId} disabled={disabled} spellCheck={false} value={draft ?? shown} aria-invalid={!!error}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      {error && <div className="pval-error" role="alert" data-testid={`${testId}-error`}>{t(`expr.error.${error}`)}</div>}
    </>
  );
}

/** An integer from 1 to 255 (Access's limit for columns and list rows); empty: the default. */
const count = (text: string) => (text === '' ? { value: undefined } : /^\d+$/.test(text) && +text >= 1 && +text <= 255 ? { value: +text } : null);

/** The Lookup tab's own state: the base's tables, and the fields of the source table (read when needed). */
function useLookupSource(open: boolean, table: string | undefined) {
  const showError = useErrorDialog();
  const [tables, setTables] = useState<string[] | null>(null);
  const [fields, setFields] = useState<{ table: string; names: string[] } | null>(null);
  useEffect(() => {
    if (open) api.tables.list().then((l) => setTables(l.map((x) => x.name)), (e) => void showError(e)); // again each time it opens
  }, [open]);
  useEffect(() => {
    if (!open || table === undefined || fields?.table === table) return;
    let stale = false;
    // A source table that is gone has no fields: its stored names stay shown (no automatic relation, A2).
    api.tables.design(table).then((d) => { if (!stale) setFields({ table, names: d.fields.map((x) => x.name) }); },
      () => { if (!stale) setFields({ table, names: [] }); });
    return () => { stale = true; };
  }, [open, table]);
  return { tables: tables ?? [], loaded: tables !== null, fields: fields && fields.table === table ? fields.names : [], showError };
}

export function FieldPropertiesPanel({ props: p, disabled, onProp, ctx, rowKey, fieldName, invalid, onInvalid }: Props) {
  const { t } = useTranslation();
  const uid = useId(); // several design tabs stay mounted at once
  const [tab, setTab] = useState<'general' | 'lookup'>('general');
  const hasLookup = !!p && LOOKUP_TYPES.includes(p.type);
  const shownTab = hasLookup ? tab : 'general';
  const lookup = p?.lookup;
  // The source's fields: only to show a lookup saved before the Access properties as Access columns.
  const source = useLookupSource(shownTab === 'lookup', lookup?.kind === 'table' && lookup.boundField !== undefined ? lookup.table : undefined);
  const row = useRef(rowKey); // an answer that comes after the user moved to another field is dropped
  row.current = rowKey;
  const lookupRef = useRef(lookup); // the lookup as it is when an answer comes
  lookupRef.current = lookup;
  const [building, setBuilding] = useState<{ key: string; text: string } | null>(null); // the Row Source's Query Builder
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const items: [string, ReactNode, string?][] = [];
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
      <ComboBox id={uid + 'format'} testId="prop-format" label={t('fieldProp.format')} disabled={disabled} options={named.map((n) => ({ id: n, label: label(n) }))}
        value={named.some((n) => n === p.format) ? label(p.format!) : p.format ?? ''}
        onChange={(text) => onProp('format', named.find((n) => label(n) === text || n === namedFormatId(text)) ?? text)} />
    ));
    if (MASK_TYPES.includes(p.type)) {
      control('inputMask', <MaskField key={rowKey + 'inputMask'} id={uid + 'inputMask'} value={p.inputMask} disabled={disabled} error={invalid.inputMask}
        onCommit={(v) => onProp('inputMask', v)} onInvalid={(code) => onInvalid('inputMask', code)} />);
    }
    control('caption', <input {...common('caption')} value={p.caption ?? ''} onChange={(e) => onProp('caption', e.target.value)} />);
    if (p.type !== 'autoNumber' && ctx) {
      // Keyed by row: a draft left unreadable in another field's panel never shows here. A rule may name its own field only, a
      // default value none (validateDesign).
      const expression = (key: 'defaultValue' | 'validationRule') => control(key, (
        <ExpressionField key={rowKey + key} id={uid + key} testId={`prop-${key}`} value={p[key]} criteria={key === 'validationRule'} ctx={ctx}
          fields={key === 'validationRule' && fieldName ? [fieldName] : []}
          disabled={disabled} error={invalid[key]} onCommit={(v) => onProp(key, v)} onInvalid={(code) => onInvalid(key, code)} />
      ));
      expression('defaultValue');
      expression('validationRule');
      control('validationText', <input {...common('validationText')} maxLength={255} value={p.validationText ?? ''} onChange={(e) => onProp('validationText', e.target.value)} />);
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

  // Lookup tab, as in Access and in its order: Display Control, then for a combo box (a list box: without List Rows, List Width
  // and Limit To List) its source and columns. A table source names a table: no relation is created (A2); SQL or a query name
  // is kept as typed for A3. Back to a text box (a check box for Yes/No): the key is omitted.
  const lookupItems: [string, ReactNode, string?][] = []; // [property, control, tooltip of a property planned later]
  if (p && shownTab === 'lookup') {
    const plain = p.type === 'yesNo' ? 'checkBox' : 'textBox';
    // A lookup saved before the Access properties shows (and is saved) as Access columns.
    const l = lookup?.kind === 'table' ? accessColumns(lookup, source.fields) ?? lookup : lookup;
    const set = (patch: Record<string, unknown>) => {
      const { boundField: _b, displayFields: _d, ...next } = { ...l, ...patch } as LookupProps & Record<string, unknown>;
      onProp('lookup', next);
    };
    const control = lookup?.displayControl === 'listBox' ? 'listBox' : lookup ? 'comboBox' : plain;
    lookupItems.push(['displayControl', (
      <select {...common('displayControl')} value={control}
        onChange={(e) => {
          const v = e.target.value;
          if (v === plain) return onProp('lookup', undefined);
          const displayControl = v === 'listBox' ? 'listBox' : undefined;
          onProp('lookup', l ? { ...l, displayControl } : { kind: 'values', values: [], limitToList: false, ...(displayControl ? { displayControl } : {}) });
        }}>
        {(p.type === 'yesNo' ? [plain, 'comboBox'] : [plain, 'listBox', 'comboBox']).map((v) => <option key={v} value={v}>{t(`fieldProp.displayControls.${v}`)}</option>)}
      </select>
    )]);
    if (l) {
      const sep = ctx?.region.decimalSep ?? ',';
      // A table named as the source takes the wizard's columns: bound to its key, showing the next field (Access's wizard).
      // Typed before the tab's table list arrived: the list is read here.
      const toTable = async (table: string) => {
        const key = rowKey;
        set({ table });
        try {
          const tables = source.loaded ? source.tables : (await api.tables.list()).map((x) => x.name);
          if (!tables.includes(table)) return;
          const columns = wizardColumns((await api.tables.design(table)).fields);
          const now = lookupRef.current;
          if (columns && row.current === key && now?.kind === 'table' && now.table === table) onProp('lookup', { ...now, ...columns });
        } catch (e) { await source.showError(e); }
      };
      lookupItems.push(['rowSourceType', (
        <select {...common('rowSourceType')} value={l.kind}
          onChange={(e) => onProp('lookup', withRowSourceType(l, e.target.value as LookupProps['kind']))}>
          {(['table', 'values', 'fieldList'] as const).map((v) => <option key={v} value={v}>{t(`fieldProp.rowSourceTypes.${v}`)}</option>)}
        </select>
      )]);
      // Row Source: a value list, or a table (picked or typed); any other text (SQL, a query name) is kept as typed, and the
      // « … » button opens A3's Query Builder over it. Text that names no table: for a Field List, a table that is not there.
      const unknown = l.kind !== 'values' && source.loaded && l.table.trim() !== '' && !source.tables.some((n) => sameName(n, l.table));
      lookupItems.push(['rowSource', (
        <>
          {l.kind === 'values' ? (
            <ValuesField key={rowKey} id={uid + 'rowSource'} values={l.values} type={p.type} region={ctx?.region ?? null} disabled={disabled}
              onCommit={(values) => onProp('lookup', { ...l, values })} />
          ) : (
            <ComboBox id={uid + 'rowSource'} testId="prop-rowSource" label={t('fieldProp.rowSource')} disabled={disabled}
              options={source.tables.map((n) => ({ id: n, label: n }))} value={l.table}
              onChange={(text) => {
                if (l.kind === 'table' && (!source.loaded || source.tables.includes(text)) && !sameName(text, l.table)) void toTable(text);
                else set({ table: text });
              }} />
          )}
          <span className="pbuild">
            {/* A3: the Query Builder over the Row Source (a table, a query or SQL), which writes back its SQL */}
            <button type="button" className="iconbtn" data-testid="prop-rowSource-build" disabled={disabled || l.kind !== 'table'}
              aria-label={t('fieldProp.queryBuilder')} title={t('fieldProp.queryBuilder')} onClick={() => { if (l.kind === 'table') setBuilding({ key: rowKey, text: l.table }); }}>…</button>
          </span>
          {unknown && l.kind === 'fieldList' && <div className="pval-note" data-testid="prop-rowSource-note">{t('fieldProp.tableNotFound')}</div>}
        </>
      )]);
      type TextKey = 'boundColumn' | 'columnCount' | 'columnWidths' | 'listRows' | 'listWidth';
      const text = (key: TextKey, shown: string, bad: InvalidCode, parse: (x: string) => { value: unknown } | null) =>
        lookupItems.push([key, <TextProp key={rowKey + key} id={uid + key} testId={`prop-${key}`} shown={shown} disabled={disabled} error={invalid[key]}
          bad={bad} parse={parse} onCommit={(v) => set({ [key]: v })} onInvalid={(code) => onInvalid(key, code)} />]);
      const check = (key: 'columnHeads' | 'limitToList' | 'allowValueListEdits') => lookupItems.push([key,
        <input type="checkbox" {...common(key)} checked={!!l[key]} onChange={(e) => set({ [key]: e.target.checked })} />]);
      const planned = (key: string, tip: string, el: ReactNode = <input type="checkbox" {...common(key)} disabled checked={false} readOnly title={tip} />) =>
        lookupItems.push([key, el, tip]);
      text('boundColumn', String(l.boundColumn ?? 1), 'badCount', count);
      text('columnCount', String(l.columnCount ?? 1), 'badCount', count);
      check('columnHeads');
      text('columnWidths', columnWidthsText(l.columnWidths ?? [], sep), 'badWidths', (x) => {
        const w = parseColumnWidths(x);
        return w && { value: w.length ? w : undefined };
      });
      if (l.displayControl !== 'listBox') {
        text('listRows', String(l.listRows ?? LIST_ROWS), 'badCount', count);
        text('listWidth', l.listWidth === undefined ? t('fieldProp.auto') : twipsToCm(l.listWidth, sep), 'badListWidth', (x) => {
          if (x === '' || x.toLowerCase() === 'auto' || x === t('fieldProp.auto')) return { value: undefined };
          const w = cmToTwips(x);
          return w === null ? null : { value: w };
        });
        check('limitToList');
      }
      // Multivalued fields are not carried over in stage A (spec §7); the edit form needs forms (A4).
      planned('allowMultipleValues', t('fieldProp.plannedLater'));
      check('allowValueListEdits');
      planned('listItemsEditForm', t('fieldProp.plannedForms'), <input {...common('listItemsEditForm')} disabled value="" readOnly title={t('fieldProp.plannedForms')} />);
      planned('showOnlyRowSourceValues', t('fieldProp.plannedLater'));
    }
  }
  const tabs: ('general' | 'lookup')[] = hasLookup ? ['general', 'lookup'] : ['general'];
  /** Arrows move between the tabs (ARIA tabs). */
  const tabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tabs[(tabs.indexOf(shownTab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    setTab(next);
    document.getElementById(uid + next)?.focus();
  };

  return (
    <section className="fprops" aria-label={t('designer.propsTitle')}>
      <div className="fprops-head">{t('designer.propsTitle')}</div>
      <div className="ptabs" role="tablist" onKeyDown={tabKey}>
        {tabs.map((x) => (
          <button key={x} className={`ptab${x === shownTab ? ' is-active' : ''}`} role="tab" aria-selected={x === shownTab} tabIndex={x === shownTab ? 0 : -1}
            id={uid + x} aria-controls={uid + 'panel'} data-testid={`prop-tab-${x}`} onClick={() => setTab(x)}>{t(`designer.${x}`)}</button>
        ))}
      </div>
      <div className="plist" role="tabpanel" id={uid + 'panel'} aria-labelledby={uid + shownTab}>
        {p ? (shownTab === 'lookup' ? lookupItems : items).map(([key, el, tip]) => (
          <div className="prow" key={key} title={tip}>
            <label htmlFor={uid + key}>{t(`fieldProp.${key}`)}</label>
            <div className="pval">{el}</div>
          </div>
        )) : <p className="fprops-empty muted">{t('designer.noField')}</p>}
      </div>
      {building && (
        <RowSourceBuilder rowSource={building.text} onClose={(sql) => {
          const now = lookupRef.current;
          setBuilding(null);
          if (sql === null || row.current !== building.key || now?.kind !== 'table') return;
          const { boundField: _b, displayFields: _d, ...next } = { ...now, table: sql }; // SQL ignores the legacy columns (rows.ts)
          onProp('lookup', next);
        }} />
      )}
    </section>
  );
}
