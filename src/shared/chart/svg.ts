// Rendu SVG déterministe (SSR) d'un graphique : même entrée, mêmes octets, quel que soit le nombre de graphiques déjà dessinés.
import type { EChartsCoreOption } from 'echarts/core';
import { echarts } from './echarts';
import { cssFamily } from '../fonts';

export function chartSvg(option: EChartsCoreOption, size: { width: number; height: number }): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: size.width, height: size.height });
  try {
    // Police par défaut explicite (sinon ECharts met Microsoft YaHei, variable selon la machine) ; l'appelant gagne.
    chart.setOption({ ...option, animation: false, textStyle: { fontFamily: `${cssFamily('Liberation Sans')}, sans-serif`, ...(option as { textStyle?: object }).textStyle } });
    // zrender numérote ses identifiants (zr<n> par instance, puis -cls-<k>, -ani-<k>, -c<k> avec des compteurs de module) :
    // un seul graphique par appel, donc préfixe zr0 ; chaque famille est renumérotée à partir de 0 par ordre d'apparition.
    const seen = new Map<string, string>();
    const count = new Map<string, number>();
    // Seuls les contextes id/sélecteur (précédés de " # . ou ( ) sont réécrits : un texte utilisateur « zr12 » reste intact.
    // L'alternative cls doit précéder c (c est un préfixe de cls).
    return chart.renderToSVGString().replace(/(?<=["#.(])zr\d+(?:-(cls-|ani-|c)\d+)?/g, (id, kind?: string) => {
      if (!kind) return 'zr0';
      let out = seen.get(id);
      if (out === undefined) {
        const n = count.get(kind) ?? 0;
        count.set(kind, n + 1);
        out = id.replace(/^zr\d+/, 'zr0').replace(/\d+$/, String(n));
        seen.set(id, out);
      }
      return out;
    });
  } finally {
    chart.dispose();
  }
}
