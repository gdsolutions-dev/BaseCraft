// Modèle de conception partagé des formulaires (A4) et des états (A5) : contrat A3/A4/A5, section 1.3. Module pur.
import { isValidObjectName, sameName } from '../field-types';
import type { RecordSourceRef } from '../record-source';

export type Unit = 'twip';   // stockage en twips (1 cm = 567), affichage en cm
export type SectionKind = 'formHeader' | 'detail' | 'formFooter'
  | 'reportHeader' | 'pageHeader' | 'groupHeader' | 'groupFooter' | 'pageFooter' | 'reportFooter';
export type ControlKind = 'label' | 'textBox' | 'checkBox' | 'optionGroup' | 'optionButton' | 'comboBox' | 'listBox'
  | 'commandButton' | 'subform' | 'image' | 'line' | 'rectangle' | 'pageBreak' | 'tabControl';
export interface ControlDef { kind: ControlKind; name: string; left: number; top: number; width: number; height: number;
  props: Record<string, unknown>;   // noms invariants (ControlSource, Format, Visible…), valeurs canoniques
  children?: ControlDef[] }         // groupe d'options, onglet
export interface SectionDef { kind: SectionKind; height: number; props: Record<string, unknown>; controls: ControlDef[]; groupLevel?: number }
export interface DesignDoc { formatVersion: '1.0'; recordSource: RecordSourceRef | null; props: Record<string, unknown>; sections: SectionDef[] }

export const SECTION_KINDS: readonly SectionKind[] = ['formHeader', 'detail', 'formFooter', 'reportHeader', 'pageHeader', 'groupHeader', 'groupFooter',
  'pageFooter', 'reportFooter'];
export const CONTROL_KINDS: readonly ControlKind[] = ['label', 'textBox', 'checkBox', 'optionGroup', 'optionButton', 'comboBox', 'listBox',
  'commandButton', 'subform', 'image', 'line', 'rectangle', 'pageBreak', 'tabControl'];

export const TWIPS_PER_CM = 567;
export const twipsToCm = (twips: number): number => twips / TWIPS_PER_CM;
export const cmToTwips = (cm: number): number => Math.round(cm * TWIPS_PER_CM);
/** Every control of a list, each followed by its children (a tab control's, an option group's), at any depth. */
export const flattenControls = (list: ControlDef[]): ControlDef[] => list.flatMap((c) => [c, ...flattenControls(c.children ?? [])]);

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isUint = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0; // twips, group level
const isRef = (v: unknown) => isObj(v) && (
  ((v.kind === 'table' || v.kind === 'query') && typeof v.name === 'string') || (v.kind === 'sql' && typeof v.sql === 'string'));

/**
 * Structure of a form or report document: the paths of what is wrong (`sections[0].controls[2].kind`), [] when valid.
 * Unknown keys are allowed and never removed (minor-version compatibility); property values are not checked here.
 */
export function validateDesignDoc(doc: unknown): string[] {
  if (!isObj(doc)) return ['$'];
  const errors: string[] = [];
  const names: string[] = [];
  if (doc.formatVersion !== '1.0') errors.push('formatVersion');
  if (doc.recordSource !== null && !isRef(doc.recordSource)) errors.push('recordSource');
  if (!isObj(doc.props)) errors.push('props');

  const control = (c: unknown, at: string): void => {
    if (!isObj(c)) { errors.push(at); return; }
    if (!CONTROL_KINDS.includes(c.kind as ControlKind)) errors.push(`${at}.kind`);
    if (typeof c.name !== 'string' || !isValidObjectName(c.name) || names.some((n) => sameName(n, c.name as string))) errors.push(`${at}.name`);
    else names.push(c.name);
    for (const k of ['left', 'top', 'width', 'height']) if (!isUint(c[k])) errors.push(`${at}.${k}`);
    if (!isObj(c.props)) errors.push(`${at}.props`);
    if (c.children !== undefined) {
      if (Array.isArray(c.children)) c.children.forEach((x, i) => control(x, `${at}.children[${i}]`));
      else errors.push(`${at}.children`);
    }
  };

  if (!Array.isArray(doc.sections)) errors.push('sections');
  else doc.sections.forEach((s: unknown, i) => {
    const at = `sections[${i}]`;
    if (!isObj(s)) { errors.push(at); return; }
    if (!SECTION_KINDS.includes(s.kind as SectionKind)) errors.push(`${at}.kind`);
    if (!isUint(s.height)) errors.push(`${at}.height`);
    if (s.groupLevel !== undefined && !isUint(s.groupLevel)) errors.push(`${at}.groupLevel`);
    if (!isObj(s.props)) errors.push(`${at}.props`);
    if (Array.isArray(s.controls)) s.controls.forEach((c, j) => control(c, `${at}.controls[${j}]`));
    else errors.push(`${at}.controls`);
  });
  return errors;
}
