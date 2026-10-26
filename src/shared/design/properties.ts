// Catalogue fermé des propriétés de l'étape A (spec 4.7, contrat 1.4), qui pilote la feuille de propriétés (A4, A5).
// Noms invariants = noms anglais d'Access. Libellés : prop.<Nom> ; valeurs d'une liste : propValue.<Nom>.<valeur>
// (une valeur sans clé, comme DecimalPlaces '0'…'15', s'affiche telle quelle).
// Valeurs stockées (contrat 1.4) : longueurs en twips, couleurs ColorValue (colors.ts), expressions canoniques.
// A4 et A5 ajoutent leurs entrées en fin de tableau, seulement si le nom n'existe pas : un nom n'a qu'un descripteur.
import { CONTROL_KINDS, SECTION_KINDS, type ControlKind, type SectionKind } from './model';

export type PropertyTarget = 'form' | 'report' | SectionKind | ControlKind;
export type PropertyEditorKind = 'text' | 'number' | 'twips' | 'bool' | 'enum' | 'color' | 'expression' | 'criteria'
  | 'controlSource' | 'recordSource' | 'rowSource' | 'objectName' | 'fieldList' | 'picture' | 'textList' | 'event' | 'font';
/** A per-target default key: a target, or a target inside a form or a report (C5; sections allowed too, e.g. `report:detail`). */
export type DefaultKey = PropertyTarget | `${'form' | 'report'}:${SectionKind | ControlKind}`;
export interface PropertyDescriptor { name: string; tab: 'format' | 'data' | 'event' | 'other'; editor: PropertyEditorKind;
  appliesTo: PropertyTarget[]; default?: unknown; defaults?: Partial<Record<DefaultKey, unknown>>;
  options?: string[]; min?: number; max?: number; integer?: boolean /* a whole number (Access) */; labelKey: string /* prop.<Nom> */
  /** The kind of object the property belongs to; absent: both. A section kind is shared by forms and reports (`detail`): this tells them apart. */
  objects?: ('form' | 'report')[] }

/** The default of `d` for one target, the most specific first: `<objectKind>:<target>`, then `<target>`, then `default`.
 *  Access defaults differ by control kind and between forms and reports. */
export function defaultFor(d: PropertyDescriptor, target: PropertyTarget, objectKind?: 'form' | 'report'): unknown {
  const keys: string[] = objectKind && target !== 'form' && target !== 'report' ? [`${objectKind}:${target}`, target] : [target];
  for (const k of keys) if (d.defaults !== undefined && Object.hasOwn(d.defaults, k)) return d.defaults[k as DefaultKey];
  return d.default;
}

const BOUND: ControlKind[] = ['textBox', 'checkBox', 'optionGroup', 'comboBox', 'listBox'];
const LISTS: ControlKind[] = ['comboBox', 'listBox'];
const TEXT: ControlKind[] = ['label', 'textBox', 'comboBox', 'listBox', 'commandButton'];
const BOXED: ControlKind[] = ['label', 'textBox', 'comboBox', 'listBox', 'optionGroup', 'commandButton', 'rectangle', 'image', 'subform'];
const BORDERED: ControlKind[] = ['label', 'textBox', 'checkBox', 'comboBox', 'listBox', 'optionGroup', 'rectangle', 'line', 'image', 'subform'];
/** Controls that take the keyboard focus in the tab order (Tab Stop, Tab Index, Status Bar Text). */
const INPUTS: ControlKind[] = [...BOUND, 'commandButton'];
const CLICKABLE: ControlKind[] = ['label', 'textBox', 'comboBox', 'listBox', 'checkBox', 'optionGroup', 'optionButton', 'commandButton', 'image', 'tabControl'];
const FOCUSABLE: ControlKind[] = [...INPUTS, 'optionButton', 'subform']; // Enter/Exit: the option group has them, the tab control does not
// Got/Lost Focus: the option group itself has none (its buttons do), nor the form (Access fires them only when no control can take the focus)
const GOT_FOCUS: PropertyTarget[] = ['textBox', 'checkBox', 'comboBox', 'listBox', 'commandButton', 'optionButton'];
/** Page header and footer can neither grow, shrink, keep together nor force a page (as in Access). */
const FLOWING: SectionKind[] = SECTION_KINDS.filter((s) => s !== 'pageHeader' && s !== 'pageFooter');
/** The report sections that fire On Format and On Print. */
const REPORT_SECTIONS: SectionKind[] = ['reportHeader', 'pageHeader', 'groupHeader', 'detail', 'groupFooter', 'pageFooter', 'reportFooter'];
const each = <T>(keys: DefaultKey[], v: T): Partial<Record<DefaultKey, T>> => Object.fromEntries(keys.map((k) => [k, v]));

type Tab = PropertyDescriptor['tab'];
type Extra = Pick<PropertyDescriptor, 'options' | 'min' | 'max' | 'integer' | 'defaults' | 'objects'>;
const p = (name: string, tab: Tab, editor: PropertyEditorKind, appliesTo: PropertyTarget[], def?: unknown, extra: Extra = {}): PropertyDescriptor => ({
  name, tab, editor, appliesTo, ...(def === undefined ? {} : { default: def }), ...extra, labelKey: `prop.${name}`,
});

