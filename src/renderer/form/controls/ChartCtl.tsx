// Graphique moderne (F4) en vues Formulaire, Page et Création : une instance ECharts SVG vivante (info-bulles, redimensionnement),
// la même option que l'impression (chartOption), plus l'info-bulle, ajoutée ici seulement pour que l'état imprimé n'en ait jamais.
import { createContext, useContext, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { echarts } from '../../../shared/chart/echarts';
import { chartFrame, chartOption, chartTooltip, readChartFormat, sampleFor } from '../../../shared/chart/option';
import { chartPalette } from '../../../shared/chart/palette';
import type { ChartData } from '../../../shared/chart/query';
import { readChartSpec, typeHintKey } from '../../../shared/chart/spec';
import { trendLabels } from '../../../shared/chart/trend';
import type { RecordSourceRef } from '../../../shared/record-source';
import { useDocTheme } from '../../design/doc-theme';
import type { SqlValue } from '../../../shared/coerce';
import { masterValues, splitFields } from '../links';
import { prop } from '../run-model';
import { tipOf, type CtlProps } from './run-ctx';
import { chartRequest, useChartData } from './chart-view';

type Ctl = CtlProps['c'];

/** Le graphique dessiné dans `data` ; l'instance naît une fois, meurt au démontage, suit la taille de son cadre. */
function Canvas({ c, data, prefix }: { c: Ctl; data: ChartData; prefix: string }) {
  const { t, i18n } = useTranslation();
  const { theme, mode } = useDocTheme();
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);
  const spec = useMemo(() => readChartSpec(c.props), [c.props]);
  const option = useMemo(() => {
    const o = chartOption(spec, data, readChartFormat(c.props, { title: t('chart.defaultTitle'), empty: t('chart.emptyCategory'), trends: trendLabels(t), total: t('chart.waterfall.total'), cumulative: t('chart.pareto.cumulative') }), chartPalette(theme, mode), { width: 0, height: 0 });
    return { ...o, tooltip: chartTooltip(spec, o, i18n.language) };
  }, [spec, data, c.props, t, i18n.language, theme, mode]);

  useEffect(() => {
    const el = box.current!;
    const inst = chart.current = echarts.init(el, null, { renderer: 'svg' });
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(el);
    return () => { ro.disconnect(); inst.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    chart.current?.setOption(option, true);
    box.current?.querySelector('svg')?.setAttribute('data-testid', `${prefix}chart-svg`);
  }, [option, prefix]);
  // cadre du graphique (ChartBorder*) : aucun trait quand la bordure est transparente
  const fr = chartFrame(readChartFormat(c.props, { title: '', empty: '' }), chartPalette(theme, mode));
  // des lignes mais rien à tracer (nuage de points sur un X texte...) : le texte d'aide du type, sinon « aucune donnée »
  const none = data.rows.length > 0 && ((option as { series?: unknown[] }).series ?? []).length === 0;
  const hint = typeHintKey(spec);
  return (
    <>
      <div ref={box} style={{ width: '100%', height: '100%', boxSizing: 'border-box', ...(fr ? { border: `${fr.width}px ${fr.style} ${fr.color}` } : {}) }} />
      {none && <div className="frun-chart-empty muted" style={{ position: 'absolute', inset: 0 }} data-testid={`${prefix}chart-empty`}>{t(hint ?? 'chart.noData')}</div>}
    </>
  );
}

/** La source d'enregistrements du document en Création : celle d'un graphique sans source propre. */
export const ChartDocSource = createContext<RecordSourceRef | null>(null);

const NO_DATA: ChartData = { columns: [], rows: [], truncated: false };
const FRAME: CSSProperties = { overflow: 'hidden' };

export function ChartCtl({ c, x, style }: CtlProps) {
  const { t } = useTranslation();
  const docSource = x.chart?.source ?? null;
  // Champs père/fils (comme un sous-formulaire) : le graphique suit l'enregistrement courant du formulaire.
  const masterF = useMemo(() => splitFields(String(prop(c, 'LinkMasterFields') ?? '')), [c.props]);   // eslint-disable-line react-hooks/exhaustive-deps -- c.props
  const childF = useMemo(() => splitFields(String(prop(c, 'LinkChildFields') ?? '')), [c.props]);   // eslint-disable-line react-hooks/exhaustive-deps -- c.props
  // les valeurs du père, gardées pendant qu'il se relit (jamais de null de passage, comme SubformCtl)
  const shown = useRef<SqlValue[] | null>(null);
  if (!x.snap.busy) shown.current = masterF.length ? masterValues(masterF, x.snap) : null;
  const values = shown.current;
  const badLink = masterF.length !== childF.length;
  const key = JSON.stringify(values);
  // Une autre ligne (formulaire continu, feuille) ne charge rien : seul l'enregistrement courant dessine le graphique.
  const req = useMemo(() => x.other ? null : chartRequest(readChartSpec(c.props), docSource, x.chart?.params, { master: masterF, child: childF, values }),
    [c.props, docSource, x.chart?.params, x.other, masterF, childF, key]);   // eslint-disable-line react-hooks/exhaustive-deps -- les valeurs par leur texte
  const { data } = useChartData(req, x.chart?.version);
  const empty = !data || data.rows.length === 0;
  if (x.other) return <div className="frun-chart" style={{ ...FRAME, ...style }} data-testid={`form-ctl-${c.name}`} />;
  const hasSource = !!(docSource || readChartSpec(c.props).source);
  return (
    <div className="frun-chart" style={{ ...FRAME, ...style }} data-testid={`form-ctl-${c.name}`} {...tipOf(c)}>
      {empty
        ? <div className="frun-chart-empty muted" data-testid="chart-empty">{t(badLink ? 'chart.badLink' : hasSource ? 'chart.noData' : 'chart.noSource')}</div>
        : <Canvas c={c} data={data} prefix="" />}
      {data?.truncated && <div className="frun-chart-hint" data-testid="chart-truncated">{t('chart.truncated')}</div>}
    </div>
  );
}

/** L'aperçu en Création (formulaires et états) : les données quand la source du graphique se résout, sinon l'exemple fixe. */
export function DesignChart({ c, className, style }: { c: Ctl; className: string; style: CSSProperties }) {
  const { t } = useTranslation();
  const docSource = useContext(ChartDocSource);
  const req = useMemo(() => chartRequest(readChartSpec(c.props), docSource), [c.props, docSource]);
  const { data } = useChartData(req);
  const sample = req === null;   // the fixed sample only without a source or fields; a valid empty source draws the real placeholder
  return (
    <div className={className} style={{ ...FRAME, ...style }} data-testid={sample ? 'design-chart-sample' : undefined}>
      <Canvas c={c} data={sample ? sampleFor(readChartSpec(c.props).type) : data ?? NO_DATA} prefix="design-" />
      {data?.truncated && <div className="frun-chart-hint" data-testid="design-chart-truncated">{t('chart.truncated')}</div>}
    </div>
  );
}

