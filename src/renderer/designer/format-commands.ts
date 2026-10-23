// Ruban › Format (formulaires A4, états A5) : chaque commande écrit des propriétés du catalogue sur les contrôles sélectionnés
// auxquels elles s'appliquent (setProp ; plusieurs écritures = une seule annulation). Sans contrôle qui convienne : rien.
import type { ColorValue } from '../../shared/design/colors';
import type { ControlKind, DesignDoc } from '../../shared/design/model';
import { effectiveProp, PROPERTY_CATALOG } from '../../shared/design/properties';
import type { CommandHandlers } from '../shell/ribbon-model';
import { designerReducer, documentKind, findControl, initDesigner, type DesignerAction, type DesignerState, type PropTarget, type Selection } from './designer-model';

export type FormatCommand = 'bold' | 'italic' | 'underline' | 'alignLeft' | 'alignCenter' | 'alignRight'
  | 'currencyFormat' | 'percentFormat' | 'commaFormat' | 'increaseDecimals' | 'decreaseDecimals';
/** Les commandes qui ouvrent un menu sous leur bouton (format-popup-<id>). */
export type FormatPopupId = 'objectList' | 'font' | 'fontSize' | 'fontColor' | 'backColor' | 'format' | 'shapeFill' | 'shapeOutline';

const FORMAT_COMMANDS: FormatCommand[] = ['bold', 'italic', 'underline', 'alignLeft', 'alignCenter', 'alignRight',
  'currencyFormat', 'percentFormat', 'commaFormat', 'increaseDecimals', 'decreaseDecimals'];
const POPUPS: FormatPopupId[] = ['objectList', 'font', 'fontSize', 'fontColor', 'backColor', 'format', 'shapeFill', 'shapeOutline'];
const MAX_DECIMALS = 15;

type Write = { targets: PropTarget[]; name: string; value: unknown };
type Target = { t: PropTarget; props: Record<string, unknown>; kind: ControlKind };

/** Les contrôles sélectionnés auxquels `name` s'applique, dans l'ordre de la sélection. */
function targetsFor(doc: DesignDoc, sel: Selection, name: string): Target[] {
  if (sel.kind !== 'controls') return [];
  const applies = PROPERTY_CATALOG.find((d) => d.name === name)?.appliesTo ?? [];
  return sel.names.flatMap((n) => {
    const c = findControl(doc, n)?.control;
    return c && applies.includes(c.kind) ? [{ t: { kind: 'control' as const, name: c.name }, props: c.props, kind: c.kind }] : [];
  });
}
const read = (x: Target, name: string, docKind: 'form' | 'report') => effectiveProp(x.props, name, x.kind, docKind);

/** La valeur de `name` commune à tous les contrôles sélectionnés auxquels elle s'applique (le choix coché d'un menu) ;
 *  undefined sans cible ou quand elles diffèrent. */
export function currentValue(doc: DesignDoc, docKind: 'form' | 'report', sel: Selection, name: string): unknown {
  const values = targetsFor(doc, sel, name).map((x) => read(x, name, docKind));
  return values.length && values.every((v) => Object.is(v, values[0])) ? values[0] : undefined;
}

/** Une écriture : setProp ; plusieurs : un seul `edit` qui les rejoue par le réducteur (une seule annulation) ; aucune : null. */
function writes(list: Write[], docKind: 'form' | 'report'): DesignerAction | null {
  const ws = list.filter((w) => w.targets.length);
  if (!ws.length) return null;
  if (ws.length === 1) return { type: 'setProp', ...ws[0] };
  return { type: 'edit', apply: (d) => ws.reduce((x, w) => designerReducer(initDesigner(x, docKind), { type: 'setProp', ...w }).doc, d) };
}

export function selectionSet(doc: DesignDoc, docKind: 'form' | 'report', sel: Selection, values: Record<string, unknown>): DesignerAction | null {
  return writes(Object.entries(values).map(([name, value]) => ({ targets: targetsFor(doc, sel, name).map((x) => x.t), name, value })), docKind);
}

/** 'auto' compte pour 2 ; borné à '0'…'15' (les options du catalogue, en chaînes). */
export function decimalStep(current: unknown, delta: 1 | -1): string {
  const n = Number(current);
  const from = current === 'auto' || current === '' || current === null || current === undefined || !Number.isFinite(n) ? 2 : n;
  return String(Math.min(Math.max(Math.round(from) + delta, 0), MAX_DECIMALS));
}

