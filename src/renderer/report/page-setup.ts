// Mise en page depuis le ruban (pur) : préréglages de la galerie Marges, préréglage coché, écriture de props.pageSetup.
import type { DesignDoc } from '../../shared/design/model';
import { readReport, reportWidth, type ColumnSetup, type PageSetup } from '../../shared/report/model';

/** La galerie Marges d'Access, relevée sur Access (1" = 1440 twips) : Normales 0,75" en haut et en bas, 0,35" sur les côtés ;
 *  Larges 1" en haut et en bas, 0,75" sur les côtés ; Étroites 0,25" partout. */
export const MARGIN_PRESETS: Record<'normal' | 'wide' | 'narrow', PageSetup['margins']> = {
  normal: { top: 1080, right: 504, bottom: 1080, left: 504 },
  wide: { top: 1440, right: 1080, bottom: 1440, left: 1080 },
  narrow: { top: 360, right: 360, bottom: 360, left: 360 },
};

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const sameMargins = (a: PageSetup['margins'], b: PageSetup['margins']) => SIDES.every((s) => a[s] === b[s]);

/** L'élément coché du menu Marges ; null : des marges personnalisées. */
export function marginPreset(p: PageSetup): 'normal' | 'wide' | 'narrow' | null {
  return (Object.keys(MARGIN_PRESETS) as (keyof typeof MARGIN_PRESETS)[]).find((k) => sameMargins(p.margins, MARGIN_PRESETS[k])) ?? null;
}

/** props.pageSetup = la mise en page lue (readReport) + `patch` ; le même document quand elle ne change pas, quoi qu'il soit stocké
 *  (pas d'annulation à vide, pas de modification : les défauts ne sont pas écrits). */
export function withPageSetup(doc: DesignDoc, patch: Partial<PageSetup>): DesignDoc {
  const cur = readReport(doc, []).page;
  const dataOnly = 'dataOnly' in patch ? patch.dataOnly : cur.dataOnly;   // true or absent
  const next: PageSetup = { orientation: patch.orientation ?? cur.orientation, paper: patch.paper ?? cur.paper, margins: { ...(patch.margins ?? cur.margins) },
    ...(dataOnly ? { dataOnly } : {}) };
  if (next.orientation === cur.orientation && next.paper === cur.paper && sameMargins(next.margins, cur.margins) && !next.dataOnly === !cur.dataOnly) return doc;
  return { ...doc, props: { ...doc.props, pageSetup: next } };
}

/** props.columns = the columns (Page Setup > Columns) ; the same document when they do not change. */
export function withColumns(doc: DesignDoc, cols: ColumnSetup): DesignDoc {
  const cur = readReport(doc, []).columns;
  if (cur.count === cols.count && cur.spacing === cols.spacing && cur.across === cols.across && cur.width === cols.width && cur.height === cols.height
    && cur.rowSpacing === cols.rowSpacing) return doc;
  return { ...doc, props: { ...doc.props, columns: { ...cols } } };
}

/** What the Page Setup box shows and returns: its tab, the page and columns, the report's width and Detail height (twips, read only in
 *  the Columns tab); Data Only travels in `page`. */
export interface PageSetupInput { tab: 'options' | 'page' | 'columns'; page: PageSetup; columns: ColumnSetup; width: number; detailHeight: number }
export interface PageSetupChoice { page: PageSetup; columns: ColumnSetup }

export function setupInput(doc: DesignDoc, tab: PageSetupInput['tab']): PageSetupInput {
  const r = readReport(doc, []);
  return { tab, page: r.page, columns: r.columns, width: reportWidth(doc), detailHeight: doc.sections.find((s) => s.kind === 'detail')?.height ?? 0 };
}

/** The page and the columns of the box, in one definition (the same document when neither changes). */
export function withSetup(doc: DesignDoc, c: PageSetupChoice): DesignDoc {
  return withColumns(withPageSetup(doc, c.page), c.columns);
}

/** Portrait and Landscape pressed as the page is (registerCommandStates; Page Setup tab and Print Preview). */
export const orientationStates = (o: PageSetup['orientation']) => ({ portrait: { active: o === 'portrait' }, landscape: { active: o === 'landscape' } });
