// Onglet « Mise en forme » des paramètres du graphique : une série à la fois (choisie parmi les Valeurs), nom, axe, remplissage, bordure,
// étiquettes, courbe de tendance et options de courbe. Chaque champ remplace la série entière par setSeries : un changement = un pas d'annulation.
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { chartFamily, DASHES, ignoresLegend, GAPS, LINE_WIDTH, SERIES_TYPES, seriesName, type ChartSeries, type ChartSpec } from '../../shared/chart/spec';
import { TRENDLINES } from '../../shared/chart/trend';
import { seriesFormatApplies, setSeries } from './chart-settings-model';
import { ColorEditor } from './ColorEditor';

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function ChartSeriesFormat(p: { spec: ChartSpec; readOnly: boolean; idPrefix: string; onSeries(series: ChartSeries[]): void; props?: Record<string, unknown>; onProps?(patch: Record<string, unknown>): void }) {
  const { t } = useTranslation();
  const uid = useId();
  const { spec, readOnly } = p;
  const [pick, setPick] = useState('');
  const value = spec.values.find((v) => same(v.field, pick)) ?? spec.values[0];
  if (!value) return <p className="cs-hint muted" data-testid="chart-series-none">{t('chart.settings.format.noValues')}</p>;
  const cfgOf = (field: string): ChartSeries | undefined => (spec.series ?? []).find((s) => same(s.field, field));
  const cfg: ChartSeries = cfgOf(value.field) ?? { field: value.field };
  const set = (patch: Partial<ChartSeries>) => { if (!readOnly) p.onSeries(setSeries(spec.series ?? [], value.field, patch)); };
  const fallback = seriesName(value);
  const f = (k: string) => t(`chart.settings.format.${k}`);
  const id = (k: string) => `${p.idPrefix}-${k}`;
  const family = chartFamily(spec.type);
  const lines = family === 'line' || family === 'area' || family === 'combo';
  // Ce que le dessin ignore est désactivé (avec une astuce) : voir seriesFormatApplies (secteurs, radar, anneau, arc, entonnoir : rien ; cascade : ses propres couleurs).
  const legended = spec.legend !== '' && !ignoresLegend(spec.type);
  const ap = seriesFormatApplies(spec);
  const round = family === 'pie' || family === 'radar';
  const flat = round || family === 'doughnut' || family === 'arc' || family === 'funnel';   // rien ne s'y règle
  const newer = ['scatter', 'bubble', 'boxWhisker', 'pareto', 'waterfall'].includes(family);
  const styleOk = ap.fill || ap.border;
  const nameOk = styleOk || ap.labels;
  // Chaque astuce a un id propre à l'instance ; le contrôle désactivé s'y rattache par aria-describedby (dby renvoie undefined quand il est actif).
  const hid = (k: string) => `${uid}-hint-${k}`;
  const dby = (ok: boolean, k: string) => (ok ? undefined : hid(k));
  const hint = (ok: boolean, why: string, k: string) => (ok ? null : <p id={hid(k)} className="cs-hint muted">{f(why)}</p>);
  const stylesWhy = round ? 'roundHint' : flat ? 'noEffect' : legended ? 'legendHint' : 'noEffect';
  // Le texte se valide en quittant le champ ou par Entrée (pas un pas d'annulation par frappe) ; `key` remet le champ à jour après une annulation.
  const text = (k: 'name' | 'trendlineName', testId: string, placeholder: string, label: string, disabled = false, by?: string) => (
    <label className="cs-field" htmlFor={id(testId)}>{label}
      <input key={`${value.field}:${cfg[k] ?? ''}`} id={id(testId)} data-testid={testId} type="text" defaultValue={cfg[k] ?? ''} placeholder={placeholder} maxLength={255} disabled={readOnly || disabled} aria-describedby={by}
        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (cfg[k] ?? '')) set({ [k]: v === '' ? undefined : v }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    </label>
  );
  const color = (k: 'color' | 'borderColor', testId: string, label: string, on: boolean, by?: string) => (
    <div className="cs-field"><span>{label}</span>
      <ColorEditor id={id(testId)} testId={testId} value={cfg[k]} mixed={false} disabled={readOnly || !on} describedBy={by} fill={false} commit={(v) => { set({ [k]: (v ?? undefined) as ChartSeries['color'] }); return null; }} /></div>
  );
  const select = <T extends string>(testId: string, label: string, list: readonly T[], current: T, keyOf: (v: T) => string, onPick: (v: T) => void, off = false, by?: string) => (
    <label className="cs-field" htmlFor={id(testId)}>{label}
      <select id={id(testId)} data-testid={testId} value={current} disabled={readOnly || off} aria-describedby={by} onChange={(e) => onPick(e.target.value as T)}>
        {list.map((v) => <option key={v} value={v}>{t(keyOf(v))}</option>)}
      </select>
    </label>
  );
  return (
    <div>
      <h3 className="cs-sub" id={id('series-h')}>{f('series')}</h3>
      <select data-testid="chart-series-pick" aria-labelledby={id('series-h')} value={value.field} onChange={(e) => setPick(e.target.value)}>
        {spec.values.map((v) => <option key={v.field} value={v.field}>{cfgOf(v.field)?.name ?? seriesName(v)}</option>)}
      </select>
      <h3 className="cs-sub">{t('chart.settings.format.heading', { name: cfg.name ?? fallback })}</h3>
      {text('name', 'chart-series-name', fallback, f('fullName'), !nameOk, dby(nameOk, 'style'))}
      {family === 'combo' && select('chart-series-type', f('seriesType'), SERIES_TYPES, cfg.type ?? 'column', (k) => `chart.settings.format.seriesTypes.${k}`, (v) => set({ type: v === 'column' ? undefined : v }))}
      <div className="cs-field" role="radiogroup" aria-label={f('plotOn')}><span>{f('plotOn')}</span>
        <span className="cs-radios">
          {(['primary', 'secondary'] as const).map((a) => (
            <label key={a}><input type="radio" name={id('axis')} data-testid={`chart-series-axis-${a}`} checked={(cfg.secondary === true) === (a === 'secondary')} disabled={readOnly || !ap.secondary} aria-describedby={dby(ap.secondary, 'axis')}
              onChange={() => set({ secondary: a === 'secondary' ? true : undefined })} />{f(a)}</label>
          ))}
        </span>
      </div>
      {hint(ap.secondary, round ? 'roundHint' : flat ? 'noEffect' : newer ? 'noAxis' : 'axisHint', 'axis')}
      {color('color', 'chart-series-fill', f('fill'), ap.fill, dby(styleOk, 'style'))}
      {color('borderColor', 'chart-series-border', f('border'), ap.border, dby(styleOk, 'style'))}
      {hint(styleOk, stylesWhy, 'style')}
      {family === 'waterfall' && (
        <>
          <h3 className="cs-sub">{f('waterfallColors')}</h3>
          {(['WaterfallIncreaseColor', 'WaterfallDecreaseColor', 'WaterfallTotalColor'] as const).map((k, i) => (
            <div key={k} className="cs-field"><span>{t(`prop.${k}`)}</span>
              <ColorEditor id={id(k)} testId={`chart-${k}`} value={p.props?.[k] ?? `theme:accent${i + 1}`} mixed={false} disabled={readOnly || !p.onProps} fill={false}
                commit={(v) => { p.onProps?.({ [k]: v ?? undefined }); return null; }} /></div>
          ))}
        </>
      )}
      <label className="cs-row"><input type="checkbox" data-testid="chart-series-labels" checked={cfg.dataLabels === true} disabled={readOnly || !ap.labels} aria-describedby={dby(styleOk || ap.labels, 'style')} onChange={(e) => set({ dataLabels: e.target.checked ? true : undefined })} />{f('labels')}</label>
      {select('chart-series-trend', f('trend'), TRENDLINES, cfg.trendline ?? 'none', (k) => `chart.settings.format.trendKinds.${k}`, (v) => set({ trendline: v === 'none' ? undefined : v }), !ap.trend, dby(ap.trend, 'trend'))}
      {hint(ap.trend, round ? 'roundHint' : flat ? 'noEffect' : newer ? 'noTrend' : legended ? 'legendHint' : 'trendHint', 'trend')}
      {text('trendlineName', 'chart-series-trend-name', '', f('trendName'), !ap.trend || (cfg.trendline ?? 'none') === 'none', dby(ap.trend, 'trend'))}
      {lines && (
        <>
          <h3 className="cs-sub">{f('lineOptions')}</h3>
          <label className="cs-field" htmlFor={id('chart-series-width')}>{f('lineWidth')}
            <input key={`${value.field}:${cfg.lineWidth ?? ''}`} id={id('chart-series-width')} data-testid="chart-series-width" type="number" min={LINE_WIDTH.min} max={LINE_WIDTH.max} step={0.5} defaultValue={cfg.lineWidth ?? ''}
              disabled={readOnly || legended} aria-describedby={dby(!legended, 'line')}
              onBlur={(e) => {
                const n = e.target.value === '' ? undefined : Number(e.target.value);
                if (n !== undefined && !(n >= LINE_WIDTH.min && n <= LINE_WIDTH.max)) e.target.value = String(cfg.lineWidth ?? '');   // hors limites : on garde l'ancienne valeur
                else if (n !== cfg.lineWidth) set({ lineWidth: n });
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          </label>
          {select('chart-series-dash', f('dash'), DASHES, cfg.dash ?? 'solid', (k) => `chart.settings.format.dashes.${k}`, (v) => set({ dash: v === 'solid' ? undefined : v }), legended, dby(!legended, 'line'))}
          <label className="cs-row"><input type="checkbox" data-testid="chart-series-marker" checked={cfg.marker !== false} disabled={readOnly || legended} aria-describedby={dby(!legended, 'line')} onChange={(e) => set({ marker: e.target.checked ? undefined : false })} />{f('marker')}</label>
          {select('chart-series-gap', f('gap'), GAPS, cfg.gap ?? 'gap', (k) => `chart.settings.format.gaps.${k}`, (v) => set({ gap: v === 'gap' ? undefined : v }), legended, dby(!legended, 'line'))}
          {hint(!legended, 'legendHint', 'line')}
        </>
      )}
    </div>
  );
}