const SET: Partial<Record<FormatCommand, [string, unknown]>> = {
  alignLeft: ['TextAlign', 'left'], alignCenter: ['TextAlign', 'center'], alignRight: ['TextAlign', 'right'],
  currencyFormat: ['Format', 'currency'], percentFormat: ['Format', 'percent'], commaFormat: ['Format', 'standard'],
};
const TOGGLE: Partial<Record<FormatCommand, [string, unknown, unknown]>> = {   // propriété, valeur active, valeur inactive
  bold: ['FontWeight', 'bold', 'normal'], italic: ['FontItalic', true, false], underline: ['FontUnderline', true, false],
};

export function formatAction(doc: DesignDoc, docKind: 'form' | 'report', sel: Selection, cmd: FormatCommand): DesignerAction | null {
  const set = SET[cmd];
  if (set) return selectionSet(doc, docKind, sel, { [set[0]]: set[1] });
  const toggle = TOGGLE[cmd];
  if (toggle) {
    const [name, on, offValue] = toggle;
    const ts = targetsFor(doc, sel, name);
    return writes([{ targets: ts.map((x) => x.t), name, value: ts.every((x) => read(x, name, docKind) === on) ? offValue : on }], docKind);
  }
  // décimales : chaque contrôle depuis sa propre valeur, groupés par résultat
  const by = new Map<string, PropTarget[]>();
  for (const x of targetsFor(doc, sel, 'DecimalPlaces')) {
    const v = decimalStep(read(x, 'DecimalPlaces', docKind), cmd === 'increaseDecimals' ? 1 : -1);
    by.set(v, [...(by.get(v) ?? []), x.t]);
  }
  return writes([...by].map(([value, targets]) => ({ targets, name: 'DecimalPlaces', value })), docKind);
}

/** Contour : la couleur de bordure, et une bordure transparente devient pleine (sinon la couleur ne se verrait pas). */
export function outlineAction(doc: DesignDoc, docKind: 'form' | 'report', sel: Selection, color: ColorValue): DesignerAction | null {
  const ts = targetsFor(doc, sel, 'BorderColor');
  const hidden = ts.filter((x) => read(x, 'BorderStyle', docKind) === 'transparent');
  return writes([{ targets: ts.map((x) => x.t), name: 'BorderColor', value: color }, { targets: hidden.map((x) => x.t), name: 'BorderStyle', value: 'solid' }], docKind);
}

/** Couleur d'arrière-plan : BackColor, et un fond transparent devient normal (la zone de texte d'un état l'est par défaut). */
export function fillAction(doc: DesignDoc, docKind: 'form' | 'report', sel: Selection, color: ColorValue): DesignerAction | null {
  const ts = targetsFor(doc, sel, 'BackColor');
  const hidden = ts.filter((x) => read(x, 'BackStyle', docKind) === 'transparent');
  return writes([{ targets: ts.map((x) => x.t), name: 'BackColor', value: color }, { targets: hidden.map((x) => x.t), name: 'BackStyle', value: 'normal' }], docKind);
}

/** À fusionner dans l'unique `registerCommands` de la vue hôte : les commandes directes agissent sur l'état courant (`current`),
 *  les autres ouvrent leur menu (`openPopup`, voir FormatPopup). Sans contrôle sélectionné (`selected`, comme designerCommands),
 *  seuls Objet et Sélectionner tout sont enregistrés : le ruban désactive les autres. */
export function formatCommands(current: () => DesignerState, dispatch: (a: DesignerAction) => void, openPopup: (id: FormatPopupId) => void,
  selected: number): CommandHandlers {
  const h: CommandHandlers = { selectAll: () => dispatch({ type: 'selectAll' }), objectList: () => openPopup('objectList') };
  if (!selected) return h;
  for (const id of POPUPS) h[id] = () => openPopup(id);
  for (const cmd of FORMAT_COMMANDS) {
    h[cmd] = () => { const s = current(); const a = formatAction(s.doc, documentKind(s), s.selection, cmd); if (a) dispatch(a); };
  }
  return h;
}
