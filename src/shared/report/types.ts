// Types du moteur d'états (pur) : police et bordure d'un contrôle, modèle de page (LaidOutReport), environnement de mise en
// page et points d'accroche des événements (étape B).
import type { SqlValue } from '../coerce';
import type { SectionKind } from '../design/model';
import type { Value } from '../expr/ast';
import type { SourceField } from '../record-source';
import type { ReportIssue, ReportSpec } from './model';
import type { PictureAlignment, PictureSpec } from '../design/picture-css';
import type { ChartFormat } from '../chart/option';
import type { ChartPalette } from '../chart/palette';
import type { ChartData } from '../chart/query';
import type { ChartSpec } from '../chart/spec';

/** A font as typed in a property sheet; `name` may be any font, portable or not. */
export interface FontSpec { name: string /* nom saisi */; size: number /* pt */; bold: boolean; italic: boolean; underline: boolean }

export interface Border { width: number /* twips */; color: string; style: 'solid' | 'dashed' | 'dotted' }

/** The gridlines of a control (a side null: none) over its cell rectangle: the control grown by its own padding (twips). */
export interface Gridlines { top: Border | null; right: Border | null; bottom: Border | null; left: Border | null;
  padding: { top: number; right: number; bottom: number; left: number } }

/** A drawn control, in twips relative to its band. A text line's `x`/`y` are relative to the box inside the border. */
export type LaidOutItem =
  | { kind: 'text'; name: string; left: number; top: number; width: number; height: number; font: FontSpec; color: string; back: string | null;
      border: Border | null; align: 'left' | 'center' | 'right'; lines: { text: string; x: number; y: number; width: number }[]; grid?: Gridlines;
      /** A Rich Text value: its HTML (sanitized when drawn), drawn instead of `lines`, which only measured it; inset = the control margins [top, right, bottom, left] */
      rich?: { html: string; inset: [number, number, number, number] } }
  | { kind: 'check'; name: string; left: number; top: number; width: number; height: number; checked: boolean | null; color: string; grid?: Gridlines }
  | { kind: 'line'; name: string; x1: number; y1: number; x2: number; y2: number; border: Border }
  | { kind: 'rect'; name: string; left: number; top: number; width: number; height: number; border: Border | null; back: string | null; grid?: Gridlines }
  | { kind: 'image'; name: string; left: number; top: number; width: number; height: number; src: string; sizeMode: 'clip' | 'stretch' | 'zoom'; pictureAlign?: PictureAlignment; tiling?: true; grid?: Gridlines }
  /** Graphique : dessiné en SVG par le rendu (chartSvg) ; `fontFamily` : la police embarquée de la palette (déclarée par reportCss). */
  | { kind: 'chart'; name: string; left: number; top: number; width: number; height: number; spec: ChartSpec; data: ChartData | null;
      format: ChartFormat; palette: ChartPalette; fontFamily: string; /** La police embarquée du titre (TitleFontName), déclarée en normal et en gras. */ titleFamily: string; /** L'aide imprimée quand rien ne se trace (ex. nuage de points sur un X texte). */ hint?: string };
export interface LaidOutBand { section: SectionKind; groupLevel?: number; top: number; left: number; width: number; height: number;
  back: string | null; repeated?: true; continued?: true; items: LaidOutItem[] }
export interface LaidOutPage { number: number; bands: LaidOutBand[] }
export interface LaidOutReport { background?: PictureSpec; width: number; height: number; pages: LaidOutPage[]; issues: ReportIssue[] }
export interface ReportData { fields: SourceField[]; rows: SqlValue[][] }
/** `flow`: one unbounded page (Layout view): no page breaks, Keep Together or Force New Page; the Page Header once after the
 *  Report Header, the Page Footer once after the Report Footer; [Page] and [Pages] read 1; the height is the content's. */
export interface LayoutOpts { flow?: boolean }
export interface LayoutEnv { locale: string; lang: 'fr' | 'en'; fourDigitYear?: boolean; now(): Date; errorText: { error: string; name: string };
  /** Libellés des graphiques (titre par défaut, catégorie vide) dans la langue de l'interface. */
  chartLabels?: import('../chart/option').ChartLabels;
  hooks?: LayoutHooks; signal?: AbortSignal; tick?(): Promise<void>;
  /** [Forms]! / [Reports]! / [TempVars]! in the report's own expressions (absent: unknownField, #Nom?). */
  member?(path: string[]): Value | Promise<Value>;
  /** D3: Python functions in the report's expressions (absent: badArgument, #Erreur). */
  callUser?(name: string, args: Value[]): Promise<Value>;
  /** The pages laid out so far (one array, growing), after each page of a pass whose count is known; a third pass starts a new array. */
  onPage?(pages: LaidOutPage[]): void;
  /** A subreport's Source Object: its definition and every row of its source; null when it cannot be read (absent: a
   *  subreport is an empty frame). */
  subreport?(name: string, signal?: AbortSignal): Promise<SubreportSource | null>;
  /** The reports being laid out, outermost first: a subreport never holds one of them. */
  subPath?: string[] }
export interface SubreportSource { spec: ReportSpec; data: ReportData }
/** A subreport laid out for one row of its master: items relative to the inside of its control, and the content's height. */
export interface SubLayout { height: number; items: LaidOutItem[]; issues: ReportIssue[] }
export interface SectionEvent { section: SectionKind; groupLevel?: number; formatCount: number; page: number;
  values: Record<string, Value>;          // valeur de chaque contrôle lié, modifiable
  visible: Record<string, boolean>;       // modifiable
  sectionVisible: boolean; cancel: boolean; height: number /* twips, modifiable dans onFormat */
  field(name: string): Value }            // a field of the band's row (Null outside a row); unknown: ExprRuntimeError unknownField
/** The report's On Format / On Print (B2): a layout without them is the same, byte for byte, as with none. */
export interface LayoutHooks { onFormat?(e: SectionEvent): Promise<void>; onPrint?(e: SectionEvent): Promise<void>;
  /** The band about to be formatted, before its values are read (changes nothing: the counting pass keeps its shortcut). */
  onBand?(e: SectionEvent): void }

/** A failure with no `dialog.error` text: the preview and the print show `report.<code>` (and the invalid paths). */
export class ReportLoadError extends Error {
  constructor(readonly code: 'invalidDefinition' | 'tooManyPages' | 'tooLarge', readonly list?: string[]) { super(`bc:${code}`); }
}
