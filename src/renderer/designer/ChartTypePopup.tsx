// Ruban › Insérer un graphique moderne : Histogramme / Barres / Courbe / Zone, chacun en groupé / empilé / empilé 100 %, Radar (simple ou rempli), plus Secteurs et Combiné.
// Choisir un type ne change pas le document, l'hôte arme l'outil Graphique. Un sous-menu s'ouvre sous sa famille (Entrée, clic ou Droite, qui place le focus sur la première variante),
// Échap ou Gauche le referme (le focus revient à la famille) ; Échap sur une autre famille referme aussi le sous-menu ; un second Échap ferme le menu.
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { NEW_CHART_TYPES, type ChartType } from '../../shared/chart/spec';
import { RibbonPopup } from './RibbonPopup';

type Family = 'column' | 'bar' | 'line' | 'area' | 'radar';
const FAMILIES: readonly Family[] = ['column', 'bar', 'line', 'area', 'radar'];
const STACKS = ['clustered', 'stacked', 'stacked100'] as const;
type Variant = (typeof STACKS)[number] | 'radar' | 'radarFilled';
const variantsOf = (f: Family): readonly Variant[] => (f === 'radar' ? ['radar', 'radarFilled'] : STACKS);
const typeOf = (f: Family, v: Variant): ChartType => v === 'radar' || v === 'radarFilled' ? v :
  ((f === 'column' || f === 'bar') && v === 'clustered' ? `${f}Clustered` : f === 'line' && v === 'clustered' ? 'line' : f === 'area' && v === 'clustered' ? 'area'
    : `${f}${v === 'stacked' ? 'Stacked' : 'Stacked100'}`) as ChartType;

/** Les types proposés après Combiné (anneau, arc, entonnoir, nuage de points, bulles) ; les tâches suivantes y ajoutent les leurs. */
export const NEW_TYPES = NEW_CHART_TYPES;

export function ChartTypePopup(p: { onPick(type: ChartType): void; onClose(): void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Family | null>(null);
  const focusFamily = (f: Family) => setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="chart-family-${f}"]`)?.focus(), 0);
  const keys = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const fam = el.dataset.family as Family | undefined;
    if (e.key === 'ArrowRight' && fam && el.dataset.sub === undefined) {
      e.preventDefault(); setOpen(fam);
      setTimeout(() => document.querySelector<HTMLElement>(`[data-family="${fam}"][data-sub]`)?.focus(), 0);
    } else if (open && (e.key === 'ArrowLeft' || (e.key === 'Escape' && fam))) {
      e.preventDefault(); e.stopPropagation(); setOpen(null); if (e.key === 'ArrowLeft' || fam === open) focusFamily(open);
    }
  };
  return (
    <RibbonPopup anchor="insertModernChart" testId="chart-type-popup" labelKey="ribbon.cmd.insertModernChart" onClose={p.onClose}>
      <div onKeyDown={keys} style={{ display: 'contents' }}>
        {FAMILIES.map((f) => (
          <div key={f} style={{ display: 'contents' }}>
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === f} data-testid={`chart-family-${f}`} data-family={f}
              onClick={() => setOpen(open === f ? null : f)}>{t(`chart.family.${f}`)}<span className="ctxmenu-chev" aria-hidden>{open === f ? '▾' : '▸'}</span></button>
            {open === f && variantsOf(f).map((v) => (
              <button key={v} type="button" role="menuitem" data-sub="" data-family={f} style={{ paddingLeft: 24 }}
                data-testid={`chart-type-${typeOf(f, v)}`} onClick={() => p.onPick(typeOf(f, v))}>{t(`chart.variant.${v}`)}</button>
            ))}
          </div>
        ))}
        <button type="button" role="menuitem" data-testid="chart-type-pie" onClick={() => p.onPick('pie')}>{t('propValue.ChartType.pie')}</button>
        <button type="button" role="menuitem" data-testid="chart-type-combo" onClick={() => p.onPick('combo')}>{t('propValue.ChartType.combo')}</button>
        {NEW_TYPES.map((ty) => <button key={ty} type="button" role="menuitem" data-testid={`chart-type-${ty}`} onClick={() => p.onPick(ty)}>{t(`propValue.ChartType.${ty}`)}</button>)}
      </div>
    </RibbonPopup>
  );
}
