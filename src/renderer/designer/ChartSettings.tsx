// Volet Paramètres du graphique (onglet Données), ancré comme la Liste des champs. Il édite le graphique sélectionné par `onChange`
// (un correctif de propriétés = un pas d'annulation, voir setChartProps). En lecture seule il reste visible, ses champs sont désactivés.
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AGGS, chartDataMode, chartFamily, DATE_GROUPS, type Agg, type ChartSeries, type ChartSpec } from '../../shared/chart/spec';
import type { RecordSourceRef, SourceField } from '../../shared/record-source';
import { api } from '../bridge';
import { isDateField, listSources, setAgg, setDateGroup, setLegend, setSource, sourceKindOf, specPatch, toggleAxis, toggleValue, typeHintKey, type SourceKind } from './chart-settings-model';
import { errorMessage } from '../shell/Modal';
import { PopupMenu } from './RibbonPopup';
import { ChartSeriesFormat } from './ChartSeriesFormat';

const KINDS: SourceKind[] = ['tables', 'queries', 'both'];
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function Section(p: { id: string; title: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <section className="cs-section" aria-labelledby={`${p.id}-h`}>
      <div className="cs-head">
        <h3 id={`${p.id}-h`}>{p.title}</h3>
        <button type="button" className="cs-fold" data-testid={`${p.id}-fold`} aria-expanded={open} aria-controls={`${p.id}-body`}
          aria-label={t(open ? 'chart.settings.collapse' : 'chart.settings.expand')} title={t(open ? 'chart.settings.collapse' : 'chart.settings.expand')} onClick={() => setOpen(!open)}>
          {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
      </div>
      <div id={`${p.id}-body`} hidden={!open}>{p.children}</div>
    </section>
  );
}

/** `spec` null : aucun graphique sélectionné. Le parent met `key` sur le nom du graphique (l'état local repart de zéro). */
export function ChartSettings(p: { spec: ChartSpec | null; docSource: RecordSourceRef | null; tables: string[]; queries: string[]; readOnly: boolean;
  onChange(patch: Record<string, unknown>): void; onClose(): void }) {
  const { t } = useTranslation();
  const { spec, readOnly } = p;
  const uid = useId();
  const [kind, setKind] = useState<SourceKind>(() => (spec ? sourceKindOf(spec) : 'both'));
  const [fields, setFields] = useState<SourceField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'data' | 'format'>('data');
  const tabs = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; field: string } | null>(null);
  const ref = spec ? (spec.source ?? p.docSource) : null;
  const refKey = JSON.stringify(ref);
  useEffect(() => {
    setFields([]); setError(null);   // les champs de l'ancienne source ne restent pas cochables
    if (!ref) return;
    let live = true;
    api.sources.describe(ref).then((i) => { if (live) setFields(i.fields); }, (e) => { if (live) { const m = errorMessage(e); setError(t(m.key, m.params)); } });
    return () => { live = false; };
  }, [refKey]);   // eslint-disable-line react-hooks/exhaustive-deps -- ref est dérivé de refKey

  const head = (
    <div className="dz-props-head">{t('chart.settings.title')}
      <button type="button" className="cs-close" data-testid="chart-settings-close" aria-label={t('chart.settings.close')} title={t('chart.settings.close')} onClick={p.onClose}><X size={14} aria-hidden /></button>
    </div>
  );
  if (!spec) {
    return <section className="dz-fields cs" aria-label={t('chart.settings.title')} data-testid="chart-settings">{head}<p className="cs-hint muted">{t('chart.settings.noChart')}</p></section>;
  }
  const commit = (next: ChartSpec) => { if (readOnly) return; const patch = specPatch(spec, next); if (Object.keys(patch).length) p.onChange(patch); };
  const names = listSources(kind, p.tables, p.queries);
  const own = spec.source && 'name' in spec.source ? spec.source.name : '';
  const options = own && !names.some((n) => sameName(n, own)) ? [own, ...names] : names;   // une source hors du genre choisi reste visible
  const pickSource = (name: string) => commit(setSource(spec, name === '' ? null : { kind: p.tables.some((n) => sameName(n, name)) ? 'table' : 'query', name }));
  const aggLabel = (a: Agg) => t(`chart.settings.agg.${a}`);
  const hintId = `${uid}-hint`;
  // Onglets : flèches gauche/droite (et Début/Fin) passent de l'un à l'autre en déplaçant le focus (une seule tabulation dans la liste).
  const TABS = ['data', 'format'] as const;
  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const j = e.key === 'ArrowRight' || e.key === 'ArrowLeft' ? (i + 1) % 2 : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : -1;
    if (j < 0) return;
    e.preventDefault(); setTab(TABS[j]!);
    tabs.current?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus();
  };
  const rows = chartDataMode(spec.type) === 'rows';   // nuage, bulles : les valeurs ne s'agrègent pas
  const hint = typeHintKey(spec);
  const xHint = chartFamily(spec.type) === 'scatter' || chartFamily(spec.type) === 'bubble';
  const multiLegend = spec.legend !== '' && spec.values.length > 1;

  return (
    <section className="dz-fields cs" aria-label={t('chart.settings.title')} data-testid="chart-settings">
      {head}
      <div className="cs-tabs" role="tablist" ref={tabs} onKeyDown={onTabKey}>
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" id={`${uid}-tab-${k}`} aria-selected={tab === k} aria-controls={`${uid}-panel-${k}`} tabIndex={tab === k ? 0 : -1}
            data-testid={`chart-settings-tab-${k}`} onClick={() => setTab(k)}>{t(k === 'data' ? 'chart.settings.tabData' : 'chart.settings.tabFormat')}</button>
        ))}
      </div>
      {(
        <div className="cs-body" role="tabpanel" id={`${uid}-panel-format`} aria-labelledby={`${uid}-tab-format`} hidden={tab !== 'format'}>
          <ChartSeriesFormat spec={spec} readOnly={readOnly} idPrefix={uid} onSeries={(series: ChartSeries[]) => commit({ ...spec, series })} />
        </div>
      )}
      <div className="cs-body" role="tabpanel" id={`${uid}-panel-data`} aria-labelledby={`${uid}-tab-data`} hidden={tab !== 'data'}>
        {hint && <p className="cs-hint muted" data-testid="chart-type-hint">{t(hint)}</p>}
        <Section id={`${uid}-source`} title={t('chart.settings.source')}>
          <div role="radiogroup" aria-label={t('chart.settings.source')} className="cs-kinds">
            {KINDS.map((k) => (
              <label key={k}><input type="radio" name={`${uid}-kind`} data-testid={`chart-source-kind-${k}`} checked={kind === k} disabled={readOnly} onChange={() => setKind(k)} />
                {t(`chart.settings.source${k === 'tables' ? 'Tables' : k === 'queries' ? 'Queries' : 'Both'}`)}</label>
            ))}
          </div>
          <select data-testid="chart-source" aria-label={t('chart.settings.sourceName')} value={own} disabled={readOnly} onChange={(e) => pickSource(e.target.value)}>
            <option value="">{t('chart.settings.sourceDoc')}</option>
            {options.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {error && <p role="alert" className="cs-hint" data-testid="chart-source-error">{error}</p>}
        </Section>
        <Section id={`${uid}-axis`} title={t('chart.settings.axis')}>
          {fields.map((f) => (
            <label key={f.name} className="cs-row"><input type="checkbox" data-testid={`chart-axis-${f.name}`} checked={spec.axis.some((a) => sameName(a, f.name))} disabled={readOnly}
              onChange={() => commit(toggleAxis(spec, f.name))} />{f.name}</label>
          ))}
          {xHint && <p className="cs-hint muted" data-testid="chart-axis-x-hint">{t('chart.settings.axisXHint')}</p>}
          {isDateField(fields, spec.axis[0]) && (
            <label className="cs-row">{t('chart.settings.dateGroup')}
              <select data-testid="chart-date-group" value={spec.dateGroup} disabled={readOnly} onChange={(e) => commit(setDateGroup(spec, e.target.value as ChartSpec['dateGroup']))}>
                {DATE_GROUPS.map((g) => <option key={g} value={g}>{t(`propValue.ChartDateGroup.${g}`)}</option>)}
              </select>
            </label>
          )}
        </Section>
        <Section id={`${uid}-legend`} title={t('chart.settings.legend')}>
          <div role="radiogroup" aria-label={t('chart.settings.legend')}>
            <label className="cs-row"><input type="radio" name={`${uid}-legend`} data-testid="chart-legend-none" checked={spec.legend === ''} disabled={readOnly}
              onChange={() => commit(setLegend(spec, ''))} />{t('chart.settings.legendNone')}</label>
            {fields.map((f) => (
              <label key={f.name} className="cs-row"><input type="radio" name={`${uid}-legend`} data-testid={`chart-legend-${f.name}`} checked={sameName(spec.legend, f.name)} disabled={readOnly}
                onChange={() => commit(setLegend(spec, f.name))} />{f.name}</label>
            ))}
          </div>
        </Section>
        <Section id={`${uid}-values`} title={t('chart.settings.values')}>
          {rows && <p id={`${uid}-rows`} className="cs-hint muted" data-testid="chart-rows-hint">{t('chart.settings.rowsHint')}</p>}
          {multiLegend && <p id={hintId} className="cs-hint muted" data-testid="chart-legend-hint">{t('chart.settings.legendHint')}</p>}
          {fields.map((f) => {
            const i = spec.values.findIndex((v) => sameName(v.field, f.name));
            const v = spec.values[i];
            const dim = multiLegend && i > 0;   // avec une légende, seule la première valeur est tracée
            return (
              <div key={f.name} className={`cs-row${dim ? ' cs-dim' : ''}`}>
                <label><input type="checkbox" data-testid={`chart-value-${f.name}`} checked={!!v} disabled={readOnly} onChange={() => commit(toggleValue(spec, f.name))}
                  aria-label={f.name} aria-describedby={dim ? hintId : undefined} /></label>
                {v && !rows ? (
                  <button type="button" className="cs-agg" data-testid={`chart-value-label-${f.name}`} aria-describedby={dim ? hintId : undefined} aria-haspopup="menu" aria-expanded={menu?.field === f.name} disabled={readOnly}
                    onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom, field: f.name }); }}>{f.name} ({aggLabel(v.agg)})</button>
                ) : <span aria-describedby={rows ? `${uid}-rows` : undefined}>{f.name}</span>}
              </div>
            );
          })}
        </Section>
      </div>
      {menu && (
        <PopupMenu x={menu.x} y={menu.y} testId="chart-agg-menu" labelKey="chart.settings.aggMenu" onClose={() => setMenu(null)}>
          {AGGS.map((a) => {
            const on = spec.values.find((v) => sameName(v.field, menu.field))?.agg === a;
            return (
              <button key={a} type="button" role="menuitemradio" aria-checked={on} data-testid={`chart-agg-${menu.field}-${a}`} disabled={readOnly}
                onClick={() => { setMenu(null); commit(setAgg(spec, menu.field, a)); }}>
                <Check size={14} aria-hidden style={{ visibility: on ? 'visible' : 'hidden' }} />{aggLabel(a)}
              </button>
            );
          })}
        </PopupMenu>
      )}
    </section>
  );
}
