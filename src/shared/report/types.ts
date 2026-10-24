// Types du moteur d'états (pur) : police et bordure d'un contrôle, modèle de page (LaidOutReport), environnement de mise en
// page et points d'accroche des événements (étape B).
import type { SqlValue } from '../coerce';
import type { SectionKind } from '../design/model';
import type { Value } from '../expr/ast';
import type { SourceField } from '../record-source';
import type { ReportIssue } from './model';

/** A font as typed in a property sheet; `name` may be any font, portable or not. */
export interface FontSpec { name: string /* nom saisi */; size: number /* pt */; bold: boolean; italic: boolean; underline: boolean }

export interface Border { width: number /* twips */; color: string; style: 'solid' | 'dashed' | 'dotted' }

/** A drawn control, in twips relative to its band. A text line's `x`/`y` are relative to the box inside the border. */
export type LaidOutItem =
  | { kind: 'text'; name: string; left: number; top: number; width: number; height: number; font: FontSpec; color: string; back: string | null;
      border: Border | null; align: 'left' | 'center' | 'right'; lines: { text: string; x: number; y: number; width: number }[] }
  | { kind: 'check'; name: string; left: number; top: number; width: number; height: number; checked: boolean | null; color: string }
  | { kind: 'line'; name: string; x1: number; y1: number; x2: number; y2: number; border: Border }
  | { kind: 'rect'; name: string; left: number; top: number; width: number; height: number; border: Border | null; back: string | null }
  | { kind: 'image'; name: string; left: number; top: number; width: number; height: number; src: string; sizeMode: 'clip' | 'stretch' | 'zoom' };
export interface LaidOutBand { section: SectionKind; groupLevel?: number; top: number; left: number; width: number; height: number;
  back: string | null; repeated?: true; continued?: true; items: LaidOutItem[] }
export interface LaidOutPage { number: number; bands: LaidOutBand[] }
export interface LaidOutReport { width: number; height: number; pages: LaidOutPage[]; issues: ReportIssue[] }
export interface ReportData { fields: SourceField[]; rows: SqlValue[][] }
export interface LayoutEnv { locale: string; lang: 'fr' | 'en'; now(): Date; errorText: { error: string; name: string };
  hooks?: LayoutHooks; signal?: AbortSignal; tick?(): Promise<void>;
  /** The pages laid out so far (one array, growing), after each page of a pass whose count is known; a third pass starts a new array. */
  onPage?(pages: LaidOutPage[]): void }
export interface SectionEvent { section: SectionKind; groupLevel?: number; formatCount: number; page: number;
  values: Record<string, Value>;          // valeur de chaque contrôle lié, modifiable
  visible: Record<string, boolean>;       // modifiable
  sectionVisible: boolean; cancel: boolean; height: number /* twips, modifiable dans onFormat */ }
export interface LayoutHooks { onFormat?(e: SectionEvent): Promise<void>; onPrint?(e: SectionEvent): Promise<void> }   // étape B : jamais fournis en A5

/** A failure with no `dialog.error` text: the preview and the print show `report.<code>` (and the invalid paths). */
export class ReportLoadError extends Error {
  constructor(readonly code: 'invalidDefinition' | 'tooManyPages' | 'tooLarge', readonly list?: string[]) { super(`bc:${code}`); }
}
