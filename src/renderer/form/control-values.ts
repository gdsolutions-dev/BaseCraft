// Valeur d'un contrôle dépendant (Control Source = un champ) : champ lié et textes affiché / modifiable. Module pur.
import type { CellInput, SqlValue } from '../../shared/coerce';
import type { ControlDef } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import { texts } from '../datasheet/datasheet-cells';

/** The bound field: a Control Source without `=` naming a source field (case ignored), else null. */
export function boundField(c: ControlDef, info: SourceInfo): SourceField | null {
  const src = c.props.ControlSource;
  if (typeof src !== 'string' || src === '' || src.startsWith('=')) return null;
  return info.fields.find((f) => sameName(f.name, src)) ?? null;
}

const INPUTS: ControlDef['kind'][] = ['textBox', 'checkBox', 'optionGroup', 'comboBox', 'listBox'];
/** An unbound input: a text box, check box, option group, combo or list box with no Control Source (its value lives in the form, not in a record). */
export function isUnbound(c: ControlDef): boolean {
  return INPUTS.includes(c.kind) && !c.props.ControlSource;
}

/** DecimalPlaces as the foundation stores it (enum text): 'auto', '0'…'15'; anything else is unset. */
export function dp(v: unknown): 'auto' | number | undefined {
  if (v === 'auto') return 'auto';
  return typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined;
}

/** Typed text as is; otherwise the field's texts with the control's Format and DecimalPlaces winning over the field's. */
export function controlTexts(c: ControlDef, f: SourceField, stored: SqlValue, pending: CellInput | undefined,
  ctx: { locale: string; lang: 'fr' | 'en' }): { display: string; edit: string } {
  if (pending !== undefined) { const t = pending === null ? '' : String(pending); return { display: t, edit: t }; }
  const format = (typeof c.props.Format === 'string' && c.props.Format) || f.props.format;
  const props = { ...f.props, format, decimalPlaces: dp(c.props.DecimalPlaces) ?? f.props.decimalPlaces };
  const [display, edit] = texts({ ...f, props }, stored, ctx);
  return { display, edit };
}