/** Control events fire in Form view only: a report control has none (Global Constraints). */
const FORM_ONLY: Extra = { objects: ['form'] };

export const PROPERTY_CATALOG: PropertyDescriptor[] = [
  // Format
  p('Caption', 'format', 'text', ['form', 'report', 'label', 'commandButton', 'optionGroup', 'tabControl'], ''),
  p('DefaultView', 'format', 'enum', ['form'], 'single', { options: ['single', 'continuous', 'datasheet'] }),
  p('NavigationButtons', 'format', 'bool', ['form'], true),
  p('Width', 'format', 'twips', ['form', 'report', ...CONTROL_KINDS], 6994), // a control's width is ControlDef.width
  p('GridX', 'format', 'number', ['form', 'report'], 4, { min: 1, max: 16, integer: true }), // grid points per cm
  p('GridY', 'format', 'number', ['form', 'report'], 4, { min: 1, max: 16, integer: true }),
  p('Visible', 'format', 'bool', [...SECTION_KINDS, ...CONTROL_KINDS], true),
  p('Format', 'format', 'text', ['textBox', 'comboBox'], ''),
  p('DecimalPlaces', 'format', 'enum', ['textBox', 'comboBox'], 'auto', { options: ['auto', ...Array.from({ length: 16 }, (_, i) => String(i))] }),
  p('ColumnCount', 'format', 'number', LISTS, 1, { min: 1, max: 20, integer: true }),
  p('ColumnWidths', 'format', 'text', LISTS, ''), // integer twips separated by ';' (as Access stores them), shown in cm
  p('ColumnHeads', 'format', 'bool', LISTS, false), // a value list's first row, a table's captions (A2's Lookup tab)
  p('BackStyle', 'format', 'enum', BOXED, 'normal', {
    options: ['normal', 'transparent'], defaults: { ...each(['label', 'optionGroup', 'rectangle'], 'transparent'), 'report:textBox': 'transparent', 'report:comboBox': 'transparent' },
  }),
  // A report prints on white whatever the theme (C5). Its controls keep theme tokens for ForeColor and BorderColor (and
  // BackColor, drawn only when BackStyle is normal): a report always resolves them with resolveColor(v, 'light').
  p('BackColor', 'format', 'color', [...SECTION_KINDS, ...BOXED], 'theme:surface', { defaults: each(SECTION_KINDS.map((s) => `report:${s}` as const), '#ffffff') }),
  p('BorderStyle', 'format', 'enum', BORDERED, 'solid', {
    options: ['transparent', 'solid', 'dashed', 'dotted'], defaults: { label: 'transparent', 'report:textBox': 'transparent', 'report:comboBox': 'transparent', 'report:label': 'transparent' },
  }),
  p('BorderWidth', 'format', 'number', BORDERED, 0, { min: 0, max: 6, integer: true }), // px; 0 = hairline, drawn 1 px wide as in Access
  p('BorderColor', 'format', 'color', BORDERED, 'theme:border'),
  p('ForeColor', 'format', 'color', TEXT, 'theme:text'),
  p('FontName', 'format', 'font', TEXT, 'Inter'), // fonts.ts: EMBEDDED_FONTS first, then any name (resolveFont: not portable)
  p('FontSize', 'format', 'number', TEXT, 10, { min: 6, max: 72, integer: true }), // pt
  p('FontWeight', 'format', 'enum', TEXT, 'normal', { options: ['normal', 'bold'] }),
  p('FontItalic', 'format', 'bool', TEXT, false),
  p('FontUnderline', 'format', 'bool', TEXT, false),
  p('TextAlign', 'format', 'enum', ['label', 'textBox', 'comboBox'], 'general', { options: ['general', 'left', 'center', 'right'] }),
  p('CanGrow', 'format', 'bool', [...FLOWING, 'textBox', 'subform'], false),
  p('CanShrink', 'format', 'bool', [...FLOWING, 'textBox', 'subform'], false),
  p('KeepTogether', 'format', 'bool', FLOWING, false, { defaults: { groupHeader: true, 'report:detail': true } }), // as in Access
  p('RepeatSection', 'format', 'bool', ['groupHeader'], false),
  p('ForceNewPage', 'format', 'enum', FLOWING, 'none', { options: ['none', 'before', 'after', 'beforeAndAfter'] }),
  // Data
  p('RecordSource', 'data', 'recordSource', ['form', 'report']), // edited into DesignDoc.recordSource, never stored in props
  p('AllowAdditions', 'data', 'bool', ['form'], true),
  p('AllowEdits', 'data', 'bool', ['form'], true),
  p('AllowDeletions', 'data', 'bool', ['form'], true),
  p('ControlSource', 'data', 'controlSource', BOUND, ''), // a field name, or `=` + canonical expression
  p('RowSourceType', 'data', 'enum', LISTS, 'tableQuery', { options: ['tableQuery', 'valueList'] }),
  p('RowSource', 'data', 'rowSource', LISTS, ''),
  p('BoundColumn', 'data', 'number', LISTS, 1, { min: 1, max: 20, integer: true }),
  p('LimitToList', 'data', 'bool', ['comboBox'], false),
  p('DefaultValue', 'data', 'expression', BOUND, ''),
  p('ValidationRule', 'data', 'criteria', BOUND, ''),
  p('ValidationText', 'data', 'text', BOUND, ''),
  p('Enabled', 'data', 'bool', [...BOUND, 'optionButton', 'commandButton', 'subform'], true),
  p('Locked', 'data', 'bool', [...BOUND, 'subform'], false),
  p('OptionValue', 'data', 'number', ['optionButton', 'checkBox'], undefined, { integer: true }), // inside an option group
  p('SourceObject', 'data', 'objectName', ['subform'], ''),
  p('LinkMasterFields', 'data', 'fieldList', ['subform'], ''),
  p('LinkChildFields', 'data', 'fieldList', ['subform'], ''),
  // A4 additions (only the names the foundation lacked). Left/Top/Height mirror ControlDef/SectionDef fields; Pages has no default (readers use ?? []);
  // PageIndex is deliberately not a descriptor (an internal key of a control placed on a tab page).
  p('RecordSelectors', 'format', 'bool', ['form'], true),
  p('Left', 'format', 'twips', [...CONTROL_KINDS]),
  p('Top', 'format', 'twips', [...CONTROL_KINDS]),
  p('Height', 'format', 'twips', [...SECTION_KINDS, ...CONTROL_KINDS]),
  p('Picture', 'format', 'picture', ['image']),
  p('SizeMode', 'format', 'enum', ['image'], 'zoom', { options: ['clip', 'stretch', 'zoom'] }),
  p('LineSlant', 'format', 'bool', ['line'], false),
  p('Pages', 'format', 'textList', ['tabControl']),
  p('Name', 'other', 'text', [...CONTROL_KINDS]),
  p('TabStop', 'other', 'bool', [...INPUTS, 'subform'], true),
  p('TabIndex', 'other', 'number', [...INPUTS, 'subform'], undefined, { min: 0, integer: true }),
  p('ControlTipText', 'other', 'text', [...CONTROL_KINDS]),
  p('StatusBarText', 'other', 'text', INPUTS),
  // Events (A4: read-only, proprietes.md section 9; B2: the closed list of events.ts, rulings R2); one descriptor per name, targets as in Access.
  // OnLoad and OnCurrent fire in a report's Report view only, which BaseCraft does not have: forms only.
  p('OnOpen', 'event', 'event', ['form', 'report']),
  p('OnLoad', 'event', 'event', ['form']),
  p('OnCurrent', 'event', 'event', ['form']),
  p('OnClose', 'event', 'event', ['form', 'report']),
  p('BeforeInsert', 'event', 'event', ['form']),
  p('AfterInsert', 'event', 'event', ['form']),
  p('BeforeUpdate', 'event', 'event', ['form', ...BOUND, 'optionButton'], undefined, FORM_ONLY),
  p('AfterUpdate', 'event', 'event', ['form', ...BOUND, 'optionButton'], undefined, FORM_ONLY),
  p('OnDelete', 'event', 'event', ['form']),
  p('OnClick', 'event', 'event', ['form', ...CLICKABLE], undefined, FORM_ONLY),
  p('OnDblClick', 'event', 'event', ['form', ...CLICKABLE], undefined, FORM_ONLY),
  p('OnEnter', 'event', 'event', FOCUSABLE, undefined, FORM_ONLY),
  p('OnExit', 'event', 'event', FOCUSABLE, undefined, FORM_ONLY),
  p('OnGotFocus', 'event', 'event', GOT_FOCUS, undefined, FORM_ONLY),
  p('OnLostFocus', 'event', 'event', GOT_FOCUS, undefined, FORM_ONLY),
  p('OnChange', 'event', 'event', ['textBox', 'comboBox', 'tabControl'], undefined, FORM_ONLY),
  p('OnNoData', 'event', 'event', ['report']),
  p('OnFormat', 'event', 'event', REPORT_SECTIONS, undefined, { objects: ['report'] }),
  p('OnPrint', 'event', 'event', REPORT_SECTIONS, undefined, { objects: ['report'] }),
];

export const propertiesFor = (target: PropertyTarget): PropertyDescriptor[] => PROPERTY_CATALOG.filter((x) => x.appliesTo.includes(target));

/** The effective value of a property: the stored one, else the most specific default (undefined for a name outside the catalog). */
export function effectiveProp(props: Record<string, unknown>, name: string, target: PropertyTarget, objectKind?: 'form' | 'report'): unknown {
  const d = PROPERTY_CATALOG.find((x) => x.name === name);
  if (!d) return undefined;
  return (Object.hasOwn(props, name) ? props[name] : undefined) ?? defaultFor(d, target, objectKind);
}
