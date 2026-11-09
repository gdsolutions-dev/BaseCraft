// Branchement commun des vues Création (formulaire, état) : Insérer un graphique moderne (liste des types, outil armé) et le volet
// Paramètres du graphique (ouvert par la commande ou par la sélection d'un graphique). Une seule définition pour les deux hôtes.
import { useEffect, useState, type ReactNode } from 'react';
import { readChartSpec } from '../../shared/chart/spec';
import type { CommandHandlers } from '../shell/ribbon-model';
import { ChartSettings } from './ChartSettings';
import { armedChartTool, selectedChart } from './chart-settings-model';
import { ChartTypePopup } from './ChartTypePopup';
import { setChartProps } from './designer-commands';
import type { DesignerAction, DesignerState } from './designer-model';
import type { ToolState } from './Designer';


export function useChartPane(p: { state: DesignerState; dispatch: (a: DesignerAction) => void; readOnly: boolean; tables: string[]; queries: string[]; onTool(t: ToolState): void }):
  { hasChart: boolean; commands: CommandHandlers; side: ReactNode; popup: ReactNode } {
  const chart = selectedChart(p.state);
  const name = chart?.name ?? null;
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState(false);
  useEffect(() => { if (name) setOpen(true); }, [name]);   // sélectionner un graphique ouvre le volet
  return {
    hasChart: name !== null,
    // sans graphique sélectionné la commande n'est pas enregistrée : le ruban la grise
    commands: { insertModernChart: () => setTypes(true), ...(name ? { chartSettings: () => setOpen(true) } : {}) },
    side: open && (
      <ChartSettings key={name ?? ''} spec={chart ? readChartSpec(chart.props) : null} docSource={p.state.doc.recordSource} tables={p.tables} queries={p.queries}
        readOnly={p.readOnly} onChange={(patch) => { if (name) p.dispatch(setChartProps([name], patch)); }} onClose={() => setOpen(false)} />
    ),
    popup: types && <ChartTypePopup onPick={(t) => { setTypes(false); p.onTool(armedChartTool(t)); }} onClose={() => setTypes(false)} />,
  };
}
