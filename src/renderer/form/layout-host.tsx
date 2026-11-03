// Mode Page (L2) : l'hôte des formulaires dont les contrôles montrent l'enregistrement courant (live-records), et le choix de
// l'hôte et des gestes selon le mode de l'onglet. Création ↔ Page garde le même concepteur : seuls l'hôte et les gestes changent.
import type { ReactNode } from 'react';
import { flattenControls, type ControlDef, type DesignDoc, type SectionDef } from '../../shared/design/model';
import type { DesignerHost } from '../designer/Designer';
import { FORM_LAYOUT_RESTRICT, type DesignerRestrict } from '../designer/designer-restrict';
import type { DocMode } from '../state/app-state';
import { preview } from './form-host';
import { fourDigitYear } from '../settings-store';
import { liveContent, type LiveData } from './live-records';
import { initialView } from './views';

const cache = new WeakMap<DesignerHost, WeakMap<LiveData, Map<string, DesignerHost>>>();

/** L'hôte `base` dont `renderControl` montre l'enregistrement `row` de `data`. Le même objet pour les mêmes (base, data, row, continuous) ;
 *  un autre quand l'enregistrement ou les données changent : les contrôles mémoïsés du canevas se redessinent. Formulaire continu :
 *  les copies du Détail montrent les enregistrements suivants (copie k = enregistrement row + k), la fenêtre suit la navigation. */
export function layoutHost(base: DesignerHost, data: LiveData, row: number, continuous = false): DesignerHost {
  let byData = cache.get(base);
  if (!byData) cache.set(base, byData = new WeakMap());
  let byRow = byData.get(data);
  if (!byRow) byData.set(data, byRow = new Map());
  const key = `${row}${continuous ? 'c' : ''}`;
  let host = byRow.get(key);
  const year4 = fourDigitYear();   // read as the records are (O2 R1)
  if (!host) byRow.set(key, host = { ...base, renderControl: (c, s) => liveControl(base, data, row, c, s, year4),
    ...(continuous && { extraDetailRows: { count: Math.max(0, data.rows.length - 1 - row), render: (c: ControlDef, s: SectionDef, k: number) => liveControl(base, data, row + k, c, s, year4) } }) });
  return host;
}

/** Une case ou un bouton d'option d'un groupe d'options : sa valeur est celle du groupe (Valeur d'option), pas la sienne. */
const inGroup = (c: ControlDef, s: SectionDef) => flattenControls(s.controls).some((g) => g.kind === 'optionGroup' && !!g.children?.includes(c));

function liveControl(base: DesignerHost, data: LiveData, row: number, c: ControlDef, s: SectionDef, year4: boolean): ReactNode {
  const { display } = base.sheet;
  try {
    const v = liveContent(c, data, row, { locale: display.region.locale, lang: display.lang, ...(year4 ? { fourDigitYear: true } : {}) });
    // ponytail: un bouton de groupe garde son aspect Création ; comparer à la valeur du groupe demanderait de redessiner les boutons quand le groupe change
    if (v.kind === 'placeholder' || (v.kind === 'check' && inGroup(c, s))) return base.renderControl(c, s);
    return preview(c, display, '', v.kind === 'text' ? { text: v.text } : { checked: v.checked === true });
  } catch {
    return base.renderControl(c, s);   // une valeur impossible à mettre en forme : l'aperçu Création, jamais une erreur du canevas
  }
}

/** Ce que montre le concepteur selon le mode : en Page, l'hôte vivant (les données lues) et les gestes restreints
 *  (la boîte à outils reste : on place des contrôles en mode Page comme dans Access). */
export function viewHost(mode: DocMode, base: DesignerHost, data: LiveData | null, row: number, doc?: DesignDoc): { host: DesignerHost; restrict?: DesignerRestrict } {
  if (mode !== 'layout') return { host: base };
  return { host: data ? layoutHost(base, data, row, !!doc && initialView(doc) === 'continuous') : base, restrict: FORM_LAYOUT_RESTRICT };
}
