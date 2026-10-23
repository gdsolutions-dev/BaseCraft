// Mise en page depuis le ruban (pur) : préréglages de la galerie Marges, préréglage coché, écriture de props.pageSetup.
import type { DesignDoc } from '../../shared/design/model';
import { readReport, type PageSetup } from '../../shared/report/model';

/** La galerie Marges d'Access (PageMarginsGallery, docs/analyse-access/interface.md § Mise en page) : ses valeurs n'y sont pas
 *  relevées ; elles viennent du plan A5 (tâche 12) : Normales 0,75" partout, Larges 1" en haut et en bas et 0,75" sur les côtés,
 *  Étroites 0,25" partout (1" = 1440 twips). À vérifier sur Access avant la recette. */
export const MARGIN_PRESETS: Record<'normal' | 'wide' | 'narrow', PageSetup['margins']> = {
  normal: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
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
  const next: PageSetup = { orientation: patch.orientation ?? cur.orientation, margins: { ...(patch.margins ?? cur.margins) } };
  if (next.orientation === cur.orientation && sameMargins(next.margins, cur.margins)) return doc;
  return { ...doc, props: { ...doc.props, pageSetup: next } };
}

/** Portrait and Landscape pressed as the page is (registerCommandStates; Page Setup tab and Print Preview). */
export const orientationStates = (o: PageSetup['orientation']) => ({ portrait: { active: o === 'portrait' }, landscape: { active: o === 'landscape' } });
