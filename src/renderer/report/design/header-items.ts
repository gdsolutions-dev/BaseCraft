// En-tête et pied d'un état (pur) : Logo, Titre, Date et heure dans l'en-tête d'état, Numéros de page dans l'en-tête ou le pied
// de page ; la paire de sections est créée quand elle manque. Seules des valeurs de mise en page sont écrites (C5).
import type { ControlDef, DesignDoc } from '../../../shared/design/model';
import { GAP, STAMP } from '../../../shared/report/instant';
import { reportWidth } from '../../../shared/report/model';
import { uniqueName } from '../../designer/designer-model';
import { intersects } from '../../designer/geometry';
import { MAX_TWIPS } from '../../designer/units';
import { placeControls, topBelow, withSections } from './report-sections';

const LOGO = 851, TITLE_WIDTH = 4535, HEIGHT = 340;   // logo 1,5 cm ; titre 8 cm ; date et heure (GAP, STAMP) : ceux de l'état instantané

const isTitle = (c: ControlDef) => c.kind === 'label' && /^Titre\d*$/i.test(c.name);
const DATE = '=Date()', TIME = '=Time()';
const byStamp = (list: ControlDef[], source: string) => list.find((c) => c.kind === 'textBox' && c.props.ControlSource === source);

/** Les contrôles de l'élément déjà présents dans l'en-tête d'état : le titre (une étiquette Titre, Titre1…), la date et l'heure
 *  (les zones de texte =Date() et =Time()) ; la vue les sélectionne au lieu d'en empiler une copie. */
export function headerItemControls(doc: DesignDoc, item: 'title' | 'dateTime'): string[] {
  const list = doc.sections.find((s) => s.kind === 'reportHeader')?.controls ?? [];
  if (item === 'title') return list.filter(isTitle).map((c) => c.name);
  return [byStamp(list, DATE), byStamp(list, TIME)].flatMap((c) => (c ? [c.name] : []));
}

/** Logo : une image de 1,5 × 1,5 cm à gauche (Picture = data URL ; SizeMode zoom = le défaut du catalogue), le titre qu'elle
 *  recouvrirait passe après elle ; Titre : une étiquette après le logo (Caption = ctx.title, 18 pt gras, comme l'état instantané) ;
 *  Date et heure : deux zones de texte à droite. Un titre déjà là, ou la date et l'heure déjà là : le même document (seul ce qui
 *  manque est ajouté). */
export function reportHeaderItem(doc: DesignDoc, item: 'logo' | 'title' | 'dateTime', ctx: { title: string; picture?: string }): DesignDoc {
  if (item !== 'logo' && headerItemControls(doc, item).length >= (item === 'title' ? 1 : 2)) return doc;
  let d = withSections(doc, ['reportHeader', 'reportFooter']);
  const index = d.sections.findIndex((s) => s.kind === 'reportHeader');
  const header = d.sections[index]!;
  let controls: ControlDef[];
  if (item === 'logo') {
    const logo: ControlDef = { kind: 'image', name: uniqueName(d, 'Auto_Logo'), left: 0, top: GAP, width: LOGO, height: LOGO, props: ctx.picture ? { Picture: ctx.picture } : {} };
    const after = logo.left + logo.width + GAP;
    if (header.controls.some((c) => isTitle(c) && intersects(c, logo))) {
      d = { ...d, sections: d.sections.map((s, i) => (i !== index ? s
        : { ...s, controls: s.controls.map((c) => (isTitle(c) && intersects(c, logo) ? { ...c, left: Math.min(after, MAX_TWIPS - c.width) } : c)) })) };
    }
    controls = [logo];
  } else if (item === 'title') {
    const left = Math.max(0, ...header.controls.filter((c) => c.kind === 'image').map((c) => c.left + c.width + GAP));
    controls = [{ kind: 'label', name: uniqueName(d, 'Titre'), left, top: 283, width: TITLE_WIDTH, height: 567, props: { Caption: ctx.title, FontSize: 18, FontWeight: 'bold' } }];
  } else {
    const left = Math.max(0, reportWidth(d) - STAMP);
    controls = [
      ...(byStamp(header.controls, DATE) ? [] : [{ kind: 'textBox', name: uniqueName(d, 'Auto_Date'), left, top: GAP, width: STAMP, height: HEIGHT,
        props: { ControlSource: DATE, Format: 'longDate', TextAlign: 'right' } } satisfies ControlDef]),
      ...(byStamp(header.controls, TIME) ? [] : [{ kind: 'textBox', name: uniqueName(d, 'Auto_Heure'), left, top: 454, width: STAMP, height: HEIGHT,
        props: { ControlSource: TIME, Format: 'longTime', TextAlign: 'right' } } satisfies ControlDef]),
    ];
  }
  return placeControls(d, index, controls);
}

export interface PageNumberOptions { format: 'pageN' | 'pageNofM'; position: 'top' | 'bottom'; align: 'left' | 'center' | 'right'; firstPage: boolean; lang: 'fr' | 'en' }

/** Numéros de page (boîte 5090 d'Access, docs/analyse-access/interface.md : « Page N · Page N sur M · Haut de page [En-tête] ·
 *  Bas de page [Pied de page] · Alignement · Afficher le numéro sur la première page » ; Intérieur/Extérieur laissés de côté).
 *  L'inventaire relève les libellés de la boîte, pas la source qu'elle écrit : « "Page " & [Page] & " sur " & [Pages] » est celle de
 *  l'état instantané (instant.ts) ; la première page masquée par IIf([Page]=1,Null,…) vient du plan A5 (tâche 13) — à vérifier sur Access.
 *  Une zone de texte de la largeur de l'état, sous les contrôles déjà présents de la section (la paire est créée si elle manque). */
export function insertPageNumbers(doc: DesignDoc, o: PageNumberOptions): DesignDoc {
  const d = withSections(doc, ['pageHeader', 'pageFooter']);
  const index = d.sections.findIndex((s) => s.kind === (o.position === 'top' ? 'pageHeader' : 'pageFooter'));
  const s = d.sections[index]!;
  const text = o.format === 'pageN' ? '"Page " & [Page]' : `"Page " & [Page] & "${o.lang === 'fr' ? ' sur ' : ' of '}" & [Pages]`;
  return placeControls(d, index, [{ kind: 'textBox', name: uniqueName(d, 'Numéro_Page'), left: 0, top: topBelow(s), width: reportWidth(d), height: HEIGHT,
    props: { ControlSource: `=${o.firstPage ? text : `IIf([Page]=1,Null,${text})`}`, TextAlign: o.align } }]);
}
